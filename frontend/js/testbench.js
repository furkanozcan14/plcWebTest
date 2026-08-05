/**
 * testbench.js — Faz 1 Refactor
 * Canlı Test Bench: Kart render, SET/Coil işlemleri, Master Toggle, Konsol
 * Faz 1: FLOAT32 gösterimi (toFixed(2)), frontend clamping, tagId bazlı yazma
 */

// ─── State ────────────────────────────────────────────────────────────────────
let tbState = {
  running:        false,
  status:         'DISCONNECTED',
  simulationMode: false,
  tags:           [],
  logCount:       0,
  MAX_LOG_LINES:  200,
};

// ─── Chart.js State ───────────────────────────────────────────────────────────
let trendChart = null;
const MAX_CHART_POINTS = 600; // 2 minutes at 200ms polling = 600 points. Let's say 1 point per second to not overload (120 points).
let lastChartUpdate = 0;

// ─── Değer formatlama (SKILL.md Faz 1: FLOAT32 → 2 ondalık) ─────────────────
/**
 * Tag'in veri tipine göre görüntülenecek değeri formatlar.
 * FLOAT32 → .toFixed(2)
 * INT16 / UINT16 → integer string
 * COIL → "ON" / "OFF"
 */
function formatValue(tag, raw) {
  if (raw === undefined || raw === null) return '—';
  const dt = (tag.dataType || 'UINT16').toUpperCase();
  if (dt === 'FLOAT32') return parseFloat(raw).toFixed(2);
  return Math.round(parseFloat(raw)).toString();
}

/**
 * SET girişi için placeholder metni
 */
function buildPlaceholder(tag) {
  const dt = (tag.dataType || 'UINT16').toUpperCase();
  const minStr = tag.min !== undefined ? tag.min : '';
  const maxStr = tag.max !== undefined ? tag.max : '';
  const range  = (minStr !== '' && maxStr !== '') ? `${minStr} – ${maxStr}` : '';
  const dtHint = dt === 'FLOAT32' ? 'Ondalıklı' : dt === 'INT16' ? 'Negatif OK' : '0-65535';
  return range ? `${range} (${dtHint})` : dtHint;
}

/**
 * Frontend clamping (SKILL.md §5):
 * Değer min/max dışındaysa sınıra çekip geri döndürür.
 * @returns { clamped: bool, value: number, message: string|null }
 */
function frontendClamp(tag, numVal) {
  const min = tag.min !== undefined ? parseFloat(tag.min) : undefined;
  const max = tag.max !== undefined ? parseFloat(tag.max) : undefined;

  if (min !== undefined && numVal < min) {
    return {
      clamped: true,
      value:   min,
      message: `[CLAMP] "${tag.name}": ${numVal} < Min(${min}) → ${min}'e çekildi.`
    };
  }
  if (max !== undefined && numVal > max) {
    return {
      clamped: true,
      value:   max,
      message: `[CLAMP] "${tag.name}": ${numVal} > Max(${max}) → ${max}'e çekildi.`
    };
  }
  return { clamped: false, value: numVal, message: null };
}

