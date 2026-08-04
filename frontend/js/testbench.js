/**
 * testbench.js
 * Canlı Test Bench: Kart render, SET/Coil işlemleri, Master Toggle, Konsol
 */

// ─── State ────────────────────────────────────────────────────────────────────
let tbState = {
  running: false,
  status: 'DISCONNECTED',
  simulationMode: false,
  tags: [],
  logCount: 0,
  MAX_LOG_LINES: 200,
};

// ─── Konsol ───────────────────────────────────────────────────────────────────
function consoleLog(message) {
  const body = document.getElementById('console-body');
  const countEl = document.getElementById('console-count');
  if (!body) return;

  // Max satır limiti
  const lines = body.querySelectorAll('.log-line');
  if (lines.length >= tbState.MAX_LOG_LINES) {
    lines[0].remove();
  }

  const line = document.createElement('div');
  line.className = 'log-line fade-in';

  // Log tipine göre renklendirme
  let msgClass = 'log-msg';
  if (message.includes('[WRITE SUCCESS]'))        msgClass += ' success';
  else if (message.includes('[COIL WRITE]'))       msgClass += ' coil';
  else if (message.includes('[ERR') || message.includes('[FATAL]') || message.includes('[ERR_')) msgClass += ' error';
  else if (message.includes('[RECONNECT]'))        msgClass += ' warning';
  else if (message.includes('[CONNECTED]'))        msgClass += ' success';
  else if (message.includes('[DISCONNECTED]'))     msgClass += ' error';
  else if (message.includes('[MASTER]'))           msgClass += ' master';
  else if (message.includes('[FAIL-SAFE]') || message.includes('[FAIL_SAFE]')) msgClass += ' failsafe';
  else if (message.includes('[WS]') || message.includes('[SERVER]') || message.includes('[POLLING]') || message.includes('[CONFIG]')) msgClass += ' info';
  else if (message.includes('[SIM'))               msgClass += ' warning';

  // Zaman damgasını ayır
  const tsMatch = message.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
  let ts = '';
  let msg = message;
  if (tsMatch) {
    ts = tsMatch[1];
    msg = message.slice(tsMatch[0].length);
  }

  line.innerHTML = `<span class="log-ts">${ts || '--:--:--'}</span><span class="${msgClass}">${escapeHtmlConsole(msg)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;

  tbState.logCount++;
  if (countEl) countEl.textContent = `${tbState.logCount} satır`;
}

function escapeHtmlConsole(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Durum LED Güncelle ───────────────────────────────────────────────────────
function updateTbStatus(status) {
  tbState.status = status;
  const dot  = document.getElementById('tb-led-dot');
  const text = document.getElementById('tb-status-text');
  const simBadge = document.getElementById('sim-badge');
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

  if (simBadge) {
    simBadge.style.display = (status === 'SIMULATION') ? 'inline-flex' : 'none';
  }
}

// ─── Master Toggle ────────────────────────────────────────────────────────────
function updateMasterButton(running) {
  tbState.running = running;
  const btn   = document.getElementById('btn-master-toggle');
  const label = document.getElementById('master-btn-label');
  if (!btn || !label) return;

  if (running) {
    btn.className = 'btn-master stop';
    btn.setAttribute('aria-label', 'Sistemi durdur');
    label.textContent = 'STOP';
    // İkon güncelle
    const icon = btn.querySelector('i');
    if (icon) { icon.setAttribute('data-lucide', 'square'); lucide.createIcons(); }
  } else {
    btn.className = 'btn-master start';
    btn.setAttribute('aria-label', 'Sistemi başlat');
    label.textContent = 'START';
    const icon = btn.querySelector('i');
    if (icon) { icon.setAttribute('data-lucide', 'play'); lucide.createIcons(); }
  }
}

async function handleMasterToggle() {
  const btn = document.getElementById('btn-master-toggle');
  if (btn) btn.disabled = true;

  try {
    if (!tbState.running) {
      // START
      const res  = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        updateMasterButton(true);
      }
    } else {
      // STOP
      const res  = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        updateMasterButton(false);
        updateTbStatus('STOPPED');
      }
    }
  } catch (err) {
    consoleLog(`[ERR] Master toggle: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Kart Render ─────────────────────────────────────────────────────────────
function renderCards(tags) {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;

  // Mevcut kartları güncelle veya yeni ekle
  const existingCards = new Set(Array.from(grid.querySelectorAll('[data-tag-id]')).map(el => parseInt(el.dataset.tagId)));

  tags.forEach(tag => {
    if (existingCards.has(tag.id)) {
      // Var olan kartı güncelle
      updateCard(tag);
    } else {
      // Yeni kart oluştur
      const card = createCard(tag);
      grid.appendChild(card);
    }
    existingCards.delete(tag.id);
  });

  // Silinmiş tag'lerin kartlarını kaldır
  existingCards.forEach(id => {
    const el = grid.querySelector(`[data-tag-id="${id}"]`);
    if (el) el.remove();
  });

  if (window.lucide) lucide.createIcons();
}

function createCard(tag) {
  const div = document.createElement('div');
  div.className = 'tag-card fade-in';
  div.dataset.tagId = tag.id;
  div.innerHTML = buildCardHTML(tag);
  return div;
}

function buildCardHTML(tag) {
  const prefix = tag.type === 'register' ? 'D' : 'M';
  const badgeClass = tag.type === 'register' ? 'register' : 'coil';

  if (tag.type === 'register') {
    return `
      <div class="tag-card-header">
        <span class="tag-card-name">${escapeHtmlConsole(tag.name)}</span>
        <span class="tag-badge ${badgeClass}">${prefix}${tag.address}</span>
      </div>
      <div class="tag-card-body">
        <div class="value-display">
          <span class="live-value" id="val-${tag.id}">${tag.value ?? 0}</span>
          <span class="unit">${escapeHtmlConsole(tag.unit || '')}</span>
        </div>
        <div class="value-addr">Modbus Holding Reg • FC3/FC16</div>
        <div class="set-row">
          <input
            id="set-input-${tag.id}"
            class="set-input"
            type="number"
            placeholder="Değer gir (0-65535)"
            min="0" max="65535"
            aria-label="${tag.name} için yeni değer"
          />
          <button
            class="btn-set"
            id="set-btn-${tag.id}"
            data-tag-id="${tag.id}"
            data-address="${tag.address}"
            aria-label="${tag.name} değerini kaydet"
          >SET</button>
        </div>
      </div>
    `;
  } else {
    const isOn = tag.value === 1 || tag.value === true;
    return `
      <div class="tag-card-header">
        <span class="tag-card-name">${escapeHtmlConsole(tag.name)}</span>
        <span class="tag-badge ${badgeClass}">${prefix}${tag.address}</span>
      </div>
      <div class="tag-card-body">
        <div class="value-addr" style="margin-bottom:10px;">Modbus Coil • FC1/FC5</div>
        <div class="coil-state-row">
          <div class="coil-indicator">
            <div class="coil-led ${isOn ? 'on' : 'off'}" id="coil-led-${tag.id}"></div>
            <span class="coil-state-text ${isOn ? 'on' : 'off'}" id="coil-text-${tag.id}">
              ${isOn ? 'ON' : 'OFF'}
            </span>
          </div>
          <div class="coil-btns">
            <button
              class="btn-on ${isOn ? 'active' : ''}"
              id="coil-on-${tag.id}"
              data-tag-id="${tag.id}"
              data-address="${tag.address}"
              data-value="1"
              aria-label="${tag.name} aç"
            >ON</button>
            <button
              class="btn-off ${!isOn ? 'active' : ''}"
              id="coil-off-${tag.id}"
              data-tag-id="${tag.id}"
              data-address="${tag.address}"
              data-value="0"
              aria-label="${tag.name} kapat"
            >OFF</button>
          </div>
        </div>
      </div>
    `;
  }
}

function updateCard(tag) {
  if (tag.type === 'register') {
    const valEl = document.getElementById(`val-${tag.id}`);
    if (valEl && document.activeElement?.id !== `set-input-${tag.id}`) {
      valEl.textContent = tag.value ?? 0;
    }
  } else {
    const isOn  = tag.value === 1 || tag.value === true;
    const led   = document.getElementById(`coil-led-${tag.id}`);
    const text  = document.getElementById(`coil-text-${tag.id}`);
    const onBtn = document.getElementById(`coil-on-${tag.id}`);
    const offBtn= document.getElementById(`coil-off-${tag.id}`);

    if (led)   { led.className = `coil-led ${isOn ? 'on' : 'off'}`; }
    if (text)  { text.className = `coil-state-text ${isOn ? 'on' : 'off'}`; text.textContent = isOn ? 'ON' : 'OFF'; }
    if (onBtn) { onBtn.classList.toggle('active', isOn); }
    if (offBtn){ offBtn.classList.toggle('active', !isOn); }
  }
}

// ─── SET Register ─────────────────────────────────────────────────────────────
async function handleSetRegister(tagId, address) {
  const inputEl = document.getElementById(`set-input-${tagId}`);
  const btnEl   = document.getElementById(`set-btn-${tagId}`);
  if (!inputEl) return;

  const raw = inputEl.value.trim();
  if (raw === '') {
    consoleLog(`[ERR_VALIDATION] D${address} — Değer boş bırakılamaz.`);
    inputEl.focus();
    return;
  }

  const val = parseInt(raw, 10);
  if (isNaN(val) || val < 0 || val > 65535) {
    consoleLog(`[ERR_VALIDATION] D${address} — Değer 0-65535 arasında olmalıdır. Girilen: ${raw}`);
    inputEl.focus();
    return;
  }

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }

  try {
    const res  = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, value: val })
    });
    const data = await res.json();

    if (data.success) {
      inputEl.value = '';
      // Flash animasyonu
      const card = document.querySelector(`[data-tag-id="${tagId}"]`);
      if (card) {
        card.classList.remove('flash');
        void card.offsetWidth;
        card.classList.add('flash');
      }
    } else {
      consoleLog(`[ERR_WRITE] D${address} → ${data.error}`);
    }
  } catch (err) {
    consoleLog(`[ERR] SET isteği başarısız: ${err.message}`);
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'SET'; }
  }
}

