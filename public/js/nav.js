'use strict';

/**
 * Menu peran yang sama di semua halaman:
 * Lobby · Display · Isi Jawaban · Admin Room · Superadmin.
 *
 * Halaman cukup menyediakan elemen <div data-site-nav></div>.
 */
(function () {
  const ITEMS = [
    { href: '/', label: 'Lobby', match: (path) => path === '/' },
    {
      href: '/display',
      label: 'Display',
      match: (path) => path === '/display' || path.startsWith('/display/'),
    },
    {
      href: '/join',
      label: 'Isi Jawaban',
      match: (path) => path === '/join' || path === '/room' || path.startsWith('/room/'),
    },
    {
      href: '/operator',
      label: 'Admin Room',
      match: (path) => path === '/operator' || path.startsWith('/operator/'),
    },
    {
      href: '/admin',
      label: 'Superadmin',
      match: (path) => path === '/admin' || path === '/superadmin',
    },
  ];

  const slots = document.querySelectorAll('[data-site-nav]');
  if (!slots.length) return;

  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';

  for (const slot of slots) {
    const nav = document.createElement('nav');
    nav.className = 'site-nav';
    nav.setAttribute('aria-label', 'Menu utama');

    for (const item of ITEMS) {
      const link = document.createElement('a');
      link.className = 'site-nav__link';
      link.href = item.href;
      link.textContent = item.label;

      if (item.match(currentPath)) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'page');
      }

      nav.appendChild(link);
    }

    slot.replaceChildren(nav);
  }
})();