// ─── Konsol ───────────────────────────────────────────────────────────────────
function consoleLog(message) {
  const body    = document.getElementById('console-body');
  const countEl = document.getElementById('console-count');
  if (!body) return;

  const lines = body.querySelectorAll('.log-line');
  if (lines.length >= tbState.MAX_LOG_LINES) lines[0].remove();

  let msgClass = 'log-msg';
  if (message.includes('[WRITE SUCCESS]'))          msgClass += ' success';
  else if (message.includes('[COIL WRITE]'))        msgClass += ' coil';
  else if (message.includes('[CLAMP]'))             msgClass += ' warning';
  else if (message.includes('[WARNING]'))           msgClass += ' warning';
  else if (message.includes('[ERR') || message.includes('[FATAL]')) msgClass += ' error';
  else if (message.includes('[RECONNECT]'))         msgClass += ' warning';
  else if (message.includes('[CONNECTED]'))         msgClass += ' success';
  else if (message.includes('[DISCONNECTED]'))      msgClass += ' error';
  else if (message.includes('[MASTER]'))            msgClass += ' master';
  else if (message.includes('[FAIL-SAFE]') || message.includes('[FAIL_SAFE]')) msgClass += ' failsafe';
  else if (message.includes('[WS]') || message.includes('[SERVER]') ||
           message.includes('[POLLING]') || message.includes('[CONFIG]')) msgClass += ' info';
  else if (message.includes('[SIM'))               msgClass += ' warning';

  const tsMatch = message.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
  const ts  = tsMatch ? tsMatch[1] : '';
  const msg = tsMatch ? message.slice(tsMatch[0].length) : message;

  const line = document.createElement('div');
  line.className = 'log-line fade-in';
  line.innerHTML = `<span class="log-ts">${ts || '--:--:--'}</span><span class="${msgClass}">${escapeHtmlConsole(msg)}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;

  tbState.logCount++;
  if (countEl) countEl.textContent = `${tbState.logCount} satır`;
}

function escapeHtmlConsole(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Durum LED ────────────────────────────────────────────────────────────────
function updateTbStatus(status) {
  tbState.status = status;
  const dot      = document.getElementById('tb-led-dot');
  const text     = document.getElementById('tb-status-text');
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
  dot.className  = `led-dot ${s.cls}`;
  text.textContent = s.label;
  if (simBadge) simBadge.style.display = (status === 'SIMULATION') ? 'inline-flex' : 'none';
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
      const res  = await fetch('/api/start', { method: 'POST' });
      const data = await res.json();
      if (data.success) updateMasterButton(true);
    } else {
      const res  = await fetch('/api/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) { updateMasterButton(false); updateTbStatus('STOPPED'); }
    }
  } catch (err) {
    consoleLog(`[ERR] Master toggle: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ─── Kart HTML Oluşturma ──────────────────────────────────────────────────────
function buildCardHTML(tag) {
  const prefix     = tag.type === 'register' ? 'D' : 'M';
  const badgeClass = tag.type === 'register' ? 'register' : 'coil';
  const dt         = (tag.dataType || 'UINT16').toUpperCase();
  const dispVal    = formatValue(tag, tag.value);

  if (tag.type === 'register') {
    // FC bilgisi tipine göre
    const fcInfo = dt === 'FLOAT32'
      ? 'Holding Reg × 2 • FLOAT32 • FC3/FC16'
      : dt === 'INT16'
        ? 'Holding Reg • INT16 Signed • FC3/FC16'
        : 'Holding Reg • UINT16 • FC3/FC16';

    // Min/Max gösterge
    const limitsStr = (tag.min !== undefined || tag.max !== undefined)
      ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-left:6px;">[${tag.min ?? '—'} … ${tag.max ?? '—'}]</span>`
      : '';

    return `
      <div class="tag-card-header">
        <span class="tag-card-name">${escapeHtmlConsole(tag.name)}</span>
        <span class="tag-badge ${badgeClass}">${prefix}${tag.address}</span>
      </div>
      <div class="tag-card-body">
        <div class="value-display">
          <span class="live-value" id="val-${tag.id}">${dispVal}</span>
          <span class="unit">${escapeHtmlConsole(tag.unit || '')}</span>
        </div>
        <div class="value-addr">
          ${fcInfo}${limitsStr}
        </div>
        <div class="set-row">
          <input
            id="set-input-${tag.id}"
            class="set-input"
            type="number"
            placeholder="${buildPlaceholder(tag)}"
            step="${dt === 'FLOAT32' ? '0.01' : '1'}"
            ${tag.min !== undefined ? `min="${tag.min}"` : ''}
            ${tag.max !== undefined ? `max="${tag.max}"` : ''}
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
    // COIL kartı
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

// ─── Kart Render / Güncelleme ─────────────────────────────────────────────────
function renderCards(tags) {
  const grid = document.getElementById('cards-grid');
  if (!grid) return;

  const existingCards = new Set(
    Array.from(grid.querySelectorAll('[data-tag-id]')).map(el => parseInt(el.dataset.tagId))
  );

  tags.forEach(tag => {
    if (existingCards.has(tag.id)) {
      updateCard(tag);
    } else {
      const card = document.createElement('div');
      card.className = 'tag-card fade-in';
      card.dataset.tagId = tag.id;
      card.innerHTML = buildCardHTML(tag);
      grid.appendChild(card);
      updateCard(tag); // To apply alarm styles immediately if needed
    }
    existingCards.delete(tag.id);
  });

  // Silinmiş kartları temizle
  existingCards.forEach(id => {
    const el = grid.querySelector(`[data-tag-id="${id}"]`);
    if (el) el.remove();
  });

  if (window.lucide) lucide.createIcons();
}

function updateCard(tag) {
  if (tag.type === 'register') {
    const valEl = document.getElementById(`val-${tag.id}`);
    // Kullanıcı o input'a odaklanmışsa değer yazan polling ezmez
    if (valEl && document.activeElement?.id !== `set-input-${tag.id}`) {
      valEl.textContent = formatValue(tag, tag.value);
    }
  } else {
    const isOn  = tag.value === 1 || tag.value === true;
    const led   = document.getElementById(`coil-led-${tag.id}`);
    const text  = document.getElementById(`coil-text-${tag.id}`);
    const onBtn = document.getElementById(`coil-on-${tag.id}`);
    const offBtn= document.getElementById(`coil-off-${tag.id}`);
    if (led)   led.className  = `coil-led ${isOn ? 'on' : 'off'}`;
    if (text)  { text.className = `coil-state-text ${isOn ? 'on' : 'off'}`; text.textContent = isOn ? 'ON' : 'OFF'; }
    if (onBtn) onBtn.classList.toggle('active', isOn);
    if (offBtn)offBtn.classList.toggle('active', !isOn);
  }

  // Faz 3: Alarm Görsel Uyarısı
  const cardEl = document.querySelector(`[data-tag-id="${tag.id}"]`);
  if (cardEl) {
    let isAlarm = false;
    if (tag.lowAlarm !== undefined && tag.lowAlarm !== null && tag.value <= tag.lowAlarm) isAlarm = true;
    if (tag.highAlarm !== undefined && tag.highAlarm !== null && tag.value >= tag.highAlarm) isAlarm = true;
    
    if (isAlarm) {
      cardEl.classList.add('card-alarm');
    } else {
      cardEl.classList.remove('card-alarm');
    }
  }
}

// ─── SET Register (Faz 1: clamping + tagId + FLOAT32) ─────────────────────────
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

  // Tag nesnesini bul (dataType ve min/max için)
  const tag = tbState.tags.find(t => t.id === tagId);
  if (!tag) { consoleLog(`[ERR] Tag #${tagId} bulunamadı.`); return; }

  const dt = (tag.dataType || 'UINT16').toUpperCase();

  // Sayısal parse
  let numVal = parseFloat(raw);
  if (isNaN(numVal)) {
    consoleLog(`[ERR_VALIDATION] D${address} — Sayısal olmayan değer: "${raw}"`);
    inputEl.focus();
    return;
  }

  // Tip bazlı ham sınır (frontend)
  if (dt === 'UINT16' && (numVal < 0 || numVal > 65535)) {
    consoleLog(`[ERR_VALIDATION] D${address} UINT16 — 0-65535 dışında: ${numVal}`);
    inputEl.focus();
    return;
  }
  if (dt === 'INT16' && (numVal < -32768 || numVal > 32767)) {
    consoleLog(`[ERR_VALIDATION] D${address} INT16 — -32768..32767 dışında: ${numVal}`);
    inputEl.focus();
    return;
  }

  // ── Frontend Clamping (SKILL.md §5) ────────────────────────────────────────
  const clamp = frontendClamp(tag, numVal);
  if (clamp.clamped) {
    consoleLog(clamp.message);
    numVal = clamp.value;
    // Input alanını clamp'lenmiş değere güncelle (kullanıcıya görünür geri bildirim)
    inputEl.value = dt === 'FLOAT32' ? numVal.toFixed(2) : String(numVal);
  }

  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '…'; }

  try {
    const res  = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId, address, value: numVal })
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

// ─── COIL Yaz (tagId bazlı) ───────────────────────────────────────────────────
async function handleCoilWrite(tagId, address, value) {
  const onBtn  = document.getElementById(`coil-on-${tagId}`);
  const offBtn = document.getElementById(`coil-off-${tagId}`);
  if (onBtn)  onBtn.disabled  = true;
  if (offBtn) offBtn.disabled = true;

  try {
    const res  = await fetch('/api/coil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId, address, value: value === 1 })
    });
    const data = await res.json();
    if (!data.success) consoleLog(`[ERR_COIL] M${address} → ${data.error}`);
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
    const setBtn = e.target.closest('[id^="set-btn-"]');
    if (setBtn) {
      handleSetRegister(parseInt(setBtn.dataset.tagId, 10), parseInt(setBtn.dataset.address, 10));
      return;
    }
    const onBtn = e.target.closest('[id^="coil-on-"]');
    if (onBtn) {
      handleCoilWrite(parseInt(onBtn.dataset.tagId, 10), parseInt(onBtn.dataset.address, 10), 1);
      return;
    }
    const offBtn = e.target.closest('[id^="coil-off-"]');
    if (offBtn) {
      handleCoilWrite(parseInt(offBtn.dataset.tagId, 10), parseInt(offBtn.dataset.address, 10), 0);
      return;
    }
  });

  // Enter ile SET
  grid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = e.target.closest('[id^="set-input-"]');
      if (input) {
        const tagId = parseInt(input.id.replace('set-input-', ''), 10);
        const tag   = tbState.tags.find(t => t.id === tagId);
        if (tag) handleSetRegister(tagId, tag.address);
      }
    }
  });
}

