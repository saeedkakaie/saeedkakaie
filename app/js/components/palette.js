/*
 * جستجوی فرمان (Ctrl+K): پرش به صفحه‌ها، بخش‌های داده، محصولات و اجرای فرمان‌ها.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt, S = IBP.store;
  var isOpen = false;

  function commands() {
    var out = [];
    IBP.NAV.forEach(function (g) {
      g.items.forEach(function (it) {
        out.push({ group: 'صفحه‌ها', icon: it.icon, title: it.label, sub: g.group + (it.phase ? ' · فاز ' + it.phase : ''), run: function () { IBP.app.navigate('#/' + it.route); } });
      });
    });
    IBP.schema.keys().forEach(function (k) {
      var e = IBP.schema.entity(k);
      out.push({ group: 'داده‌های پایه', icon: e.icon, title: e.label, sub: F.num(S.count(k)) + ' رکورد', run: function () { IBP.app.navigate('#/masterdata/' + k); } });
    });
    out.push(
      { group: 'فرمان‌ها', icon: 'excel', title: 'دانلود الگوی خالی Excel برای ورود داده', run: function () { return IBP.dataio.downloadTemplate({ filename: 'الگوی ورود داده IBP' }); } },
      { group: 'فرمان‌ها', icon: 'excel', title: 'خروجی Excel همه داده‌ها', run: function () { return IBP.dataio.downloadTemplate({ data: 'current', filename: 'همه داده‌های IBP' }); } },
      { group: 'فرمان‌ها', icon: 'excel', title: 'خروجی Excel داشبورد مدیریتی', run: function () { return IBP.dashboardExport && IBP.dashboardExport(); } },
      { group: 'فرمان‌ها', icon: 'excel', title: 'خروجی Excel تحلیل پورتفوی', run: function () { return IBP.portfolioExport && IBP.portfolioExport(); } },
      { group: 'فرمان‌ها', icon: 'upload', title: 'بارگذاری فایل Excel داده', run: function () { IBP.app.navigate('#/datahub'); } },
      { group: 'فرمان‌ها', icon: 'moon', title: 'تغییر پوسته روشن / تیره', run: function () { IBP.app.toggleTheme(); } },
      { group: 'فرمان‌ها', icon: 'sidebar', title: 'جمع / باز کردن منوی کناری', run: function () { IBP.app.toggleCollapse(); } },
      { group: 'فرمان‌ها', icon: 'python', title: 'بررسی اتصال موتور پایتون', run: function () { return IBP.engine.check().then(function (ok) { IBP.ui.toast(ok ? 'موتور پایتون متصل است' : 'موتور پایتون در دسترس نیست', ok ? 'success' : 'warning'); }); } }
    );
    IBP.templates.list.forEach(function (t) {
      out.push({ group: 'الگوهای صنعت', icon: 'sparkles', title: 'بارگذاری داده نمونه: ' + t.name, sub: t.company, run: function () { IBP.app.navigate('#/datahub'); } });
    });
    S.all('products').forEach(function (p) {
      out.push({ group: 'محصولات', icon: 'box', title: p.name, sub: p.code + ' · ' + S.name('families', p.familyId), search: p.code, run: function () { IBP.form.editRecord('products', p); } });
    });
    S.all('customers').forEach(function (c) {
      out.push({ group: 'مشتریان', icon: 'users', title: c.name, sub: c.code + ' · ' + S.name('channels', c.channelId), search: c.code, run: function () { IBP.form.editRecord('customers', c); } });
    });
    return out;
  }

  function normalize(s) { return F.toLatinDigits(String(s || '')).toLowerCase().replace(/[‌\s]+/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک'); }

  function open() {
    if (isOpen) return;
    isOpen = true;
    var all = commands(), sel = 0, shown = [];
    var input = h('input', { type: 'text', placeholder: 'نام صفحه، محصول، مشتری یا فرمان را بنویسید…', 'aria-label': 'جستجو' });
    var list = h('div.palette-list', { role: 'listbox' });
    var box = h('div.palette', h('div.palette-input', { html: icon('search', 20) }, input), list,
      h('div.palette-foot', { html: '<span><span class="kbd">↑↓</span> حرکت</span><span><span class="kbd">Enter</span> اجرا</span><span><span class="kbd">Esc</span> بستن</span>' }));
    var overlay = h('div.modal-overlay.palette-overlay', box);
    function close() { isOpen = false; overlay.remove(); document.removeEventListener('keydown', onKey, true); }
    function run(c) { close(); if (c) Promise.resolve(c.run()).catch(function (e) { IBP.ui.toast(e.message, 'error'); }); }
    function draw() {
      var q = normalize(input.value.trim());
      shown = !q ? all.filter(function (c) { return c.group !== 'محصولات' && c.group !== 'مشتریان'; }).slice(0, 40)
        : all.filter(function (c) { return normalize(c.title + ' ' + (c.sub || '') + ' ' + (c.search || '')).indexOf(q) >= 0; }).slice(0, 60);
      if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
      list.textContent = '';
      var lastGroup = null;
      if (!shown.length) list.appendChild(h('div.palette-group', 'نتیجه‌ای یافت نشد'));
      shown.forEach(function (c, i) {
        if (c.group !== lastGroup) { list.appendChild(h('div.palette-group', c.group)); lastGroup = c.group; }
        var item = h('div.palette-item' + (i === sel ? '.on' : ''), { role: 'option', 'aria-selected': i === sel ? 'true' : 'false' },
          h('div.pi-icon', { html: icon(c.icon || 'chevronLeft', 16) }),
          h('div', h('div', c.title), c.sub ? h('div.pi-sub', c.sub) : null),
          h('span.pi-hint', i === sel ? '↵' : ''));
        item.addEventListener('mousemove', function () { if (sel !== i) { sel = i; draw(); } });
        item.addEventListener('click', function () { run(c); });
        list.appendChild(item);
      });
      var on = list.querySelector('.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); run(shown[sel]); }
    }
    input.addEventListener('input', function () { sel = 0; draw(); });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    draw();
    input.focus();
  }

  IBP.palette = { open: open };
})(window.IBP = window.IBP || {});
