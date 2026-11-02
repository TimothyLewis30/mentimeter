'use strict';

/**
 * Halaman peserta: kirim jawaban, lihat status koneksi, dan 5 kata teratas.
 */

(function () {
  const socket = io();

  const form = document.getElementById('answerForm');
  const input = document.getElementById('answerInput');
  const submitBtn = document.getElementById('submitBtn');
  const submitLabel = submitBtn ? submitBtn.querySelector('.btn-label') : null;
  const charCount = document.getElementById('charCount');
  const feedback = document.getElementById('feedback');
  const submittedRow = document.getElementById('submittedRow');
  const submittedText = document.getElementById('submittedText');
  const questionEl = document.getElementById('questionText');
  const topWordsEl = document.getElementById('topWords');
  const answerCountEl = document.getElementById('answerCount');
  const peopleCountEl = document.getElementById('peopleCount');
  const connectionPill = document.getElementById('connectionPill');
  const connectionText = document.getElementById('connectionText');

  const numberFormat = new Intl.NumberFormat('id-ID');
  const maxLength = input && input.maxLength > 0 ? input.maxLength : 40;

  let accepting = true;
  let submitting = false;
  let cooldownUntil = 0;
  let cooldownTimer = null;
  let feedbackTimeout = null;
  let submittedCount = 0;
  let connected = false;

  function setConnection(state, label) {
    connected = state === 'online';
    if (connectionPill) connectionPill.dataset.state = state;
    if (connectionText) connectionText.textContent = label;
    updateAvailability();
  }

  function updateAvailability() {
    if (!input || !submitBtn) return;
    const coolingDown = Date.now() < cooldownUntil;
    const enabled = connected && accepting && !submitting && !coolingDown;

    input.disabled = !connected || !accepting;
    submitBtn.disabled = !enabled;

    if (!accepting) {
      input.placeholder = 'Sesi sudah ditutup oleh admin';
    } else {
      input.placeholder = 'Ketik 1 kata atau frasa singkat…';
    }
  }

  function showFeedback(message, type = 'info', autoHide = true) {
    if (!feedback) return;
    clearTimeout(feedbackTimeout);

    feedback.textContent = message;
    feedback.className = `feedback is-visible is-${type}`;

    if (autoHide) {
      feedbackTimeout = setTimeout(() => {
        feedback.classList.remove('is-visible');
      }, 4200);
    }
  }

  function updateCharCount() {
    if (!charCount || !input) return;
    const length = input.value.length;
    charCount.textContent = `${length}/${maxLength}`;
    charCount.classList.toggle('is-near', length >= maxLength - 8 && length < maxLength);
    charCount.classList.toggle('is-max', length >= maxLength);
  }

  function setQuestion(text) {
    if (!questionEl || !text) return;
    if (questionEl.textContent === text) return;
    questionEl.textContent = text;
  }

  function setAccepting(value) {
    accepting = Boolean(value);
    updateAvailability();

    if (!accepting) {
      showFeedback('Sesi sudah ditutup oleh admin. Terima kasih sudah berpartisipasi!', 'info', false);
    } else if (feedback && feedback.classList.contains('is-info')) {
      feedback.classList.remove('is-visible');
    }
  }

  function setStat(element, value) {
    if (!element) return;
    const formatted = numberFormat.format(value || 0);
    element.textContent = formatted;
  }

  function updateStats(stats) {
    if (!stats) return;
    if (answerCountEl) setStat(answerCountEl, stats.totalAnswers);
    if (peopleCountEl) setStat(peopleCountEl, stats.participants);
  }

  function findChip(text) {
    if (!topWordsEl) return null;
    return (
      Array.from(topWordsEl.querySelectorAll('.word-chip')).find(
        (chip) => chip.dataset.word === text
      ) || null
    );
  }

  function renderTopWords(words) {
    if (!topWordsEl) return;

    const list = (Array.isArray(words) ? words : [])
      .filter((word) => word && typeof word.text === 'string' && Number(word.size) > 0)
      .slice(0, 5);

    if (!list.length) {
      topWordsEl.innerHTML = '<span class="muted">Menunggu jawaban pertama…</span>';
      return;
    }

    const placeholder = topWordsEl.querySelector('.muted');
    if (placeholder) placeholder.remove();

    const seen = new Set();

    list.forEach((word) => {
      seen.add(word.text);
      let chip = findChip(word.text);

      if (!chip) {
        chip = document.createElement('span');
        chip.className = 'word-chip';
        chip.dataset.word = word.text;

        const text = document.createElement('span');
        text.className = 'word-chip__text';

        const count = document.createElement('span');
        count.className = 'word-chip__count';

        chip.append(text, count);
      }

      chip.querySelector('.word-chip__text').textContent = word.text;
      chip.querySelector('.word-chip__count').textContent = `${numberFormat.format(word.size)}×`;
      topWordsEl.append(chip);
    });

    Array.from(topWordsEl.querySelectorAll('.word-chip')).forEach((chip) => {
      if (!seen.has(chip.dataset.word)) chip.remove();
    });
  }

  function triggerCooldown(ms) {
    cooldownUntil = Date.now() + ms;
    updateAvailability();
    clearTimeout(cooldownTimer);
    cooldownTimer = setTimeout(() => {
      updateAvailability();
      if (input) input.focus();
    }, ms);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    if (!socket.connected) {
      showFeedback('Koneksi ke server terputus. Menyambung ulang…', 'error');
      return;
    }

    if (!accepting) {
      showFeedback('Sesi sudah ditutup oleh admin.', 'info');
      return;
    }

    if (submitting || Date.now() < cooldownUntil) return;

    const value = input.value.trim();
    if (!value) {
      input.classList.add('shake');
      setTimeout(() => input.classList.remove('shake'), 350);
      input.focus();
      showFeedback('Tulis jawaban dulu ya.', 'error');
      return;
    }

    submitting = true;
    updateAvailability();

    const previousLabel = submitLabel ? submitLabel.textContent : '';
    if (submitLabel) submitLabel.textContent = 'Mengirim…';

    socket.timeout(7000).emit('submit-answer', value, (err, response) => {
      submitting = false;
      if (submitLabel) submitLabel.textContent = previousLabel || 'Kirim Jawaban';

      if (err) {
        showFeedback('Server tidak merespons. Silakan coba lagi.', 'error');
        updateAvailability();
        return;
      }

      if (!response || !response.ok) {
        showFeedback((response && response.message) || 'Jawaban gagal dikirim.', 'error');
        updateAvailability();
        return;
      }

      input.value = '';
      updateCharCount();

      submittedCount += 1;
      if (submittedRow && submittedText) {
        submittedRow.hidden = false;
        submittedText.textContent = `"${response.text}" terkirim — jawaban Anda ke-${submittedCount}.`;
      }

      showFeedback('Jawaban berhasil terkirim! Lihat layar utama. ✨', 'success');
      triggerCooldown(950);
    });
  });

  input.addEventListener('input', updateCharCount);

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      // Biarkan form submit menangani (mencegah newline/duplikasi).
      event.preventDefault();
      if (!submitBtn.disabled) form.requestSubmit();
    }
  });

  socket.on('connect', () => {
    setConnection('online', 'Live');
    socket.emit('register-role', 'audience');
  });

  socket.on('disconnect', () => {
    setConnection('offline', 'Terputus');
    submitting = false;
    if (submitLabel) submitLabel.textContent = 'Kirim Jawaban';
  });

  socket.on('connect_error', () => {
    setConnection('offline', 'Gagal terhubung');
  });

  socket.on('state:init', (data) => {
    if (!data) return;
    setQuestion(data.question);
    setAccepting(data.acceptingAnswers);
    renderTopWords(data.words);
    updateStats(data.stats);
  });

  socket.on('question:update', (question) => {
    setQuestion(question);
  });

  socket.on('accepting:update', (value) => {
    setAccepting(value);
  });

  socket.on('stats:update', (stats) => {
    updateStats(stats);
  });

  socket.on('topwords:update', (words) => {
    renderTopWords(words);
  });

  updateCharCount();
  setConnection('connecting', 'Menghubungkan…');
})();
