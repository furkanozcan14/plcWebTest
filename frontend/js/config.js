/**
 * config.js — Faz 1 Refactor
 * Konfigürasyon sayfası: Bağlantı yönetimi + Dinamik tag tablosu
 * Faz 1: dataType (FLOAT32/INT16/UINT16/COIL), min, max alanları eklendi
 */

// ─── Veri tipi seçenekleri ────────────────────────────────────────────────────
const DATA_TYPES = ['FLOAT32', 'INT16', 'UINT16', 'COIL'];

// ─── Yerel tag listesi (Faz 1: dataType, min, max ile genişletildi) ───────────
let localTags = [
  { id: 1, name: 'Evaporatör Sıcaklığı', type: 'register', dataType: 'FLOAT32', address: 100, unit: '°C',  min: -50,  max: 150,  lowAlarm: 0, highAlarm: 100, value: 0 },
  { id: 2, name: 'Kompresör Basıncı',    type: 'register', dataType: 'INT16',   address: 102, unit: 'bar', min: 0,    max: 50,   lowAlarm: undefined, highAlarm: undefined, value: 0 },
  { id: 3, name: 'Sıvı Vana Durumu',     type: 'coil',     dataType: 'COIL',    address: 10,  unit: '',    min: undefined, max: undefined, lowAlarm: undefined, highAlarm: undefined, value: 0 },
  { id: 4, name: 'Fan Hızı',             type: 'register', dataType: 'UINT16',  address: 104, unit: 'RPM', min: 0,    max: 3000, lowAlarm: undefined, highAlarm: undefined, value: 0 },
];
let nextId = 5;