// ─── Konsol Temizle ───────────────────────────────────────────────────────────
function clearConsole() {
  const body    = document.getElementById('console-body');
  const countEl = document.getElementById('console-count');
  if (body) body.innerHTML = '<div class="log-line"><span class="log-ts">--:--:--</span><span class="log-msg info">Konsol temizlendi.</span></div>';
  tbState.logCount = 0;
  if (countEl) countEl.textContent = '0 satır';
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-master-toggle')?.addEventListener('click', handleMasterToggle);
  document.getElementById('btn-clear-console')?.addEventListener('click', clearConsole);
  
  // CSV Export Event
  document.getElementById('tb-csv-btn')?.addEventListener('click', exportCSV);

  attachCardEvents();

  fetch('/api/state')
    .then(r => r.json())
    .then(data => {
      tbState.status         = data.status || 'DISCONNECTED';
      tbState.simulationMode = data.simulationMode || false;
      tbState.running        = data.running || false;
      tbState.tags           = data.tags || [];

      updateTbStatus(tbState.status);
      updateMasterButton(tbState.running);
      if (tbState.tags.length > 0) { renderCards(tbState.tags); lucide.createIcons(); }
      
      initLiveChart();
    })
    .catch(() => consoleLog('[ERR] Sunucudan durum alınamadı. Backend çalışıyor mu?'));

  // Socket bekle
  const waitForSocket = setInterval(() => {
    if (window.plcSocket) { clearInterval(waitForSocket); bindSocketEvents(window.plcSocket); }
  }, 100);
});

