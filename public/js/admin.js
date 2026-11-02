'use strict';

/** Super admin: login, kelola room, bagi link, dan preview read-only. */
(function () {
  const UI = window.UI;
  const TOKEN_KEY = 'cloudwords:admin-token';
  const DEFAULT_QUESTION = 'Apa satu kata yang menggambarkan harimu?';

  const loginView = document.getElementById('loginView');
  const dashboardView = document.getElementById('dashboardView');
  const loginForm = document.getElementById('loginForm');
  const loginButton = document.getElementById('loginButton');
  const loginFeedback = document.getElementById('loginFeedback');
  const adminPassword = document.getElementById('adminPassword');
  const logoutButton = document.getElementById('logoutButton');
  const connectionPill = document.getElementById('connectionPill');
  const connectionText = document.getElementById('connectionText');
  const createRoomButton = document.getElementById('createRoomButton');
  const roomFormPanel = document.getElementById('roomFormPanel');
  const roomForm = document.getElementById('roomForm');
  const roomFormTitle = document.getElementById('roomFormTitle');
  const editingRoomId = document.getElementById('editingRoomId');
  const roomNameInput = document.getElementById('roomNameInput');
  const roomQuestionInput = document.getElementById('roomQuestionInput');
  const saveRoomButton = document.getElementById('saveRoomButton');
  const cancelRoomForm = document.getElementById('cancelRoomForm');
  const cancelRoomFormBottom = document.getElementById('cancelRoomFormBottom');
  const adminRoomList = document.getElementById('adminRoomList');
  const roomsCountTag = document.getElementById('roomsCountTag');
  const adminSummary = document.getElementById('adminSummary');
  const summaryRooms = document.getElementById('summaryRooms');
  const summaryRoomsMeta = document.getElementById('summaryRoomsMeta');
  const summaryLive = document.getElementById('summaryLive');
  const summaryParticipants = document.getElementById('summaryParticipants');
  const summaryAnswers = document.getElementById('summaryAnswers');
  const previewPanel = document.getElementById('previewPanel');
  const previewEmpty = document.getElementById('previewEmpty');
  const previewBody = document.getElementById('previewBody');
  const previewRoomName = document.getElementById('previewRoomName');
  const previewBadge = document.getElementById('previewBadge');
  const previewCanvas = document.getElementById('previewCanvas');
  const previewParticipants = document.getElementById('previewParticipants');
  const previewAnswers = document.getElementById('previewAnswers');
  const previewUnique = document.getElementById('previewUnique');
  const previewWords = document.getElementById('previewWords');
  const previewActivity = document.getElementById('previewActivity');
  const closePreviewButton = document.getElementById('closePreview');

  let token = '';
  try {
    token = sessionStorage.getItem(TOKEN_KEY) || '';
  } catch (err) {
    token = '';
  }

  let adminSocket = null;
  let previewSocket = null;
  let renderer = null;
  let rooms = [];
  let previewRoomId = '';

  const RECORDING_LABELS = {
    idle: 'Siap',
    recording: 'Merekam',
    interrupted: 'Terputus',
    unknown: 'Tidak terpantau',
    stopped: 'Selesai',
  };

  function showLogin(message) {
    loginView.hidden = false;
    dashboardView.hidden = true;
    logoutButton.hidden = true;
    closePreview();
    if (message) {
      loginFeedback.textContent = message;
      loginFeedback.className = 'feedback is-visible is-error';
    }
    if (adminPassword) adminPassword.focus({ preventScroll: true });
  }

  function showDashboard() {
    loginView.hidden = true;
    dashboardView.hidden = false;
    logoutButton.hidden = false;
    loginFeedback.textContent = '';
    loginFeedback.className = 'feedback';
  }

  function setLoginFeedback(message, type) {
    loginFeedback.textContent = message || '';
    loginFeedback.className = 'feedback';
    if (message) {
      loginFeedback.classList.add('is-visible');
      loginFeedback.classList.add(`is-${type || 'info'}`);
    }
  }

  function saveToken(value) {
    token = value || '';
    try {
      if (token) sessionStorage.setItem(TOKEN_KEY, token);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (err) {
      /* ignore storage failures */
    }
  }

  function connectAdmin() {
    if (!token) {
      showLogin();
      return;
    }

    showDashboard();
    adminSocket = io('/admin', {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 20,
    });

    adminSocket.on('connect', () => {
      UI.setConnection(connectionPill, 'online', 'Terhubung');
    });

    adminSocket.on('disconnect', () => {
      UI.setConnection(connectionPill, 'offline', 'Menyambung ulang…');
    });

    adminSocket.on('connect_error', (error) => {
      const code = error && error.data && error.data.code;
      UI.setConnection(connectionPill, 'offline', 'Koneksi gagal');
      if (code === 'UNAUTHORIZED') {
        expireSession();
      }
    });

    adminSocket.on('admin:rooms', (payload) => {
      rooms = payload && Array.isArray(payload.rooms) ? payload.rooms : [];
      renderRooms();
      renderSummary();
      syncPreview();
    });
  }

  function expireSession() {
    saveToken('');
    if (adminSocket) {
      adminSocket.disconnect();
      adminSocket = null;
    }
    showLogin('Sesi admin berakhir. Silakan login lagi.');
    UI.toast('Sesi admin berakhir. Login kembali.', 'warning');
  }

  function logout() {
    saveToken('');
    if (adminSocket) {
      adminSocket.disconnect();
      adminSocket = null;
    }
    closePreview();
    rooms = [];
    showLogin();
    UI.toast('Anda sudah keluar.', 'info');
  }

  function renderSummary() {
    const live = rooms.filter((room) => room.status === 'live').length;
    const waiting = rooms.filter((room) => room.status === 'waiting').length;
    const participants = rooms.reduce((sum, room) => sum + (Number(room.participants) || 0), 0);
    const answers = rooms.reduce((sum, room) => sum + (Number(room.totalAnswers) || 0), 0);

    summaryRooms.textContent = UI.formatNumber(rooms.length);
    summaryRoomsMeta.textContent = `${UI.formatNumber(live)} live · ${UI.formatNumber(waiting)} waiting`;
    summaryLive.textContent = UI.formatNumber(live);
    summaryParticipants.textContent = UI.formatNumber(participants);
    summaryAnswers.textContent = UI.formatNumber(answers);
    roomsCountTag.textContent = `${UI.formatNumber(rooms.length)} room`;
    adminSummary.textContent = rooms.length
      ? `${UI.formatNumber(live)} room live, ${UI.formatNumber(waiting)} menunggu operator.`
      : 'Belum ada room. Buat room pertama untuk mulai.';
  }

  function makeCopyButton(label, value, successMessage) {
    const button = UI.createElement('button', 'btn btn-ghost btn-small', label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      const ok = await UI.copyText(value);
      UI.toast(ok ? successMessage : 'Gagal menyalin. Salin manual dari kolom link.', ok ? 'success' : 'error');
    });
    return button;
  }

  function roomCard(room) {
    const links = UI.roomLinks(room);
    const card = UI.createElement('article', `room-admin-card room-admin-card--${room.status}`);

    const head = UI.createElement('div', 'room-admin-card__head');
    const titleWrap = UI.createElement('div', 'room-admin-card__title');
    const name = UI.createElement('h3', null, room.name);
    const id = UI.createElement('span', 'room-admin-card__id', room.id);
    titleWrap.append(name, id);
    const badge = UI.createElement('span', `status-badge status-badge--${room.status}`, UI.statusLabel(room.status));
    head.append(titleWrap, badge);

    const question = UI.createElement('p', 'room-admin-card__question', room.question);

    const meta = UI.createElement('div', 'room-admin-card__meta');
    meta.append(
      UI.createElement('span', 'meta-pill', `${UI.formatNumber(room.participants)} peserta`),
      UI.createElement('span', 'meta-pill', `${UI.formatNumber(room.totalAnswers)} jawaban`),
      UI.createElement('span', 'meta-pill', `${UI.formatNumber(room.uniqueWords)} kata unik`),
      UI.createElement(
        'span',
        `meta-pill ${room.operatorOnline ? 'meta-pill--ok' : 'meta-pill--muted'}`,
        room.operatorOnline ? 'Operator online' : 'Operator offline'
      ),
      UI.createElement(
        'span',
        `meta-pill ${room.recording && room.recording.status === 'recording' ? 'meta-pill--rec' : 'meta-pill--muted'}`,
        `REC ${RECORDING_LABELS[room.recording && room.recording.status] || 'Siap'}`
      ),
      UI.createElement(
        'span',
        `meta-pill ${room.displayOnline ? 'meta-pill--ok' : 'meta-pill--muted'}`,
        room.displayOnline ? 'Display online' : 'Display offline'
      )
    );

    const timeRow = UI.createElement('div', 'room-admin-card__time');
    timeRow.append(
      UI.createElement('span', null, `Dibuat ${UI.formatDate(room.createdAt)}`),
      UI.createElement('span', null, `Mulai ${UI.formatDate(room.startedAt)}`),
      UI.createElement('span', null, `Selesai ${UI.formatDate(room.endedAt)}`)
    );

    const linkList = UI.createElement('div', 'link-list');
    const linkRows = [
      ['Peserta', links.participant, 'Link peserta disalin.'],
      ['Display', links.display, 'Link display disalin.'],
      ['Operator', links.operator, 'Link operator + token disalin. Jangan bagikan sembarangan.'],
    ];
    for (const [label, value, message] of linkRows) {
      const row = UI.createElement('div', `link-row ${label === 'Operator' ? 'link-row--secret' : ''}`);
      row.append(
        UI.createElement('span', 'link-row__label', label),
        UI.createElement('code', 'link-row__value', value),
        makeCopyButton('Salin', value, message)
      );
      linkList.appendChild(row);
    }

    const actions = UI.createElement('div', 'room-admin-card__actions');

    const preview = UI.createElement('button', 'btn btn-primary btn-small', 'Preview');
    preview.type = 'button';
    preview.addEventListener('click', () => openPreview(room));
    actions.appendChild(preview);

    const displayLink = UI.createElement('a', 'btn btn-ghost btn-small', 'Display ↗');
    displayLink.href = links.display;
    displayLink.target = '_blank';
    displayLink.rel = 'noopener';
    actions.appendChild(displayLink);

    const operatorLink = UI.createElement('a', 'btn btn-ghost btn-small', 'Admin Room ↗');
    operatorLink.href = links.operator;
    operatorLink.target = '_blank';
    operatorLink.rel = 'noopener noreferrer';
    operatorLink.title = 'Buka halaman operator room ini (berisi token rahasia)';
    actions.appendChild(operatorLink);

    if (room.status === 'waiting') {
      const edit = UI.createElement('button', 'btn btn-ghost btn-small', 'Edit');
      edit.type = 'button';
      edit.addEventListener('click', () => openEditForm(room));
      actions.appendChild(edit);
    }

    const regenerate = UI.createElement('button', 'btn btn-ghost btn-small', 'Regenerate token');
    regenerate.type = 'button';
    regenerate.addEventListener('click', () => regenerateToken(room));
    actions.appendChild(regenerate);

    if (room.status !== 'live') {
      const remove = UI.createElement('button', 'btn btn-danger btn-small', 'Hapus');
      remove.type = 'button';
      remove.addEventListener('click', () => deleteRoom(room));
      actions.appendChild(remove);
    }

    card.append(head, question, meta, timeRow, linkList, actions);
    return card;
  }

  function renderRooms() {
    adminRoomList.replaceChildren();

    if (!rooms.length) {
      const empty = UI.createElement('div', 'empty-rooms');
      empty.append(
        UI.createElement('h3', null, 'Belum ada room'),
        UI.createElement('p', 'muted', 'Klik “Buat room” untuk membuat room waiting pertama.'),
        (() => {
          const button = UI.createElement('button', 'btn btn-primary', '+ Buat room');
          button.type = 'button';
          button.addEventListener('click', openCreateForm);
          return button;
        })()
      );
      adminRoomList.appendChild(empty);
      return;
    }

    const sorted = [...rooms].sort((a, b) => {
      const rank = { live: 0, waiting: 1, ended: 2 };
      return (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.name.localeCompare(b.name);
    });
    for (const room of sorted) adminRoomList.appendChild(roomCard(room));
  }

  function openCreateForm() {
    editingRoomId.value = '';
    roomFormTitle.textContent = 'Buat room baru';
    saveRoomButton.textContent = 'Buat room';
    roomNameInput.value = '';
    roomQuestionInput.value = DEFAULT_QUESTION;
    roomFormPanel.hidden = false;
    roomFormPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    roomNameInput.focus({ preventScroll: true });
  }

  function openEditForm(room) {
    if (room.status !== 'waiting') {
      UI.toast('Nama dan pertanyaan hanya bisa diedit saat room waiting.', 'warning');
      return;
    }
    editingRoomId.value = room.id;
    roomFormTitle.textContent = 'Edit room';
    saveRoomButton.textContent = 'Simpan perubahan';
    roomNameInput.value = room.name || '';
    roomQuestionInput.value = room.question || '';
    roomFormPanel.hidden = false;
    roomFormPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    roomNameInput.focus({ preventScroll: true });
  }

  function closeForm() {
    roomFormPanel.hidden = true;
    editingRoomId.value = '';
  }

  function submitForm(event) {
    event.preventDefault();
    if (!adminSocket || !adminSocket.connected) {
      UI.toast('Belum terhubung ke server. Coba lagi.', 'error');
      return;
    }

    const name = roomNameInput.value.trim();
    const question = roomQuestionInput.value.trim();
    const roomId = editingRoomId.value;

    if (!name) {
      UI.toast('Nama room wajib diisi.', 'error');
      roomNameInput.focus();
      return;
    }
    if (question.length < 3) {
      UI.toast('Pertanyaan minimal 3 karakter.', 'error');
      roomQuestionInput.focus();
      return;
    }

    saveRoomButton.disabled = true;
    const eventName = roomId ? 'admin:update-room' : 'admin:create-room';
    const payload = roomId ? { roomId, name, question } : { name, question };

    adminSocket.timeout(8000).emit(eventName, payload, (err, response) => {
      saveRoomButton.disabled = false;
      if (err || !response || !response.ok) {
        UI.toast((response && response.message) || 'Gagal menyimpan room.', 'error', 6000);
        return;
      }
      closeForm();
      UI.toast(response.message || 'Room disimpan.', 'success');
      if (!roomId) {
        UI.toast('Salin link operator + token dari kartu room dan kirim ke operator.', 'info', 7000);
      }
    });
  }

  function deleteRoom(room) {
    if (room.status === 'live') {
      UI.toast('Room live tidak bisa dihapus. Operator harus mengakhiri sesi dulu.', 'warning');
      return;
    }
    if (!window.confirm(`Hapus room “${room.name}”? Semua jawaban tersimpan di snapshot akan ikut dihapus.`)) {
      return;
    }

    adminSocket.timeout(8000).emit('admin:delete-room', { roomId: room.id }, (err, response) => {
      if (err || !response || !response.ok) {
        UI.toast((response && response.message) || 'Gagal menghapus room.', 'error');
        return;
      }
      if (previewRoomId === room.id) closePreview();
      UI.toast('Room dihapus.', 'success');
    });
  }

  function regenerateToken(room) {
    const warning =
      room.status === 'live'
        ? `Room “${room.name}” sedang LIVE. Regenerate token akan mencabut operator sekarang, menghentikan rekamannya, dan room tetap live tanpa operator sampai link baru dibuka. Lanjutkan?`
        : `Buat token operator baru untuk “${room.name}”? Link operator lama langsung tidak valid.`;

    if (!window.confirm(warning)) return;

    adminSocket.timeout(8000).emit('admin:regenerate-token', { roomId: room.id }, (err, response) => {
      if (err || !response || !response.ok) {
        UI.toast((response && response.message) || 'Gagal regenerate token.', 'error');
        return;
      }
      UI.toast(response.message || 'Token operator diperbarui.', 'success', 6000);
    });
  }

  function ensureRenderer() {
    if (renderer || !previewCanvas) return renderer;
    try {
      renderer = new window.WordCloudRenderer(previewCanvas, {
        maxWords: 70,
        maxFontCap: 120,
        padding: 4,
        duration: 500,
      });
    } catch (err) {
      console.error('[admin] Preview renderer gagal:', err);
    }
    return renderer;
  }

  function closePreview() {
    if (previewSocket) {
      previewSocket.disconnect();
      previewSocket = null;
    }
    previewRoomId = '';
    if (previewBody) previewBody.hidden = true;
    if (previewEmpty) previewEmpty.hidden = false;
    if (closePreviewButton) closePreviewButton.hidden = true;
    if (renderer) renderer.setData([]);
  }

  function openPreview(room) {
    if (!token) return;
    if (previewRoomId === room.id && previewSocket) {
      previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    closePreview();
    previewRoomId = room.id;
    previewEmpty.hidden = true;
    previewBody.hidden = false;
    closePreviewButton.hidden = false;
    previewRoomName.textContent = room.name;
    previewBadge.className = `status-badge status-badge--${room.status}`;
    previewBadge.textContent = UI.statusLabel(room.status);
    previewParticipants.textContent = UI.formatNumber(room.participants);
    previewAnswers.textContent = UI.formatNumber(room.totalAnswers);
    previewUnique.textContent = UI.formatNumber(room.uniqueWords);
    UI.renderWordBars(previewWords, [], { emptyText: 'Belum ada jawaban.' });
    UI.renderActivity(previewActivity, []);
    previewPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    requestAnimationFrame(() => {
      ensureRenderer();
      if (renderer) renderer.resize();
    });

    previewSocket = io('/room', {
      auth: { roomId: room.id, role: 'admin', token },
      reconnection: true,
    });

    previewSocket.on('room:init', (payload) => {
      if (!payload || !payload.room) return;
      previewRoomName.textContent = payload.room.name || room.name;
      previewBadge.className = `status-badge status-badge--${payload.room.status}`;
      previewBadge.textContent = UI.statusLabel(payload.room.status);
      updatePreviewStats(payload.stats);
      UI.renderWordBars(previewWords, payload.words, { emptyText: 'Belum ada jawaban.' });
      UI.renderActivity(previewActivity, payload.recent);
      requestAnimationFrame(() => {
        ensureRenderer();
        if (renderer) {
          renderer.resize();
          renderer.setData(payload.words || []);
        }
      });
    });

    previewSocket.on('update-wordcloud', (words) => {
      UI.renderWordBars(previewWords, words, { emptyText: 'Belum ada jawaban.' });
      if (renderer) renderer.setData(words || []);
    });

    previewSocket.on('stats:update', updatePreviewStats);

    previewSocket.on('activity:new', (entry) => {
      if (!entry || !entry.text) return;
      const item = UI.createElement('li', 'activity-item');
      const dot = UI.createElement('span', 'activity-item__dot');
      dot.setAttribute('aria-hidden', 'true');
      item.append(
        dot,
        UI.createElement('span', 'activity-item__text', entry.text),
        UI.createElement('span', 'activity-item__time', UI.formatTime(entry.at))
      );
      previewActivity.querySelector('.muted')?.remove();
      previewActivity.prepend(item);
      while (previewActivity.children.length > 8) previewActivity.lastElementChild.remove();
    });

    previewSocket.on('room:status', (payload) => {
      if (!payload) return;
      previewBadge.className = `status-badge status-badge--${payload.status}`;
      previewBadge.textContent = UI.statusLabel(payload.status);
    });

    previewSocket.on('room:meta', (payload) => {
      if (payload && payload.name) previewRoomName.textContent = payload.name;
    });

    previewSocket.on('room:deleted', () => {
      UI.toast('Room yang dipreview telah dihapus.', 'warning');
      closePreview();
    });

    previewSocket.on('connect_error', (error) => {
      const code = error && error.data && error.data.code;
      if (code === 'UNAUTHORIZED') expireSession();
      else UI.toast('Preview gagal terhubung ke room.', 'error');
    });
  }

  function updatePreviewStats(stats) {
    if (!stats) return;
    previewParticipants.textContent = UI.formatNumber(stats.participants);
    previewAnswers.textContent = UI.formatNumber(stats.totalAnswers);
    previewUnique.textContent = UI.formatNumber(stats.uniqueWords);
  }

  function syncPreview() {
    if (!previewRoomId) return;
    const room = rooms.find((item) => item.id === previewRoomId);
    if (!room) {
      closePreview();
      return;
    }
    previewRoomName.textContent = room.name;
    previewBadge.className = `status-badge status-badge--${room.status}`;
    previewBadge.textContent = UI.statusLabel(room.status);
    previewParticipants.textContent = UI.formatNumber(room.participants);
    previewAnswers.textContent = UI.formatNumber(room.totalAnswers);
    previewUnique.textContent = UI.formatNumber(room.uniqueWords);
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = adminPassword.value;
    if (!password) return;

    loginButton.disabled = true;
    setLoginFeedback('Memeriksa password…', 'info');

    try {
      const result = await UI.api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (!result.ok || !result.body || !result.body.token) {
        setLoginFeedback((result.body && result.body.message) || 'Password admin salah.', 'error');
        adminPassword.select();
        return;
      }

      saveToken(result.body.token);
      adminPassword.value = '';
      setLoginFeedback('');
      connectAdmin();
      UI.toast('Login berhasil. Selamat mengelola room!', 'success');
    } catch (err) {
      setLoginFeedback('Tidak dapat menghubungi server. Coba lagi.', 'error');
    } finally {
      loginButton.disabled = false;
    }
  });

  createRoomButton.addEventListener('click', openCreateForm);
  cancelRoomForm.addEventListener('click', closeForm);
  cancelRoomFormBottom.addEventListener('click', closeForm);
  roomForm.addEventListener('submit', submitForm);
  closePreviewButton.addEventListener('click', closePreview);
  logoutButton.addEventListener('click', logout);

  if (token) {
    connectAdmin();
  } else {
    showLogin();
  }
})();
