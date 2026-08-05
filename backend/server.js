/**
 * server.js — Faz 2
 * Delta PLC Web Test Bench — Ana Sunucu
 * Express HTTP + Socket.io WebSocket + Modbus TCP polling
 *
 * Faz 2 yenilikleri:
 *   - configStore.js ile kalıcı konfigürasyon (config.json)
 *   - Polling: modbusClient.readAllTags() — Read Bundling optimizasyonu
 */

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');

const { ModbusClient } = require('./modbusClient');
const FailSafeManager  = require('./failSafe');
const { loadConfig, saveConfig } = require('./configStore');
const { RecipeManager } = require('./recipes');

// ─── App Setup ───────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const PORT            = 3000;
const POLL_INTERVAL_MS = 200;

// ─── Kalıcı Konfigürasyonu Yükle ─────────────────────────────────────────────
const savedCfg = loadConfig();

let plcState = {
  status:         'DISCONNECTED',
  ip:             savedCfg.ip   || '192.168.1.50',
  port:           savedCfg.port || 502,
  simulationMode: false,
  running:        false,
  tags:           savedCfg.tags || [],
  nextTagId:      savedCfg.nextTagId || 5,
  simValues:      {}
};

// ─── Log ──────────────────────────────────────────────────────────────────────
function broadcastLog(msg) {
  const ts    = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  const entry = `[${ts}] ${msg}`;
  console.log(entry);
  io.emit('plc:log', { message: entry, timestamp: new Date().toISOString() });
}

// ─── Modbus, FailSafe & Recipes ───────────────────────────────────────────────
const modbusClient = new ModbusClient(broadcastLog);
const failSafe     = new FailSafeManager(modbusClient, io, broadcastLog);
const recipeManager = new RecipeManager(plcState, modbusClient, io, broadcastLog);

// ─── Konfigürasyon Kaydet (tag ekleme/silme sonrası çağrılır) ─────────────────
function persistConfig() {
  saveConfig({
    ip:        plcState.ip,
    port:      plcState.port,
    nextTagId: plcState.nextTagId,
    tags:      plcState.tags
  });
}

// ─── Simülasyon ───────────────────────────────────────────────────────────────
function clamp(val, min, max) {
  if (min !== undefined && val < min) return min;
  if (max !== undefined && val > max) return max;
  return val;
}

function initSimValues() {
  plcState.simValues = {};
  for (const tag of plcState.tags) {
    if (tag.type === 'coil') {
      plcState.simValues[tag.id] = tag.value ?? 0;
      continue;
    }
    const dt = (tag.dataType || 'UINT16').toUpperCase();
    if (dt === 'FLOAT32') {
      // Tag'in min/max aralığının ortasından başla
      const mid = (tag.min !== undefined && tag.max !== undefined)
        ? (tag.min + tag.max) / 2
        : (tag.address === 100 ? 18.5 : 0.0);
      plcState.simValues[tag.id] = mid;
    } else if (dt === 'INT16') {
      plcState.simValues[tag.id] = tag.address === 102 ? 12 : 0;
    } else {
      plcState.simValues[tag.id] = tag.address === 104 ? 1450 : 0;
    }
  }
}

function updateSimValues() {
  for (const tag of plcState.tags) {
    if (tag.type === 'coil') continue;
    const dt = (tag.dataType || 'UINT16').toUpperCase();
    let current = plcState.simValues[tag.id] ?? 0;

    if (dt === 'FLOAT32') {
      current += (Math.random() - 0.5) * 0.3;
      current  = clamp(current, tag.min ?? -9999, tag.max ?? 9999);
      plcState.simValues[tag.id] = current;
      tag.value = current;
    } else if (dt === 'INT16') {
      current += Math.round((Math.random() - 0.5) * 2);
      current  = clamp(current, tag.min ?? -32768, tag.max ?? 32767);
      plcState.simValues[tag.id] = current;
      tag.value = Math.round(current);
    } else {
      current += Math.round((Math.random() - 0.5) * 10);
      current  = clamp(current, tag.min ?? 0, tag.max ?? 65535);
      plcState.simValues[tag.id] = current;
      tag.value = Math.round(current);
    }
  }
}

