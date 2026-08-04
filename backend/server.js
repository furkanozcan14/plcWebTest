/**
 * server.js
 * Delta PLC Web Test Bench — Ana Sunucu
 * Express HTTP + Socket.io WebSocket + Modbus TCP polling
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const ModbusClient = require('./modbusClient');
const FailSafeManager = require('./failSafe');

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT = 3000;
const POLL_INTERVAL_MS = 200;

// ─── State ────────────────────────────────────────────────────────────────────
let plcState = {
  status: 'DISCONNECTED', // DISCONNECTED | CONNECTED | RECONNECTING | STOPPED | FAIL_SAFE
  ip: '192.168.1.50',
  port: 502,
  simulationMode: false,  // PLC bağlı değilken simülasyon verisi üretir
  running: false,          // Master START/STOP durumu
  tags: [                  // Varsayılan değişken eşleme tablosu
    { id: 1, name: 'Evaporatör Sıcaklığı', type: 'register', address: 100, unit: '°C',  value: 0 },
    { id: 2, name: 'Kompresör Basıncı',    type: 'register', address: 102, unit: 'bar', value: 0 },
    { id: 3, name: 'Sıvı Vana Durumu',     type: 'coil',     address: 10,  unit: '',    value: 0 },
    { id: 4, name: 'Fan Hızı',             type: 'register', address: 104, unit: 'RPM', value: 0 },
  ],
  nextTagId: 5,
  simValues: {}            // Simülasyon değerleri
};

// ─── Modbus & FailSafe ────────────────────────────────────────────────────────
function broadcastLog(msg) {
  const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  io.emit('plc:log', { message: entry, timestamp: new Date().toISOString() });
}

const modbusClient = new ModbusClient(broadcastLog);
const failSafe = new FailSafeManager(modbusClient, io, broadcastLog);

// ─── Polling ──────────────────────────────────────────────────────────────────
let pollTimer = null;

function initSimValues() {
  plcState.simValues = {};
  for (const tag of plcState.tags) {
    if (tag.type === 'register') {
      if (tag.address === 100) plcState.simValues[tag.id] = 18;   // Evaporatör ~18°C
      else if (tag.address === 102) plcState.simValues[tag.id] = 12; // Basınç ~12bar
      else if (tag.address === 104) plcState.simValues[tag.id] = 1450; // Fan RPM
      else plcState.simValues[tag.id] = 0;
    } else {
      plcState.simValues[tag.id] = 0;
    }
  }
}

function updateSimValues() {
  for (const tag of plcState.tags) {
    if (tag.type === 'register') {
      let current = plcState.simValues[tag.id] || 0;
      if (tag.address === 100) {
        // Evaporatör sıcaklığı: 15-25°C arası gerçekçi dalgalanma
        current += (Math.random() - 0.5) * 0.4;
        current = Math.max(15, Math.min(25, current));
      } else if (tag.address === 102) {
        // Basınç: 10-15 bar
        current += (Math.random() - 0.5) * 0.2;
        current = Math.max(10, Math.min(15, current));
      } else if (tag.address === 104) {
        // Fan RPM: 1400-1500
        current += (Math.random() - 0.5) * 10;
        current = Math.max(1400, Math.min(1500, current));
      }
      plcState.simValues[tag.id] = current;
      tag.value = Math.round(current);
    }
  }
}

async function pollPlc() {
  if (!plcState.running) return;

  if (plcState.simulationMode) {
    updateSimValues();
    io.emit('plc:data', {
      tags: plcState.tags.map(t => ({ id: t.id, name: t.name, type: t.type, address: t.address, unit: t.unit, value: t.value })),
      status: plcState.status,
      running: plcState.running,
      simulationMode: true
    });
    return;
  }

  // PLC bağlı ise gerçek okuma
  if (!modbusClient.isConnected()) {
    if (plcState.status !== 'RECONNECTING') {
      plcState.status = 'DISCONNECTED';
      io.emit('plc:status', { status: 'DISCONNECTED' });
      failSafe.startReconnect(plcState.ip, plcState.port);
    }
    return;
  }

  for (const tag of plcState.tags) {
    try {
      let result;
      if (tag.type === 'register') {
        result = await modbusClient.readRegister(tag.address);
      } else if (tag.type === 'coil') {
        result = await modbusClient.readCoil(tag.address);
      }

      if (result && result.success) {
        tag.value = result.value;
      } else if (result && result.error === 'NOT_CONNECTED') {
        // Bağlantı koptu
        plcState.status = 'DISCONNECTED';
        if (!failSafe.isReconnecting) {
          failSafe.startReconnect(plcState.ip, plcState.port);
        }
        break;
      }
    } catch (err) {
      broadcastLog(`[ERR_POLL] Tag "${tag.name}" polling hatası: ${err.message}`);
    }
  }

  io.emit('plc:data', {
    tags: plcState.tags.map(t => ({ id: t.id, name: t.name, type: t.type, address: t.address, unit: t.unit, value: t.value })),
    status: plcState.status,
    running: plcState.running,
    simulationMode: false
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollPlc, POLL_INTERVAL_MS);
  broadcastLog(`[POLLING] Başlatıldı — ${POLL_INTERVAL_MS}ms aralık`);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  broadcastLog('[POLLING] Durduruldu.');
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// PLC'ye bağlan
app.post('/api/connect', async (req, res) => {
  try {
    const { ip, port, tags, simulation } = req.body;
    plcState.ip = ip || '192.168.1.50';
    plcState.port = parseInt(port, 10) || 502;

    if (tags && Array.isArray(tags)) {
      plcState.tags = tags;
    }

    if (simulation) {
      plcState.simulationMode = true;
      plcState.status = 'SIMULATION';
      broadcastLog(`[SIM MODE] Simülasyon modu aktif — PLC: ${plcState.ip}:${plcState.port}`);
      initSimValues();
      res.json({ success: true, status: 'SIMULATION', message: 'Simülasyon modu başlatıldı.' });
    } else {
      plcState.simulationMode = false;
      broadcastLog(`[CONNECT] ${plcState.ip}:${plcState.port} bağlanılıyor...`);
      const result = await modbusClient.connect(plcState.ip, plcState.port);

      if (result.success) {
        plcState.status = 'CONNECTED';
        io.emit('plc:status', { status: 'CONNECTED' });
        res.json({ success: true, status: 'CONNECTED' });
      } else {
        plcState.status = 'DISCONNECTED';
        res.json({ success: false, status: 'DISCONNECTED', error: result.error });
      }
    }
  } catch (err) {
    broadcastLog(`[ERR] /api/connect → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PLC bağlantısını kes
app.post('/api/disconnect', async (req, res) => {
  try {
    failSafe.cancelReconnect();
    await modbusClient.disconnect();
    plcState.status = 'DISCONNECTED';
    plcState.simulationMode = false;
    res.json({ success: true });
  } catch (err) {
    broadcastLog(`[ERR] /api/disconnect → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Register yaz (D register)
app.post('/api/write', async (req, res) => {
  try {
    const { address, value } = req.body;

    if (address === undefined || value === undefined) {
      return res.status(400).json({ success: false, error: 'address ve value gerekli.' });
    }

    if (plcState.simulationMode) {
      // Simülasyon modunda lokal güncelle
      const tag = plcState.tags.find(t => t.type === 'register' && t.address === parseInt(address, 10));
      if (tag) {
        tag.value = parseInt(value, 10);
        plcState.simValues[tag.id] = tag.value;
        broadcastLog(`[WRITE SUCCESS] Delta Register D${address} set to ${value} (SIM)`);
        return res.json({ success: true, value: tag.value });
      }
      return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    }

    const result = await modbusClient.writeRegister(address, value);
    if (result.success) {
      // Lokal state güncelle
      const tag = plcState.tags.find(t => t.type === 'register' && t.address === parseInt(address, 10));
      if (tag) tag.value = result.value;
      res.json({ success: true, value: result.value });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    broadcastLog(`[ERR] /api/write → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Coil yaz (M relay)
app.post('/api/coil', async (req, res) => {
  try {
    const { address, value } = req.body;

    if (address === undefined || value === undefined) {
      return res.status(400).json({ success: false, error: 'address ve value gerekli.' });
    }

    if (plcState.simulationMode) {
      const tag = plcState.tags.find(t => t.type === 'coil' && t.address === parseInt(address, 10));
      if (tag) {
        tag.value = value ? 1 : 0;
        const stateStr = tag.value ? 'ON (1)' : 'OFF (0)';
        broadcastLog(`[COIL WRITE] M${address} → ${stateStr} (SIM)`);
        return res.json({ success: true, value: tag.value });
      }
      return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    }

    const result = await modbusClient.writeCoil(address, value);
    if (result.success) {
      const tag = plcState.tags.find(t => t.type === 'coil' && t.address === parseInt(address, 10));
      if (tag) tag.value = result.value;
      res.json({ success: true, value: result.value });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    broadcastLog(`[ERR] /api/coil → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Master START
app.post('/api/start', async (req, res) => {
  try {
    if (!plcState.running) {
      plcState.running = true;
      if (plcState.simulationMode) initSimValues();
      startPolling();
      broadcastLog('[MASTER] Sistem BAŞLATILDI — Durum: RUNNING');
      io.emit('plc:status', { status: plcState.status, running: true });
    }
    res.json({ success: true, running: true });
  } catch (err) {
    broadcastLog(`[ERR] /api/start → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Master STOP + Fail-Safe
app.post('/api/stop', async (req, res) => {
  try {
    if (plcState.running) {
      plcState.running = false;
      stopPolling();
      await failSafe.triggerFailSafe('MASTER_STOP');
      broadcastLog('[MASTER] Sistem DURDURULDU — Fail-Safe aktif.');
      io.emit('plc:status', { status: 'STOPPED', running: false });
    }
    res.json({ success: true, running: false });
  } catch (err) {
    broadcastLog(`[ERR] /api/stop → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tag ekle
app.post('/api/tags', (req, res) => {
  try {
    const { name, type, address, unit } = req.body;
    if (!name || !type || address === undefined) {
      return res.status(400).json({ success: false, error: 'name, type ve address gerekli.' });
    }
    const newTag = { id: plcState.nextTagId++, name, type, address: parseInt(address, 10), unit: unit || '', value: 0 };
    plcState.tags.push(newTag);
    broadcastLog(`[CONFIG] Tag eklendi: ${name} (${type === 'register' ? 'D' : 'M'}${address})`);
    res.json({ success: true, tag: newTag });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tag sil
app.delete('/api/tags/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const idx = plcState.tags.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    const removed = plcState.tags.splice(idx, 1)[0];
    broadcastLog(`[CONFIG] Tag silindi: ${removed.name}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Mevcut state
app.get('/api/state', (req, res) => {
  res.json({
    status: plcState.status,
    running: plcState.running,
    simulationMode: plcState.simulationMode,
    tags: plcState.tags,
    ip: plcState.ip,
    port: plcState.port
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  broadcastLog(`[WS] İstemci bağlandı: ${socket.id}`);
  // Bağlanan istemciye mevcut durumu gönder
  socket.emit('plc:status', { status: plcState.status, running: plcState.running });
  socket.emit('plc:data', {
    tags: plcState.tags,
    status: plcState.status,
    running: plcState.running,
    simulationMode: plcState.simulationMode
  });

  socket.on('disconnect', () => {
    broadcastLog(`[WS] İstemci ayrıldı: ${socket.id}`);
  });
});

// ─── Başlat ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Delta PLC Web Test Bench — Sunucu Başlatıldı   ║`);
  console.log(`║  http://localhost:${PORT}                           ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  broadcastLog('[SERVER] Delta PLC Web Test Bench v1.0 hazır.');
});
