/*
 * تطبیق مالی (فاز ۵):
 *   pnl          سود و زیان برنامه (درآمد، مواد، تبدیل، سربار، سود ناخالص، اضافه‌کاری، نگهداری)، سودآوری خانواده‌ها، سرمایه در گردش
 *   budget       تطبیق با بودجه: پل درآمد (اثر حجم، قیمت و ترکیب)، شکاف ماهانه و خانواده‌ها، راهکارهای پوشش شکاف
 *   sensitivity  حساسیت سود به محرک‌ها (تقاضا، قیمت، مواد، ارز، تبدیل، ظرفیت) با بازسازی برنامه تولید
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var TABS = [['pnl', 'سود و زیان برنامه', 'coins'], ['budget', 'تطبیق با بودجه', 'target'], ['sensitivity', 'تحلیل حساسیت', 'scenario']];
  var state = { months: 12, delta: 10, sens: null };

  function sc() { return S.settings().displayScale || 1e9; }
  function m(v) { return v / sc(); }
  function money(v) { return F.money(v); }
  var LINES = [
    ['revenue', 'درآمد فروش'], ['material', 'بهای مواد'], ['conversion', 'هزینه تبدیل'], ['overhead', 'سربار'], ['cogs', 'بهای تمام‌شده'],
    ['gross', 'سود ناخالص'], ['overtime', 'صرف اضافه‌کاری'], ['holding', 'هزینه نگهداری موجودی'], ['operating', 'سود عملیاتی برنامه'], ['lost', 'فروش ازدست‌رفته (کمبود)']
  ];

  function exportPnl(f) {
    var n = state.months, per = f.periods.slice(0, n);
    var cols = [{ header: 'سطر', value: function (r) { return r[1]; }, type: 'text', width: 26 }];
    per.forEach(function (p, i) { cols.push({ header: J.year(p) + '/' + String(J.month(p)).padStart(2, '0'), type: 'money', value: function (r) { return f.totals[r[0]][i]; } }); });
    cols.push({ header: 'جمع', type: 'money', value: function (r) { return A.sum(f.totals[r[0]].slice(0, n)); } });
    var fams = Object.keys(f.byFamily).map(function (k) { return f.byFamily[k]; });
    return IBP.excel.exportTables({
      filename: 'سود و زیان برنامه ' + J.label(f.periods[0]),
      summary: { title: 'خلاصه مالی برنامه ' + F.num(n) + ' ماه', pairs: [['درآمد', money(f.kpi.revenue)], ['سود ناخالص', money(f.kpi.gross)], ['حاشیه ناخالص', F.pct(f.kpi.gm, 1)], ['سود عملیاتی برنامه', money(f.kpi.operating)], ['فروش ازدست‌رفته', money(f.kpi.lost)], ['سرمایه در گردش پایان دوره', money(f.kpi.nwcEnd)]] },
      sheets: [
        { name: 'سود و زیان', title: 'سود و زیان ماهانه برنامه (ریال)', columns: cols, rows: LINES, freezeCols: 1 },
        { name: 'خانواده‌ها', title: 'سودآوری خانواده‌های محصول', columns: [{ header: 'خانواده', value: function (x) { return S.name('families', x.familyId); }, type: 'text' }, { header: 'درآمد', value: function (x) { return x.revenue; }, type: 'money' }, { header: 'بهای تمام‌شده', value: function (x) { return x.cogs; }, type: 'money' }, { header: 'سود ناخالص', value: function (x) { return x.gross; }, type: 'money' }, { header: 'حاشیه', value: function (x) { return x.revenue ? x.gross / x.revenue : null; }, type: 'pct' }], rows: fams, charts: [{ type: 'bar', x: 0, y: [1, 3], title: 'درآمد و سود ناخالص' }] },
        { name: 'سرمایه در گردش', title: 'سرمایه در گردش پیش‌بینی‌شده', columns: [{ header: 'ماه', value: function (x) { return J.label(x.p); }, type: 'text' }, { header: 'موجودی محصول', value: function (x) { return f.wc.inventory[x.i]; }, type: 'money' }, { header: 'موجودی مواد', value: function (x) { return f.wc.materials[x.i]; }, type: 'money' }, { header: 'مطالبات', value: function (x) { return f.wc.receivables[x.i]; }, type: 'money' }, { header: 'بدهی تأمین‌کنندگان', value: function (x) { return f.wc.payables[x.i]; }, type: 'money' }, { header: 'سرمایه در گردش خالص', value: function (x) { return f.wc.net[x.i]; }, type: 'money' }], rows: per.map(function (p, i) { return { p: p, i: i }; }), charts: [{ type: 'line', x: 0, y: [5], title: 'سرمایه در گردش خالص' }] }
      ]
    });
  }

  function kpiRow(f) {
    var k = f.kpi, kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'chart', label: 'درآمد برنامه ' + F.num(f.months12) + ' ماه', value: m(k.revenue), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: F.num(k.tons, 0) + ' تن فروش' }));
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'سود ناخالص', value: m(k.gross), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'حاشیه ' + F.pct(k.gm, 1) }));
    kp.appendChild(UI.kpi({ icon: 'trend', label: 'سود عملیاتی برنامه', value: m(k.operating), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'پس از اضافه‌کاری و نگهداری · ' + F.pct(k.opm, 1) }));
    kp.appendChild(UI.kpi({ icon: 'target', label: 'شکاف درآمد با بودجه', value: k.budgetGap, format: function (v) { return F.signedPct(v); }, text: '—', foot: k.budgetMonths ? 'در ' + F.num(k.budgetMonths) + ' ماه دارای بودجه' : 'بودجه‌ای برای افق ثبت نشده' }));
    kp.appendChild(UI.kpi({ icon: 'critical', label: 'فروش ازدست‌رفته', value: m(k.lost), format: function (v) { return F.num(v, 1); }, unit: F.moneyUnit(), foot: 'کمبود ناشی از محدودیت ظرفیت' }));
    kp.appendChild(UI.kpi({ icon: 'warehouse', label: 'سرمایه در گردش پایان دوره', value: m(k.nwcEnd), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'دوره وصول ' + F.num(f.dso, 0) + ' روز · پرداخت ' + F.num(f.dpo) + ' روز' }));
    return kp;
  }

  /* ======================= سود و زیان ======================= */
  function renderPnl(root) {
    var f = IBP.finance.current(), n = state.months, per = f.periods.slice(0, n), T = f.totals;
    root.appendChild(kpiRow(f));
    var grid = h('div.dash-grid'); root.appendChild(grid);
    var c1 = UI.card({ title: 'ترکیب درآمد ماهانه', sub: 'هر ستون = درآمد برنامه؛ بخش‌ها: مواد، تبدیل، سربار و سود ناخالص (' + F.moneyUnit() + ')', icon: 'chart', span: 8, exportFn: function () { return exportPnl(f); } });
    var b1 = h('div'); c1.body.appendChild(b1);
    C.columns(b1, { labels: per.map(J.shortLabel), tipTitles: per.map(function (p, i) { return J.label(p) + ' · حاشیه ' + F.pct(T.revenue[i] ? T.gross[i] / T.revenue[i] : null, 1); }), stacked: true, height: 290,
      series: [{ name: 'بهای مواد', values: T.material.slice(0, n).map(m), color: 'var(--series-2)' }, { name: 'هزینه تبدیل', values: T.conversion.slice(0, n).map(m), color: 'var(--series-4)' }, { name: 'سربار', values: T.overhead.slice(0, n).map(m), color: 'var(--series-8)' }, { name: 'سود ناخالص', values: T.gross.slice(0, n).map(m), color: 'var(--series-3)' }],
      format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); } });
    grid.appendChild(c1.el);

    var fams = Object.keys(f.byFamily).map(function (k) { return f.byFamily[k]; }).sort(function (a, b) { return b.gross - a.gross; });
    var c2 = UI.card({ title: 'سودآوری خانواده‌ها', sub: 'سود ناخالص کل افق · برچسب: حاشیه', icon: 'layers', span: 4 });
    C.hbars(c2.body, { items: fams.map(function (x, i) { var fm = S.get('families', x.familyId); return { label: fm ? fm.name : '—', value: m(x.gross), color: (fm && fm.color) || C.seriesColor(i), sub: [{ label: 'حاشیه ناخالص', value: F.pct(x.revenue ? x.gross / x.revenue : null, 1) }, { label: 'درآمد', value: money(x.revenue) }, { label: 'فروش ازدست‌رفته', value: money(x.lost) }] }; }), format: function (v) { return F.num(v, 0); }, valueLabel: 'سود ناخالص (' + F.moneyUnit() + ')' });
    grid.appendChild(c2.el);

    // جدول سود و زیان
    var c3 = UI.card({ title: 'صورت سود و زیان برنامه', sub: 'ماهانه · ' + F.moneyUnit() + ' · مبنا: برنامه تولید و تقاضای اجماعی چرخه ' + J.label(f.periods[0]), icon: 'table', span: 12, flush: true, exportFn: function () { return exportPnl(f); } });
    var t = h('table.data-table.plan-table.pnl-table'), hr = h('tr', h('th.pt-name', 'سطر'));
    per.forEach(function (p) { hr.appendChild(h('th.num', J.shortLabel(p))); });
    hr.appendChild(h('th.num', 'جمع')); hr.appendChild(h('th.num', 'سهم از درآمد'));
    t.appendChild(h('thead', hr));
    var tb = h('tbody'), rev = A.sum(T.revenue.slice(0, n));
    LINES.forEach(function (ln) {
      var strong = ln[0] === 'revenue' || ln[0] === 'gross' || ln[0] === 'operating';
      var tr = h('tr' + (strong ? '.pt-d1.pnl-strong' : '') + (ln[0] === 'lost' ? '.pnl-memo' : ''), h('td.pt-name', ln[1]));
      per.forEach(function (_, i) { tr.appendChild(h('td.num', F.num(m(T[ln[0]][i]), 1))); });
      var s = A.sum(T[ln[0]].slice(0, n));
      tr.appendChild(h('td.num.pt-total', F.num(m(s), 1)));
      tr.appendChild(h('td.num', rev ? F.pct(s / rev, 1) : '—'));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    c3.body.appendChild(h('div.plan-wrap', t));
    grid.appendChild(c3.el);

    var W = f.wc;
    var c4 = UI.card({ title: 'سرمایه در گردش پیش‌بینی‌شده', sub: 'موجودی محصول و مواد + مطالبات − بدهی تأمین‌کنندگان (' + F.moneyUnit() + ')', icon: 'coins', span: 7 });
    var b4 = h('div'); c4.body.appendChild(b4);
    C.line(b4, { labels: per.map(J.shortLabel), tipLabels: per.map(J.label), height: 260, series: [
      { name: 'سرمایه در گردش خالص', values: W.net.slice(0, n).map(m), color: 'var(--series-1)', area: true },
      { name: 'مطالبات', values: W.receivables.slice(0, n).map(m), color: 'var(--series-3)', noLabels: true },
      { name: 'موجودی محصول و مواد', values: W.inventory.slice(0, n).map(function (v, i) { return m(v + W.materials[i]); }), color: 'var(--series-4)', noLabels: true },
      { name: 'بدهی تأمین‌کنندگان', values: W.payables.slice(0, n).map(m), color: 'var(--series-2)', dash: true }
    ], format: function (v) { return F.num(v, 0); }, labelFormat: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); } });
    grid.appendChild(c4.el);

    var prods = Object.keys(f.byProduct).map(function (k) { return f.byProduct[k]; });
    var c5 = UI.card({ title: 'سودآوری محصولات', sub: 'حاشیه ناخالص در برابر درآمد · اندازه = سود ناخالص', icon: 'scatter', span: 5 });
    var b5 = h('div'); c5.body.appendChild(b5);
    C.scatter(b5, { points: prods.filter(function (x) { return x.revenue > 0; }).map(function (x) { var fm = S.get('families', x.product.familyId); return { x: m(x.revenue), y: x.gross / x.revenue, size: Math.max(0, x.gross), color: (fm && fm.color) || 'var(--series-1)', label: x.product.name, short: x.product.code, rows: [{ label: 'سود ناخالص', value: money(x.gross) }] }; }),
      xFormat: function (v) { return F.num(v, 0); }, yFormat: function (v) { return F.pct(v, 0); }, xTitle: 'درآمد (' + F.moneyUnit() + ')', yTitle: 'حاشیه ناخالص', xLabel: 'درآمد', yLabel: 'حاشیه', height: 260, labelTop: 4 });
    grid.appendChild(c5.el);
  }

  /* ======================= بودجه ======================= */
  function renderBudget(root) {
    var f = IBP.finance.current(), n = state.months, per = f.periods.slice(0, n), T = f.totals, B = f.budget, br = f.bridge;
    root.appendChild(kpiRow(f));
    var grid = h('div.dash-grid'); root.appendChild(grid);
    if (!br.months) { grid.appendChild(h('div.card.span-12', h('div.card-body', 'برای ماه‌های افق برنامه بودجه‌ای ثبت نشده است. بودجه را از «مرکز داده» وارد کنید.'))); return; }
    var c1 = UI.card({ title: 'پل درآمد: بودجه تا برنامه', sub: F.num(br.months) + ' ماه دارای بودجه · اثر حجم = (مقدار برنامه − مقدار بودجه) × قیمت بودجه (' + F.moneyUnit() + ')', icon: 'chart', span: 6 });
    var b1 = h('div'); c1.body.appendChild(b1);
    C.waterfall(b1, { items: [{ label: 'بودجه', value: m(br.budget), total: true }, { label: 'اثر حجم', value: m(br.volume) }, { label: 'اثر قیمت و ترکیب', value: m(br.priceMix) }, { label: 'برنامه', value: m(br.plan), total: true }], format: function (v) { return F.num(v, 0); }, height: 280 });
    grid.appendChild(c1.el);

    var idx = per.map(function (_, i) { return i; }).filter(function (i) { return B.has[i]; });
    var c2 = UI.card({ title: 'درآمد ماهانه: برنامه در برابر بودجه', sub: F.moneyUnit() + ' · ماه‌های دارای بودجه', icon: 'target', span: 6 });
    var b2 = h('div'); c2.body.appendChild(b2);
    C.columns(b2, { labels: idx.map(function (i) { return J.shortLabel(per[i]); }), tipTitles: idx.map(function (i) { return J.label(per[i]) + ' · شکاف ' + F.signedPct(B.revenue[i] ? T.revenue[i] / B.revenue[i] - 1 : null); }), height: 280,
      series: [{ name: 'بودجه', values: idx.map(function (i) { return m(B.revenue[i]); }), color: 'var(--series-8)' }, { name: 'برنامه', values: idx.map(function (i) { return m(T.revenue[i]); }), color: 'var(--series-1)' }],
      format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); } });
    grid.appendChild(c2.el);

    // راهکارهای پوشش شکاف
    var gap = br.plan - br.budget, ideas = [];
    if (gap < 0) {
      var lostB = A.sum(idx, function (i) { return T.lost[i]; });
      if (lostB > 0) ideas.push({ t: 'آزادسازی ظرفیت', d: 'فروش ازدست‌رفته ناشی از کمبود در همین ماه‌ها ' + money(lostB) + ' است (' + F.pct(lostB / -gap, 0) + ' شکاف)؛ اضافه‌کاری، شیفت اضافه یا خط جایگزین در «تأمین و ظرفیت» بررسی شود.' });
      ideas.push({ t: 'افزایش قیمت لازم', d: 'بستن کامل شکاف فقط با قیمت نیازمند ' + F.pct(-gap / br.plan, 1) + ' افزایش قیمت در ماه‌های بودجه است (با فرض ثبات تقاضا).' });
      if (br.volume < 0) ideas.push({ t: 'جبران حجم', d: 'اثر حجم ' + money(br.volume) + ' است؛ کمپین فروش یا قرارداد جدید در خانواده‌های با بیشترین شکاف (جدول زیر) پیشنهاد می‌شود.' });
    } else ideas.push({ t: 'برنامه بالاتر از بودجه', d: 'درآمد برنامه ' + money(gap) + ' بیش از بودجه است؛ کفایت ظرفیت و مواد برای اجرای آن در «تأمین و ظرفیت» و «MRP» تأیید شود.' });
    var c3 = UI.card({ title: 'راهکارهای پوشش شکاف', sub: 'پیشنهاد خودکار بر اساس پل درآمد و برنامه تأمین', icon: 'wand', span: 12, flush: true });
    var ul = h('ul.alerts');
    ideas.forEach(function (x) { ul.appendChild(h('li.alert-item', h('div.alert-icon.' + (gap < 0 ? 'warning' : 'good'), { html: icon(gap < 0 ? 'alert' : 'check', 16) }), h('div', h('div.alert-text', x.t), h('div.alert-detail', x.d)))); });
    c3.body.appendChild(ul);
    grid.appendChild(c3.el);

    var rowsBy = {};
    IBP.supply.current().plan.rows.forEach(function (rr) { rowsBy[rr.product.id] = rr; });
    var famRows = S.all('families').map(function (fm) {
      var ps = Object.keys(f.byProduct).map(function (k) { return f.byProduct[k]; }).filter(function (x) { return x.product.familyId === fm.id; });
      var plan = 0, bud = 0;
      S.all('budgets').forEach(function (b) {
        var i = per.indexOf(b.period); if (i < 0) return;
        if (ps.some(function (x) { return x.product.id === b.productId; })) bud += b.revenue || 0;
      });
      ps.forEach(function (x) { var p = x.product, r = rowsBy[p.id]; if (r) idx.forEach(function (i) { plan += Math.max(0, r.demand[i] - r.shortage[i]) * A.priceAt(p, per[i]) * (1 - A.avgDiscount()); }); });
      return { family: fm, plan: plan, budget: bud, gap: bud ? plan / bud - 1 : null };
    }).filter(function (x) { return x.budget > 0 || x.plan > 0; });
    var c4 = UI.card({ title: 'شکاف بودجه خانواده‌ها', sub: 'درآمد برنامه در برابر بودجه در ماه‌های دارای بودجه', icon: 'layers', span: 12, flush: true,
      exportFn: function () { return IBP.excel.exportTables({ filename: 'تطبیق بودجه ' + J.label(per[0]), summary: { title: 'پل درآمد', pairs: [['درآمد بودجه', money(br.budget)], ['اثر حجم', money(br.volume)], ['اثر قیمت و ترکیب', money(br.priceMix)], ['درآمد برنامه', money(br.plan)]] }, sheets: [{ name: 'خانواده‌ها', title: 'شکاف بودجه خانواده‌ها', columns: [{ header: 'خانواده', value: function (x) { return x.family.name; }, type: 'text' }, { header: 'درآمد برنامه', value: function (x) { return x.plan; }, type: 'money' }, { header: 'درآمد بودجه', value: function (x) { return x.budget; }, type: 'money' }, { header: 'شکاف', value: function (x) { return x.gap; }, type: 'pct' }], rows: famRows, charts: [{ type: 'bar', x: 0, y: [1, 2], title: 'برنامه و بودجه' }] }] }); } });
    IBP.grid(c4.body, { rows: function () { return famRows; }, pageSize: 20, columns: [
      { key: 'f', label: 'خانواده', value: function (x) { return x.family.name; } },
      { key: 'p', label: 'درآمد برنامه', align: 'num', value: function (x) { return x.plan; }, render: function (x) { return money(x.plan); } },
      { key: 'b', label: 'درآمد بودجه', align: 'num', value: function (x) { return x.budget; }, render: function (x) { return money(x.budget); } },
      { key: 'g', label: 'شکاف', align: 'num', value: function (x) { return x.gap; }, render: function (x) { return x.gap === null ? '—' : '<span class="delta ' + (x.gap >= 0 ? 'up-good' : 'down-bad') + '">' + F.signedPct(x.gap) + '</span>'; } }
    ] });
    grid.appendChild(c4.el);
  }

  /* ======================= حساسیت ======================= */
  function renderSensitivity(root) {
    var seg = h('div.seg', [5, 10, 20].map(function (d) { return h('button' + (state.delta === d ? '.on' : ''), { type: 'button', onclick: function () { state.delta = d; state.sens = null; IBP.app.render(true); } }, '±' + F.num(d) + '٪'); }));
    root.appendChild(h('div.engine-panel', { style: { marginBottom: '16px' } }, h('div.ep-icon', { html: icon('scenario', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } }, h('div.ep-t', 'اثر تغییر هر محرک بر سود ناخالص ۱۲ ماه'),
        h('div.ep-d', 'برای تقاضا و ظرفیت، برنامه تولید دوباره با محدودیت ظرفیت ساخته می‌شود؛ به همین دلیل افزایش تقاضا ممکن است به‌دلیل گلوگاه اثر کمتری از کاهش آن داشته باشد.')), seg));
    var key = state.delta + '|' + S.version;
    if (!state.sens || state.sens.key !== key) state.sens = { key: key, rows: IBP.finance.sensitivity(state.delta) };
    var rows = state.sens.rows.filter(function (r) { return !r.base; }), base = state.sens.rows.filter(function (r) { return r.base; })[0].base;
    var grid = h('div.dash-grid'); root.appendChild(grid);
    var c1 = UI.card({ title: 'نمودار گردبادی حساسیت سود ناخالص', sub: 'تغییر سود ناخالص ۱۲ ماه (' + F.moneyUnit() + ') · مبنا ' + money(base.gross), icon: 'chart', span: 8,
      exportFn: function () { return IBP.excel.exportTables({ filename: 'تحلیل حساسیت', sheets: [{ name: 'حساسیت', title: 'حساسیت سود ناخالص به ±' + state.delta + '٪ تغییر محرک‌ها', columns: [{ header: 'محرک', value: function (r) { return r.label; }, type: 'text' }, { header: 'اثر کاهش', value: function (r) { return r.low; }, type: 'money' }, { header: 'اثر افزایش', value: function (r) { return r.high; }, type: 'money' }, { header: 'سطح خدمت با کاهش', value: function (r) { return r.lowFill; }, type: 'pct' }, { header: 'سطح خدمت با افزایش', value: function (r) { return r.highFill; }, type: 'pct' }], rows: rows, charts: [{ type: 'bar', direction: 'bar', x: 0, y: [1, 2], title: 'حساسیت سود ناخالص' }] }] }); } });
    var b1 = h('div'); c1.body.appendChild(b1);
    C.tornado(b1, { items: rows.map(function (r) { return { label: r.label, low: m(r.low), high: m(r.high), rows: { low: [{ label: 'سطح خدمت', value: F.pct(r.lowFill, 1) }], high: [{ label: 'سطح خدمت', value: F.pct(r.highFill, 1) }] } }; }), lowLabel: '−' + F.num(state.delta) + '٪', highLabel: '+' + F.num(state.delta) + '٪', format: function (v) { return F.num(v, 0); }, valueLabel: 'تغییر سود ناخالص' });
    grid.appendChild(c1.el);
    var c2 = UI.card({ title: 'خلاصه حساسیت', sub: 'به ترتیب اثر', icon: 'list', span: 4, flush: true });
    var ul = h('ul.alerts');
    rows.forEach(function (r) {
      var big = Math.max(Math.abs(r.low), Math.abs(r.high));
      ul.appendChild(h('li.alert-item', h('div.alert-icon.' + (big / Math.max(1, Math.abs(base.gross)) > 0.1 ? 'critical' : 'warning'), { html: icon('scenario', 16) }),
        h('div', h('div.alert-text', r.label), h('div.alert-detail', '−' + F.num(state.delta) + '٪: ' + money(r.low) + ' · +' + F.num(state.delta) + '٪: ' + money(r.high)))));
    });
    c2.body.appendChild(ul);
    grid.appendChild(c2.el);
  }

  /* ======================= صفحه ======================= */
  function render(root, params) {
    var tab = TABS.some(function (t) { return t[0] === params[0]; }) ? params[0] : 'pnl';
    var tabs = h('div.tabbar', { role: 'tablist' });
    TABS.forEach(function (t) { tabs.appendChild(h('a.tab' + (t[0] === tab ? '.on' : ''), { href: '#/finance/' + t[0], role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', html: icon(t[2], 16) + '<span>' + t[1] + '</span>' })); });
    if (!S.count('products')) { root.appendChild(UI.pageHead({ title: 'تطبیق مالی' })); root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.'))); return; }
    var monthsSel = h('div.seg', [6, 12, 18].map(function (mm) { return h('button' + (state.months === mm ? '.on' : ''), { type: 'button', onclick: function () { state.months = mm; IBP.app.render(true); } }, F.num(mm) + ' ماه'); }));
    var fs = IBP.finance.settings();
    root.appendChild(UI.pageHead({ title: 'تطبیق مالی', badge: UI.statusBadge('info', 'برنامه ' + (IBP.supply.current().plan.engine === 'python' ? 'بهینه' : 'داخلی')),
      desc: S.settings().companyName + ' · تبدیل برنامه تقاضا و تولید به سود و زیان · تورم ماهانه هزینه ' + F.pct(fs.costInflation, 1) + ' · نگهداری موجودی ' + F.pct(fs.holdingRate, 1) + ' در ماه', actions: [monthsSel] }));
    root.appendChild(tabs);
    var host = h('div'); root.appendChild(host);
    ({ pnl: renderPnl, budget: renderBudget, sensitivity: renderSensitivity })[tab](host);
  }

  IBP.register('finance', { title: 'تطبیق مالی', render: render });
})(window.IBP = window.IBP || {});