// ─── Tag serileştirme ─────────────────────────────────────────────────────────
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
    lowAlarm: t.lowAlarm,
    highAlarm:t.highAlarm,
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
      tags:           plcState.tags.map(serializeTag),
      status:         plcState.status,
      running:        plcState.running,
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

  // ── Faz 2: readAllTags — Read Bundling ile tek seferde toplu okuma ─────────
  try {
    const results = await modbusClient.readAllTags(plcState.tags);

    for (const res of results) {
      if (res.success) {
        const tag = plcState.tags.find(t => t.id === res.id);
        if (tag) {
          tag.value = res.value;
          
          // Alarm Kontrolü
          if (tag.lowAlarm !== undefined && tag.value <= tag.lowAlarm) {
            broadcastLog(`[ALARM LOW] "${tag.name}" değeri alt sınırın altında: ${tag.value} (Limit: ${tag.lowAlarm})`);
          }
          if (tag.highAlarm !== undefined && tag.value >= tag.highAlarm) {
            broadcastLog(`[ALARM HIGH] "${tag.name}" değeri üst sınırın üstünde: ${tag.value} (Limit: ${tag.highAlarm})`);
          }
        }
      } else if (res.error === 'NOT_CONNECTED') {
        plcState.status = 'DISCONNECTED';
        if (!failSafe.isReconnecting) failSafe.startReconnect(plcState.ip, plcState.port);
        // Bağlantı koptu, bu polling iterasyonunu bitir
        io.emit('plc:status', { status: 'DISCONNECTED' });
        return;
      }
    }
  } catch (err) {
    broadcastLog(`[ERR_POLL] Toplu okuma hatası: ${err.message}`);
  }

  io.emit('plc:data', {
    tags:           plcState.tags.map(serializeTag),
    status:         plcState.status,
    running:        plcState.running,
    simulationMode: false
  });
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollPlc, POLL_INTERVAL_MS);
  broadcastLog(`[POLLING] Başlatıldı — ${POLL_INTERVAL_MS}ms aralık (Read Bundling aktif)`);
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
      plcState.tags = tags.map(t => ({
        ...t,
        dataType: (t.dataType || 'UINT16').toUpperCase(),
        min:   t.min  !== undefined ? parseFloat(t.min)  : undefined,
        max:   t.max  !== undefined ? parseFloat(t.max)  : undefined,
        value: t.value ?? 0
      }));
    }

    // IP/Port değişimini kalıcı kaydet
    persistConfig();

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
    plcState.status         = 'DISCONNECTED';
    plcState.simulationMode = false;
    res.json({ success: true });
  } catch (err) {
    broadcastLog(`[ERR] /api/disconnect → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Register yaz
app.post('/api/write', async (req, res) => {
  try {
    const { tagId, address, value } = req.body;

    let tag = tagId
      ? plcState.tags.find(t => t.id === parseInt(tagId, 10))
      : plcState.tags.find(t => t.type === 'register' && t.address === parseInt(address, 10));

    if (!tag) return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    if (value === undefined || value === null) return res.status(400).json({ success: false, error: 'value gerekli.' });

    if (plcState.simulationMode) {
      let numVal = parseFloat(value);
      if (isNaN(numVal)) { broadcastLog(`[ERR_VALIDATION] "${tag.name}" geçersiz değer: ${value}`); return res.status(400).json({ success: false, error: 'VALIDATION_ERROR' }); }
      if (tag.min !== undefined && numVal < tag.min) { broadcastLog(`[WARNING] "${tag.name}" sınırı aşıldı: ${numVal} → ${tag.min}'e çekildi`); numVal = tag.min; }
      if (tag.max !== undefined && numVal > tag.max) { broadcastLog(`[WARNING] "${tag.name}" sınırı aşıldı: ${numVal} → ${tag.max}'e çekildi`); numVal = tag.max; }
      tag.value = numVal;
      plcState.simValues[tag.id] = numVal;
      broadcastLog(`[WRITE SUCCESS] D${tag.address} (${tag.dataType}) set to ${numVal} (SIM)`);
      return res.json({ success: true, value: numVal });
    }

    const result = await modbusClient.writeTagValue(tag, value);
    if (result.success) { tag.value = result.value; res.json({ success: true, value: result.value }); }
    else res.status(500).json({ success: false, error: result.error });
  } catch (err) {
    broadcastLog(`[ERR] /api/write → ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Coil yaz
app.post('/api/coil', async (req, res) => {
  try {
    const { tagId, address, value } = req.body;
    let tag = tagId
      ? plcState.tags.find(t => t.id === parseInt(tagId, 10))
      : plcState.tags.find(t => t.type === 'coil' && t.address === parseInt(address, 10));
    if (!tag) return res.status(404).json({ success: false, error: 'Coil tag bulunamadı.' });
    const boolVal = value === true || value === 1 || value === '1' || value === 'true';
    if (plcState.simulationMode) {
      tag.value = boolVal ? 1 : 0;
      broadcastLog(`[COIL WRITE] M${tag.address} → ${boolVal ? 'ON (1)' : 'OFF (0)'} (SIM)`);
      return res.json({ success: true, value: tag.value });
    }
    const result = await modbusClient.writeTagValue(tag, boolVal);
    if (result.success) { tag.value = result.value; res.json({ success: true, value: result.value }); }
    else res.status(500).json({ success: false, error: result.error });
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

// Tag ekle — Faz 2: persistConfig çağrısı eklendi
app.post('/api/tags', (req, res) => {
  try {
    const { name, type, dataType, address, unit, min, max, lowAlarm, highAlarm } = req.body;
    if (!name || !type || address === undefined) {
      return res.status(400).json({ success: false, error: 'name, type ve address gerekli.' });
    }
    const dt = (dataType || (type === 'coil' ? 'COIL' : 'UINT16')).toUpperCase();
    const newTag = {
      id:       plcState.nextTagId++,
      name, type,
      dataType: dt,
      address:  parseInt(address, 10),
      unit:     unit || '',
      min:      min !== undefined && min !== '' ? parseFloat(min) : undefined,
      max:      max !== undefined && max !== '' ? parseFloat(max) : undefined,
      lowAlarm: lowAlarm !== undefined && lowAlarm !== '' ? parseFloat(lowAlarm) : undefined,
      highAlarm: highAlarm !== undefined && highAlarm !== '' ? parseFloat(highAlarm) : undefined,
      value:    0
    };
    plcState.tags.push(newTag);

    // ── Faz 2: kalıcı kaydet ──────────────────────────────────────────────
    persistConfig();

    broadcastLog(`[CONFIG] Tag eklendi: ${name} (${dt} @ ${type === 'coil' ? 'M' : 'D'}${address}) → config.json güncellendi`);
    res.json({ success: true, tag: newTag });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tag sil — Faz 2: persistConfig çağrısı eklendi
app.delete('/api/tags/:id', (req, res) => {
  try {
    const id  = parseInt(req.params.id, 10);
    const idx = plcState.tags.findIndex(t => t.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Tag bulunamadı.' });
    const removed = plcState.tags.splice(idx, 1)[0];

    // ── Faz 2: kalıcı kaydet ──────────────────────────────────────────────
    persistConfig();

    broadcastLog(`[CONFIG] Tag silindi: ${removed.name} → config.json güncellendi`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Recipes API ──────────────────────────────────────────────────────────────
app.get('/api/recipes', (req, res) => {
  res.json({ success: true, recipes: recipeManager.getRecipes() });
});

app.post('/api/recipes', (req, res) => {
  try {
    const recipe = recipeManager.addRecipe(req.body);
    res.json({ success: true, recipe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/recipes/:id', (req, res) => {
  try {
    const recipe = recipeManager.updateRecipe(req.params.id, req.body);
    if (!recipe) return res.status(404).json({ success: false, error: 'Reçete bulunamadı.' });
    res.json({ success: true, recipe });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/recipes/:id', (req, res) => {
  try {
    const success = recipeManager.deleteRecipe(req.params.id);
    if (!success) return res.status(404).json({ success: false, error: 'Reçete bulunamadı.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/recipes/:id/run', (req, res) => {
  try {
    // Fire and forget, runs async
    recipeManager.runRecipe(req.params.id).catch(() => {}); 
    res.json({ success: true, message: 'Reçete başlatıldı.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/recipes/stop', (req, res) => {
  try {
    recipeManager.stopRecipe();
    res.json({ success: true, message: 'Reçete durduruldu.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// State
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
  socket.on('disconnect', () => broadcastLog(`[WS] İstemci ayrıldı: ${socket.id}`));
});

// ─── Başlat ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════╗`);
  console.log(`║  Delta PLC Web Test Bench — Faz 2 Hazır         ║`);
  console.log(`║  http://localhost:${PORT}                           ║`);
  console.log(`╚══════════════════════════════════════════════════╝\n`);
  broadcastLog('[SERVER] Delta PLC Web Test Bench v1.2 — Faz 2 (Read Bundling + Kalıcı Config) hazır.');
});
