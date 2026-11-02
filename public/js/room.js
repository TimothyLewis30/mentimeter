'use strict';

/** Halaman peserta satu room: waiting → live → ended. */
(function () {
  const UI = window.UI;
  const roomId = UI.roomIdFromPath();
  const connectionPill = document.getElementById('connectionPill');
  const connectionText = document.getElementById('connectionText');
  const roomName = document.getElementById('roomName');
  const roomBadge = document.getElementById('roomBadge');
  const questionText = document.getElementById('questionText');
  const waitingPanel = document.getElementById('waitingPanel');
  const waitingTitle = document.getElementById('waitingTitle');
  const waitingText = document.getElementById('waitingText');
  const answerForm = document.getElementById('answerForm');
  const answerInput = document.getElementById('answerInput');
  const charCount = document.getElementById('charCount');
  const submitBtn = document.getElementById('submitBtn');
  const feedback = document.getElementById('feedback');
  const submittedRow = document.getElementById('submittedRow');
  const submittedText = document.getElementById('submittedText');
  const endedPanel = document.getElementById('endedPanel');
  const deletedPanel = document.getElementById('deletedPanel');
  const roomHint = document.getElementById('roomHint');
  const topWordsEl = document.getElementById('topWords');
  const answerCount = document.getElementById('answerCount');
  const peopleCount = document.getElementById('peopleCount');

  if (!roomId) {
    window.location.replace('/');
    return;
  }

  let status = 'waiting';
  let sending = false;
  let closed = false;

  const socket = io('/room', {
    auth: { roomId, role: 'audience' },
    reconnection: true,
  });

  function setFeedback(message, type) {
    feedback.textContent = message || '';
    feedback.className = 'feedback';
    if (message) {
      feedback.classList.add('is-visible');
      if (type) feedback.classList.add(`is-${type}`);
    }
  }

  function setBadge(value) {
    roomBadge.className = `status-badge status-badge--${value}`;
    roomBadge.textContent = UI.statusLabel(value);
  }

  function renderStatus(nextStatus, room, stats) {
    status = nextStatus || 'waiting';
    setBadge(status);

    const live = status === 'live';
    const ended = status === 'ended';
    const waiting = status === 'waiting';

    waitingPanel.hidden = !waiting;
    endedPanel.hidden = !ended;
    answerForm.hidden = !live;
    roomHint.hidden = ended || closed;

    if (waiting) {
      waitingTitle.textContent = 'Sesi belum dimulai';
      waitingText.textContent = 'Tunggu operator memulai room. Halaman ini akan aktif otomatis.';
      answerInput.disabled = true;
      submitBtn.disabled = true;
    } else if (live) {
      answerInput.disabled = false;
      submitBtn.disabled = false;
      answerForm.hidden = false;
    } else if (ended) {
      answerInput.disabled = true;
      submitBtn.disabled = true;
      submittedRow.hidden = true;
      setFeedback('');
    }

    if (room) {
      roomName.textContent = room.name || 'Room';
      questionText.textContent = room.question || '';
      document.title = `${room.name || 'Room'} — CloudWords`;
    }

    if (stats) {
      answerCount.textContent = UI.formatNumber(stats.totalAnswers);
      peopleCount.textContent = UI.formatNumber(stats.participants);
    }
  }

  function showDeleted() {
    closed = true;
    answerForm.hidden = true;
    waitingPanel.hidden = true;
    endedPanel.hidden = true;
    deletedPanel.hidden = false;
    roomHint.hidden = true;
    submitBtn.disabled = true;
    answerInput.disabled = true;
    UI.setConnection(connectionPill, 'offline', 'Room ditutup');
    socket.disconnect();
  }

  function updateCharCount() {
    charCount.textContent = `${answerInput.value.length}/40`;
  }

  socket.on('connect', () => {
    UI.setConnection(connectionPill, 'online', 'Terhubung');
  });

  socket.on('disconnect', () => {
    if (closed) return;
    UI.setConnection(connectionPill, 'offline', 'Menyambung ulang…');
  });

  socket.on('connect_error', (error) => {
    const code = error && error.data && error.data.code;
    if (code === 'ROOM_NOT_FOUND') {
      showDeleted();
      return;
    }
    UI.setConnection(connectionPill, 'offline', 'Koneksi gagal');
  });

  socket.on('room:init', (payload) => {
    if (!payload || !payload.room) return;
    renderStatus(payload.room.status, payload.room, payload.stats);
    UI.renderChips(topWordsEl, payload.words, 'Menunggu jawaban pertama…');
    if (payload.room.status === 'live') {
      answerInput.focus({ preventScroll: true });
    }
  });

  socket.on('room:status', (payload) => {
    if (!payload) return;
    renderStatus(payload.status);
    if (payload.status === 'ended') {
      UI.toast('Sesi telah berakhir. Terima kasih!', 'info');
    }
    if (payload.status === 'live') {
      waitingPanel.hidden = true;
      setFeedback('Sesi dimulai! Kirim kata pertamamu.', 'success');
      answerInput.focus({ preventScroll: true });
    }
  });

  socket.on('room:meta', (payload) => {
    if (!payload) return;
    if (payload.name) {
      roomName.textContent = payload.name;
      document.title = `${payload.name} — CloudWords`;
    }
    if (payload.question) questionText.textContent = payload.question;
  });

  socket.on('topwords:update', (words) => {
    UI.renderChips(topWordsEl, words, 'Menunggu jawaban pertama…');
  });

  socket.on('stats:update', (stats) => {
    if (!stats) return;
    answerCount.textContent = UI.formatNumber(stats.totalAnswers);
    peopleCount.textContent = UI.formatNumber(stats.participants);
  });

  socket.on('room:deleted', showDeleted);

  answerInput.addEventListener('input', updateCharCount);

  answerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending || status !== 'live') return;

    const value = answerInput.value.trim();
    if (!value) {
      setFeedback('Tulis satu kata atau frasa singkat dulu.', 'error');
      answerInput.focus();
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    setFeedback('Mengirim…', 'info');

    socket.timeout(6000).emit('submit-answer', value, (err, response) => {
      sending = false;
      submitBtn.disabled = status !== 'live';

      if (err) {
        setFeedback('Server tidak merespons. Coba kirim lagi.', 'error');
        return;
      }
      if (!response || !response.ok) {
        const message = (response && response.message) || 'Jawaban ditolak.';
        setFeedback(message, 'error');
        return;
      }

      answerInput.value = '';
      updateCharCount();
      setFeedback('');
      submittedText.textContent = `“${response.text}” terkirim!`;
      submittedRow.hidden = false;
      setTimeout(() => {
        submittedRow.hidden = true;
      }, 3200);
      answerInput.focus({ preventScroll: true });
    });
  });

  updateCharCount();
  renderStatus('waiting');
})();
