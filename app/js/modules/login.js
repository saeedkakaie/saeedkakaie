/*
 * ورود به سرور مرکزی (فاز ۹): ورود کاربر، راه‌اندازی نخستین مدیر سیستم با کد راه‌اندازی، خطای اتصال.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, SV = IBP.server;

  function field(label, input) { return h('label.login-field', h('span', label), input); }

  /** نمایش صفحه ورود؛ پس از ورود موفق resolve می‌شود */
  function show() {
    return new Promise(function (resolve) {
      var el = h('div.login', { role: 'main' });
      document.body.appendChild(el);
      document.body.classList.add('gate-open');
      var info = SV.info() || {};
      var err = h('div.login-error', { role: 'alert' });
      var card = h('form.login-card', { autocomplete: 'on' });
      var done = function () { el.remove(); resolve(SV.user()); };
      var fail = function (e) { err.textContent = e.message; btn.disabled = false; };
      var btn;

      card.appendChild(h('div.login-head', IBP.flag({ width: 96, height: 66, title: 'گروه زر' }),
        h('div', h('div.login-title', info.name || 'هلدینگ گروه زر'), h('div.login-sub', 'Integrated Business Planning'))));

      if (info.setupRequired) {
        var tok = h('input', { type: 'text', dir: 'ltr', required: true, autocomplete: 'off' });
        var nm = h('input', { type: 'text', required: true });
        var un = h('input', { type: 'text', dir: 'ltr', required: true, autocomplete: 'username' });
        var pw = h('input', { type: 'password', dir: 'ltr', required: true, autocomplete: 'new-password', minlength: 8 });
        var pw2 = h('input', { type: 'password', dir: 'ltr', required: true, autocomplete: 'new-password' });
        card.appendChild(h('div.login-step', 'راه‌اندازی سرور: ساخت مدیر سیستم'));
        [field('کد راه‌اندازی', tok), field('نام و نام خانوادگی', nm), field('نام کاربری', un), field('رمز عبور (دست‌کم ۸ نویسه)', pw), field('تکرار رمز عبور', pw2)].forEach(function (f) { card.appendChild(f); });
        card.appendChild(err);
        card.appendChild(btn = h('button.btn.btn-primary.login-btn', { type: 'submit', html: icon('check', 16) + '<span>ساخت مدیر و ورود</span>' }));
        card.appendChild(h('div.login-hint', 'کد راه‌اندازی هنگام اجرای سرور نمایش داده و در فایل setup-token.txt پوشه داده نوشته می‌شود.'));
        card.addEventListener('submit', function (e) {
          e.preventDefault();
          if (pw.value !== pw2.value) { err.textContent = 'تکرار رمز عبور یکسان نیست'; return; }
          btn.disabled = true; err.textContent = '';
          SV.setup({ setupToken: tok.value, name: nm.value, username: un.value.trim(), password: pw.value }).then(done, fail);
        });
        setTimeout(function () { tok.focus(); }, 50);
      } else {
        var u = h('input', { type: 'text', dir: 'ltr', required: true, autocomplete: 'username', name: 'username' });
        var p = h('input', { type: 'password', dir: 'ltr', required: true, autocomplete: 'current-password', name: 'password' });
        card.appendChild(field('نام کاربری', u));
        card.appendChild(field('رمز عبور', p));
        card.appendChild(err);
        card.appendChild(btn = h('button.btn.btn-primary.login-btn', { type: 'submit', html: icon('lock', 16) + '<span>ورود</span>' }));
        card.addEventListener('submit', function (e) {
          e.preventDefault();
          btn.disabled = true; err.textContent = '';
          SV.login(u.value.trim(), p.value).then(done, fail);
        });
        setTimeout(function () { u.focus(); }, 50);
      }
      if (SV.savedUrl()) {
        card.appendChild(h('button.btn.btn-sm.login-alt', { type: 'button', html: icon('x', 14) + '<span>قطع اتصال از سرور و کار محلی</span>', onclick: function () { SV.setServerUrl('').then(function () { location.reload(); }); } }));
      }
      card.appendChild(h('div.login-server', { dir: 'ltr' }, SV.base()));
      el.appendChild(card);
    });
  }

  /** سرور ذخیره‌شده در دسترس نیست (نسخه رومیزی/اندروید) */
  function unreachable(msg) {
    return new Promise(function (resolve) {
      var el = h('div.login', { role: 'main' });
      document.body.appendChild(el);
      el.appendChild(h('div.login-card',
        h('div.login-head', IBP.flag({ width: 96, height: 66, title: 'گروه زر' }), h('div', h('div.login-title', 'اتصال به سرور'), h('div.login-sub', 'Integrated Business Planning'))),
        h('div.login-error', msg),
        h('button.btn.btn-primary.login-btn', { type: 'button', html: icon('refresh', 16) + '<span>تلاش دوباره</span>', onclick: function () { location.reload(); } }),
        h('button.btn.btn-sm.login-alt', { type: 'button', html: icon('x', 14) + '<span>قطع اتصال و کار محلی</span>', onclick: function () { SV.setServerUrl('').then(function () { el.remove(); resolve(); location.reload(); }); } })));
    });
  }

  IBP.login = { show: show, unreachable: unreachable };
})(window.IBP = window.IBP || {});