// ─── Veri tipi badge HTML ─────────────────────────────────────────────────────
function dataTypeBadge(dt) {
  const dtUpper = (dt || 'UINT16').toUpperCase();
  const colorMap = {
    FLOAT32: { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' },
    INT16:   { bg: 'rgba(16,185,129,0.12)', color: '#34d399', border: 'rgba(16,185,129,0.3)' },
    UINT16:  { bg: 'rgba(99,102,241,0.15)', color: '#818cf8', border: 'rgba(99,102,241,0.3)' },
    COIL:    { bg: 'rgba(245,158,11,0.15)', color: '#F59E0B', border: 'rgba(245,158,11,0.3)' },
  };
  const c = colorMap[dtUpper] || colorMap['UINT16'];
  return `<span style="
    font-family:var(--font-mono);font-size:10px;font-weight:700;
    padding:2px 5px;border-radius:3px;letter-spacing:0.5px;
    background:${c.bg};color:${c.color};border:1px solid ${c.border};">${dtUpper}</span>`;
}

// ─── Tag Tablosu Render ───────────────────────────────────────────────────────
function renderTagTable() {
  const tbody   = document.getElementById('tag-tbody');
  const countEl = document.getElementById('tag-count');
  if (!tbody) return;

  tbody.innerHTML = '';
  localTags.forEach((tag, idx) => {
    const prefix = tag.type === 'register' ? 'D' : 'M';
    const minStr = tag.min !== undefined ? tag.min : '—';
    const maxStr = tag.max !== undefined ? tag.max : '—';
    const lowAlarmStr = tag.lowAlarm !== undefined ? tag.lowAlarm : '—';
    const highAlarmStr = tag.highAlarm !== undefined ? tag.highAlarm : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:var(--text-muted);font-family:var(--font-mono);">${idx + 1}</td>
      <td style="font-weight:600;">${escapeHtml(tag.name)}</td>
      <td>${dataTypeBadge(tag.dataType)}</td>
      <td><span class="tag-addr">${prefix}${tag.address}</span></td>
      <td style="color:var(--text-secondary);font-family:var(--font-mono);">${escapeHtml(tag.unit)}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--green);">${minStr}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--red);">${maxStr}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);">${lowAlarmStr}</td>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);">${highAlarmStr}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-delete-id="${tag.id}" title="Bu tag'i sil">
          <i data-lucide="trash-2" style="width:11px;height:11px;pointer-events:none;"></i>
          Sil
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (countEl) countEl.textContent = `${localTags.length} değişken`;
  if (window.lucide) lucide.createIcons();
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Tag Tip → dataType otomatik seçimi ──────────────────────────────────────
function syncDataTypeToTagType() {
  const typeEl     = document.getElementById('new-tag-type');
  const dataTypeEl = document.getElementById('new-tag-datatype');
  if (!typeEl || !dataTypeEl) return;

  if (typeEl.value === 'coil') {
    dataTypeEl.value = 'COIL';
    dataTypeEl.disabled = true;
  } else {
    if (dataTypeEl.value === 'COIL') dataTypeEl.value = 'UINT16';
    dataTypeEl.disabled = false;
  }
}

// ─── Tag Sil ─────────────────────────────────────────────────────────────────
async function deleteTag(id) {
  const idx = localTags.findIndex(t => t.id === id);
  if (idx === -1) return;

  try {
    await fetch(`/api/tags/${id}`, { method: 'DELETE' });
  } catch (_) { /* ignore if not connected */ }

  localTags.splice(idx, 1);
  renderTagTable();
}

// ─── Tag Ekle (Faz 1: dataType, min, max) ────────────────────────────────────
async function addTag() {
  const nameEl     = document.getElementById('new-tag-name');
  const typeEl     = document.getElementById('new-tag-type');
  const dataTypeEl = document.getElementById('new-tag-datatype');
  const addressEl  = document.getElementById('new-tag-address');
  const unitEl     = document.getElementById('new-tag-unit');
  const minEl      = document.getElementById('new-tag-min');
  const maxEl      = document.getElementById('new-tag-max');
  const lowAlarmEl = document.getElementById('new-tag-low-alarm');
  const highAlarmEl= document.getElementById('new-tag-high-alarm');

  const name     = nameEl.value.trim();
  const type     = typeEl.value;              // 'register' | 'coil'
  const dataType = dataTypeEl.value;          // 'FLOAT32' | 'INT16' | 'UINT16' | 'COIL'
  const address  = parseInt(addressEl.value, 10);
  const unit     = unitEl.value.trim();
  const minRaw   = minEl.value.trim();
  const maxRaw   = maxEl.value.trim();
  const lowRaw   = lowAlarmEl.value.trim();
  const highRaw  = highAlarmEl.value.trim();
  
  const min      = minRaw !== '' ? parseFloat(minRaw) : undefined;
  const max      = maxRaw !== '' ? parseFloat(maxRaw) : undefined;
  const lowAlarm = lowRaw !== '' ? parseFloat(lowRaw) : undefined;
  const highAlarm= highRaw !== '' ? parseFloat(highRaw) : undefined;

  // Validasyonlar
  if (!name) { nameEl.focus(); showConnMsg('Değişken adı gereklidir.', 'error'); return; }
  if (isNaN(address) || address < 0) { addressEl.focus(); showConnMsg('Geçerli bir adres giriniz.', 'error'); return; }
  if (min !== undefined && max !== undefined && min >= max) {
    showConnMsg('Min değeri Max değerinden küçük olmalıdır.', 'error'); return;
  }

  // Çakışma kontrolü
  const exists = localTags.find(t => t.type === type && t.address === address);
  if (exists) {
    showConnMsg(`${type === 'register' ? 'D' : 'M'}${address} adresi zaten tanımlı.`, 'error');
    return;
  }

  const newTag = { id: nextId++, name, type, dataType, address, unit, min, max, lowAlarm, highAlarm, value: 0 };

  // Backend'e bildir
  try {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, dataType, address, unit, min, max, lowAlarm, highAlarm })
    });
    const data = await res.json();
    if (data.success && data.tag) newTag.id = data.tag.id;
  } catch (_) { /* ignore */ }

  localTags.push(newTag);
  renderTagTable();

  // Formu temizle
  nameEl.value = '';
  addressEl.value = '';
  unitEl.value = '';
  minEl.value = '';
  maxEl.value = '';
  lowAlarmEl.value = '';
  highAlarmEl.value = '';
  nameEl.focus();

  showConnMsg(`"${name}" (${dataType}) başarıyla eklendi.`, 'success');
}

// ─── Bağlantı Mesajı ─────────────────────────────────────────────────────────
function showConnMsg(text, type = 'info') {
  const el = document.getElementById('conn-message');
  if (!el) return;

  const colors = {
    success: { bg: 'var(--green-dim)',          border: 'rgba(16,185,129,0.3)',  color: 'var(--green)' },
    error:   { bg: 'var(--red-dim)',             border: 'rgba(239,68,68,0.3)',   color: 'var(--red)' },
    info:    { bg: 'var(--accent-dim)',          border: 'rgba(255,211,0,0.3)',   color: 'var(--accent)' },
    warning: { bg: 'rgba(245,158,11,0.1)',       border: 'rgba(245,158,11,0.3)', color: '#F59E0B' },
  };

  const c = colors[type] || colors.info;
  el.textContent = text;
  el.style.display = 'block';
  el.style.background = c.bg;
  el.style.border = `1px solid ${c.border}`;
  el.style.color = c.color;
}

function hideConnMsg() {
  const el = document.getElementById('conn-message');
  if (el) el.style.display = 'none';
}

