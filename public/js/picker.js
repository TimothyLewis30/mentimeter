'use strict';

/**
 * Halaman pemilih room untuk dua peran:
 *  - /display : membuka display room
 *  - /join    : masuk sebagai peserta dan mengisi jawaban
 */
(function () {
  const UI = window.UI;
  const mode = window.location.pathname.startsWith('/display') ? 'display' : 'join';

  const copy = {
    display: {
      eyebrow: 'Layar room',
      title: 'Pilih room untuk ditampilkan',
      lead:
        'Buka display di layar room. Display menampilkan pertanyaan, word cloud, dan statistik ' +
        'room yang dipilih, tanpa bisa memulai atau merekam sesi.',
      action: (room) => (room.status === 'live' ? 'Buka Display' : 'Lihat layar waiting'),
      emptyTitle: 'Belum ada room untuk ditampilkan',
      emptyText: 'Minta Superadmin membuat room terlebih dahulu, lalu muat ulang halaman ini.',
    },
    join: {
      eyebrow: 'Peserta',
      title: 'Pilih room untuk mengirim jawaban',
      lead:
        'Masuk ke room yang sedang menunggu atau live. Form jawaban aktif otomatis setelah ' +
        'operator room memulai sesi.',
      action: (room) => (room.status === 'live' ? 'Masuk & isi jawaban' : 'Lihat waiting room'),
      emptyTitle: 'Belum ada room untuk diikuti',
      emptyText: 'Minta link peserta ke admin, atau tunggu room baru dibuka.',
    },
  }[mode];

  const grid = document.getElementById('roomGrid');
  const empty = document.getElementById('emptyPicker');
  const emptyTitle = document.getElementById('emptyPickerTitle');
  const emptyText = document.getElementById('emptyPickerText');
  const updated = document.getElementById('pickerUpdated');
  const refresh = document.getElementById('refreshRooms');

  document.getElementById('pickerEyebrow').textContent = copy.eyebrow;
  document.getElementById('pickerTitle').textContent = copy.title;
  document.getElementById('pickerLead').textContent = copy.lead;
  document.title = `${copy.title} — CloudWords`;

  let loading = false;
  let pollTimer = null;

  function roomCard(room) {
    const card = UI.createElement('article', `room-card room-card--${room.status}`);

    const head = UI.createElement('div', 'room-card__head');
    const badge = UI.createElement(
      'span',
      `status-badge status-badge--${room.status}`,
      UI.statusLabel(room.status)
    );
    const count = UI.createElement(
      'span',
      'room-card__count',
      `${UI.formatNumber(room.participants)} peserta`
    );
    head.append(badge, count);

    const name = UI.createElement('h2', 'room-card__name', room.name);
    const question = UI.createElement('p', 'room-card__question', room.question);

    const meta = UI.createElement('div', 'room-card__meta');
    meta.append(
      UI.createElement('span', null, `${UI.formatNumber(room.totalAnswers)} jawaban`),
      UI.createElement('span', null, `${UI.formatNumber(room.uniqueWords)} kata unik`)
    );

    const roomPath = `/room/${encodeURIComponent(room.id)}`;
    const displayPath = `/display/${encodeURIComponent(room.id)}`;

    const actions = UI.createElement('div', 'room-card__actions');
    const primary = UI.createElement('a', 'btn btn-primary', copy.action(room));
    primary.href = mode === 'display' ? displayPath : roomPath;
    if (mode === 'display') {
      primary.target = '_blank';
      primary.rel = 'noopener';
    }

    const secondary = UI.createElement(
      'a',
      'btn btn-ghost',
      mode === 'display' ? 'Isi jawaban' : 'Lihat display'
    );
    secondary.href = mode === 'display' ? roomPath : displayPath;
    secondary.target = '_blank';
    secondary.rel = 'noopener';

    actions.append(primary, secondary);
    card.append(head, name, question, meta, actions);
    return card;
  }

  function render(rooms) {
    grid.replaceChildren();
    const list = Array.isArray(rooms) ? rooms : [];

    if (!list.length) {
      grid.hidden = true;
      empty.hidden = false;
      emptyTitle.textContent = copy.emptyTitle;
      emptyText.textContent = copy.emptyText;
      return;
    }

    grid.hidden = false;
    empty.hidden = true;
    for (const room of list) grid.appendChild(roomCard(room));
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
