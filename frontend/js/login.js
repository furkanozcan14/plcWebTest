/**
 * login.js
 * Login sayfası form doğrulama ve geçiş mantığı.
 */

const LOGIN_CREDENTIALS = {
  username: 'admin',
  password: 'plc2024'
};

document.addEventListener('DOMContentLoaded', () => {
  const form       = document.getElementById('login-form');
  const usernameEl = document.getElementById('login-username');
  const passwordEl = document.getElementById('login-password');
  const errorEl    = document.getElementById('login-error');
  const loginBtn   = document.getElementById('login-btn');

  if (!form) return;

  function clearError() {
    errorEl.classList.remove('visible');
  }

  function showError() {
    errorEl.classList.add('visible');
    passwordEl.value = '';
    passwordEl.focus();
    // Hafif shake animasyonu
    const box = document.querySelector('.login-box');
    box.style.transform = 'translateX(-4px)';
    setTimeout(() => { box.style.transform = 'translateX(4px)'; }, 80);
    setTimeout(() => { box.style.transform = ''; }, 160);
  }

  function handleLogin(e) {
    e.preventDefault();
    clearError();

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    if (!username || !password) {
      errorEl.textContent = 'Kullanıcı adı ve şifre gereklidir.';
      showError();
      return;
    }

    if (username !== LOGIN_CREDENTIALS.username || password !== LOGIN_CREDENTIALS.password) {
      errorEl.textContent = 'Kullanıcı adı veya şifre hatalı.';
      showError();
      return;
    }

    // Başarılı giriş
    loginBtn.textContent = 'Yönlendiriliyor...';
    loginBtn.disabled = true;

    setTimeout(() => {
      showView('config');
      // Buton sıfırla
      loginBtn.textContent = 'Sisteme Giriş Yap';
      loginBtn.disabled = false;
      // Form temizle
      usernameEl.value = '';
      passwordEl.value = '';
    }, 300);
  }

  form.addEventListener('submit', handleLogin);

  // Hata mesajını temizle
  usernameEl.addEventListener('input', clearError);
  passwordEl.addEventListener('input', clearError);

  // Enter tuşu desteği
  passwordEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') form.requestSubmit();
  });
});
