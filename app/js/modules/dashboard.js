/*
 * داشبورد مدیریتی: شاخص‌های کلیدی، روند فروش و پیش‌بینی، ظرفیت، هشدارها و چرخه IBP.
 * فیلترهای بالای صفحه (خانواده و کارخانه) روی همه بخش‌ها اعمال می‌شوند.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts;
  var state = { family: '', plant: '', mode: 'revenue' };

  function card(title, sub, opts) {
    opts = opts || {};
    var body = h('div.card-body' + (opts.flush ? '.flush' : ''));
    var tools = h('div.card-tools');
    var el = h('section.card' + (opts.span ? '.span-' + opts.span : ''),
      h('div.card-head', h('div', h('h3.card-title', title), sub ? h('div.card-sub', sub) : null), tools),
      body);
    return { el: el, body: body, tools: tools };
  }

  function deltaHtml(v, upIsGood, suffix) {
    if (v === null || v === undefined || !isFinite(v)) return '<span class="delta flat">—</span>';
    var cls = Math.abs(v) < 0.005 ? 'flat' : (v > 0 ? (upIsGood ? 'up-good' : 'up-bad') : (upIsGood ? 'down-bad' : 'down-good'));
    var arrow = Math.abs(v) < 0.005 ? '' : (v > 0 ? '▲' : '▼');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + F.signedPct(v) + '</span>' + (suffix ? '<span>' + suffix + '</span>' : '');
  }

  function kpi(opts) {
    return h('div.card.kpi' + (opts.hero ? '.hero' : ''),
      h('div.kpi-label', { html: icon(opts.icon, 15) + '<span>' + opts.label + '</span>' }),
      h('div.kpi-value', { html: opts.value + (opts.unit ? '<small>' + opts.unit + '</small>' : '') }),
      h('div.kpi-foot', { html: (opts.foot || '') + (opts.spark || '') })
    );
  }

  function render(root) {
    var ctx = A.ctx(), st = ctx.settings, cycle = ctx.cycle, last = ctx.lastActual;
    var scale = st.displayScale || 1e9, unit = F.moneyUnit(scale);
    var fam = state.family, plant = state.plant;
    if (fam && !S.get('families', fam)) fam = state.family = '';
    if (plant && !S.get('plants', plant)) plant = state.plant = '';
    var pf = null;
    if (fam || plant) {
      pf = function (p) { return (!fam || p.familyId === fam) && (!plant || p.plantId === plant); };
      pf.key = fam + '|' + plant;
    }

    if (!S.count('products')) {
      root.appendChild(h('div.card', h('div.roadmap-hero', h('div.roadmap-icon', { html: icon('database', 28) }),
        h('div', h('h2', 'هنوز داده‌ای ثبت نشده است'), h('p', 'برای شروع، داده‌های پایه را وارد کنید یا از صفحه تنظیمات یک مجموعه داده تستی بسازید.'),
          h('p', h('a.btn.btn-primary', { href: '#/settings', style: { marginTop: '12px' } }, 'رفتن به تنظیمات'))))));
      return;
    }

    /* ---------------- فیلترها ---------------- */
    var famSel = h('select', { 'aria-label': 'خانواده محصول' }, h('option', { value: '' }, 'همه خانواده‌ها'));
    S.all('families').forEach(function (f) { famSel.appendChild(h('option', { value: f.id }, f.name)); });
    famSel.value = fam;
    var plantSel = h('select', { 'aria-label': 'کارخانه' }, h('option', { value: '' }, 'همه کارخانه‌ها'));
    S.all('plants').forEach(function (p) { plantSel.appendChild(h('option', { value: p.id }, p.name)); });
    plantSel.value = plant;
    famSel.addEventListener('change', function () { state.family = famSel.value; rerender(); });
    plantSel.addEventListener('change', function () { state.plant = plantSel.value; rerender(); });
    function rerender() { root.textContent = ''; render(root); }
    root.appendChild(h('div.filter-row',
      h('label', { html: icon('filter', 15) }), famSel, plantSel,
      h('span.scope-note', 'آخرین ماه بسته‌شده: ' + J.label(last) + ' · مبالغ به ' + unit)
    ));

    /* ---------------- محاسبات ---------------- */
    var hist24 = J.range(J.addMonths(cycle, -24), 24), ltm = hist24.slice(12), prev12 = hist24.slice(0, 12);
    var next12 = J.range(cycle, 12), next3 = J.range(cycle, 3);
    var ltmSeries = A.salesSeries(ltm, pf), prevSeries = A.salesSeries(prev12, pf);
    var revLtm = A.sum(ltmSeries, function (x) { return x.revenue; }), revPrev = A.sum(prevSeries, function (x) { return x.revenue; });
    var costLtm = A.sum(ltmSeries, function (x) { return x.cost; });
    var margin = revLtm ? 1 - costLtm / revLtm : null;
    var marginPrev = revPrev ? 1 - A.sum(prevSeries, function (x) { return x.cost; }) / revPrev : null;

    var fsm = st.fiscalStartMonth || 1, fy = J.fiscalYear(last, fsm);
    var ytd = J.between(J.period(fy, fsm), last);
    var ytdAct = A.sum(ytd, function (p) { return A.salesTotal(p, pf).revenue; });
    var ytdBud = A.sum(ytd, function (p) { return A.budgetTotal(p, pf).revenue; });
    var lastAct = A.salesTotal(last, pf).revenue, lastBud = A.budgetTotal(last, pf).revenue;

    var acc3 = A.accuracy(J.range(J.addMonths(cycle, -3), 3), pf);
    var acc12 = A.accuracy(J.range(J.addMonths(cycle, -12), 12), pf);

    var cov = A.coverage().filter(function (c) { return !pf || pf(c.product); });
    var invValue = A.sum(cov, function (c) { return c.value; });
    var cogsNext = A.sum(next3, function (p) { return A.forecastTotal(p, 'اجماعی', cycle, pf).cost; }) / 3;
    var monthsCover = cogsNext ? invValue / cogsNext : null;
    var shortCount = cov.filter(function (c) { return c.status === 'critical'; }).length;

    var famRes = null;
    if (fam) {
      famRes = new Set();
      S.all('routings').forEach(function (r) { var p = S.get('products', r.productId); if (p && p.familyId === fam) famRes.add(r.resourceId); });
    }
    var resFilter = function (r) { return (!plant || r.plantId === plant) && (!famRes || famRes.has(r.id)); };
    var cap6 = A.capacityLoad(J.range(cycle, 6)).filter(function (r) { return resFilter(r.resource); });
    var cap3h = 0, cap3c = 0;
    cap6.forEach(function (r) { r.periods.slice(0, 3).forEach(function (p) { cap3h += p.hours; cap3c += p.capacity; }); });
    var util3 = cap3c ? cap3h / cap3c : null;
    var hotLines = cap6.filter(function (r) { return r.peak > (st.utilizationWarn || 0.85); }).length;

    /* ---------------- کارت‌های شاخص ---------------- */
    var accTarget = st.forecastAccuracyTarget || 0.8;
    var kpis = h('div.kpis');
    kpis.appendChild(kpi({
      hero: true, icon: 'chart', label: 'فروش ۱۲ ماه اخیر', value: F.num(revLtm / scale), unit: unit,
      foot: deltaHtml(revPrev ? revLtm / revPrev - 1 : null, true, 'نسبت به ۱۲ ماه قبل'),
      spark: C.sparkline(ltmSeries.map(function (x) { return x.revenue; }))
    }));
    kpis.appendChild(kpi({
      icon: 'target', label: 'تحقق بودجه ' + J.monthName(last), value: lastBud ? F.pct(lastAct / lastBud, 0) : '—',
      foot: ytdBud ? '<span>از ابتدای سال: <b>' + F.pct(ytdAct / ytdBud, 0) + '</b></span>' : '<span>بودجه‌ای ثبت نشده</span>'
    }));
    kpis.appendChild(kpi({
      icon: 'trend', label: 'دقت پیش‌بینی (۳ ماه)', value: F.pct(acc3.accuracy, 0),
      foot: '<span>سوگیری ' + F.signedPct(acc3.bias) + ' · هدف ' + F.pct(accTarget, 0) + '</span>',
      spark: C.sparkline(acc12.byPeriod.map(function (x) { return x.accuracy; }))
    }));
    kpis.appendChild(kpi({
      icon: 'coins', label: 'حاشیه سود ناخالص', value: F.pct(margin), foot: deltaHtml(margin !== null && marginPrev !== null ? margin - marginPrev : null, true, 'تغییر واحد درصد'),
      spark: C.sparkline(ltmSeries.map(function (x) { return x.revenue ? 1 - x.cost / x.revenue : 0; }))
    }));
    kpis.appendChild(kpi({
      icon: 'warehouse', label: 'ارزش موجودی محصول', value: F.num(invValue / scale), unit: unit,
      foot: '<span>پوشش ' + (monthsCover !== null ? F.num(monthsCover, 1) + ' ماه' : '—') + '</span>' + (shortCount ? IBP.ui.statusBadge('critical', shortCount + ' کمبود') : '')
    }));
    kpis.appendChild(kpi({
      icon: 'factory', label: 'بهره‌برداری ظرفیت (۳ ماه آینده)', value: F.pct(util3, 0),
      foot: hotLines ? IBP.ui.statusBadge(cap6.some(function (r) { return r.peak > (st.utilizationMax || 1); }) ? 'critical' : 'warning', hotLines + ' خط پربار') : IBP.ui.statusBadge('good', 'ظرفیت کافی')
    }));
    root.appendChild(kpis);

    var grid = h('div.dash-grid');
    root.appendChild(grid);

    /* ---------------- روند فروش و پیش‌بینی ---------------- */
    var trend = card('روند فروش، پیش‌بینی و بودجه', '۲۴ ماه گذشته و ۱۲ ماه آینده · پیش‌بینی اجماعی چرخه ' + J.label(cycle), { span: 8 });
    var seg = h('div.seg', { role: 'group', 'aria-label': 'واحد نمایش' });
    [['revenue', 'مبلغ'], ['qty', 'مقدار']].forEach(function (m) {
      seg.appendChild(h('button' + (state.mode === m[0] ? '.on' : ''), { type: 'button', 'aria-pressed': state.mode === m[0] ? 'true' : 'false', onclick: function () { state.mode = m[0]; drawTrend(); seg.querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', i === (m[0] === 'revenue' ? 0 : 1)); b.setAttribute('aria-pressed', b.classList.contains('on')); }); } }, m[1]));
    });
    trend.tools.appendChild(seg);
    var trendBox = h('div');
    trend.body.appendChild(trendBox);
    grid.appendChild(trend.el);
    function drawTrend() {
      var key = state.mode, all = hist24.concat(next12);
      var act = hist24.map(function (p) { return A.salesTotal(p, pf)[key]; });
      var fc = next12.map(function (p) { return A.forecastTotal(p, 'اجماعی', cycle, pf)[key]; });
      var bud = all.map(function (p) { var b = A.budgetTotal(p, pf)[key]; return b || null; });
      var actualSeries = act.concat(next12.map(function () { return null; }));
      var fcSeries = hist24.map(function (p, i) { return i === hist24.length - 1 ? act[i] : null; }).concat(fc);
      var money = key === 'revenue';
      C.line(trendBox, {
        labels: all.map(J.shortLabel),
        series: [
          { name: 'فروش واقعی', values: actualSeries, color: 'var(--series-1)', area: true },
          { name: 'پیش‌بینی اجماعی', values: fcSeries, color: 'var(--series-1)', dash: true },
          { name: 'بودجه', values: bud, color: 'var(--series-2)', endDot: false }
        ],
        format: money ? function (v) { return F.num(v / scale); } : F.compact,
        tipFormat: money ? function (v) { return F.money(v, { scale: scale }); } : function (v) { return F.num(v); },
        height: 280, markIndex: hist24.length, markLabel: 'شروع افق برنامه‌ریزی'
      });
    }
    drawTrend();

    /* ---------------- چرخه IBP ---------------- */
    var steps = S.all('cycleSteps').filter(function (s) { return s.cycle === cycle; }).sort(function (a, b) { return a.order - b.order; });
    var done = steps.filter(function (s) { return s.status === 'تکمیل'; }).length;
    var cyc = card('چرخه IBP ' + J.label(cycle), steps.length ? F.num(done) + ' از ' + F.num(steps.length) + ' مرحله تکمیل شده' : 'مراحل این چرخه تعریف نشده', { span: 4 });
    cyc.tools.appendChild(h('a.btn.btn-sm', { href: '#/cycle' }, 'مدیریت چرخه'));
    if (steps.length) {
      cyc.body.appendChild(h('div.progress', { role: 'progressbar', 'aria-valuenow': Math.round(done / steps.length * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: (done / steps.length * 100) + '%' } })));
      var ul = h('ol.steps');
      steps.forEach(function (s) {
        var cls = s.status === 'تکمیل' ? 'done' : s.status === 'در حال انجام' ? 'active' : s.status === 'تأخیر' ? 'late' : '';
        var lvl = s.status === 'تکمیل' ? 'good' : s.status === 'تأخیر' ? 'critical' : s.status === 'در حال انجام' ? 'info' : 'neutral';
        ul.appendChild(h('li.step',
          h('div.step-dot' + (cls ? '.' + cls : ''), { html: s.status === 'تکمیل' ? icon('check', 14) : String(s.order) }),
          h('div', h('div.step-name', s.name), h('div.step-meta', s.owner + (s.dueDate ? ' · سررسید ' + J.isoToJalaliStr(s.dueDate) : ''))),
          h('div', { html: IBP.ui.statusBadge(lvl, s.status) })
        ));
      });
      cyc.body.appendChild(ul);
    }
    grid.appendChild(cyc.el);

    /* ---------------- فروش بر اساس خانواده یا محصول ---------------- */
    var byFam = card(fam ? 'فروش محصولات ' + S.name('families', fam) : 'فروش بر اساس خانواده محصول', '۱۲ ماه اخیر · ' + unit, { span: 5 });
    var famItems;
    if (fam) {
      famItems = A.salesBy('product', ltm).filter(function (r) { return r.record && pf(r.record); }).slice(0, 10)
        .map(function (r) { return { label: r.name, value: r.revenue, color: (S.get('families', fam) || {}).color }; });
    } else {
      var famAgg = new Map();
      A.salesBy('product', ltm).forEach(function (r) {
        if (!r.record || (pf && !pf(r.record))) return;
        famAgg.set(r.record.familyId, (famAgg.get(r.record.familyId) || 0) + r.revenue);
      });
      famItems = S.all('families').map(function (f) { return { label: f.name, value: famAgg.get(f.id) || 0, color: f.color }; })
        .filter(function (x) { return x.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    }
    C.hbars(byFam.body, { items: famItems, format: function (v) { return F.num(v / scale); }, valueLabel: 'فروش (' + unit + ')' });
    grid.appendChild(byFam.el);

    /* ---------------- سهم کانال‌ها ---------------- */
    var byCh = card('سهم کانال‌های فروش', '۱۲ ماه اخیر', { span: 3 });
    var ltmSet = new Set(ltm), chAgg = new Map();
    S.all('salesActuals').forEach(function (s) {
      if (!ltmSet.has(s.period)) return;
      if (pf) { var p = S.get('products', s.productId); if (!p || !pf(p)) return; }
      var c = S.get('customers', s.customerId);
      var k = c ? c.channelId : null;
      chAgg.set(k, (chAgg.get(k) || 0) + s.revenue);
    });
    var chItems = S.all('channels').map(function (c, i) { return { label: c.name, value: chAgg.get(c.id) || 0, color: C.seriesColor(i) }; }).filter(function (x) { return x.value > 0; });
    C.donut(byCh.body, { items: chItems, format: function (v) { return F.money(v, { scale: scale }); }, valueLabel: 'فروش', center: { value: F.num(chItems.length), label: 'کانال' }, size: 150 });
    grid.appendChild(byCh.el);

    /* ---------------- دقت پیش‌بینی ---------------- */
    var accCard = card('دقت پیش‌بینی ماهانه', 'یک ماه قبل از وقوع (lag-1) · ۱ − WMAPE', { span: 4 });
    var accPer = acc12.byPeriod.filter(function (x) { return x.hasData; });
    if (accPer.length) {
      C.columns(accCard.body, {
        labels: accPer.map(function (x) { return J.shortLabel(x.period); }),
        series: [{ name: 'دقت پیش‌بینی', values: accPer.map(function (x) { return x.accuracy; }), color: 'var(--series-1)' }],
        format: function (v) { return F.pct(v, 0); }, height: 200,
        refLine: { value: accTarget, label: 'هدف ' + F.pct(accTarget, 0) }
      });
    } else accCard.body.appendChild(h('p.muted', 'سابقه پیش‌بینی برای سنجش دقت ثبت نشده است.'));
    grid.appendChild(accCard.el);

    /* ---------------- نقشه حرارتی ظرفیت ---------------- */
    var capCard = card('بار ظرفیت خطوط تولید', '۶ ماه آینده · ساعت مورد نیاز ÷ ساعت در دسترس', { span: 7, flush: true });
    var periods6 = J.range(cycle, 6);
    var tbl = h('table.heat');
    var hr = h('tr', h('th.res', 'خط / منبع'));
    periods6.forEach(function (p) { hr.appendChild(h('th', J.shortLabel(p))); });
    tbl.appendChild(h('thead', hr));
    var tb = h('tbody');
    var warn = st.utilizationWarn || 0.85, max = st.utilizationMax || 1;
    function heatStyle(u) {
      var step = u < 0.5 ? 1 : u < 0.65 ? 2 : u < 0.75 ? 3 : u < warn ? 4 : u <= max ? 5 : 6;
      return { background: 'var(--seq-' + step + ')', color: step >= 4 ? 'var(--seq-ink-dark)' : 'var(--seq-ink-light)' };
    }
    cap6.sort(function (a, b) { return b.peak - a.peak; }).forEach(function (r) {
      var tr = h('tr', h('th.res', { title: r.resource.name + ' — ' + S.name('plants', r.resource.plantId) }, r.resource.name));
      r.periods.forEach(function (p) {
        var over = p.util > max;
        var td = h('td' + (over ? '.over' : ''), { style: over ? null : heatStyle(p.util || 0), tabindex: 0 }, (over ? '! ' : '') + F.pct(p.util, 0));
        td.addEventListener('pointermove', function (e) {
          C.showTip(e, r.resource.name + ' · ' + J.label(p.period), [
            { label: 'بهره‌برداری', value: F.pct(p.util, 0) },
            { label: 'ساعت مورد نیاز', value: F.num(p.hours) },
            { label: 'ساعت در دسترس', value: F.num(p.capacity) }
          ]);
        });
        td.addEventListener('pointerleave', C.hideTip);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    capCard.body.appendChild(h('div.table-wrap', { style: { padding: '8px 14px 0' } }, tbl));
    capCard.body.appendChild(h('div.heat-legend', { html:
      '<span>کم</span><i style="background:var(--seq-1)"></i><i style="background:var(--seq-2)"></i><i style="background:var(--seq-3)"></i><i style="background:var(--seq-4)"></i><i style="background:var(--seq-5)"></i><span>' + F.pct(max, 0) + '</span>' +
      '<span style="margin-inline-start:12px">' + IBP.ui.statusBadge('critical', 'بالای ظرفیت') + '</span>' }));
    grid.appendChild(capCard.el);

    /* ---------------- هشدارها ---------------- */
    var alerts = A.alerts().filter(function (a) {
      if (a.productId && pf) { var p = S.get('products', a.productId); return p && pf(p); }
      if (a.resourceId) { var r = S.get('resources', a.resourceId); return r && resFilter(r); }
      return true;
    });
    var nCrit = alerts.filter(function (a) { return a.level === 'critical'; }).length;
    var alCard = card('هشدارها و استثناها', 'مواردی که در جلسات بازنگری باید بررسی شوند', { span: 5, flush: true });
    alCard.tools.appendChild(h('div.alert-summary', { html: IBP.ui.statusBadge('critical', F.num(nCrit) + ' بحرانی') + IBP.ui.statusBadge('warning', F.num(alerts.length - nCrit) + ' هشدار') }));
    var al = h('ul.alerts');
    if (!alerts.length) al.appendChild(h('li.alert-item', { html: IBP.ui.statusBadge('good', 'موردی برای بررسی وجود ندارد') }));
    alerts.slice(0, 40).forEach(function (a) {
      al.appendChild(h('li.alert-item',
        h('div.alert-icon.' + a.level, { html: icon(a.level === 'critical' ? 'critical' : 'alert', 16) }),
        h('div', h('div.alert-text', a.text), h('div.alert-detail', a.detail)),
        h('span.alert-type', a.type)
      ));
    });
    alCard.body.appendChild(al);
    grid.appendChild(alCard.el);

    /* ---------------- جدول محصولات ---------------- */
    var prodCard = card('عملکرد محصولات', 'فروش ۱۲ ماه، روند، دقت پیش‌بینی و پوشش موجودی', { span: 12, flush: true });
    var revBy = new Map(), trendBy = new Map();
    A.salesBy('product', ltm).forEach(function (r) { revBy.set(r.id, r.revenue); });
    var si = A.salesIndex();
    var accBy = new Map(); acc3.byProduct.forEach(function (r) { accBy.set(r.productId, r); });
    var covBy = new Map(); cov.forEach(function (c) { covBy.set(c.product.id, c); });
    var rows = S.all('products').filter(function (p) { return !pf || pf(p); });
    rows.forEach(function (p) { trendBy.set(p.id, ltm.map(function (per) { var m = si.get(per); var v = m && m.get(p.id); return v ? v.qty : 0; })); });
    var statusLabel = { critical: 'کمبود', warning: 'نزدیک ذخیره اطمینان', excess: 'مازاد', ok: 'مناسب' };
    var statusLevel = { critical: 'critical', warning: 'warning', excess: 'excess', ok: 'good' };
    IBP.grid(prodCard.body, {
      pageSize: 10, sortKey: 'rev', sortDir: -1,
      rows: function () { return rows; },
      onRowClick: function () { IBP.app.navigate('#/masterdata/products'); },
      filters: [{ label: 'وضعیت موجودی', options: Object.keys(statusLabel).map(function (k) { return { value: k, label: statusLabel[k] }; }), test: function (p, v) { var c = covBy.get(p.id); return c && c.status === v; } },
        { label: 'کلاس ABC', options: ['A', 'B', 'C'].map(function (x) { return { value: x, label: x }; }), test: function (p, v) { return p.abc === v; } }],
      columns: [
        { key: 'name', label: 'محصول', render: function (p) { return F.escape(p.name) + '<div class="cell-sub code">' + F.escape(p.code) + '</div>'; }, text: function (p) { return p.name + ' ' + p.code; } },
        { key: 'family', label: 'خانواده', value: function (p) { return S.name('families', p.familyId); }, render: function (p) { var f = S.get('families', p.familyId); return '<span class="swatch" style="background:' + F.escape(f ? f.color : '#999') + '"></span>' + F.escape(f ? f.name : '—'); } },
        { key: 'abc', label: 'ABC/XYZ', value: function (p) { return (p.abc || 'Z') + (p.xyz || 'Z'); }, render: function (p) { return '<span class="tag ' + (p.abc || '') + '">' + (p.abc || '—') + '</span> <span class="tag">' + (p.xyz || '—') + '</span>'; } },
        { key: 'rev', label: 'فروش ۱۲ ماه (' + unit + ')', align: 'num', value: function (p) { return revBy.get(p.id) || 0; }, render: function (p) { return F.num((revBy.get(p.id) || 0) / scale, 1); } },
        { key: 'trend', label: 'روند مقدار', sortable: false, render: function (p) { return C.sparkline(trendBy.get(p.id), { width: 90, height: 24 }); } },
        { key: 'acc', label: 'دقت پیش‌بینی', align: 'num', value: function (p) { var a = accBy.get(p.id); return a ? a.accuracy : null; }, render: function (p) { var a = accBy.get(p.id); return a && a.accuracy !== null ? F.pct(a.accuracy, 0) : '—'; } },
        { key: 'cover', label: 'پوشش موجودی', value: function (p) { var c = covBy.get(p.id); return c && isFinite(c.months) ? c.months : 999; }, render: function (p) {
          var c = covBy.get(p.id);
          if (!c) return '—';
          return IBP.ui.statusBadge(statusLevel[c.status], (isFinite(c.months) ? F.num(c.months, 1) + ' ماه' : '∞') + ' · ' + statusLabel[c.status]);
        } }
      ]
    });
    grid.appendChild(prodCard.el);
  }

  IBP.register('dashboard', { title: 'داشبورد مدیریتی', render: render });
})(window.IBP = window.IBP || {});
