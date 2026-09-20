/* ==========================================================================
   Visit Kokino — booking form

   The anti-spam sum is issued and signed by booking.php. The correct answer
   never reaches the browser, so it cannot be read out of the page; the server
   verifies the answer against an HMAC it signed itself.

   Because of that the form needs JavaScript. The contact page also carries
   phone, WhatsApp/Viber and a mailto link, so nobody is left without a way
   through if scripting is off.
   ========================================================================== */
(function () {
  'use strict';

  var form = document.querySelector('[data-booking]');
  if (!form) return;

  var statusBox = form.querySelector('[data-bk-status]');
  var statusMsg = form.querySelector('[data-bk-message]');
  var submitBtn = form.querySelector('[data-bk-submit]');
  var submitLbl = submitBtn ? submitBtn.querySelector('span') : null;
  var originalLabel = submitLbl ? submitLbl.textContent : '';

  var mathWrap = form.querySelector('[data-math-wrap]');
  var mathQ = form.querySelector('[data-math-q]');
  var mathToken = form.querySelector('[data-math-token]');
  var mathInput = form.elements.math_answer;

  /* ---------- status ------------------------------------------------------ */

  function showStatus(ok, message) {
    if (!statusBox || !statusMsg) return;
    statusBox.classList.remove('form-status--ok', 'form-status--bad');
    statusBox.classList.add('is-shown', ok ? 'form-status--ok' : 'form-status--bad');
    var icon = statusBox.querySelector('.bi');
    if (icon) icon.className = ok ? 'bi bi-check-circle' : 'bi bi-exclamation-circle';
    statusMsg.textContent = message;
    statusBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  /* ---------- anti-spam sum ------------------------------------------------ */

  function loadChallenge() {
    if (!mathQ || !mathToken) return Promise.resolve();

    mathQ.textContent = '…';
    if (mathInput) mathInput.value = '';

    var lang = document.documentElement.lang === 'mk' ? 'mk' : 'en';
    return fetch('/booking.php?challenge=1&lang=' + lang, {
      headers: { 'Accept': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store'
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.question || !d.token) throw new Error('bad challenge');
        mathQ.textContent = d.question;
        mathToken.value = d.token;
      })
      .catch(function () {
        mathQ.textContent = '—';
        mathToken.value = '';
        if (mathWrap) {
          var hint = mathWrap.querySelector('.field-hint');
          if (hint) hint.textContent = 'Could not load the anti-spam check. Please reload the page.';
        }
      });
  }

  loadChallenge();

  // The sum is worded in the page language, so re-issue it on a switch.
  document.querySelectorAll('.lang-switch button').forEach(function (b) {
    b.addEventListener('click', function () { setTimeout(loadChallenge, 300); });
  });

  /* ---------- validation --------------------------------------------------- */

  function fieldOf(input) { return input.closest('.field'); }

  function markError(input, bad) {
    var f = fieldOf(input);
    if (f) f.classList.toggle('has-error', !!bad);
  }

  function validEmail(v) {
    // Deliberately permissive; booking.php is the authority.
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  function validate() {
    var ok = true;

    var name = form.elements.name;
    var bad = !name.value.trim() || name.value.trim().length < 2;
    markError(name, bad);
    if (bad) ok = false;

    var email = form.elements.email;
    bad = !validEmail(email.value.trim());
    markError(email, bad);
    if (bad) ok = false;

    var date = form.elements.date;
    if (date && date.value && !/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
      markError(date, true);
      ok = false;
    } else if (date) {
      markError(date, false);
    }

    // Only check that a number was entered — the server decides if it is right.
    if (mathInput) {
      bad = !/^-?\d{1,3}$/.test(mathInput.value.trim());
      markError(mathInput, bad);
      if (bad) ok = false;
    }

    return ok;
  }

  Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea'), function (el) {
    el.addEventListener('input', function () { markError(el, false); });
  });

  /* ---------- submit -------------------------------------------------------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!validate()) {
      var firstBad = form.querySelector('.field.has-error input, .field.has-error select');
      if (firstBad) firstBad.focus();
      return;
    }

    if (!window.fetch || !window.FormData) {
      showStatus(false, 'Your browser cannot submit this form. Please email info@visitkokino.com or message us on WhatsApp.');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      if (submitLbl) submitLbl.textContent = 'Sending…';
    }

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin'
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { ok: res.ok, message: res.ok ? 'Your enquiry has been sent.' : 'Something went wrong.' };
        });
      })
      .then(function (data) {
        showStatus(!!data.ok, data.message || '');
        if (data.ok) {
          form.reset();
          Array.prototype.forEach.call(form.querySelectorAll('.field.has-error'), function (f) {
            f.classList.remove('has-error');
          });
        }
        // A token is single-use in practice: issue a fresh sum either way.
        return loadChallenge();
      })
      .catch(function () {
        showStatus(false, 'We could not reach the server. Please email info@visitkokino.com or message us on WhatsApp.');
        return loadChallenge();
      })
      .then(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitLbl) submitLbl.textContent = originalLabel;
        }
      });
  });

  /* ---------- returning from a no-JS style redirect ------------------------- */

  var sent = new URLSearchParams(window.location.search).get('sent');
  if (sent === '1') {
    showStatus(true, 'Thank you — your enquiry is on its way. We usually reply within a few hours.');
  } else if (sent === '0') {
    showStatus(false, 'Your enquiry could not be sent. Please check the form, or email info@visitkokino.com.');
  }
})();
