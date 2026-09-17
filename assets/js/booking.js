/* ==========================================================================
   Visit Kokino — booking form

   Progressive enhancement only. With JavaScript off the form is an ordinary
   POST to booking.php, which redirects back with ?sent=1 or ?sent=0. With
   JavaScript on it submits in the background and reports inline.
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

    return ok;
  }

  // Clear a field's error as soon as the visitor edits it
  Array.prototype.forEach.call(form.querySelectorAll('input, select, textarea'), function (el) {
    el.addEventListener('input', function () { markError(el, false); });
  });

  /* ---------- submit -------------------------------------------------------- */

  form.addEventListener('submit', function (e) {
    if (!validate()) {
      e.preventDefault();
      var firstBad = form.querySelector('.field.has-error input, .field.has-error select');
      if (firstBad) firstBad.focus();
      return;
    }

    // fetch isn't available everywhere — let those browsers post normally
    if (!window.fetch || !window.FormData) return;

    e.preventDefault();

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
        if (data.ok) form.reset();
      })
      .catch(function () {
        showStatus(false, 'We could not reach the server. Please email info@visitkokino.com or message us on WhatsApp.');
      })
      .then(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          if (submitLbl) submitLbl.textContent = originalLabel;
        }
      });
  });

  /* ---------- no-JS round trip: booking.php redirected back here ------------ */

  var sent = new URLSearchParams(window.location.search).get('sent');
  if (sent === '1') {
    showStatus(true, 'Thank you — your enquiry is on its way. We usually reply within a few hours.');
  } else if (sent === '0') {
    showStatus(false, 'Your enquiry could not be sent. Please check the form, or email info@visitkokino.com.');
  }
})();
