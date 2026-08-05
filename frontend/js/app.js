/**
 * app.js
 * SPA Router, Tema Switcher, Global Socket.io bağlantısı
 */

// ─── Tema Yönetimi ────────────────────────────────────────────────────────────
const THEME_KEY = 'plc_theme';

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);

  // Tüm tema butonlarının ikonunu güncelle
  const buttons = document.querySelectorAll('.btn-theme');
  buttons.forEach(btn => {
    const icon = btn.querySelector('i');
    if (icon) {
      icon.setAttribute('data-lucide', theme === 'dark' ? 'sun' : 'moon');
    }
  });
  // Lucide'i yeniden render et
  if (window.lucide) lucide.createIcons();
}

function toggleTheme() {
  const current = getTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// ─── SPA Router ──────────────────────────────────────────────────────────────
const VIEWS = ['login', 'config', 'testbench'];

function showView(viewName) {
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      el.classList.toggle('active', v === viewName);
    }
  });

  const topbarTabs = document.getElementById('topbar-tabs');
  const topbarStatusLed = document.getElementById('topbar-status-led');
  const masterBtn = document.getElementById('btn-master-toggle');
  const csvBtn = document.getElementById('tb-csv-btn');
  const logoutBtn = document.getElementById('topbar-logout-btn');
  const topbarBrandText = document.getElementById('topbar-brand-text');

  if (viewName === 'login') {
    if (topbarTabs) topbarTabs.style.display = 'none';
    if (topbarStatusLed) topbarStatusLed.style.display = 'none';
    if (masterBtn) masterBtn.style.display = 'none';
    if (csvBtn) csvBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (topbarBrandText) topbarBrandText.textContent = 'Delta Web Test Bench';
  } else if (viewName === 'config') {
    if (topbarTabs) topbarTabs.style.display = 'flex';
    if (topbarStatusLed) topbarStatusLed.style.display = 'flex';
    if (masterBtn) masterBtn.style.display = 'none';
    if (csvBtn) csvBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (topbarBrandText) topbarBrandText.textContent = 'Delta Web Test Bench';
  } else if (viewName === 'testbench') {
    if (topbarTabs) topbarTabs.style.display = 'flex';
    if (topbarStatusLed) topbarStatusLed.style.display = 'flex';
    if (masterBtn) masterBtn.style.display = 'inline-flex';
    if (csvBtn) csvBtn.style.display = 'inline-flex';
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    if (topbarBrandText) topbarBrandText.textContent = 'Canlı Test Bench';
  }
}

// ─── Global Socket.io ────────────────────────────────────────────────────────
// Socket backend'e bağlanır; diğer modüller window.plcSocket ile erişir
let socket = null;

function initSocket() {
  socket = io('/', { transports: ['websocket', 'polling'] });
  window.plcSocket = socket;

  socket.on('connect', () => {
    console.log('[WS] Socket.io bağlandı:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('[WS] Socket.io bağlantısı koptu.');
  });

  socket.on('connect_error', (err) => {
    console.warn('[WS] Bağlantı hatası:', err.message);
  });

  return socket;
}

// ─── Başlatma ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Tema uygula
  applyTheme(getTheme());

  // Socket başlat
  initSocket();

  // Tema butonları — tüm view'larda çalışır
  document.querySelectorAll('.btn-theme').forEach(btn => {
    btn.addEventListener('click', toggleTheme);
  });

  // Nav tab geçişleri (config ↔ testbench)
  const navConfig   = document.getElementById('nav-config');
  const navTestbench = document.getElementById('nav-testbench');
  const tbNavConfig  = document.getElementById('tb-nav-config');
  const tbNavTestbench = document.getElementById('tb-nav-testbench');

  if (navConfig) navConfig.addEventListener('click', () => {
    showView('config');
    setNavActive('config');
  });

  if (navTestbench) navTestbench.addEventListener('click', () => {
    showView('testbench');
    setNavActive('testbench');
  });

  if (tbNavConfig) tbNavConfig.addEventListener('click', () => {
    showView('config');
    setNavActive('config');
  });

  if (tbNavTestbench) tbNavTestbench.addEventListener('click', () => {
    showView('testbench');
    setNavActive('testbench');
  });

  // Logout butonları
  const topbarLogoutBtn = document.getElementById('topbar-logout-btn');
  if (topbarLogoutBtn) {
    topbarLogoutBtn.addEventListener('click', () => {
      if (confirm('Sistemden çıkmak istiyor musunuz?')) {
        showView('login');
      }
    });
  }

  // Başlangıç view
  showView('login');
});

function setNavActive(view) {
  // config view nav tabs
  const navConfig = document.getElementById('nav-config');
  const navTestbench = document.getElementById('nav-testbench');
  if (navConfig) navConfig.classList.toggle('active', view === 'config');
  if (navTestbench) navTestbench.classList.toggle('active', view === 'testbench');

  // testbench view nav tabs
  const tbNavConfig = document.getElementById('tb-nav-config');
  const tbNavTestbench = document.getElementById('tb-nav-testbench');
  if (tbNavConfig) tbNavConfig.classList.toggle('active', view === 'config');
  if (tbNavTestbench) tbNavTestbench.classList.toggle('active', view === 'testbench');
}

// Global erişim
window.showView = showView;
window.setNavActive = setNavActive;
window.applyTheme = applyTheme;
