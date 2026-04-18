/**
 * Documentation Download Organization — thème et navigation mobile
 */

const STORAGE_KEY = 'download-organizer-doc-theme';

function getStoredTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function isDarkActive() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function updateThemeToggleUi() {
  const btn = document.getElementById('theme-toggle');
  btn?.classList.toggle('theme-toggle--dark', isDarkActive());
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateThemeToggleUi();
}

function initTheme() {
  const stored = getStoredTheme();
  if (stored === 'light' || stored === 'dark') {
    applyTheme(stored);
  } else {
    updateThemeToggleUi();
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!getStoredTheme()) updateThemeToggleUi();
  });
}

function toggleTheme() {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  let next;
  if (current === 'dark') next = 'light';
  else if (current === 'light') next = 'dark';
  else next = prefersDark ? 'light' : 'dark';

  applyTheme(next);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
}

function initNavToggle() {
  const btn = document.querySelector('.nav__toggle');
  const menu = document.getElementById('nav-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', () => {
    const open = menu.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  menu.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      menu.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
    });
  });
}

function initActiveNav() {
  const sections = [...document.querySelectorAll('main section[id]')];
  const links = [...document.querySelectorAll('.nav__list a[href^="#"]')];
  if (!sections.length || !links.length) return;

  const map = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const id = entry.target.id;
        links.forEach((a) => a.removeAttribute('aria-current'));
        const active = map.get(id);
        if (active) active.setAttribute('aria-current', 'page');
      });
    },
    { rootMargin: '-20% 0px -60% 0px', threshold: 0 },
  );

  sections.forEach((s) => observer.observe(s));
}

initTheme();
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
initNavToggle();
initActiveNav();
