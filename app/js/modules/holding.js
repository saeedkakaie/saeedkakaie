/*
 * نمای تلفیقی هلدینگ (فاز ۶): همه شرکت‌های گروه کنار هم.
 *   شاخص‌های تلفیقی (فروش و برنامه بیرون از گروه، سود ناخالص، تناژ، سطح خدمت، سرمایه در گردش، شکاف بودجه)،
 *   مقایسه شرکت‌ها، نقشه متحرک جریان‌های درون‌گروهی (تن در ماه)، ماتریس سلامت شرکت‌ها و روند تلفیقی.
 * فروش درون‌گروهی در اعداد تلفیقی حذف می‌شود. داده هر شرکت از خلاصه ذخیره‌شده همان شرکت خوانده می‌شود؛
 * «به‌روزرسانی همه شرکت‌ها» هر شرکت را در فضای کاری خودش دوباره محاسبه می‌کند.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, C = IBP.charts, UI = IBP.ui;
  var state = { focus: null };

  function sc() { return S.settings().displayScale || 1e9; }
  function m(v) { return (v || 0) / sc(); }
  function money(v) { return F.money(v, { digits: 0 }); }
  function color(c, i) { var t = c.templateId ? IBP.templates.find(c.templateId) : null; var g = t && t.grad ? /#[0-9a-f]{6}/i.exec(t.grad) : null; return g ? g[0] : C.seriesColor(i); }

  function data() {
    var list = IBP.holding.list().filter(function (c) { return c.summary && c.summary.products; });
    var withPlan = list.filter(function (c) { return c.summary.plan; });
    var sum = function (arr, f) { return arr.reduce(function (a, c) { return a + (f(c) || 0); }, 0); };
    var wavg = function (arr, f, w) { var tw = sum(arr, w); return tw ? sum(arr, function (c) { return (f(c) || 0) * w(c); }) / tw : null; };
    var P = function (c) { return c.summary.plan || {}; };
    return {
      list: list, withPlan: withPlan, missing: IBP.holding.list().length - withPlan.length,
      revExt: sum(list, function (c) { return c.summary.revenueExternal; }), rev: sum(list, function (c) { return c.summary.revenue; }),
      revPrev: sum(list, function (c) { return c.summary.revenuePrev; }), tons: sum(list, function (c) { return c.summary.tons; }),
      planRevExt: sum(withPlan, function (c) { return P(c).revenueExt; }), planGrossExt: sum(withPlan, function (c) { return P(c).grossExt; }),
      planRev: sum(withPlan, function (c) { return P(c).revenue; }), planGross: sum(withPlan, function (c) { return P(c).gross; }),
      planTons: sum(withPlan, function (c) { return P(c).tons; }), nwc: sum(withPlan, function (c) { return P(c).nwcEnd; }), lost: sum(withPlan, function (c) { return P(c).lost; }),
      fill: wavg(withPlan, function (c) { return P(c).fillRate; }, function (c) { return P(c).revenue; }),
      acc: wavg(list, function (c) { return c.summary.accuracy; }, function (c) { return c.summary.revenue; }),
      gap: wavg(withPlan.filter(function (c) { return P(c).budgetGap !== null && P(c).budgetGap !== undefined; }), function (c) { return P(c).budgetGap; }, function (c) { return P(c).revenue; }),
      crit: sum(list, function (c) { return c.summary.critical; })
    };
  }

  function refreshBtn(label) {
    var b = h('button.btn' + (label ? '.btn-primary' : ''), { type: 'button', html: icon('refresh', 15) + '<span>' + (label || 'به‌روزرسانی همه شرکت‌ها') + '</span>' });
    b.addEventListener('click', function () {
      var span = b.querySelector('span');
      UI.busy(b, function () {
        return IBP.holding.refreshAll(function (c, i, n) { span.textContent = 'محاسبه ' + c.name + ' (' + F.num(i + 1) + ' از ' + F.num(n) + ')'; })
          .then(function () { UI.toast('خلاصه همه شرکت‌ها به‌روز شد', 'success'); IBP.app.render(); });
      });
    });
    return b;
  }

  function exportAll(D) {
    var rows = D.list;
    var P = function (c) { return c.summary.plan || {}; };
    return IBP.excel.exportTables({ filename: 'نمای تلفیقی ' + IBP.holding.holdingName(), summary: { title: 'شاخص‌های تلفیقی', pairs: [
      ['فروش ۱۲ ماه بیرون از گروه', money(D.revExt)], ['برنامه ۱۲ ماه بیرون از گروه', money(D.planRevExt)], ['سود ناخالص برنامه (بیرون از گروه)', money(D.planGrossExt)],
      ['تناژ برنامه', F.num(D.planTons, 0) + ' تن'], ['سطح خدمت وزنی', F.pct(D.fill, 1)], ['سرمایه در گردش پایان دوره', money(D.nwc)], ['شکاف وزنی با بودجه', F.signedPct(D.gap)]] },
      sheets: [{ name: 'شرکت‌ها', title: 'مقایسه شرکت‌های گروه', columns: [
        { header: 'کد', value: function (c) { return c.code; }, type: 'code' }, { header: 'شرکت', value: function (c) { return c.name; }, type: 'text' }, { header: 'مدل', value: function (c) { return c.model || ''; }, type: 'text' },
        { header: 'فروش ۱۲ ماه', value: function (c) { return c.summary.revenue; }, type: 'money' }, { header: 'فروش بیرون از گروه', value: function (c) { return c.summary.revenueExternal; }, type: 'money' },
        { header: 'برنامه ۱۲ ماه', value: function (c) { return P(c).revenue; }, type: 'money' }, { header: 'سود ناخالص برنامه', value: function (c) { return P(c).gross; }, type: 'money' },
        { header: 'حاشیه', value: function (c) { return P(c).gm; }, type: 'pct' }, { header: 'سطح خدمت', value: function (c) { return P(c).fillRate; }, type: 'pct' },
        { header: 'بهره‌برداری', value: function (c) { return P(c).util; }, type: 'pct' }, { header: 'دقت پیش‌بینی', value: function (c) { return c.summary.accuracy; }, type: 'pct' },
        { header: 'شکاف بودجه', value: function (c) { return P(c).budgetGap; }, type: 'pct' }, { header: 'تناژ برنامه', value: function (c) { return P(c).tons; }, type: 'num' }, { header: 'استثنای بحرانی', value: function (c) { return c.summary.critical; }, type: 'int' }],
        rows: rows, charts: [{ type: 'bar', x: 1, y: [3, 5], title: 'فروش و برنامه شرکت‌ها' }] },
      { name: 'جریان درون‌گروهی', title: 'جریان‌های درون‌گروهی (تن در ۱۲ ماه)', columns: [{ header: 'تأمین‌کننده', value: function (x) { return x.from; }, type: 'text' }, { header: 'خریدار', value: function (x) { return x.to; }, type: 'text' }, { header: 'تن', value: function (x) { return x.tons; }, type: 'num' }, { header: 'کالاها', value: function (x) { return x.items; }, type: 'text' }], rows: flowRows(D) }]
    });
  }
  function flowRows(D) {
    var out = [];
    D.withPlan.forEach(function (c) {
      var ic = c.summary.plan.ic || {};
      Object.keys(ic).forEach(function (code) { var s = IBP.holding.byCode(code); out.push({ from: s ? s.name : code, fromCode: code, to: c.name, toCode: c.code, tons: ic[code].total, items: (ic[code].items || []).join('، '), monthly: ic[code].tons }); });
    });
    return out;
  }

  function render(root) {
    var D = data(), name = IBP.holding.holdingName();
    root.appendChild(UI.pageHead({ title: 'نمای تلفیقی هلدینگ', badge: UI.statusBadge('info', F.num(IBP.holding.list().length) + ' شرکت'),
      desc: name + ' · فروش درون‌گروهی حذف شده است · داده هر شرکت از آخرین محاسبه همان شرکت', actions: [UI.excelButton('خروجی Excel تلفیقی', function () { return exportAll(D); }), refreshBtn()] }));
    if (D.missing) {
      root.appendChild(h('div.engine-panel', { style: { marginBottom: '16px' } }, h('div.ep-icon', { html: icon('refresh', 22) }),
        h('div', { style: { flex: 1 } }, h('div.ep-t', F.num(D.missing) + ' شرکت هنوز خلاصه برنامه تأمین و مالی ندارد'), h('div.ep-d', 'برای محاسبه برنامه تولید، سود و زیان و جریان‌های درون‌گروهی همه شرکت‌ها، به‌روزرسانی را اجرا کنید (چند ثانیه).')), refreshBtn('محاسبه همه شرکت‌ها')));
    }
    // بنر
    var g = function (v, label, sub, from, to) { return h('div.hero-gauge', h('div', { html: C.ring(v, { size: 62, stroke: 6, track: 'rgba(255,255,255,0.14)', from: from, to: to, fontSize: 14, label: v === null || v === undefined ? '—' : F.pct(v, 0) }) }), h('div', h('div.hg-l', label), h('div.hg-s', sub))); };
    root.appendChild(h('section.hero.holding-hero',
      h('div', IBP.flag({ width: 92, height: 62, title: name })),
      h('div', h('h2', name), h('p', 'برنامه ۱۲ ماه آینده بیرون از گروه: ' + money(D.planRevExt) + ' · سود ناخالص ' + money(D.planGrossExt) + ' · ' + F.num(D.planTons, 0) + ' تن')),
      h('div.hero-gauges',
        g(D.planRevExt ? D.planGrossExt / D.planRevExt : null, 'حاشیه ناخالص تلفیقی', 'بیرون از گروه', '#fbbf24', '#f472b6'),
        g(D.fill, 'سطح خدمت وزنی', F.num(D.withPlan.length) + ' شرکت', '#34d399', '#22d3ee'),
        g(D.acc, 'دقت پیش‌بینی وزنی', 'سه ماه اخیر', '#a78bfa', '#60a5fa'),
        h('div.hero-gauge.count', h('div.hg-n', F.num(D.crit)), h('div', h('div.hg-l', 'استثنای بحرانی'), h('div.hg-s', 'در همه شرکت‌ها'))))));

    var kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'chart', label: 'فروش ۱۲ ماه بیرون از گروه', value: m(D.revExt), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'رشد اسمی ' + F.signedPct(D.revPrev ? D.rev / D.revPrev - 1 : null) }));
    kp.appendChild(UI.kpi({ icon: 'trend', label: 'برنامه ۱۲ ماه بیرون از گروه', value: m(D.planRevExt), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'کل با درون‌گروهی ' + money(D.planRev) }));
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'سود ناخالص برنامه', value: m(D.planGrossExt), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'حاشیه ' + F.pct(D.planRevExt ? D.planGrossExt / D.planRevExt : null, 1) }));
    kp.appendChild(UI.kpi({ icon: 'target', label: 'شکاف وزنی با بودجه', value: D.gap, format: function (v) { return F.signedPct(v); }, text: '—', foot: 'ماه‌های دارای بودجه' }));
    kp.appendChild(UI.kpi({ icon: 'warehouse', label: 'سرمایه در گردش گروه', value: m(D.nwc), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'پایان ۱۲ ماه برنامه' }));
    kp.appendChild(UI.kpi({ icon: 'critical', label: 'فروش ازدست‌رفته گروه', value: m(D.lost), format: function (v) { return F.num(v, 1); }, unit: F.moneyUnit(), foot: 'کمبود ظرفیت' }));
    root.appendChild(kp);

    var grid = h('div.dash-grid'); root.appendChild(grid);
    // جریان درون‌گروهی
    var fr = flowRows(D);
    var fc = UI.card({ title: 'نقشه جریان‌های درون‌گروهی', sub: 'تن در ۱۲ ماه بر اساس MRP هر شرکت خریدار · اندازه گره = فروش · روی هر شرکت کلیک کنید تا فقط جریان‌های آن نمایش داده شود', icon: 'share', span: 7 });
    var fb = h('div'); fc.body.appendChild(fb);
    if (fr.length) {
      C.flows(fb, {
        nodes: D.list.map(function (c, i) { return { id: c.code, code: c.code, label: c.name, sub: c.model || '', color: color(c, i), size: c.summary.revenue, rows: [{ label: 'فروش ۱۲ ماه', value: money(c.summary.revenue) }, { label: 'برنامه', value: money((c.summary.plan || {}).revenue) }] }; }),
        links: fr.map(function (x) { return { from: x.fromCode, to: x.toCode, value: x.tons, rows: [{ label: 'کالاها', value: x.items }] }; }),
        format: function (v) { return F.num(v, 0) + ' تن'; }, valueLabel: 'جریان ۱۲ ماه', height: 460, title: 'جریان‌های درون‌گروهی',
        onNode: function (n) { state.focus = n ? n.id : null; drawFocus(); }
      });
    } else fb.appendChild(h('div.cell-sub', 'جریان درون‌گروهی محاسبه نشده است؛ «به‌روزرسانی همه شرکت‌ها» را اجرا کنید.'));
    grid.appendChild(fc.el);

    // جزئیات شرکت متمرکز
    var dc = UI.card({ title: 'تمرکز بر شرکت', sub: 'روی یک شرکت در نقشه جریان یا نمودار کلیک کنید', icon: 'target', span: 5 });
    var dbody = h('div'); dc.body.appendChild(dbody);
    function drawFocus() {
      dbody.textContent = '';
      var c = state.focus ? IBP.holding.byCode(state.focus) : null;
      if (!c || !c.summary) { dbody.appendChild(h('div.cell-sub', 'هیچ شرکتی انتخاب نشده است. خلاصه گروه:')); dbody.appendChild(companyBars(D)); return; }
      var P = c.summary.plan || {};
      dbody.appendChild(h('div.focus-co', h('div.fc-name', { html: F.escape(c.name) + ' <span class="model-badge ' + ((c.model || 'B2C') === 'B2B' ? 'b2b' : 'b2c') + '">' + F.escape(c.model || 'B2C') + '</span>' }), h('div.cell-sub', c.industry || '')));
      var st = h('div.sc-stats');
      [['فروش ۱۲ ماه', money(c.summary.revenue)], ['برنامه ۱۲ ماه', money(P.revenue)], ['سود ناخالص', money(P.gross)], ['حاشیه', F.pct(P.gm, 1)], ['سطح خدمت', F.pct(P.fillRate, 1)], ['بهره‌برداری', F.pct(P.util, 0)], ['دقت پیش‌بینی', F.pct(c.summary.accuracy, 0)], ['شکاف بودجه', F.signedPct(P.budgetGap)]]
        .forEach(function (x) { st.appendChild(h('div', h('span', x[0]), h('b', x[1]))); });
      dbody.appendChild(st);
      var inn = fr.filter(function (x) { return x.toCode === c.code; }), out = fr.filter(function (x) { return x.fromCode === c.code; });
      var ul = h('ul.alerts', { style: { maxHeight: 'none' } });
      inn.forEach(function (x) { ul.appendChild(h('li.alert-item', h('div.alert-icon.warning', { html: icon('download', 15) }), h('div', h('div.alert-text', 'دریافت از ' + x.from + ': ' + F.num(x.tons, 0) + ' تن'), h('div.alert-detail', x.items)))); });
      out.forEach(function (x) { ul.appendChild(h('li.alert-item', h('div.alert-icon.good', { html: icon('upload', 15) }), h('div', h('div.alert-text', 'تأمین برای ' + x.to + ': ' + F.num(x.tons, 0) + ' تن'), h('div.alert-detail', x.items)))); });
      if (inn.length || out.length) dbody.appendChild(ul);
      dbody.appendChild(h('div', { style: { marginTop: '10px' } }, h('button.btn.btn-primary.btn-sm', { type: 'button', html: '<span>ورود به ' + F.escape(c.name) + '</span>' + icon('chevronLeft', 14), onclick: function () { enterCo(c); } })));
      if (IBP.motion) IBP.motion.pulse(dc.el);
    }
    grid.appendChild(dc.el);
    drawFocus();

    // مقایسه فروش و برنامه
    var cc = UI.card({ title: 'فروش ۱۲ ماه گذشته و برنامه ۱۲ ماه آینده', sub: F.moneyUnit() + ' · برای تمرکز روی شرکت کلیک کنید', icon: 'chart', span: 7 });
    var cb = h('div'); cc.body.appendChild(cb);
    C.columns(cb, { labels: D.list.map(function (c) { return c.name; }), height: 280,
      series: [{ name: 'فروش ۱۲ ماه گذشته', values: D.list.map(function (c) { return m(c.summary.revenue); }), color: 'color-mix(in srgb, var(--text-2) 40%, transparent)' }, { name: 'برنامه ۱۲ ماه آینده', values: D.list.map(function (c) { return m((c.summary.plan || {}).revenue); }), colors: D.list.map(color), color: 'var(--series-1)' }],
      lines: [{ name: 'سود ناخالص برنامه', values: D.list.map(function (c) { return m((c.summary.plan || {}).gross); }), color: 'var(--series-3)' }],
      format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' ' + F.moneyUnit(); },
      onClick: function (i) { state.focus = D.list[i].code; drawFocus(); } });
    grid.appendChild(cc.el);

    var pc = UI.card({ title: 'نقشه سودآوری شرکت‌ها', sub: 'حاشیه ناخالص برنامه در برابر برنامه فروش · اندازه = تناژ', icon: 'scatter', span: 5 });
    var pb = h('div'); pc.body.appendChild(pb);
    C.scatter(pb, { points: D.withPlan.map(function (c, i) { var P = c.summary.plan; return { x: m(P.revenue), y: P.gm, size: P.tons, color: color(c, D.list.indexOf(c)), label: c.name, short: c.name, id: c.code, rows: [{ label: 'سطح خدمت', value: F.pct(P.fillRate, 1) }, { label: 'تناژ', value: F.num(P.tons, 0) + ' تن' }] }; }),
      xFormat: function (v) { return F.num(v, 0); }, yFormat: function (v) { return F.pct(v, 0); }, xTitle: 'برنامه فروش (' + F.moneyUnit() + ')', yTitle: 'حاشیه ناخالص', xLabel: 'برنامه', yLabel: 'حاشیه', height: 280, labelTop: 6,
      onClick: function (p) { state.focus = p.id; drawFocus(); } });
    grid.appendChild(pc.el);

    // ماتریس سلامت
    var hm = UI.card({ title: 'ماتریس سلامت شرکت‌ها', sub: 'سبز = مطلوب · قرمز = نیازمند توجه · برای ورود به شرکت کلیک کنید', icon: 'table', span: 12 });
    var tgt = S.settings();
    var cols = [
      { id: 'acc', label: 'دقت پیش‌بینی', v: function (c) { return c.summary.accuracy; }, good: function (v) { return v >= (tgt.forecastAccuracyTarget || 0.8) ? 1 : v >= 0.7 ? 0.5 : 0; }, fmt: function (v) { return F.pct(v, 0); } },
      { id: 'fill', label: 'سطح خدمت', v: function (c) { return (c.summary.plan || {}).fillRate; }, good: function (v) { return v >= 0.98 ? 1 : v >= 0.95 ? 0.5 : 0; }, fmt: function (v) { return F.pct(v, 1); } },
      { id: 'util', label: 'بهره‌برداری خطوط', v: function (c) { return (c.summary.plan || {}).util; }, good: function (v) { return v <= 0.85 ? 1 : v <= 0.95 ? 0.5 : 0; }, fmt: function (v) { return F.pct(v, 0); } },
      { id: 'gm', label: 'حاشیه ناخالص', v: function (c) { return (c.summary.plan || {}).gm; }, good: function (v) { return v >= 0.2 ? 1 : v >= 0.12 ? 0.5 : 0; }, fmt: function (v) { return F.pct(v, 1); } },
      { id: 'gap', label: 'شکاف بودجه', v: function (c) { return (c.summary.plan || {}).budgetGap; }, good: function (v) { return v >= -0.02 ? 1 : v >= -0.1 ? 0.5 : 0; }, fmt: function (v) { return F.signedPct(v); } },
      { id: 'growth', label: 'رشد اسمی فروش', v: function (c) { return c.summary.revenuePrev ? c.summary.revenue / c.summary.revenuePrev - 1 : null; }, good: function (v) { return v >= 0.3 ? 1 : v >= 0.15 ? 0.5 : 0; }, fmt: function (v) { return F.signedPct(v); } },
      { id: 'crit', label: 'استثنای بحرانی', v: function (c) { return c.summary.critical; }, good: function (v) { return v === 0 ? 1 : v <= 3 ? 0.5 : 0; }, fmt: function (v) { return F.num(v); } }
    ];
    C.heatmap(hm.body, {
      corner: 'شرکت / شاخص',
      rows: D.list.map(function (c) { return { id: c.id, label: c.name, sub: c.code + ' · ' + (c.model || ''), c: c }; }),
      cols: cols.map(function (x) { return { id: x.id, label: x.label, x: x }; }),
      value: function (r, col) { var v = col.x.v(r.c); return v === null || v === undefined ? null : v; },
      format: function (v) { return F.num(v, 2); },
      color: function (v, r, col) { var g2 = col.x.good(v); return g2 >= 1 ? 'color-mix(in srgb, var(--good) 22%, transparent)' : g2 >= 0.5 ? 'color-mix(in srgb, var(--warning) 26%, transparent)' : 'color-mix(in srgb, var(--critical) 26%, transparent)'; },
      onClick: function (r) { state.focus = r.c.code; drawFocus(); dc.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
    // نمایش با قالب هر ستون
    Array.prototype.forEach.call(hm.body.querySelectorAll('tbody tr'), function (tr, ri) {
      Array.prototype.forEach.call(tr.querySelectorAll('td'), function (td, ci) { var v = cols[ci].v(D.list[ri]); if (v !== null && v !== undefined) td.textContent = cols[ci].fmt(v); });
    });
    grid.appendChild(hm.el);

    // روند تلفیقی برنامه
    var per = (D.withPlan[0] && D.withPlan[0].summary.plan.periods) || [];
    if (per.length) {
      var tc = UI.card({ title: 'برنامه فروش بیرون از گروه به تفکیک شرکت', sub: '۱۲ ماه آینده · ' + F.moneyUnit(), icon: 'trend', span: 12 });
      var tb = h('div'); tc.body.appendChild(tb);
      C.columns(tb, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, height: 280,
        series: D.withPlan.map(function (c) { return { name: c.name, values: (c.summary.plan.revenueExtMonthly || []).map(m), color: color(c, D.list.indexOf(c)) }; }),
        format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' ' + F.moneyUnit(); } });
      grid.appendChild(tc.el);
    }
  }

  function companyBars(D) {
    var box = h('div');
    C.hbars(box, { items: D.list.map(function (c, i) { return { id: c.code, label: c.name, value: m((c.summary.plan || {}).gross), color: color(c, i), sub: [{ label: 'حاشیه', value: F.pct((c.summary.plan || {}).gm, 1) }] }; }),
      format: function (v) { return F.num(v, 0); }, valueLabel: 'سود ناخالص برنامه (' + F.moneyUnit() + ')',
      onClick: function (it) { state.focus = it.id; IBP.app.render(true); } });
    return box;
  }
  function enterCo(c) {
    IBP.holding.saveSummary().then(function () { return IBP.holding.enter(c.id); }).then(function () { IBP.app.enterCompany(c); IBP.app.navigate('#/dashboard'); });
  }

  IBP.register('holding', { title: 'نمای تلفیقی هلدینگ', render: render });
})(window.IBP = window.IBP || {});
