/*
 * لایه حرکت و تمرکز (Motion — کتابخانه انیمیشن Framer Motion برای JavaScript، MIT، در vendor/motion).
 *
 *   enter(root)   ورود پلکانی فنری کارت‌ها و شاخص‌های صفحه
 *   focus(card)   تمرکز روی یک تحلیل: کارت از جای خود با انیمیشن FLIP به صفحه کامل می‌آید (نمودار بزرگ‌تر و کامل‌تر)،
 *                 بقیه صفحه محو می‌شود؛ Esc، کلیک بیرون یا دکمه بستن آن را برمی‌گرداند
 *   pulse(el)     تأکید کوتاه روی یک عنصر پس از تغییر
 *   tween(el, from, to, fmt)  شمارنده عددی نرم
 * اگر کاربر «کاهش حرکت» را در سیستم‌عامل فعال کرده باشد، همه حرکت‌ها حذف می‌شوند.
 */
(function (IBP) {
  'use strict';

  var M = window.Motion || null;
  function reduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  function ok() { return !!(M && M.animate) && !reduced(); }
  var SPRING = [0.22, 1, 0.36, 1];
  /** پایان انیمیشن (کنترل‌های Motion خودشان thenable هستند) */
  function done(ctrl, fn) { var p = ctrl && (ctrl.finished || ctrl); if (p && p.then) p.then(fn, fn); else fn(); }

  function enter(root) {
    if (!ok() || !root) return;
    var els = Array.prototype.slice.call(root.querySelectorAll(':scope > .page-head, :scope > .tabbar, :scope > .hero, .kpis > *, .dash-grid > *, .sc-grid > *, .hub-grid > *')).filter(function (el) { return el.offsetParent !== null; }).slice(0, 40);
    if (!els.length) return;
    document.body.classList.add('motion-on');
    var a = M.animate(els, { opacity: [0, 1], transform: ['translateY(16px) scale(0.985)', 'translateY(0px) scale(1)'] }, { delay: M.stagger(0.035), duration: 0.55, easing: SPRING });
    done(a, function () { els.forEach(function (el) { el.style.transform = ''; }); });
  }

  function pulse(el) {
    if (!ok() || !el) return;
    M.animate(el, { transform: ['scale(1)', 'scale(1.03)', 'scale(1)'] }, { duration: 0.45, easing: SPRING });
  }

  function tween(el, from, to, fmt) {
    if (!ok()) { el.textContent = fmt(to); return; }
    M.animate(from, to, { duration: 0.9, easing: SPRING, onUpdate: function (v) { el.textContent = fmt(v); } });
  }

  /* ---------------- حالت تمرکز ---------------- */
  var cur = null;
  function focus(card, opts) {
    if (cur) { unfocus(); return; }
    opts = opts || {};
    var first = card.getBoundingClientRect();
    var ph = document.createElement('div');
    ph.className = 'focus-placeholder ' + card.className.replace(/\bcard\b|\bhoverable\b/g, '');
    ph.style.height = first.height + 'px';
    card.parentNode.insertBefore(ph, card);
    var ov = document.createElement('div');
    ov.className = 'focus-overlay';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    var stage = document.createElement('div');
    stage.className = 'focus-stage';
    var bar = document.createElement('div');
    bar.className = 'focus-bar';
    bar.innerHTML = '<span class="focus-hint">' + IBP.ui.icon('target', 15) + '<span>حالت تمرکز · با کشیدن روی نمودار بزرگ‌نمایی کنید · Esc برای بازگشت</span></span>';
    var close = document.createElement('button');
    close.type = 'button'; close.className = 'btn btn-sm'; close.innerHTML = IBP.ui.icon('x', 15) + '<span>بستن</span>';
    close.addEventListener('click', unfocus);
    bar.appendChild(close);
    stage.appendChild(bar);
    ov.appendChild(stage);
    document.body.appendChild(ov);
    stage.appendChild(card);
    card.classList.add('focused');
    document.body.classList.add('focus-open');
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) unfocus(); });
    cur = { card: card, ph: ph, ov: ov, stage: stage, first: first };
    document.addEventListener('keydown', onKey);
    if (opts.onOpen) opts.onOpen();
    if (ok()) {
      var last = card.getBoundingClientRect();
      var dx = first.left - last.left, dy = first.top - last.top, sx = first.width / last.width, sy = first.height / last.height;
      M.animate(ov, { opacity: [0, 1] }, { duration: 0.3 });
      if (isFinite(sx) && isFinite(sy) && last.width > 0) {
        done(M.animate(card, { transform: ['translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')', 'translate(0px, 0px) scale(1, 1)'] }, { duration: 0.5, easing: SPRING }), function () { card.style.transform = ''; });
      }
    }
    setTimeout(function () { close.focus(); }, 60);
  }
  function onKey(e) { if (e.key === 'Escape') unfocus(); }
  function unfocus() {
    if (!cur) return;
    var c = cur;
    cur = null;
    document.removeEventListener('keydown', onKey);
    var finish = function () {
      c.card.classList.remove('focused');
      c.card.style.transform = '';
      c.ph.parentNode.replaceChild(c.card, c.ph);
      c.ov.remove();
      document.body.classList.remove('focus-open');
      IBP.charts.hideTip();
    };
    if (!ok()) { finish(); return; }
    var from = c.card.getBoundingClientRect(), to = c.ph.getBoundingClientRect();
    var dx = to.left - from.left, dy = to.top - from.top, sx = to.width / from.width, sy = to.height / from.height;
    M.animate(c.ov, { opacity: [1, 0] }, { duration: 0.3 });
    if (!isFinite(sx) || !isFinite(sy) || !from.width) { finish(); return; }
    done(M.animate(c.card, { transform: ['translate(0px, 0px) scale(1, 1)', 'translate(' + dx + 'px, ' + dy + 'px) scale(' + sx + ', ' + sy + ')'] }, { duration: 0.38, easing: SPRING }), finish);
  }

  IBP.motion = { available: function () { return !!M; }, ok: ok, enter: enter, pulse: pulse, tween: tween, focus: focus, unfocus: unfocus, isFocused: function () { return !!cur; } };
})(window.IBP = window.IBP || {});
