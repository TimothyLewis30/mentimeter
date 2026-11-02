'use strict';

/**
 * UI helpers shared by lobby, participant, display, operator, and admin pages.
 * All dynamic text is inserted with textContent (never innerHTML).
 */
(function () {
  const numberFormat = new Intl.NumberFormat('id-ID');

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function qsa(selector, root = document) {
    return [...root.querySelectorAll(selector)];
  }

  function formatNumber(value) {
    return numberFormat.format(Math.max(0, Number(value) || 0));
  }

  function formatDate(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '—';
    try {
      return new Date(time).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch (err) {
      return new Date(time).toLocaleString();
    }
  }

  function formatTime(value) {
    const time = Number(value);
    if (!Number.isFinite(time) || time <= 0) return '—';
    try {
      return new Date(time).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    } catch (err) {
      return new Date(time).toLocaleTimeString();
    }
  }

  function statusLabel(status) {
    if (status === 'live') return 'Live';
    if (status === 'ended') return 'Selesai';
    return 'Menunggu';
  }

  function roomIdFromPath(pathname = window.location.pathname) {
    const match = String(pathname).match(/\/(?:room|display|operator)\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function setConnection(pill, state, text) {
    if (!pill) return;
    pill.dataset.state = state;
    const label = pill.querySelector('span:last-child');
    if (label) label.textContent = text;
  }

  function toastHost() {
    let host = document.getElementById('toastHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toastHost';
      host.className = 'toast-host';
      host.setAttribute('aria-live', 'polite');
      document.body.appendChild(host);
    }
    return host;
  }

  function toast(message, type = 'info', timeout = 4200) {
    if (!message) return;
    const host = toastHost();
    const item = document.createElement('div');
    item.className = `toast toast--${type}`;
    item.setAttribute('role', 'status');

    const dot = document.createElement('span');
    dot.className = 'toast__dot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'toast__text';
    text.textContent = message;

    item.append(dot, text);
    host.appendChild(item);
    requestAnimationFrame(() => item.classList.add('is-visible'));

    setTimeout(() => {
      item.classList.remove('is-visible');
      setTimeout(() => item.remove(), 260);
    }, Math.max(1200, timeout));
  }

  async function copyText(text) {
    const value = String(text == null ? '' : text);
    if (!value) return false;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (err) {
      /* fall through to the legacy path */
    }

    try {
      const field = document.createElement('textarea');
      field.value = value;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      const ok = document.execCommand('copy');
      field.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let body = null;
    try {
      body = await response.json();
    } catch (err) {
      body = null;
    }
    return { ok: response.ok, status: response.status, body };
  }

  function roomLinks(room) {
    const origin = window.location.origin;
    const id = encodeURIComponent(room.id);
    return {
      participant: `${origin}/room/${id}`,
      display: `${origin}/display/${id}`,
      operator: `${origin}/operator/${id}?token=${encodeURIComponent(room.operatorToken || '')}`,
    };
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  }

  function renderWordBars(container, words, options = {}) {
    if (!container) return;
    container.replaceChildren();

    const list = Array.isArray(words) ? words : [];
    if (!list.length) {
      container.appendChild(
        createElement('p', 'muted', options.emptyText || 'Belum ada jawaban.')
      );
      return;
    }

    const max = Math.max(...list.map((word) => Number(word.size) || 0), 1);
    for (const word of list) {
      const row = createElement('div', 'word-bar');
      const label = createElement('span', 'word-bar__text', word.text);
      const meta = createElement('span', 'word-bar__count', formatNumber(word.size));
      const track = createElement('div', 'word-bar__track');
      const fill = createElement('div', 'word-bar__fill');
      fill.style.width = `${Math.max(4, (Number(word.size) || 0) / max) * 100}%`;
      track.appendChild(fill);
      row.append(label, meta, track);
      container.appendChild(row);
    }
  }

  function renderChips(container, words, emptyText) {
    if (!container) return;
    container.replaceChildren();

    const list = Array.isArray(words) ? words : [];
    if (!list.length) {
      container.appendChild(createElement('span', 'muted', emptyText || 'Menunggu jawaban pertama…'));
      return;
    }

    for (const word of list) {
      const chip = createElement('span', 'chip');
      chip.appendChild(createElement('span', 'chip__text', word.text));
      chip.appendChild(createElement('span', 'chip__count', formatNumber(word.size)));
      container.appendChild(chip);
    }
  }

  function renderActivity(container, entries) {
    if (!container) return;
    container.replaceChildren();

    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) {
      container.appendChild(createElement('li', 'muted', 'Menunggu jawaban…'));
      return;
    }

    for (const entry of list) {
      const item = createElement('li', 'activity-item');
      const dot = createElement('span', 'activity-item__dot');
      dot.setAttribute('aria-hidden', 'true');
      const text = createElement('span', 'activity-item__text', entry.text);
      const time = createElement('span', 'activity-item__time', formatTime(entry.at));
      item.append(dot, text, time);
      container.appendChild(item);
    }
  }

  function setText(idOrElement, value) {
    const element = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
    if (element) element.textContent = value == null ? '' : String(value);
  }

  function setHidden(idOrElement, hidden) {
    const element = typeof idOrElement === 'string' ? document.getElementById(idOrElement) : idOrElement;
    if (element) element.hidden = Boolean(hidden);
  }

  window.UI = {
    qs,
    qsa,
    formatNumber,
    formatDate,
    formatTime,
    statusLabel,
    roomIdFromPath,
    setConnection,
    toast,
    copyText,
    api,
    roomLinks,
    createElement,
    renderWordBars,
    renderChips,
    renderActivity,
    setText,
    setHidden,
  };
})();
