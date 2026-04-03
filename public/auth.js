document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('themeToggle');

  function applySavedTheme() {
    const theme = localStorage.getItem('convo-theme') === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    if (themeToggle) {
      themeToggle.textContent = theme === 'dark' ? '☀' : '◐';
    }
  }

  applySavedTheme();

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('convo-theme', nextTheme);
      applySavedTheme();
    });
  }

  const loginForm = document.getElementById('loginForm');
  const regForm = document.getElementById('registrationForm');

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('loginMsg');
      msg.textContent = '';
      const username = document.getElementById('loginUsername').value.trim();
      const password = document.getElementById('loginPassword').value;
      try {
        const res = await fetch('/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
          window.location.href = '/index.html';
        } else {
          msg.textContent = data.message;
        }
      } catch {
        msg.textContent = 'Network error.';
      }
    });
  }

  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('regMsg');
      msg.textContent = '';
      const username = document.getElementById('regUsername').value.trim();
      const password = document.getElementById('regPassword').value;
      try {
        const res = await fetch('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        msg.textContent = data.message;
        if (data.success) {
          msg.className = 'msg success';
          setTimeout(() => window.location.href = '/login.html', 1200);
        }
      } catch {
        msg.textContent = 'Network error.';
      }
    });
  }
});
