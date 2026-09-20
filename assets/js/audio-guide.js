/* ==========================================================================
   Visit Kokino — audio guide player

   The original guide shipped as an Android/iOS app that no longer exists.
   These are the same seven recordings, served straight from the site so they
   work in any phone browser on the hill — no install, no account.
   ========================================================================== */
(function () {
  'use strict';

  // Strings the player writes into the page, per language.
  var T = {
    en: {
      play: 'Play', pause: 'Pause',
      stop: 'Stop {n} of {total}',
      resume: 'Resume \u2014 stop {n} of {total}',
      failed: 'This recording could not be loaded.',
      album: 'Megalithic Observatory Kokino',
      artist: 'Visit Kokino \u2014 Audio Guide'
    },
    mk: {
      play: 'Пушти', pause: 'Пауза',
      stop: 'Стојалиште {n} од {total}',
      resume: 'Продолжи \u2014 стојалиште {n} од {total}',
      failed: 'Оваа снимка не може да се вчита.',
      album: 'Мегалитска опсерваторија Кокино',
      artist: 'Посетете Кокино \u2014 аудио водич'
    }
  }[document.documentElement.lang === 'mk' ? 'mk' : 'en'];

  function fill(tpl, n, total) {
    return tpl.replace('{n}', n).replace('{total}', total);
  }

  var root = document.querySelector('[data-audio-guide]');
  if (!root) return;

  var stops = Array.prototype.slice.call(root.querySelectorAll('.ag-stop'));
  if (!stops.length) return;

  var audio = new Audio();
  audio.preload = 'metadata'; // visitors are often on mobile data up there

  var el = {
    title:  root.querySelector('[data-ag-title]'),
    sub:    root.querySelector('[data-ag-sub]'),
    label:  root.querySelector('[data-ag-label]'),
    scrub:  root.querySelector('[data-ag-scrub]'),
    cur:    root.querySelector('[data-ag-current]'),
    dur:    root.querySelector('[data-ag-duration]'),
    play:   root.querySelector('[data-ag-play]'),
    prev:   root.querySelector('[data-ag-prev]'),
    next:   root.querySelector('[data-ag-next]'),
    rate:   root.querySelector('[data-ag-rate]'),
    icon:   root.querySelector('[data-ag-play] .bi')
  };

  var index = 0;
  var RATES = [1, 1.25, 1.5, 0.75];
  var rateAt = 0;
  var STORE = 'vk-guide-pos';

  /* ---------- Helpers ------------------------------------------------------ */

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function stopData(i) {
    var node = stops[i];
    return {
      src:   node.getAttribute('data-src'),
      title: node.querySelector('.ag-stop-title'),
      sub:   node.querySelector('.ag-stop-sub'),
      time:  node.getAttribute('data-duration') || ''
    };
  }

  function setPlayIcon(playing) {
    if (!el.icon) return;
    el.icon.className = playing ? 'bi bi-pause-fill' : 'bi bi-play-fill';
    if (el.play) {
      el.play.setAttribute('aria-label', playing ? T.pause : T.play);
    }
  }

  function remember() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ i: index, t: audio.currentTime }));
    } catch (e) { /* private mode — just don't resume */ }
  }

  function recall() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var v = JSON.parse(raw);
      if (typeof v.i !== 'number' || v.i < 0 || v.i >= stops.length) return null;
      return v;
    } catch (e) { return null; }
  }

  /* ---------- Media Session (lock screen controls) ------------------------- */

  function publishMetadata() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    var d = stopData(index);
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: d.title ? d.title.textContent : 'Kokino',
        artist: T.artist,
        album: T.album
      });
      navigator.mediaSession.setActionHandler('play', play);
      navigator.mediaSession.setActionHandler('pause', pause);
      navigator.mediaSession.setActionHandler('previoustrack', function () { go(index - 1, true); });
      navigator.mediaSession.setActionHandler('nexttrack', function () { go(index + 1, true); });
    } catch (e) { /* not supported — controls simply won't appear */ }
  }

  /* ---------- Core --------------------------------------------------------- */

  function paint() {
    var d = stopData(index);

    if (el.title && d.title) el.title.textContent = d.title.textContent;
    if (el.sub && d.sub) el.sub.textContent = d.sub.textContent;
    if (el.label) el.label.textContent = fill(T.stop, index + 1, stops.length);
    if (el.dur && d.time) el.dur.textContent = d.time;

    stops.forEach(function (node, i) {
      node.setAttribute('aria-current', i === index ? 'true' : 'false');
      node.classList.toggle('is-playing', i === index && !audio.paused);
    });

    if (el.prev) el.prev.disabled = index === 0;
    if (el.next) el.next.disabled = index === stops.length - 1;

    publishMetadata();
  }

  function load(i, autoplay) {
    index = i;
    var d = stopData(i);
    if (!d.src) return;

    audio.src = d.src;
    audio.playbackRate = RATES[rateAt];
    setProgress(0);
    if (el.cur) el.cur.textContent = '0:00';
    paint();

    if (autoplay) play();
  }

  function go(i, autoplay) {
    if (i < 0 || i >= stops.length) return;
    load(i, autoplay);
  }

  function play() {
    var attempt = audio.play();
    if (attempt && attempt.catch) {
      attempt.catch(function () { setPlayIcon(false); });
    }
  }

  function pause() { audio.pause(); }

  function setProgress(ratio) {
    if (!el.scrub) return;
    el.scrub.style.setProperty('--played', (ratio * 100).toFixed(2) + '%');
    el.scrub.setAttribute('aria-valuenow', Math.round(ratio * 100));
  }

  /* ---------- Wiring -------------------------------------------------------- */

  stops.forEach(function (node, i) {
    node.addEventListener('click', function () {
      if (i === index) {
        audio.paused ? play() : pause();
      } else {
        go(i, true);
      }
    });
  });

  if (el.play) {
    el.play.addEventListener('click', function () {
      audio.paused ? play() : pause();
    });
  }
  if (el.prev) el.prev.addEventListener('click', function () { go(index - 1, true); });
  if (el.next) el.next.addEventListener('click', function () { go(index + 1, true); });

  if (el.rate) {
    el.rate.addEventListener('click', function () {
      rateAt = (rateAt + 1) % RATES.length;
      audio.playbackRate = RATES[rateAt];
      el.rate.textContent = RATES[rateAt] + '×';
    });
  }

  /* Scrubbing */
  if (el.scrub) {
    var seekFromEvent = function (e) {
      var box = el.scrub.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX) - box.left;
      var ratio = Math.min(1, Math.max(0, x / box.width));
      if (isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
      setProgress(ratio);
    };

    el.scrub.addEventListener('click', seekFromEvent);

    el.scrub.addEventListener('keydown', function (e) {
      if (!isFinite(audio.duration)) return;
      var step = 5;
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + step); e.preventDefault(); }
      if (e.key === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - step); e.preventDefault(); }
      if (e.key === 'Home')       { audio.currentTime = 0; e.preventDefault(); }
      if (e.key === 'End')        { audio.currentTime = audio.duration; e.preventDefault(); }
    });
  }

  /* Audio events */
  audio.addEventListener('timeupdate', function () {
    if (el.cur) el.cur.textContent = fmt(audio.currentTime);
    if (isFinite(audio.duration) && audio.duration > 0) {
      setProgress(audio.currentTime / audio.duration);
    }
    remember();
  });

  audio.addEventListener('loadedmetadata', function () {
    if (el.dur) el.dur.textContent = fmt(audio.duration);
  });

  audio.addEventListener('play', function () {
    setPlayIcon(true);
    stops.forEach(function (n, i) { n.classList.toggle('is-playing', i === index); });
  });

  audio.addEventListener('pause', function () {
    setPlayIcon(false);
    stops.forEach(function (n) { n.classList.remove('is-playing'); });
  });

  audio.addEventListener('ended', function () {
    setPlayIcon(false);
    if (index < stops.length - 1) go(index + 1, true);
  });

  audio.addEventListener('error', function () {
    if (el.sub) el.sub.textContent = T.failed;
    setPlayIcon(false);
  });

  /* Keyboard shortcuts while the guide has focus */
  root.addEventListener('keydown', function (e) {
    if (e.target.closest('.ag-scrub')) return; // scrubber handles its own keys
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      audio.paused ? play() : pause();
    }
  });

  /* ---------- Start --------------------------------------------------------- */

  var saved = recall();
  load(saved ? saved.i : 0, false);

  if (saved && saved.t > 2) {
    audio.addEventListener('loadedmetadata', function once() {
      audio.removeEventListener('loadedmetadata', once);
      if (saved.t < audio.duration) audio.currentTime = saved.t;
    });
    if (el.label) {
      el.label.textContent = fill(T.resume, saved.i + 1, stops.length);
    }
  }

  setPlayIcon(false);
})();
