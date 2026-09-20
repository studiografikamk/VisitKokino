/* ==========================================================================
   Visit Kokino — UI behaviour
   Vanilla ES2015+. No inline handlers, no eval, no external calls.
   ========================================================================== */
(function () {
  'use strict';

  // Strings the script injects. The page language decides which set is used.
  var T = {
    en: { viewer: 'Image viewer', close: 'Close' },
    mk: { viewer: 'Прегледувач на слики', close: 'Затвори' }
  }[document.documentElement.lang === 'mk' ? 'mk' : 'en'];

  /* ---------- Sticky navbar ---------------------------------------------- */

  var nav = document.querySelector('.nav-bar');
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle('is-stuck', window.scrollY > 24);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Mobile nav toggle ------------------------------------------ */

  var toggle = document.querySelector('.nav-toggle');
  var links = document.querySelector('.nav-links');

  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      var icon = toggle.querySelector('.bi');
      if (icon) icon.className = open ? 'bi bi-x-lg' : 'bi bi-list';
    });

    // Close the mobile menu after following an in-page link
    links.addEventListener('click', function (e) {
      if (e.target.closest('a') && window.matchMedia('(max-width: 900px)').matches) {
        links.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        var icon = toggle.querySelector('.bi');
        if (icon) icon.className = 'bi bi-list';
      }
    });
  }

  /* ---------- Dropdown menus --------------------------------------------- */

  var drops = Array.prototype.slice.call(document.querySelectorAll('.nav-drop'));

  drops.forEach(function (drop) {
    var btn = drop.querySelector('button');
    if (!btn) return;

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = drop.classList.contains('is-open');
      drops.forEach(function (d) {
        d.classList.remove('is-open');
        var b = d.querySelector('button');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
      if (!isOpen) {
        drop.classList.add('is-open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.nav-drop')) {
      drops.forEach(function (d) {
        d.classList.remove('is-open');
        var b = d.querySelector('button');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    drops.forEach(function (d) {
      d.classList.remove('is-open');
      var b = d.querySelector('button');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- Reveal on scroll ------------------------------------------- */

  var revealables = document.querySelectorAll('.reveal');

  if (revealables.length) {
    if (!('IntersectionObserver' in window)) {
      // Older browsers: show everything immediately.
      Array.prototype.forEach.call(revealables, function (el) {
        el.classList.add('is-in');
      });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        });
      }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });

      Array.prototype.forEach.call(revealables, function (el, i) {
        // Stagger siblings a little for a more organic entrance.
        el.style.transitionDelay = (Math.min(i % 4, 3) * 80) + 'ms';
        io.observe(el);
      });
    }
  }

  /* ---------- Gallery lightbox ------------------------------------------- */

  var galItems = document.querySelectorAll('.gal-item');

  if (galItems.length) {
    var box = document.createElement('div');
    box.className = 'lightbox';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', T.viewer);

    var inner = document.createElement('div');
    inner.className = 'center';

    var bigImg = document.createElement('img');
    bigImg.alt = '';

    var cap = document.createElement('p');
    cap.className = 'lightbox-cap';

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'lightbox-close';
    closeBtn.setAttribute('aria-label', T.close);
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    inner.appendChild(bigImg);
    inner.appendChild(cap);
    box.appendChild(closeBtn);
    box.appendChild(inner);
    document.body.appendChild(box);

    var lastFocus = null;

    var openBox = function (src, text) {
      lastFocus = document.activeElement;
      bigImg.src = src;
      bigImg.alt = text || '';
      cap.textContent = text || '';
      box.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    };

    var closeBox = function () {
      box.classList.remove('is-open');
      document.body.style.overflow = '';
      bigImg.removeAttribute('src');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    };

    Array.prototype.forEach.call(galItems, function (item) {
      item.addEventListener('click', function () {
        var img = item.querySelector('img');
        if (!img) return;
        var full = item.getAttribute('data-full') || img.currentSrc || img.src;
        var label = item.getAttribute('data-caption') || img.alt || '';
        openBox(full, label);
      });
    });

    closeBtn.addEventListener('click', closeBox);
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target === inner) closeBox();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && box.classList.contains('is-open')) closeBox();
    });
  }

  /* ---------- Footer year ------------------------------------------------- */

  var yearEls = document.querySelectorAll('[data-year]');
  Array.prototype.forEach.call(yearEls, function (el) {
    el.textContent = String(new Date().getFullYear());
  });
})();
