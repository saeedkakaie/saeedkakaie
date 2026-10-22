/*
 * پوسته برنامه: منو، مسیریابی، نوار بالا، پوسته روشن/تیره و راه‌اندازی.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, S = IBP.store;

  IBP.APP = { name: 'Integrated Business Planning', short: 'IBP', version: '0.1.0', phase: 1 };

  /* ---------------- منوی اصلی ---------------- */
  var NAV = [
    {
      group: 'نمای کلی', items: [
        { route: 'dashboard', label: 'داشبورد مدیریتی', icon: 'dashboard' },
        { route: 'cycle', label: 'چرخه ماهانه IBP', icon: 'cycle' }
      ]
    },
    {
      group: 'برنامه‌ریزی', items: [
        { route: 'portfolio', label: 'پورتفوی محصول', icon: 'layers', phase: 2 },
        { route: 'demand', label: 'برنامه‌ریزی تقاضا', icon: 'trend', phase: 3 },
        { route: 'supply', label: 'تأمین و ظرفیت', icon: 'factory', phase: 4 },
        { route: 'inventory', label: 'موجودی و MRP', icon: 'warehouse', phase: 4 },
        { route: 'finance', label: 'تطبیق مالی', icon: 'coins', phase: 5 },
        { route: 'scenarios', label: 'سناریوها', icon: 'scenario', phase: 5 }
      ]
    },
    {
      group: 'تصمیم‌گیری', items: [
        { route: 'review', label: 'بازنگری مدیریت', icon: 'review', phase: 6 },
        { route: 'reports', label: 'گزارش‌ها', icon: 'report', phase: 6 },
        { route: 'agent', label: 'دستیار هوشمند', icon: 'bot', phase: 7 }
      ]
    },
    {
      group: 'داده و سیستم', items: [
        { route: 'masterdata', label: 'داده‌های پایه', icon: 'database' },
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

  function buildShell() {
    var app = h('div.app');
    var side = h('aside.sidebar', { 'aria-label': 'منوی اصلی' });
    side.appendChild(h('div.brand',
      h('div.brand-logo', 'IBP'),
      h('div', h('div.brand-name', 'Integrated Business Planning'), h('div.brand-sub', 'برنامه‌ریزی یکپارچه کسب‌وکار'))
    ));
    var nav = h('nav');
    NAV.forEach(function (g) {
      var grp = h('div.nav-group', h('div.nav-group-title', g.group));
      g.items.forEach(function (it) {
        grp.appendChild(h('a.nav-item', { href: '#/' + it.route, 'data-route': it.route, html: icon(it.icon, 18) + '<span>' + it.label + '</span>' + (it.phase ? '<span class="phase">فاز ' + it.phase + '</span>' : '') }));
      });
      nav.appendChild(grp);
    });
    side.appendChild(nav);
    els.storeInfo = h('div');
    side.appendChild(h('div.sidebar-foot', els.storeInfo, h('div', 'نسخه ' + IBP.APP.version + ' · فاز ' + IBP.APP.phase)));

    var main = h('div.main');
    els.title = h('h1');
    els.crumb = h('div.crumb');
    els.cycleChip = h('a.cycle-chip', { href: '#/settings', title: 'تغییر در تنظیمات' });
    els.theme = h('button.icon-btn', { type: 'button', 'aria-label': 'تغییر پوسته روشن و تیره', onclick: toggleTheme });
    var top = h('header.topbar',
      h('button.icon-btn.menu-btn', { type: 'button', 'aria-label': 'منو', html: icon('menu'), onclick: function () { app.classList.toggle('nav-open'); } }),
      h('div', els.title, els.crumb),
      h('div.topbar-actions', els.cycleChip, h('span.today-chip', J.longDate()), els.theme)
    );
    els.content = h('main.content', { id: 'content', tabindex: '-1' });
    main.appendChild(top); main.appendChild(els.content);
    app.appendChild(side);
    app.appendChild(h('div.sidebar-overlay', { onclick: function () { app.classList.remove('nav-open'); } }));
    app.appendChild(main);
    els.app = app;
    document.getElementById('root').appendChild(app);
  }

  function updateChrome() {
    var st = S.settings();
    els.cycleChip.innerHTML = icon('calendar', 15) + '<span>چرخه برنامه‌ریزی</span><strong>' + J.label(st.cyclePeriod) + '</strong>';
    var kind = S.adapterKind();
    els.storeInfo.innerHTML = '<span class="store-pill' + (kind === 'memory' ? ' memory' : '') + '">' + (kind === 'memory' ? 'ذخیره موقت (بدون ماندگاری)' : 'ذخیره محلی فعال') + '</span>';
    els.storeInfo.lastChild.title = st.companyName;
    applyThemeIcon();
  }

  /* ---------------- پوسته ---------------- */
  function getTheme() { try { return localStorage.getItem('ibp-theme') || 'auto'; } catch (e) { return 'auto'; } }
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
    try { localStorage.setItem('ibp-theme', next); } catch (e) { /* ذخیره اختیاری */ }
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
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    IBP.charts.hideTip();
    IBP.form.closePicker();
    var y = window.scrollY;
    els.content.textContent = '';
    els.title.textContent = mod.title ? (typeof mod.title === 'function' ? mod.title(r.params, nav) : mod.title) : (nav ? nav.label : '');
    els.crumb.textContent = S.settings().companyName || '';
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
    window.scrollTo(0, keepScroll ? y : 0);
  }

  IBP.app = {
    render: render,
    refresh: function () { updateChrome(); render(true); },
    navigate: function (hash) { if (location.hash === hash) render(); else location.hash = hash; }
  };

  /* ---------------- راه‌اندازی ---------------- */
  function boot() {
    applyTheme(getTheme());
    buildShell();
    var bootEl = document.getElementById('boot');
    S.init().then(function (r) {
      if (r.empty) {
        return IBP.seed.load({ templateId: 'food', cyclePeriod: J.currentPeriod() }).then(function () {
          IBP.ui.toast('داده تستی «صنایع غذایی» بارگذاری شد. از تنظیمات می‌توانید صنعت دیگری انتخاب کنید.', 'success');
        });
      }
    }).then(function () {
      updateChrome();
      render();
      if (bootEl) bootEl.remove();
      window.addEventListener('hashchange', function () { render(); });
      S.on(function (evt) {
        if (['settings', 'import', 'clear'].indexOf(evt.type) >= 0) updateChrome();
      });
      if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { applyThemeIcon(); render(true); });
    }).catch(function (e) {
      console.error(e);
      if (bootEl) bootEl.querySelector('.boot-inner').textContent = 'خطا در راه‌اندازی: ' + e.message;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.IBP = window.IBP || {});
