/**
 * server.js — Faz 1 Refactor
 * Delta PLC Web Test Bench — Ana Sunucu
 * Express HTTP + Socket.io WebSocket + Modbus TCP polling
 * Faz 1: dataType (FLOAT32/INT16/UINT16/COIL), min/max clamping desteği
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

// ─── Varsayılan Tag Listesi (Faz 1: dataType, min, max alanlarıyla) ──────────
const DEFAULT_TAGS = [
  {
    id: 1, name: 'Evaporatör Sıcaklığı',
    type: 'register', dataType: 'FLOAT32',
    address: 100, unit: '°C',
    min: -50, max: 150,
    value: 0
  },
  {
    id: 2, name: 'Kompresör Basıncı',
    type: 'register', dataType: 'INT16',
    address: 102, unit: 'bar',
    min: 0, max: 50,
    value: 0
  },
  {
    id: 3, name: 'Sıvı Vana Durumu',
    type: 'coil', dataType: 'COIL',
    address: 10, unit: '',
    min: undefined, max: undefined,
    value: 0
  },
  {
    id: 4, name: 'Fan Hızı',
    type: 'register', dataType: 'UINT16',
    address: 104, unit: 'RPM',
    min: 0, max: 3000,
    value: 0
  },
];

// ─── State ────────────────────────────────────────────────────────────────────
let plcState = {
  status: 'DISCONNECTED',
  ip: '192.168.1.50',
  port: 502,
  simulationMode: false,
  running: false,
  tags: JSON.parse(JSON.stringify(DEFAULT_TAGS)), // deep copy
  nextTagId: 5,
  simValues: {}
};

// ─── Log ──────────────────────────────────────────────────────────────────────
function broadcastLog(msg) {
  const ts = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  io.emit('plc:log', { message: entry, timestamp: new Date().toISOString() });
}

// ─── Modbus & FailSafe ────────────────────────────────────────────────────────
const modbusClient = new ModbusClient(broadcastLog);
const failSafe = new FailSafeManager(modbusClient, io, broadcastLog);

// ─── Simülasyon ───────────────────────────────────────────────────────────────
function initSimValues() {
  plcState.simValues = {};
  for (const tag of plcState.tags) {
    const dt = (tag.dataType || 'UINT16').toUpperCase();
    if (tag.type === 'coil') {
      plcState.simValues[tag.id] = 0;
    } else if (dt === 'FLOAT32') {
      // Evaporatör için gerçekçi başlangıç
      plcState.simValues[tag.id] = tag.address === 100 ? 18.5 : 0.0;
    } else if (dt === 'INT16') {
      plcState.simValues[tag.id] = tag.address === 102 ? 12 : 0;
    } else {
      plcState.simValues[tag.id] = tag.address === 104 ? 1450 : 0;
    }
  }
}

function clamp(val, min, max) {
  if (min !== undefined && val < min) return min;
  if (max !== undefined && val > max) return max;
  return val;
}

function updateSimValues() {
  for (const tag of plcState.tags) {
    if (tag.type === 'coil') continue;
    const dt = (tag.dataType || 'UINT16').toUpperCase();
    let current = plcState.simValues[tag.id] ?? 0;

    if (dt === 'FLOAT32') {
      // FLOAT32: ondalıklı dalgalanma
      current += (Math.random() - 0.5) * 0.3;
      current = clamp(current, tag.min ?? -50, tag.max ?? 150);
      plcState.simValues[tag.id] = current;
      tag.value = current; // float, toFixed frontend'de yapılacak
    } else if (dt === 'INT16') {
      current += Math.round((Math.random() - 0.5) * 2);
      current = clamp(current, tag.min ?? -32768, tag.max ?? 32767);
      plcState.simValues[tag.id] = current;
      tag.value = Math.round(current);
    } else {
      // UINT16
      current += Math.round((Math.random() - 0.5) * 10);
      current = clamp(current, tag.min ?? 0, tag.max ?? 65535);
      plcState.simValues[tag.id] = current;
      tag.value = Math.round(current);
    }
  }
}

// ─── Tag serileştirme (Socket.io'ya gönderilecek alan seti) ──────────────────
function serializeTag(t) {
  return {
    id:       t.id,
    name:     t.name,
    type:     t.type,
    dataType: t.dataType || 'UINT16',
    address:  t.address,
    unit:     t.unit,
    min:      t.min,
    max:      t.max,
    value:    t.value
  };
}

// ─── Polling ──────────────────────────────────────────────────────────────────
let pollTimer = null;

async function pollPlc() {
  if (!plcState.running) return;

  if (plcState.simulationMode) {
    updateSimValues();
    io.emit('plc:data', {
      tags: plcState.tags.map(serializeTag),
      status: plcState.status,
      running: plcState.running,
      simulationMode: true
    });
    return;
  }

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
      // Faz 1: readTagValue kullan — dataType'a göre doğru FC seçer
      const result = await modbusClient.readTagValue(tag);

      if (result.success) {
        tag.value = result.value;
      } else if (result.error === 'NOT_CONNECTED') {
        plcState.status = 'DISCONNECTED';
        if (!failSafe.isReconnecting) failSafe.startReconnect(plcState.ip, plcState.port);
        break;
      }
    } catch (err) {
      broadcastLog(`[ERR_POLL] "${tag.name}" polling hatası: ${err.message}`);
    }
  }

  io.emit('plc:data', {
    tags: plcState.tags.map(serializeTag),
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
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  broadcastLog('[POLLING] Durduruldu.');
}

// ─── REST API ─────────────────────────────────────────────────────────────────

// PLC'ye bağlan
app.post('/api/connect', async (req, res) => {
  try {
    const { ip, port, tags, simulation } = req.body;
    plcState.ip   = ip   || '192.168.1.50';
    plcState.port = parseInt(port, 10) || 502;

    if (tags && Array.isArray(tags)) {
      // Gelen tag'lerde dataType/min/max alanlarını normalize et
      plcState.tags = tags.map(t => ({
        ...t,
        dataType: (t.dataType || 'UINT16').toUpperCase(),
        min: t.min !== undefined ? parseFloat(t.min) : undefined,
        max: t.max !== undefined ? parseFloat(t.max) : undefined,
        value: t.value ?? 0
      }));
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

// ─── Register / Coil yaz (Faz 1: tag id bazlı, dataType + clamping) ──────────
app.post('/api/write', async (req, res) => {
  try {
    const { tagId, address, value, dataType } = req.body;

    // Tag'i bul: tagId varsa id ile, yoksa address + type ile
    let tag = tagId
      ? plcState.tags.find(t => t.id === parseInt(tagId, 10))
      : plcState.tags.find(t => t.type === 'register' && t.address === parseInt(address, 10));

    if (!tag) {
      return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    }

    if (value === undefined || value === null) {
      return res.status(400).json({ success: false, error: 'value gerekli.' });
    }

    if (plcState.simulationMode) {
      // Simülasyon: frontend clamping sonrası gelir ama backend'de de kontrol et
      let numVal = parseFloat(value);
      if (isNaN(numVal)) {
        broadcastLog(`[ERR_VALIDATION] "${tag.name}" geçersiz değer: ${value}`);
        return res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
      }
      // Backend clamp
      if (tag.min !== undefined && numVal < tag.min) {
        broadcastLog(`[WARNING] "${tag.name}" sınırı aşıldı: ${numVal} → ${tag.min}'e çekildi`);
        numVal = tag.min;
      }
      if (tag.max !== undefined && numVal > tag.max) {
        broadcastLog(`[WARNING] "${tag.name}" sınırı aşıldı: ${numVal} → ${tag.max}'e çekildi`);
        numVal = tag.max;
      }

      tag.value = numVal;
      plcState.simValues[tag.id] = numVal;

      const dtLabel = (tag.dataType || 'UINT16').toUpperCase();
      const addrLabel = `D${tag.address}`;
      broadcastLog(`[WRITE SUCCESS] ${addrLabel} (${dtLabel}) set to ${numVal} (SIM)`);
      return res.json({ success: true, value: numVal });
    }

    // Gerçek PLC yazma: writeTagValue tüm tip mantığını ve clamping'i içerir
    const result = await modbusClient.writeTagValue(tag, value);
    if (result.success) {
      tag.value = result.value;
      res.json({ success: true, value: result.value });
    } else {
      res.status(500).json({ success: false, error: result.error });
    }
  } catch (err) {
    broadcastLog(`[ERR] /api/write → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Coil yaz (M relay) — ayrı endpoint korunuyor
app.post('/api/coil', async (req, res) => {
  try {
    const { tagId, address, value } = req.body;

    let tag = tagId
      ? plcState.tags.find(t => t.id === parseInt(tagId, 10))
      : plcState.tags.find(t => t.type === 'coil' && t.address === parseInt(address, 10));

    if (!tag) {
      return res.status(404).json({ success: false, error: 'Coil tag bulunamadı.' });
    }

    const boolVal = value === true || value === 1 || value === '1' || value === 'true';

    if (plcState.simulationMode) {
      tag.value = boolVal ? 1 : 0;
      broadcastLog(`[COIL WRITE] M${tag.address} → ${boolVal ? 'ON (1)' : 'OFF (0)'} (SIM)`);
      return res.json({ success: true, value: tag.value });
    }

    const result = await modbusClient.writeTagValue(tag, boolVal);
    if (result.success) {
      tag.value = result.value;
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

// Tag ekle (Faz 1: dataType, min, max alanlarıyla)
app.post('/api/tags', (req, res) => {
  try {
    const { name, type, dataType, address, unit, min, max } = req.body;
    if (!name || !type || address === undefined) {
      return res.status(400).json({ success: false, error: 'name, type ve address gerekli.' });
    }
    const dt = (dataType || (type === 'coil' ? 'COIL' : 'UINT16')).toUpperCase();
    const newTag = {
      id:       plcState.nextTagId++,
      name,
      type,
      dataType: dt,
      address:  parseInt(address, 10),
      unit:     unit || '',
      min:      min !== undefined && min !== '' ? parseFloat(min) : undefined,
      max:      max !== undefined && max !== '' ? parseFloat(max) : undefined,
      value:    0
    };
    plcState.tags.push(newTag);
    broadcastLog(`[CONFIG] Tag eklendi: ${name} (${dt} @ ${type === 'coil' ? 'M' : 'D'}${address})`);
    res.json({ success: true, tag: newTag });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tag sil
app.delete('/api/tags/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
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
    status:         plcState.status,
    running:        plcState.running,
    simulationMode: plcState.simulationMode,
    tags:           plcState.tags.map(serializeTag),
    ip:             plcState.ip,
    port:           plcState.port
  });
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  broadcastLog(`[WS] İstemci bağlandı: ${socket.id}`);
  socket.emit('plc:status', { status: plcState.status, running: plcState.running });
  socket.emit('plc:data', {
    tags:           plcState.tags.map(serializeTag),
    status:         plcState.status,
    running:        plcState.running,
    simulationMode: plcState.simulationMode
  });
  socket.on('disconnect', () => {
    broadcastLog(`[WS] İstemci ayrıldı: ${socket.id}`);
  });
});

// ─── Başlat ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Delta PLC Web Test Bench — Faz 1 Hazır         ║`);
  console.log(`║  http://localhost:${PORT}                           ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  broadcastLog('[SERVER] Delta PLC Web Test Bench v1.1 — Faz 1 (FLOAT32/INT16/UINT16/COIL) hazır.');
});
