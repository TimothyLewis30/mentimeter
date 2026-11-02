'use strict';

/** Lobby publik: daftar room waiting/live dari /api/rooms. */
(function () {
  const UI = window.UI;
  const grid = document.getElementById('roomGrid');
  const empty = document.getElementById('emptyLobby');
  const updated = document.getElementById('lobbyUpdated');
  const refresh = document.getElementById('refreshRooms');

  let loading = false;
  let pollTimer = null;

  function roomCard(room) {
    const card = UI.createElement('article', `room-card room-card--${room.status}`);

    const head = UI.createElement('div', 'room-card__head');
    const badge = UI.createElement('span', `status-badge status-badge--${room.status}`, UI.statusLabel(room.status));
    const count = UI.createElement('span', 'room-card__count', `${UI.formatNumber(room.participants)} peserta`);
    head.append(badge, count);

    const name = UI.createElement('h2', 'room-card__name', room.name);
    const question = UI.createElement('p', 'room-card__question', room.question);

    const meta = UI.createElement('div', 'room-card__meta');
    const answers = UI.createElement('span', null, `${UI.formatNumber(room.totalAnswers)} jawaban`);
    const unique = UI.createElement('span', null, `${UI.formatNumber(room.uniqueWords)} kata unik`);
    meta.append(answers, unique);

    const actions = UI.createElement('div', 'room-card__actions');
    const enter = UI.createElement('a', 'btn btn-primary', room.status === 'live' ? 'Masuk room' : 'Lihat waiting room');
    enter.href = `/room/${encodeURIComponent(room.id)}`;
    const display = UI.createElement('a', 'btn btn-ghost', 'Buka display');
    display.href = `/display/${encodeURIComponent(room.id)}`;
    display.target = '_blank';
    display.rel = 'noopener';
    actions.append(enter, display);

    card.append(head, name, question, meta, actions);
    return card;
  }

  function render(rooms) {
    grid.replaceChildren();
    const list = Array.isArray(rooms) ? rooms : [];

    if (!list.length) {
      grid.hidden = true;
      empty.hidden = false;
      return;
    }

    grid.hidden = false;
    empty.hidden = true;
    for (const room of list) {
      grid.appendChild(roomCard(room));
    }
  }

  async function loadRooms(quiet = false) {
    if (loading) return;
    loading = true;
    refresh.disabled = true;
    if (!quiet) updated.textContent = 'Memuat room…';

    try {
      const response = await fetch('/api/rooms', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      render(data.rooms);
      updated.textContent = `Diperbarui ${new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })}`;
    } catch (err) {
      updated.textContent = 'Gagal memuat room. Periksa koneksi lalu coba lagi.';
      if (!quiet) UI.toast('Tidak dapat memuat daftar room.', 'error');
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', () => loadRooms(false));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadRooms(true);
  });

  loadRooms(false);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') loadRooms(true);
  }, 10000);

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });
})();
