/* ==========================================================================
   Visit Kokino — bilingual layer (EN default, MK on demand)

   English lives in the HTML, so the page is complete and crawlable with
   JavaScript disabled. Macedonian is fetched from a static same-origin JSON
   file only when the visitor asks for it.

   Markup contract:
     data-i18n="key"                 -> textContent
     data-i18n-html="key"            -> innerHTML, run through an allowlist
     data-i18n-attr="alt:key, title:key2" -> attribute values
   ========================================================================== */
(function () {
  'use strict';

  var SUPPORTED = ['en', 'mk'];
  var DEFAULT_LANG = 'en';
  var STORE_KEY = 'vk-lang';

  var page = document.body.getAttribute('data-page') || 'index';
  var cache = {};      // lang -> dictionary
  var snapshot = null; // the original English strings, captured once
  var current = DEFAULT_LANG;

  /* ---------- Tiny HTML allowlist ---------------------------------------- */

  var ALLOWED_TAGS = ['EM', 'STRONG', 'B', 'I', 'BR', 'SPAN', 'SMALL', 'A'];
  var ALLOWED_ATTRS = { A: ['href'], SPAN: ['class'] };

  function scrub(node) {
    var children = Array.prototype.slice.call(node.childNodes);

    children.forEach(function (child) {
      if (child.nodeType === 3) return; // text is fine

      if (child.nodeType !== 1) { // comments, etc.
        node.removeChild(child);
        return;
      }

      if (ALLOWED_TAGS.indexOf(child.tagName) === -1) {
        // Unwrap: keep the words, drop the tag.
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        return;
      }

      var keep = ALLOWED_ATTRS[child.tagName] || [];
      Array.prototype.slice.call(child.attributes).forEach(function (attr) {
        if (keep.indexOf(attr.name) === -1) {
          child.removeAttribute(attr.name);
          return;
        }
        if (attr.name === 'href') {
          var v = attr.value.trim();
          // Only same-site or plain https links; never javascript:/data:
          var ok = /^(https:\/\/|\/|#|\.\/|[a-z0-9._-]+\.html)/i.test(v);
          if (!ok) child.removeAttribute('href');
        }
      });

      scrub(child);
    });
  }

  function safeHTML(el, markup) {
    var doc = new DOMParser().parseFromString(
      '<!doctype html><body>' + markup, 'text/html'
    );
    scrub(doc.body);
    el.textContent = '';
    while (doc.body.firstChild) el.appendChild(doc.body.firstChild);
  }

  /* ---------- Capture the English baseline -------------------------------- */

  function capture() {
    var snap = { text: {}, html: {}, attr: {}, title: document.title, desc: '' };

    var meta = document.querySelector('meta[name="description"]');
    if (meta) snap.desc = meta.getAttribute('content') || '';

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      snap.text[el.getAttribute('data-i18n')] = el.textContent;
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      snap.html[el.getAttribute('data-i18n-html')] = el.innerHTML;
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var map = {};
      parseAttrSpec(el).forEach(function (pair) {
        map[pair.attr] = el.getAttribute(pair.attr) || '';
      });
      snap.attr[cssPath(el)] = map;
    });

    return snap;
  }

  function parseAttrSpec(el) {
    return (el.getAttribute('data-i18n-attr') || '')
      .split(',')
      .map(function (chunk) {
        var bits = chunk.split(':');
        if (bits.length < 2) return null;
        return { attr: bits[0].trim(), key: bits[1].trim() };
      })
      .filter(Boolean);
  }

  // Stable identifier for elements carrying translated attributes.
  var pathSeq = 0;
  function cssPath(el) {
    if (!el.dataset.i18nId) el.dataset.i18nId = 'k' + (pathSeq++);
    return el.dataset.i18nId;
  }

  /* ---------- Apply a dictionary ------------------------------------------ */

  function apply(dict) {
    if (dict.__title) document.title = dict.__title;

    if (dict.__description) {
      var meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', dict.__description);
    }

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (typeof dict[key] === 'string') el.textContent = dict[key];
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (typeof dict[key] === 'string') safeHTML(el, dict[key]);
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      parseAttrSpec(el).forEach(function (pair) {
        if (typeof dict[pair.key] === 'string') el.setAttribute(pair.attr, dict[pair.key]);
      });
    });
  }

  function restoreEnglish() {
    if (!snapshot) return;
    document.title = snapshot.title;

    var meta = document.querySelector('meta[name="description"]');
    if (meta && snapshot.desc) meta.setAttribute('content', snapshot.desc);

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (key in snapshot.text) el.textContent = snapshot.text[key];
    });

    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html');
      if (key in snapshot.html) el.innerHTML = snapshot.html[key];
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      var saved = snapshot.attr[cssPath(el)];
      if (!saved) return;
      Object.keys(saved).forEach(function (attr) { el.setAttribute(attr, saved[attr]); });
    });
  }

  /* ---------- Switching ---------------------------------------------------- */

  function markButtons(lang) {
    document.querySelectorAll('.lang-switch button').forEach(function (btn) {
      btn.setAttribute('aria-pressed', btn.getAttribute('data-lang') === lang ? 'true' : 'false');
    });
  }

  function remember(lang) {
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) { /* private mode */ }
  }

  function recall() {
    var fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (fromUrl && SUPPORTED.indexOf(fromUrl) !== -1) return fromUrl;
    try {
      var saved = localStorage.getItem(STORE_KEY);
      if (saved && SUPPORTED.indexOf(saved) !== -1) return saved;
    } catch (e) { /* ignore */ }
    return null;
  }

  function setLang(lang, pushUrl) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;

    document.documentElement.lang = lang;
    markButtons(lang);
    remember(lang);
    current = lang;

    if (pushUrl) {
      var url = new URL(window.location.href);
      if (lang === DEFAULT_LANG) url.searchParams.delete('lang');
      else url.searchParams.set('lang', lang);
      history.replaceState(null, '', url.toString());
    }

    if (lang === DEFAULT_LANG) { restoreEnglish(); return; }

    if (cache[lang]) { apply(cache[lang]); return; }

    fetch('assets/i18n/' + lang + '/' + page + '.json', { credentials: 'omit' })
      .then(function (res) {
        if (!res.ok) throw new Error('missing');
        return res.json();
      })
      .then(function (dict) {
        cache[lang] = dict;
        if (current === lang) apply(dict);
      })
      .catch(function () {
        // No translation shipped for this page — stay on English silently.
        document.documentElement.lang = DEFAULT_LANG;
        markButtons(DEFAULT_LANG);
        current = DEFAULT_LANG;
      });
  }

  /* ---------- Boot ---------------------------------------------------------- */

  function init() {
    snapshot = capture();

    document.querySelectorAll('.lang-switch button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setLang(btn.getAttribute('data-lang'), true);
      });
    });

    var wanted = recall();
    if (wanted && wanted !== DEFAULT_LANG) setLang(wanted, false);
    else markButtons(DEFAULT_LANG);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Let the audio guide re-read stop labels after a language change.
  window.VKLang = { get: function () { return current; } };
})();