// ─── COIL Yaz ────────────────────────────────────────────────────────────────
async function handleCoilWrite(tagId, address, value) {
  const onBtn  = document.getElementById(`coil-on-${tagId}`);
  const offBtn = document.getElementById(`coil-off-${tagId}`);
  if (onBtn)  onBtn.disabled  = true;
  if (offBtn) offBtn.disabled = true;

  try {
    const res  = await fetch('/api/coil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, value: value === 1 })
    });
    const data = await res.json();

    if (!data.success) {
      consoleLog(`[ERR_COIL] M${address} → ${data.error}`);
    }
  } catch (err) {
    consoleLog(`[ERR] Coil isteği başarısız: ${err.message}`);
  } finally {
    if (onBtn)  onBtn.disabled  = false;
    if (offBtn) offBtn.disabled = false;
  }
}

// ─── Event Delegation ─────────────────────────────────────────────────────────
function attachCardEvents() {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;

  grid.addEventListener('click', (e) => {
    // SET butonu
    const setBtn = e.target.closest('[id^="set-btn-"]');
    if (setBtn) {
      const tagId  = parseInt(setBtn.dataset.tagId, 10);
      const address = parseInt(setBtn.dataset.address, 10);
      handleSetRegister(tagId, address);
      return;
    }

    // ON butonu
    const onBtn = e.target.closest('[id^="coil-on-"]');
    if (onBtn) {
      const tagId   = parseInt(onBtn.dataset.tagId, 10);
      const address = parseInt(onBtn.dataset.address, 10);
      handleCoilWrite(tagId, address, 1);
      return;
    }

    // OFF butonu
    const offBtn = e.target.closest('[id^="coil-off-"]');
    if (offBtn) {
      const tagId   = parseInt(offBtn.dataset.tagId, 10);
      const address = parseInt(offBtn.dataset.address, 10);
      handleCoilWrite(tagId, address, 0);
      return;
    }
  });

  // Enter ile SET
  grid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = e.target.closest('[id^="set-input-"]');
      if (input) {
        const idStr = input.id.replace('set-input-', '');
        const tagId = parseInt(idStr, 10);
        const tag   = tbState.tags.find(t => t.id === tagId);
        if (tag) handleSetRegister(tagId, tag.address);
      }
    }
  });
}

