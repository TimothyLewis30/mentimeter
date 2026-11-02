'use strict';

/** Display satu room: waiting, live, ended. Read-only. */
(function () {
  const UI = window.UI;
  const roomId = UI.roomIdFromPath();
  const canvas = document.getElementById('wordCloudCanvas');
  const emptyState = document.getElementById('emptyState');
  const closedBanner = document.getElementById('closedBanner');
  const overlayTitle = document.getElementById('overlayTitle');
  const overlayText = document.getElementById('overlayText');
  const questionEl = document.getElementById('questionText');
  const displayKicker = document.getElementById('displayKicker');
  const livePill = document.getElementById('livePill');
  const liveLabel = document.getElementById('liveLabel');
  const recPill = document.getElementById('recPill');
  const recLabel = document.getElementById('recLabel');
  const joinLink = document.getElementById('joinLink');
  const footerUrl = document.getElementById('footerUrl');
  const displayUrl = document.getElementById('displayUrl');
  const displayRoomName = document.getElementById('displayRoomName');
  const statParticipants = document.getElementById('statParticipants');
  const statAnswers = document.getElementById('statAnswers');
  const statUnique = document.getElementById('statUnique');

  if (!roomId) {
    window.location.replace('/');
    return;
  }

  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const participantUrl = `${window.location.origin}/room/${encodeURIComponent(roomId)}`;
  const hostLabel = window.location.host || 'localhost:3000';
  if (joinLink) joinLink.textContent = participantUrl.replace(/^https?:\/\//, '');
  if (footerUrl) footerUrl.textContent = participantUrl.replace(/^https?:\/\//, '');
  if (displayUrl) displayUrl.textContent = hostLabel;

  let renderer = null;
  let status = 'waiting';
  let hasWords = false;

  try {
    renderer = new window.WordCloudRenderer(canvas, {
      maxWords: 150,
      maxFontCap: 200,
      padding: 6,
      duration: prefersReducedMotion ? 0 : 900,
    });
  } catch (err) {
    console.error('[display] Gagal membuat word cloud:', err);
  }

  const socket = io('/room', { auth: { roomId, role: 'display' } });

  let questionTimer = null;
  const countFrames = new WeakMap();

  function setQuestion(text) {
    if (!text || questionEl.textContent === text) return;
    clearTimeout(questionTimer);
    questionEl.classList.add('is-updating');
    questionTimer = setTimeout(() => {
      questionEl.textContent = text;
      questionEl.classList.remove('is-updating');
    }, 160);
  }

  function setLivePill(state, label) {
    if (livePill) livePill.dataset.state = state;
    if (liveLabel) liveLabel.textContent = label;
  }

  function setRec(recording) {
    if (!recPill) return;
    const value = recording && recording.status;
    if (value === 'recording') {
      recPill.hidden = false;
      recPill.dataset.state = 'recording';
      recLabel.textContent = 'REC';
    } else if (value === 'interrupted' || value === 'unknown') {
      recPill.hidden = false;
      recPill.dataset.state = 'interrupted';
      recLabel.textContent = 'REC terputus';
    } else {
      recPill.hidden = true;
      recPill.dataset.state = 'idle';
    }
  }

  function setCounter(element, value) {
    if (!element) return;
    const target = Math.max(0, Number(value) || 0);
    const from = Number(element.dataset.value || 0);
    element.dataset.value = String(target);
    if (from === target || prefersReducedMotion) {
      element.textContent = UI.formatNumber(target);
      return;
    }

    const previousFrame = countFrames.get(element);
    if (previousFrame) cancelAnimationFrame(previousFrame);

    const startedAt = performance.now();
    const duration = 520;
    const tick = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = UI.formatNumber(Math.round(from + (target - from) * eased));
      if (progress < 1) countFrames.set(element, requestAnimationFrame(tick));
    };
    countFrames.set(element, requestAnimationFrame(tick));
  }

  function updateStats(stats) {
    if (!stats) return;
    setCounter(statParticipants, stats.participants);
    setCounter(statAnswers, stats.totalAnswers);
    setCounter(statUnique, stats.uniqueWords);
  }

  function overlay(title, text, visible) {
    overlayTitle.textContent = title;
    overlayText.textContent = text;
    emptyState.classList.toggle('is-hidden', !visible);
  }

  function applyStatus(nextStatus) {
    status = nextStatus || 'waiting';
    closedBanner.hidden = status !== 'ended';

    if (status === 'waiting') {
      setLivePill('online', 'Menunggu');
      displayKicker.textContent = 'Bersiap';
      overlay(
        'Menunggu operator memulai',
        'Bagikan link peserta di bawah. Word cloud akan muncul otomatis saat sesi dimulai.',
        true
      );
    } else if (status === 'live') {
      setLivePill('online', 'Live');
      displayKicker.textContent = 'Kata-kata dari peserta';
      overlay(
        'Menunggu jawaban pertama',
        'Bagikan link peserta di bawah. Setiap jawaban langsung membentuk word cloud ini.',
        !hasWords
      );
    } else {
      setLivePill('offline', 'Selesai');
      displayKicker.textContent = 'Word cloud final';
      overlay('Sesi berakhir', 'Terima kasih kepada semua peserta.', !hasWords);
    }
  }

  function applyWords(words) {
    const list = Array.isArray(words) ? words : [];
    hasWords = list.length > 0;
    if (renderer) renderer.setData(list);
    if (status === 'live') {
      overlay('Menunggu jawaban pertama', '', !hasWords);
    } else if (status === 'ended') {
      overlay('Sesi berakhir', 'Terima kasih kepada semua peserta.', !hasWords);
    }
  }

  socket.on('connect', () => setLivePill('online', status === 'live' ? 'Live' : 'Terhubung'));
  socket.on('disconnect', () => setLivePill('offline', 'Menyambung ulang…'));
  socket.on('connect_error', (error) => {
    const code = error && error.data && error.data.code;
    setLivePill('offline', code === 'ROOM_NOT_FOUND' ? 'Room tidak ditemukan' : 'Offline');
  });

  socket.on('room:init', (payload) => {
    if (!payload || !payload.room) return;
    setQuestion(payload.room.question);
    displayRoomName.textContent = payload.room.name || 'Room';
    document.title = `${payload.room.name || 'Room'} — Live Word Cloud`;
    applyStatus(payload.room.status);
    applyWords(payload.words);
    updateStats(payload.stats);
    setRec(payload.recording);
  });

  socket.on('room:status', (payload) => {
    if (!payload) return;
    applyStatus(payload.status);
    setRec(payload.recording);
  });

  socket.on('room:meta', (payload) => {
    if (!payload) return;
    if (payload.name) {
      displayRoomName.textContent = payload.name;
      document.title = `${payload.name} — Live Word Cloud`;
    }
    if (payload.question) setQuestion(payload.question);
  });

  socket.on('update-wordcloud', applyWords);
  socket.on('stats:update', updateStats);
  socket.on('recording:update', setRec);
  socket.on('room:deleted', () => {
    setLivePill('offline', 'Room dihapus');
    overlay('Room telah dihapus', 'Admin menutup room ini.', true);
    socket.disconnect();
  });

  applyStatus('waiting');
  overlay('Menunggu operator memulai', 'Bagikan link peserta di bawah.', true);
})();