function bindSocketEvents(socket) {
  socket.on('plc:data', (data) => {
    if (data.tags && Array.isArray(data.tags)) {
      tbState.tags           = data.tags;
      tbState.simulationMode = data.simulationMode || false;
      tbState.running        = data.running !== undefined ? data.running : tbState.running;
      renderCards(data.tags);
      updateTbStatus(data.status || tbState.status);
      
      updateLiveChart(data.tags);
    }
  });

  socket.on('plc:status', (data) => {
    updateTbStatus(data.status);
    if (data.running !== undefined) updateMasterButton(data.running);
  });

  socket.on('plc:log', (data) => {
    consoleLog(data.message || data);
  });

  if (window.initRecipeSocket) {
    initRecipeSocket(socket);
  }

  consoleLog('[WS] WebSocket bağlantısı kuruldu — Canlı veri akışı başladı.');
}

// ─── CSV Rapor İndirme ────────────────────────────────────────────────────────
function exportCSV() {
  if (tbState.tags.length === 0) {
    alert("Dışa aktarılacak tag bulunamadı.");
    return;
  }
  
  let csvContent = "data:text/csv;charset=utf-8,";
  
  // Başlıklar
  csvContent += "ID,Isim,Tip,Data_Tipi,Adres,Deger,Birim,Alt_Alarm,Ust_Alarm\r\n";
  
  // Veriler
  tbState.tags.forEach(tag => {
    const minAlarm = tag.lowAlarm !== undefined ? tag.lowAlarm : "";
    const maxAlarm = tag.highAlarm !== undefined ? tag.highAlarm : "";
    const row = `${tag.id},"${tag.name}",${tag.type},${tag.dataType},${tag.address},${tag.value},${tag.unit},${minAlarm},${maxAlarm}`;
    csvContent += row + "\r\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `PLC_Test_Raporu_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ─── Chart.js (Canlı Trend Grafiği) ──────────────────────────────────────────
function initLiveChart() {
  const ctx = document.getElementById('live-trend-chart');
  if (!ctx) return;

  Chart.defaults.color = '#757B81';
  Chart.defaults.font.family = 'JetBrains Mono, monospace';

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'D100 - Evap Sıcaklığı (°C)',
          borderColor: '#FFD300',
          backgroundColor: 'rgba(255, 211, 0, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          data: [],
          tension: 0.3,
          fill: true
        },
        {
          label: 'D102 - Komp Basıncı (bar)',
          borderColor: '#10B981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          data: [],
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          display: true,
          grid: { color: 'rgba(117, 123, 129, 0.1)' }
        },
        y: {
          display: true,
          grid: { color: 'rgba(117, 123, 129, 0.1)' },
          suggestedMin: 0,
          suggestedMax: 50
        }
      },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 6 } }
      }
    }
  });
}

function updateLiveChart(tags) {
  if (!trendChart) return;
  
  const now = Date.now();
  // Saniyede bir kez grafik güncelleyelim, 200ms çok hızlı
  if (now - lastChartUpdate < 1000) return;
  lastChartUpdate = now;

  const t100 = tags.find(t => t.address === 100 && t.type === 'register');
  const t102 = tags.find(t => t.address === 102 && t.type === 'register');

  const val100 = t100 ? parseFloat(t100.value) : 0;
  const val102 = t102 ? parseFloat(t102.value) : 0;

  const timeStr = new Date().toLocaleTimeString('tr-TR', { hour12: false });
  
  trendChart.data.labels.push(timeStr);
  trendChart.data.datasets[0].data.push(val100);
  trendChart.data.datasets[1].data.push(val102);

  // 2 dakika = 120 saniye (nokta)
  if (trendChart.data.labels.length > 120) {
    trendChart.data.labels.shift();
    trendChart.data.datasets[0].data.shift();
    trendChart.data.datasets[1].data.shift();
  }

  trendChart.update();
}