// ─── Durum LED ────────────────────────────────────────────────────────────────
function updateConfigStatus(status) {
  const dot  = document.getElementById('config-led-dot');
  const text = document.getElementById('config-status-text');
  if (!dot || !text) return;

  const map = {
    'CONNECTED':    { cls: 'connected',    label: 'CONNECTED' },
    'DISCONNECTED': { cls: 'disconnected', label: 'DISCONNECTED' },
    'RECONNECTING': { cls: 'reconnecting', label: 'RECONNECTING' },
    'SIMULATION':   { cls: 'simulation',   label: 'SIMULATION' },
    'STOPPED':      { cls: 'stopped',      label: 'STOPPED' },
    'FAIL_SAFE':    { cls: 'stopped',      label: 'FAIL-SAFE' },
  };
  const s = map[status] || map['DISCONNECTED'];
  dot.className = `led-dot ${s.cls}`;
  text.textContent = s.label;
}

function setConnectionButtons(connected) {
  const btnConnect    = document.getElementById('btn-connect-plc');
  const btnSim        = document.getElementById('btn-connect-sim');
  const btnDisconnect = document.getElementById('btn-disconnect');
  if (btnConnect)    btnConnect.disabled    = connected;
  if (btnSim)        btnSim.disabled        = connected;
  if (btnDisconnect) btnDisconnect.disabled = !connected;
}

// ─── Bağlantı Kur ────────────────────────────────────────────────────────────
async function connectToPLC(simulation = false) {
  const ip   = document.getElementById('cfg-ip')?.value.trim()   || '192.168.1.50';
  const port = document.getElementById('cfg-port')?.value.trim() || '502';

  const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!simulation && !ipRegex.test(ip)) {
    showConnMsg('Geçerli bir IP adresi giriniz. (Örn: 192.168.1.50)', 'error'); return;
  }
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
    showConnMsg('Port 1–65535 arasında olmalıdır.', 'error'); return;
  }

  showConnMsg(simulation ? 'Simülasyon modu başlatılıyor...' : `${ip}:${port} bağlanılıyor...`, 'info');

  const btnConnect = document.getElementById('btn-connect-plc');
  const btnSim     = document.getElementById('btn-connect-sim');
  if (btnConnect) btnConnect.disabled = true;
  if (btnSim)     btnSim.disabled     = true;

  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port: portNum, tags: localTags, simulation })
    });
    const data = await res.json();

    if (data.success) {
      const status = data.status || (simulation ? 'SIMULATION' : 'CONNECTED');
      updateConfigStatus(status);
      setConnectionButtons(true);
      showConnMsg(
        simulation
          ? 'Simülasyon modu aktif — PLC bağlı olmadan test yapabilirsiniz.'
          : `Delta PLC başarıyla bağlandı: ${ip}:${portNum}`,
        'success'
      );
    } else {
      showConnMsg(`Bağlantı hatası: ${data.error || 'Bilinmeyen hata'}`, 'error');
      updateConfigStatus('DISCONNECTED');
      setConnectionButtons(false);
    }
  } catch (err) {
    showConnMsg(`Sunucu hatası: ${err.message}`, 'error');
    setConnectionButtons(false);
  }
}

// ─── Bağlantıyı Kes ──────────────────────────────────────────────────────────
async function disconnectFromPLC() {
  try { await fetch('/api/disconnect', { method: 'POST' }); } catch (_) {}
  updateConfigStatus('DISCONNECTED');
  setConnectionButtons(false);
  hideConnMsg();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderTagTable();

  document.getElementById('btn-connect-plc')?.addEventListener('click', () => connectToPLC(false));
  document.getElementById('btn-connect-sim')?.addEventListener('click', () => connectToPLC(true));
  document.getElementById('btn-disconnect')?.addEventListener('click', disconnectFromPLC);

  document.getElementById('btn-goto-testbench')?.addEventListener('click', () => {
    showView('testbench');
    setNavActive('testbench');
  });

  document.getElementById('btn-add-tag')?.addEventListener('click', addTag);

  // Tip değiştiğinde dataType'ı otomatik güncelle
  document.getElementById('new-tag-type')?.addEventListener('change', syncDataTypeToTagType);

  // Enter ile tag ekle
  document.getElementById('new-tag-max')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') addTag();
  });

  // Tag sil — event delegation
  document.getElementById('tag-tbody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete-id]');
    if (btn) {
      const id = parseInt(btn.dataset.deleteId, 10);
      if (confirm('Bu değişkeni silmek istediğinizden emin misiniz?')) deleteTag(id);
    }
  });

  // Socket.io status dinle
  setTimeout(() => {
    if (window.plcSocket) {
      window.plcSocket.on('plc:status', (data) => {
        updateConfigStatus(data.status);
        if (data.status === 'CONNECTED' || data.status === 'SIMULATION') setConnectionButtons(true);
        else if (data.status === 'DISCONNECTED') setConnectionButtons(false);
      });
    }
  }, 500);
});

// Dışa aktar
window.getLocalTags = () => localTags;
