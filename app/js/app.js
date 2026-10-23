/*
 * پوسته برنامه: منو، مسیریابی، نوار بالا، جستجوی فرمان، اعلان‌ها، وضعیت موتور پایتون و راه‌اندازی.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, S = IBP.store, F = IBP.fmt;

  IBP.APP = { name: 'Integrated Business Planning', short: 'IBP', version: '0.8.0', phase: 8 };

  /* ---------------- منوی اصلی ---------------- */
  var NAV = [
    {
      group: 'نمای کلی', items: [
        { route: 'holding', label: 'نمای تلفیقی هلدینگ', icon: 'map' },
        { route: 'dashboard', label: 'داشبورد مدیریتی', icon: 'dashboard' },
        { route: 'cycle', label: 'چرخه ماهانه IBP', icon: 'cycle' }
      ]
    },
    {
      group: 'داده', items: [
        { route: 'datahub', label: 'مرکز داده', icon: 'cloud' },
        { route: 'masterdata', label: 'داده‌های پایه', icon: 'database' }
      ]
    },
    {
      group: 'برنامه‌ریزی', items: [
        { route: 'portfolio', label: 'پورتفوی محصول', icon: 'layers' },
        { route: 'demand', label: 'برنامه‌ریزی تقاضا', icon: 'trend' },
        { route: 'supply', label: 'تأمین و ظرفیت', icon: 'factory' },
        { route: 'inventory', label: 'موجودی و MRP', icon: 'warehouse' },
        { route: 'finance', label: 'تطبیق مالی', icon: 'coins' },
        { route: 'scenarios', label: 'سناریوها', icon: 'scenario' }
      ]
    },
    {
      group: 'تصمیم‌گیری', items: [
        { route: 'review', label: 'بازنگری مدیریت', icon: 'review', badge: 'جدید' },
        { route: 'reports', label: 'گزارش‌ها', icon: 'report', badge: 'جدید' },
        { route: 'agent', label: 'دستیار هوشمند', icon: 'bot', badge: 'AI' }
      ]
    },
    {
      group: 'سیستم', items: [
        { route: 'settings', label: 'تنظیمات', icon: 'settings' },
        { route: 'users', label: 'کاربران و دسترسی', icon: 'users', phase: 9 }
      ]
    }
  ];
  IBP.NAV = NAV;

  var els = {};
  var current = { route: null, cleanup: null };

  function navItem(route) {
    for (var g = 0; g < NAV.length; g++) for (var i = 0; i < NAV[g].items.length; i++) if (NAV[g].items[i].route === route) return NAV[g].items[i];
    return null;
  }
  function navGroup(route) {
    for (var g = 0; g < NAV.length; g++) if (NAV[g].items.some(function (it) { return it.route === route; })) return NAV[g].group;
    return '';
  }
  function pref(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
    return null;
  }

  function buildShell() {
    var app = h('div.app' + (pref('ibp-collapsed') === '1' ? '.collapsed' : ''));
    var side = h('aside.sidebar', { 'aria-label': 'منوی اصلی' });
    side.appendChild(h('div.brand.with-flag',
      IBP.flag({ width: 92, height: 62, title: 'گروه زر' }),
      h('img.brand-crown', { src: 'assets/img/zar-crown.png', alt: 'گروه زر' }),
      h('div.brand-text', els.brandSub = h('div.brand-title', 'گروه زر'), h('div.brand-name', 'Integrated Business Planning'))
    ));
    var nav = h('nav');
    NAV.forEach(function (g) {
      var grp = h('div.nav-group', h('div.nav-group-title', g.group));
      g.items.forEach(function (it) {
        var extra = it.phase ? '<span class="phase">فاز ' + it.phase + '</span>' : (it.badge ? '<span class="new-dot">' + it.badge + '</span>' : '');
        grp.appendChild(h('a.nav-item', { href: '#/' + it.route, 'data-route': it.route, title: it.label, html: icon(it.icon, 19) + '<span class="nav-label">' + it.label + '</span>' + extra }));
      });
      nav.appendChild(grp);
    });
    side.appendChild(nav);
    els.engineLine = h('div.status-line');
    els.storeLine = h('div.status-line');
    side.appendChild(h('div.sidebar-foot', els.engineLine, els.storeLine,
      h('button.collapse-btn', { type: 'button', 'aria-label': 'جمع کردن منو', html: icon('sidebar', 17) + '<span class="collapse-label">جمع کردن منو · نسخه ' + IBP.APP.version + '</span>', onclick: toggleCollapse })));

    var main = h('div.main');
    els.title = h('h1');
    els.crumb = h('div.crumb');
    els.cycleChip = h('a.cycle-chip', { href: '#/cycle', title: 'چرخه برنامه‌ریزی' });
    els.companyChip = h('button.company-chip', { type: 'button', title: 'تغییر شرکت', onclick: switchCompany });
    els.theme = h('button.tb-btn', { type: 'button', 'aria-label': 'تغییر پوسته روشن و تیره', onclick: toggleTheme });
    els.bell = h('button.tb-btn', { type: 'button', 'aria-label': 'اعلان‌ها', onclick: function () { showNotifications(); } });
    var search = h('button.search-trigger', { type: 'button', 'aria-label': 'جستجو و فرمان', onclick: function () { IBP.palette.open(); },
      html: icon('search', 16) + '<span class="st-label">جستجو در صفحه‌ها، محصولات و فرمان‌ها…</span><span class="kbd">Ctrl K</span>' });
    var top = h('header.topbar',
      h('button.tb-btn.menu-btn', { type: 'button', 'aria-label': 'منو', html: icon('menu'), onclick: function () { app.classList.toggle('nav-open'); } }),
      h('div', els.crumb, els.title),
      h('div.topbar-actions', els.companyChip, search, els.cycleChip, h('span.today-chip', J.longDate()), els.bell, els.theme)
    );
    els.content = h('main.content', { id: 'content', tabindex: '-1' });
    main.appendChild(top); main.appendChild(els.content);
    app.appendChild(side);
    app.appendChild(h('div.sidebar-overlay', { onclick: function () { app.classList.remove('nav-open'); } }));
    app.appendChild(main);
    els.app = app;
    document.getElementById('root').appendChild(app);
  }

  function toggleCollapse() {
    els.app.classList.toggle('collapsed');
    pref('ibp-collapsed', els.app.classList.contains('collapsed') ? '1' : '0');
  }

  function switchCompany() {
    IBP.ui.closePopover();
    IBP.holding.leave().then(function () { IBP.gate.show(); });
  }

  function updateChrome() {
    var st = S.settings();
    var co = IBP.holding.current();
    els.companyChip.innerHTML = '<span class="cc-code">' + F.escape(co ? co.code : (st.companyCode || '—')) + '</span><span class="cc-name">' + F.escape(co ? co.name : st.companyName) + '</span><span class="model-badge ' + ((st.businessModel || 'B2C') === 'B2B' ? 'b2b' : 'b2c') + '">' + F.escape(st.businessModel || 'B2C') + '</span>' + icon('chevronDown', 15);
    els.brandSub.textContent = IBP.holding.holdingName();
    els.cycleChip.innerHTML = icon('calendar', 16) + '<span class="cc-label">چرخه</span><strong>' + J.label(st.cyclePeriod) + '</strong>';
    var kind = S.adapterKind();
    els.storeLine.innerHTML = '<span class="dot ' + (kind === 'memory' ? 'warn' : 'on') + '"></span><span class="status-text">' + (kind === 'memory' ? 'ذخیره موقت' : 'پایگاه داده محلی') + '</span>';
    updateEngine();
    updateBell();
    applyThemeIcon();
  }
  function updateEngine() {
    var es = IBP.engine.state();
    var on = es.status === 'online';
    els.engineLine.innerHTML = '<span class="dot ' + (on ? 'on' : 'off') + '"></span><span class="status-text">موتور پایتون: ' + (on ? 'متصل' : es.status === 'unknown' ? 'در حال بررسی' : 'غیرفعال') + '</span>';
    els.engineLine.title = on ? 'نسخه ' + (es.info && es.info.version) : 'برای تحلیل پیشرفته، موتور پایتون را اجرا کنید (تنظیمات)';
  }
  function updateBell() {
    var n = 0;
    try { n = IBP.analytics.alerts().filter(function (a) { return a.level === 'critical'; }).length; } catch (e) { n = 0; }
    els.bell.innerHTML = icon('bell', 18) + (n ? '<span class="count">' + (n > 99 ? '99+' : F.num(n)) + '</span>' : '');
  }
  function showNotifications() {
    var alerts = [];
    try { alerts = IBP.analytics.alerts(); } catch (e) { alerts = []; }
    var list = h('ul.alerts', { style: { maxHeight: '420px' } });
    if (!alerts.length) list.appendChild(h('li.alert-item', { html: IBP.ui.statusBadge('good', 'موردی برای بررسی وجود ندارد') }));
    alerts.slice(0, 12).forEach(function (a) {
      list.appendChild(h('li.alert-item',
        h('div.alert-icon.' + a.level, { html: icon(a.level === 'critical' ? 'critical' : 'alert', 16) }),
        h('div', h('div.alert-text', a.text), h('div.alert-detail', a.detail)),
        h('span.alert-type', a.type)));
    });
    var crit = alerts.filter(function (a) { return a.level === 'critical'; }).length;
    IBP.ui.popover(els.bell, h('div',
      h('div.popover-head', { html: icon('bell', 16) + '<span>اعلان‌ها و استثناها</span><span style="margin-inline-start:auto">' + IBP.ui.statusBadge('critical', F.num(crit) + ' بحرانی') + '</span>' }),
      list,
      h('div', { style: { padding: '10px 16px', borderTop: '1px solid var(--border)' } }, h('a', { href: '#/dashboard', onclick: function () { IBP.ui.closePopover(); } }, 'مشاهده همه در داشبورد'))));
  }

  /* ---------------- پوسته ---------------- */
  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function applyThemeIcon() { if (els.theme) els.theme.innerHTML = icon(effectiveTheme() === 'dark' ? 'sun' : 'moon', 18); }
  function toggleTheme() {
    var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    pref('ibp-theme', next);
    applyThemeIcon();
    render(true);
  }

  /* ---------------- مسیریابی ---------------- */
  function parseHash() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    return { route: parts[0] || 'dashboard', params: parts.slice(1) };
  }

  function render(keepScroll) {
    var r = parseHash();
    var mod = IBP.modules[r.route];
    var nav = navItem(r.route);
    if (!mod && nav && nav.phase) mod = IBP.modules.roadmap;
    if (!mod) { location.hash = '#/dashboard'; return; }
    if (IBP.motion && IBP.motion.isFocused()) IBP.motion.unfocus();
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    IBP.charts.hideTip();
    IBP.form.closePicker();
    IBP.ui.closePopover();
    var y = window.scrollY;
    els.content.textContent = '';
    els.content.classList.remove('enter');
    if (!keepScroll) { void els.content.offsetWidth; els.content.classList.add('enter'); }
    els.title.textContent = mod.title ? (typeof mod.title === 'function' ? mod.title(r.params, nav) : mod.title) : (nav ? nav.label : '');
    var co = IBP.holding.current();
    els.crumb.innerHTML = F.escape(co ? co.code + ' · ' + co.name : (S.settings().companyName || '')) + (navGroup(r.route) ? '<span class="sep">/</span>' + F.escape(navGroup(r.route)) : '');
    document.querySelectorAll('.nav-item').forEach(function (a) { a.classList.toggle('active', a.getAttribute('data-route') === r.route); });
    els.app.classList.remove('nav-open');
    document.title = (nav ? nav.label + ' — ' : '') + 'Integrated Business Planning';
    try {
      current.cleanup = mod.render(els.content, r.params, nav) || null;
    } catch (e) {
      console.error(e);
      els.content.appendChild(h('div.card', h('div.card-body', 'خطا در نمایش صفحه: ' + e.message)));
    }
    current.route = r.route;
    if (!keepScroll && IBP.motion) IBP.motion.enter(els.content);
    updateBell();
    window.scrollTo(0, keepScroll ? y : 0);
  }

  IBP.app = {
    render: render,
    refresh: function () { updateChrome(); render(true); },
    navigate: function (hash) { if (location.hash === hash) render(); else location.hash = hash; },
    toggleTheme: toggleTheme,
    toggleCollapse: toggleCollapse
  };

  /* ---------------- راه‌اندازی ---------------- */
  var started = false;
  /** پس از ورود به شرکت (از صفحه ورود هلدینگ) */
  function enterCompany() {
    updateChrome();
    if (!location.hash || location.hash === '#/' ) location.hash = '#/dashboard';
    render();
    if (!started) startListeners();
  }
  IBP.app.enterCompany = enterCompany;
  IBP.app.switchCompany = switchCompany;

  var saveSummarySoon = IBP.ui.debounce(function () { IBP.holding.saveSummary(); }, 4000);
  function startListeners() {
    started = true;
    window.addEventListener('hashchange', function () { if (IBP.holding.current()) render(); });
    S.on(function (evt) {
      if (['settings', 'import', 'clear', 'bulk', 'replace'].indexOf(evt.type) >= 0) updateChrome();
      saveSummarySoon();
    });
    IBP.engine.on(function (es) {
      updateEngine();
      if (['dashboard', 'portfolio', 'settings', 'demand'].indexOf(current.route) >= 0 && es.status !== 'unknown' && !document.querySelector('.modal-overlay') && IBP.holding.current()) render(true);
    });
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK') && IBP.holding.current()) { e.preventDefault(); IBP.palette.open(); }
    });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { applyThemeIcon(); if (IBP.holding.current()) render(true); });
    window.addEventListener('beforeunload', function () { IBP.holding.saveSummary(); });
  }

  function boot() {
    applyTheme(pref('ibp-theme') || 'auto');
    buildShell();
    var bootEl = document.getElementById('boot');
    var bootText = bootEl ? bootEl.querySelector('.boot-text') : null;
    IBP.engine.startWatch();
    IBP.holding.init(function (msg) { if (bootText) bootText.textContent = msg; }).then(function () {
      var sid = IBP.holding.sessionCompany();
      if (sid && IBP.holding.get(sid)) return IBP.holding.enter(sid).then(function () { enterCompany(); });
      IBP.gate.show();
      if (!started) startListeners();
    }).then(function () {
      if (bootEl) { bootEl.style.transition = 'opacity .3s'; bootEl.style.opacity = '0'; setTimeout(function () { bootEl.remove(); }, 300); }
    }).catch(function (e) {
      console.error(e);
      if (bootEl) bootEl.querySelector('.boot-inner').textContent = 'خطا در راه‌اندازی: ' + e.message;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.IBP = window.IBP || {});
