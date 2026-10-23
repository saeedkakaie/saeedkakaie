/*
 * کاربران و دسترسی (فاز ۹).
 *   حالت سرور، مدیر سیستم: فهرست کاربران، افزودن و ویرایش (نقش، شرکت‌ها، حوزه‌های قابل ویرایش، فعال/غیرفعال)، بازنشانی رمز
 *   حالت سرور، همه کاربران: دسترسی‌های خودم و تغییر رمز عبور
 *   حالت محلی: اتصال این برنامه به سرور مرکزی
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt, UI = IBP.ui, SV = IBP.server, J = IBP.jalali;

  function when(ts) {
    if (!ts) return '—';
    var d = new Date(ts * 1000), j = J.toJalali(d);
    return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function section(title, sub, iconName) {
    var c = UI.card({ title: title, sub: sub, icon: iconName, focus: false });
    c.el.style.marginBottom = '16px';
    return c;
  }

  function render(root) {
    root.appendChild(UI.pageHead({ title: 'کاربران و دسترسی' }));
    if (!SV.active()) return renderLocal(root);
    renderMe(root);
    if (SV.isAdmin()) renderAdmin(root);
  }

  /* ---------------- حالت محلی: اتصال به سرور ---------------- */
  function renderLocal(root) {
    var c = section('اتصال به سرور مرکزی', '', 'cloud');
    var inp = h('input', { type: 'url', dir: 'ltr', placeholder: 'http://server:8765', value: SV.savedUrl() || '' });
    var go = h('button.btn.btn-primary', { type: 'button', html: icon('check', 16) + '<span>اتصال</span>', onclick: function () {
      go.disabled = true;
      SV.setServerUrl(inp.value).then(function () { UI.toast('متصل شد؛ برنامه دوباره بارگذاری می‌شود', 'success'); setTimeout(function () { location.reload(); }, 700); },
        function (e) { UI.toast(e.message, 'error'); go.disabled = false; });
    } });
    c.body.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, h('div', { style: { flex: 1, minWidth: '240px' } }, inp), go));
    c.body.appendChild(h('div.hint', { style: { marginTop: '10px' } }, 'برای انتقال داده‌ها: پیش از اتصال «پشتیبان کامل هلدینگ» بگیرید و پس از ورود بازیابی کنید.'));
    root.appendChild(c.el);
  }

  /* ---------------- حساب من ---------------- */
  function renderMe(root) {
    var u = SV.user(), areas = SV.areas();
    var c = section('حساب من', u.username + ' · ' + SV.roleLabel(u.role), 'lock');
    c.body.appendChild(h('div.settings-grid',
      h('div.field', h('label', 'شرکت‌های مجاز'), h('div', u.companies.indexOf('*') >= 0 ? 'همه شرکت‌ها' : u.companies.join('، ') || '—')),
      h('div.field', h('label', 'حوزه‌های قابل ویرایش'), h('div', u.role === 'viewer' ? 'هیچ (فقط مشاهده)' : u.areas.map(function (a) { return areas[a] || a; }).join('، ') || '—'))));
    var o = h('input', { type: 'password', dir: 'ltr', autocomplete: 'current-password' }), n1 = h('input', { type: 'password', dir: 'ltr', autocomplete: 'new-password' }), n2 = h('input', { type: 'password', dir: 'ltr', autocomplete: 'new-password' });
    c.body.appendChild(h('div.settings-grid', { style: { marginTop: '12px' } },
      h('div.field', h('label', 'رمز فعلی'), o), h('div.field', h('label', 'رمز جدید (دست‌کم ۸ نویسه)'), n1), h('div.field', h('label', 'تکرار رمز جدید'), n2)));
    c.body.appendChild(h('button.btn', { type: 'button', style: { marginTop: '10px' }, html: icon('check', 16) + '<span>تغییر رمز عبور</span>', onclick: function () {
      if (n1.value !== n2.value) { UI.toast('تکرار رمز جدید یکسان نیست', 'warning'); return; }
      SV.changePassword(o.value, n1.value).then(function () { o.value = n1.value = n2.value = ''; UI.toast('رمز عبور تغییر کرد', 'success'); }, function (e) { UI.toast(e.message, 'error'); });
    } }));
    root.appendChild(c.el);
  }

  /* ---------------- مدیریت کاربران ---------------- */
  function renderAdmin(root) {
    var c = UI.card({ title: 'کاربران', icon: 'users', flush: true, focus: false,
      tools: [h('button.btn.btn-primary.btn-sm', { type: 'button', html: icon('plus', 15) + '<span>کاربر جدید</span>', onclick: function () { userForm(null); } })],
      exportFn: function () { return list.then(exportUsers); } });
    root.appendChild(c.el);
    var box = h('div.plan-wrap', h('div.muted', { style: { padding: '16px' } }, 'در حال دریافت…'));
    c.body.appendChild(box);
    var list = SV.api('GET', '/api/users');
    list.then(function (users) {
      box.textContent = '';
      var areas = SV.areas();
      var t = h('table.data-table.users-table', h('thead', h('tr', ['نام', 'نام کاربری', 'نقش', 'شرکت‌ها', 'حوزه‌های ویرایش', 'آخرین ورود', 'وضعیت', ''].map(function (x) { return h('th', x); }))));
      var tb = h('tbody');
      users.forEach(function (u) {
        tb.appendChild(h('tr' + (u.active ? '' : '.inactive'),
          h('td', u.name), h('td', { dir: 'ltr' }, u.username), h('td', { html: '<span class="role-badge role-' + u.role + '">' + F.escape(SV.roleLabel(u.role)) + '</span>' }),
          h('td', u.companies.indexOf('*') >= 0 ? 'همه' : u.companies.join('، ')),
          h('td', u.role === 'admin' ? 'همه' : u.role === 'viewer' ? '—' : u.areas.map(function (a) { return areas[a] || a; }).join('، ')),
          h('td', when(u.lastLogin)),
          h('td', { html: UI.statusBadge(u.active ? 'good' : 'neutral', u.active ? 'فعال' : 'غیرفعال') }),
          h('td', h('button.icon-btn', { type: 'button', title: 'ویرایش', 'aria-label': 'ویرایش ' + u.username, html: icon('edit', 16), onclick: function () { userForm(u); } }))));
      });
      t.appendChild(tb);
      box.appendChild(t);
    }, function (e) { box.textContent = e.message; });
  }

  function exportUsers(users) {
    var areas = SV.areas();
    return IBP.excel.exportTables({ filename: 'کاربران', sheets: [{ name: 'کاربران', title: 'کاربران و دسترسی‌ها', columns: [
      { header: 'نام', key: 'name', type: 'text' }, { header: 'نام کاربری', key: 'username', type: 'text' },
      { header: 'نقش', value: function (u) { return SV.roleLabel(u.role); }, type: 'text' },
      { header: 'شرکت‌ها', value: function (u) { return u.companies.join('، '); }, type: 'text', width: 30 },
      { header: 'حوزه‌های ویرایش', value: function (u) { return u.areas.map(function (a) { return areas[a] || a; }).join('، '); }, type: 'text', width: 50 },
      { header: 'آخرین ورود', value: function (u) { return when(u.lastLogin); }, type: 'text' },
      { header: 'وضعیت', value: function (u) { return u.active ? 'فعال' : 'غیرفعال'; }, type: 'text' }], rows: users }] });
  }

  function userForm(u) {
    var isNew = !u;
    u = u || { name: '', username: '', role: 'editor', companies: [], areas: [], active: true };
    var areas = SV.areas(), cos = IBP.holding.list();
    var name = h('input', { type: 'text', value: u.name || '' });
    var uname = h('input', { type: 'text', dir: 'ltr', value: u.username || '', disabled: !isNew, autocomplete: 'off' });
    var pw = h('input', { type: 'password', dir: 'ltr', autocomplete: 'new-password', placeholder: isNew ? 'دست‌کم ۸ نویسه' : 'خالی = بدون تغییر' });
    var role = h('select');
    Object.keys(SV.state().info.roles).forEach(function (r) { role.appendChild(h('option', { value: r }, SV.roleLabel(r))); });
    role.value = u.role;
    var allCo = h('input', { type: 'checkbox' }); allCo.checked = u.companies.indexOf('*') >= 0;
    var coChecks = cos.map(function (c) { var x = h('input', { type: 'checkbox', value: c.code }); x.checked = u.companies.indexOf(c.code) >= 0; return h('label.chk', x, c.name + ' (' + c.code + ')'); });
    var areaChecks = Object.keys(areas).map(function (a) { var x = h('input', { type: 'checkbox', value: a }); x.checked = u.areas.indexOf(a) >= 0; return h('label.chk', x, areas[a]); });
    var active = h('input', { type: 'checkbox' }); active.checked = u.active !== false;
    var coBox = h('div.chk-grid', h('label.chk.all', allCo, 'همه شرکت‌ها (فعلی و آینده)'), coChecks);
    var areaWrap = h('div.field', h('label', 'حوزه‌هایی که می‌تواند ویرایش کند'), h('div.chk-grid', areaChecks));
    var coWrap = h('div.field', h('label', 'شرکت‌های قابل مشاهده'), coBox);
    var sync = function () {
      areaWrap.style.display = role.value === 'editor' ? '' : 'none';
      coWrap.style.display = role.value === 'admin' ? 'none' : '';
      coChecks.forEach(function (l) { l.firstChild.disabled = allCo.checked; });
    };
    role.addEventListener('change', sync); allCo.addEventListener('change', sync);
    var body = h('div.user-form',
      h('div.settings-grid', h('div.field', h('label', 'نام'), name), h('div.field', h('label', 'نام کاربری'), uname), h('div.field', h('label', isNew ? 'رمز عبور' : 'رمز عبور جدید'), pw), h('div.field', h('label', 'نقش'), role)),
      coWrap, areaWrap,
      isNew ? null : h('label.chk', active, 'حساب فعال است'));
    sync();
    UI.modal({ title: isNew ? 'کاربر جدید' : 'ویرایش ' + u.username, body: body, actions: [{ label: 'انصراف' }, { label: 'ذخیره', primary: true, onClick: function (close) {
      var d = { name: name.value.trim(), role: role.value, active: active.checked,
        companies: allCo.checked ? ['*'] : coChecks.filter(function (l) { return l.firstChild.checked; }).map(function (l) { return l.firstChild.value; }),
        areas: areaChecks.filter(function (l) { return l.firstChild.checked; }).map(function (l) { return l.firstChild.value; }) };
      var p;
      if (isNew) p = SV.api('POST', '/api/users', Object.assign(d, { username: uname.value.trim(), password: pw.value }));
      else p = SV.api('PUT', '/api/users/' + u.id, d).then(function () { return pw.value ? SV.api('POST', '/api/users/' + u.id + '/password', { password: pw.value }) : null; });
      p.then(function () { close(); UI.toast('ذخیره شد', 'success'); IBP.app.render(true); }, function (e) { UI.toast(e.message, 'error'); });
      return false;
    } }] });
  }

  IBP.register('users', { title: 'کاربران و دسترسی', render: render });
  IBP.usersWhen = when;
})(window.IBP = window.IBP || {});
