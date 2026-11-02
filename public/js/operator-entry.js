'use strict';

/**
 * Halaman /operator (tanpa room): menerima link operator + token yang
 * ditempel dari Superadmin, memvalidasi bentuknya, lalu membuka halaman
 * /operator/<roomId>?token=<token>.
 */
(function () {
  const form = document.getElementById('operatorEntryForm');
  const input = document.getElementById('operatorLink');
  const feedback = document.getElementById('entryFeedback');
  const submit = document.getElementById('openOperatorButton');

  function show(message, kind) {
    feedback.textContent = message;
    feedback.className = `feedback is-visible is-${kind || 'info'}`;
  }

  function clear() {
    feedback.textContent = '';
    feedback.className = 'feedback';
  }

  /** @returns {{ href: string, roomId: string } | null} */
  function parseOperatorLink(raw) {
    const value = String(raw || '').trim();
    if (!value) return null;

    // Terima URL lengkap, path relatif (/operator/...), atau "operator/...".
    const candidate = /^https?:\/\//i.test(value)
      ? value
      : value.startsWith('/')
        ? value
        : `/${value}`;

    let url;
    try {
      url = new URL(candidate, window.location.origin);
    } catch (err) {
      return null;
    }

    const match = url.pathname.match(/^\/operator\/([A-Za-z0-9_-]+)\/?$/);
    if (!match) return null;

    const token = url.searchParams.get('token');
    if (!token) return null;

    return {
      roomId: match[1],
      href: `/operator/${encodeURIComponent(match[1])}?token=${encodeURIComponent(token)}`,
    };
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clear();

    const parsed = parseOperatorLink(input.value);
    if (!parsed) {
      show(
        'Link tidak valid. Tempel link yang berbentuk /operator/<roomId>?token=<token>.',
        'error'
      );
      input.focus();
      input.select();
      return;
    }

    submit.disabled = true;
    show(`Membuka Admin Room ${parsed.roomId}…`, 'info');
    window.location.assign(parsed.href);
  });

  input.addEventListener('input', clear);

  // Dukungan ?link=<url> agar Superadmin bisa menautkan langsung ke sini.
  const preset = new URLSearchParams(window.location.search).get('link');
  if (preset) {
    input.value = preset;
    form.requestSubmit();
  } else {
    input.focus();
  }
})();