// ─── Konsol Temizle ───────────────────────────────────────────────────────────
function clearConsole() {
  const body = document.getElementById('console-body');
  const countEl = document.getElementById('console-count');
  if (body) {
    body.innerHTML = '<div class="log-line"><span class="log-ts">--:--:--</span><span class="log-msg info">Konsol temizlendi.</span></div>';
  }
  tbState.logCount = 0;
  if (countEl) countEl.textContent = '0 satır';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Master Toggle
  document.getElementById('btn-master-toggle')?.addEventListener('click', handleMasterToggle);

  // Konsol Temizle
  document.getElementById('btn-clear-console')?.addEventListener('click', clearConsole);

  // Kart event'leri
  attachCardEvents();

  // Sunucudan mevcut state al
  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      tbState.status = data.status || 'DISCONNECTED';
      tbState.simulationMode = data.simulationMode || false;
      tbState.running = data.running || false;
      tbState.tags = data.tags || [];

      updateTbStatus(tbState.status);
      updateMasterButton(tbState.running);

      if (tbState.tags.length > 0) {
        renderCards(tbState.tags);
        lucide.createIcons();
      }
    })
    .catch(() => {
      consoleLog('[ERR] Sunucudan durum alınamadı. Backend çalışıyor mu?');
    });

  // Socket.io dinleyicileri
  const waitForSocket = setInterval(() => {
    if (window.plcSocket) {
      clearInterval(waitForSocket);
      bindSocketEvents(window.plcSocket);
    }
  }, 100);
});

function bindSocketEvents(socket) {
  // Canlı veri
  socket.on('plc:data', (data) => {
    if (data.tags && Array.isArray(data.tags)) {
      tbState.tags = data.tags;
      tbState.simulationMode = data.simulationMode || false;
      tbState.running = data.running !== undefined ? data.running : tbState.running;

      renderCards(data.tags);
      updateTbStatus(data.status || tbState.status);
    }
  });

  // Durum güncellemeleri
  socket.on('plc:status', (data) => {
    updateTbStatus(data.status);
    if (data.running !== undefined) {
      updateMasterButton(data.running);
    }
  });

  // Log mesajları
  socket.on('plc:log', (data) => {
    consoleLog(data.message || data);
  });

  consoleLog('[WS] WebSocket bağlantısı kuruldu — Canlı veri akışı başladı.');
}
