/*
 * پورتفوی محصول: تحلیل سبد، ماتریس ABC-XYZ، پارتو، نقشه رشد و سودآوری، الگوی تقاضا،
 * چرخه عمر و رویدادهای سبد، تحلیل پیشرفته موتور پایتون و خروجی Excel کامل.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, C = IBP.charts, UI = IBP.ui, P = IBP.portfolio;
  var state = { family: '', plant: '', months: 12, cell: '', rec: '' };
  var engineCache = { key: null, data: null, error: null, pending: null };
  var ABC_COLOR = { A: 'var(--series-1)', B: 'var(--series-2)', C: 'var(--series-3)' };
  var TREND_LABEL = { up: 'صعودی معنادار', down: 'نزولی معنادار', flat: 'بدون روند معنادار' };

  function filterFn() {
    var fam = state.family && S.get('families', state.family) ? state.family : '';
    var plant = state.plant && S.get('plants', state.plant) ? state.plant : '';
    state.family = fam; state.plant = plant;
    if (!fam && !plant) return null;
    return function (p) { return (!fam || p.familyId === fam) && (!plant || p.plantId === plant); };
  }
  function scopeLabel() {
    return [state.family ? S.name('families', state.family) : 'همه خانواده‌ها', state.plant ? S.name('plants', state.plant) : 'همه کارخانه‌ها', state.months + ' ماه اخیر'].join(' · ');
  }
  function compute() { return P.compute({ months: state.months, filter: filterFn() }); }

  /* ---------------- موتور پایتون ---------------- */
  function engineKey() { return S.version + '|' + state.family + '|' + state.plant + '|' + state.months; }
  function loadEngine(R) {
    var key = engineKey();
    if (engineCache.key === key && (engineCache.data || engineCache.pending)) return engineCache.pending || Promise.resolve(engineCache.data);
    if (!IBP.engine.online()) return Promise.resolve(null);
    engineCache = { key: key, data: null, error: null, pending: null };
    engineCache.pending = IBP.engine.call('/portfolio/analyze', P.enginePayload(R), { timeout: 60000 }).then(function (res) {
      var byId = {};
      (res.products || []).forEach(function (p) { byId[p.id] = p; });
      var cl = {};
      (res.clusters || []).forEach(function (c) { cl[c.id] = c; });
      res.byId = byId; res.clusterById = cl;
      if (engineCache.key === key) { engineCache.data = res; engineCache.pending = null; }
      return res;
    }, function (e) {
      if (engineCache.key === key) { engineCache.error = e.message; engineCache.pending = null; }
      return null;
    });
    return engineCache.pending;
  }

  /* ---------------- خروجی Excel ---------------- */
  function tableColumns(E) {
    var cols = [
      { header: 'رتبه', key: 'rank', type: 'int' },
      { header: 'کد', value: function (r) { return r.product.code; }, type: 'code' },
      { header: 'محصول', value: function (r) { return r.product.name; }, type: 'text' },
      { header: 'خانواده', value: function (r) { return S.name('families', r.product.familyId); }, type: 'text' },
      { header: 'چرخه عمر', value: function (r) { return r.product.lifecycle || ''; }, type: 'text' },
      { header: 'فروش (ریال)', key: 'revenue', type: 'money' },
      { header: 'سهم فروش', key: 'share', type: 'pct' },
      { header: 'سهم تجمعی', key: 'cumShare', type: 'pct' },
      { header: 'مقدار فروش', key: 'qty', type: 'int' },
      { header: 'رشد حجمی سالانه', key: 'growth', type: 'pct' },
      { header: 'رشد اسمی فروش', key: 'revenueGrowth', type: 'pct' },
      { header: 'حاشیه سود ناخالص', key: 'margin', type: 'pct' },
      { header: 'ABC', key: 'abc', type: 'text' }, { header: 'XYZ', key: 'xyz', type: 'text' },
      { header: 'ضریب تغییرات (CV)', key: 'cv', type: 'dec' },
      { header: 'ADI', key: 'adi', type: 'dec' }, { header: 'CV²', key: 'cv2', type: 'dec' },
      { header: 'الگوی تقاضا', value: function (r) { return r.pattern ? P.PATTERNS[r.pattern].label : ''; }, type: 'text' },
      { header: 'توصیه', value: function (r) { return P.RECS[r.rec].label; }, type: 'text' }
    ];
    if (E) {
      cols.push(
        { header: 'بخش (خوشه‌بندی)', value: function (r) { var e = E.byId[r.id]; return e && E.clusterById[e.cluster] ? E.clusterById[e.cluster].label : ''; }, type: 'text' },
        { header: 'قدرت فصلی', value: function (r) { var e = E.byId[r.id]; return e ? e.seasonalStrength : null; }, type: 'pct' },
        { header: 'ماه اوج', value: function (r) { var e = E.byId[r.id]; return e && e.peakMonth ? J.MONTHS[e.peakMonth - 1] : ''; }, type: 'text' },
        { header: 'روند (آزمون آماری)', value: function (r) { var e = E.byId[r.id]; return e ? TREND_LABEL[e.trendDir] : ''; }, type: 'text' },
        { header: 'شیب روند سالانه', value: function (r) { var e = E.byId[r.id]; return e ? e.trendSlopePct : null; }, type: 'pct' },
        { header: 'p-value روند', value: function (r) { var e = E.byId[r.id]; return e ? e.trendPValue : null; }, type: 'dec' }
      );
    }
    return cols;
  }
  function exportAll() {
    var R = compute();
    return loadEngine(R).then(function (E) {
      var T = R.totals;
      var sheets = [];
      sheets.push({
        name: 'پورتفوی', title: 'تحلیل پورتفوی محصول', subtitle: scopeLabel(), freezeCols: 3,
        columns: tableColumns(E), rows: R.rows, totals: ['revenue', 'qty'],
        cellStyle: function (row, col) {
          if (col.header !== 'توصیه') return null;
          var lv = P.RECS[row.rec].level;
          return lv === 'critical' ? { fill: 'FFFBE7E7', color: 'FFB42323', bold: true } : lv === 'good' ? { fill: 'FFE5F5E5', color: 'FF067A06', bold: true } : lv === 'warning' ? { fill: 'FFFDF3DC', color: 'FF8A5A00' } : null;
        },
        charts: [{ type: 'scatter', title: 'رشد حجمی و حاشیه سود', x: 9, y: [11], anchor: 'B' + (R.rows.length + 8), xTitle: 'رشد حجمی', yTitle: 'حاشیه سود', width: 22, height: 11 }]
      });
      var mx = [];
      ['A', 'B', 'C'].forEach(function (a) { ['X', 'Y', 'Z'].forEach(function (x) { var c = R.matrix[a + x]; mx.push({ cell: a + x, count: c.count, revenue: c.revenue, share: c.share }); }); });
      sheets.push({ name: 'ماتریس ABC-XYZ', title: 'ماتریس ABC-XYZ', subtitle: 'ABC بر اساس سهم تجمعی فروش · XYZ بر اساس ضریب تغییرات تقاضا',
        columns: [{ header: 'خانه', key: 'cell', type: 'text' }, { header: 'تعداد محصول', key: 'count', type: 'int' }, { header: 'فروش (ریال)', key: 'revenue', type: 'money' }, { header: 'سهم فروش', key: 'share', type: 'pct' }],
        rows: mx, totals: ['count', 'revenue'], charts: [{ type: 'bar', title: 'سهم فروش خانه‌های ماتریس', x: 0, y: [3], anchor: 'G4' }] });
      sheets.push({ name: 'پارتو', title: 'منحنی پارتو فروش', subtitle: R.totals.top20Count + ' محصول برتر = ' + F.pct(T.top20Share, 0) + ' فروش',
        columns: [{ header: 'رتبه', key: 'rank', type: 'int' }, { header: 'محصول', value: function (r) { return r.product.name; }, type: 'text' }, { header: 'سهم فروش', key: 'share', type: 'pct' }, { header: 'سهم تجمعی', key: 'cumShare', type: 'pct' }],
        rows: R.rows, charts: [{ type: 'line', title: 'سهم تجمعی فروش', x: 0, y: [3], anchor: 'G4' }] });
      sheets.push({ name: 'الگوی تقاضا', title: 'الگوی تقاضا (Syntetos–Boylan)',
        columns: [{ header: 'الگو', key: 'label', type: 'text' }, { header: 'تعداد محصول', key: 'n', type: 'int' }, { header: 'توضیح', key: 'desc', type: 'text', width: 70 }],
        rows: Object.keys(P.PATTERNS).map(function (k) { return { label: P.PATTERNS[k].label, n: R.patterns[k], desc: P.PATTERNS[k].desc }; }),
        charts: [{ type: 'pie', title: 'توزیع الگوی تقاضا', x: 0, y: [1], anchor: 'E4' }] });
      sheets.push({ name: 'چرخه عمر', title: 'چرخه عمر محصولات',
        columns: [{ header: 'مرحله', key: 'stage', type: 'text' }, { header: 'تعداد محصول', key: 'count', type: 'int' }, { header: 'فروش (ریال)', key: 'revenue', type: 'money' }],
        rows: Object.keys(R.lifecycle).map(function (k) { return { stage: k, count: R.lifecycle[k].count, revenue: R.lifecycle[k].revenue }; }), totals: ['count', 'revenue'],
        charts: [{ type: 'bar', title: 'فروش بر اساس مرحله چرخه عمر', x: 0, y: [2], anchor: 'F4' }] });
      if (E) {
        sheets.push({ name: 'بخش‌بندی هوشمند', title: 'بخش‌بندی محصولات (K-Means — موتور پایتون)',
          columns: [{ header: 'بخش', key: 'label', type: 'text' }, { header: 'تعداد', key: 'count', type: 'int' }, { header: 'فروش (ریال)', key: 'revenue', type: 'money' }, { header: 'رشد میانگین', key: 'growth', type: 'pct' }, { header: 'حاشیه میانگین', key: 'margin', type: 'pct' }, { header: 'نوسان (CV)', key: 'cv', type: 'dec' }, { header: 'توضیح', key: 'description', type: 'text', width: 60 }],
          rows: E.clusters, charts: [{ type: 'pie', title: 'سهم فروش بخش‌ها', x: 0, y: [2], anchor: 'J4' }] });
        if (E.pairs && E.pairs.length) {
          sheets.push({ name: 'جایگزینی محصولات', title: 'جفت محصولات با رفتار جایگزین (هم‌خواری فروش)', subtitle: 'همبستگی منفی معنادار نوسانات فروش در یک خانواده',
            columns: [{ header: 'محصول اول', value: function (x) { return S.name('products', x.a); }, type: 'text' }, { header: 'محصول دوم', value: function (x) { return S.name('products', x.b); }, type: 'text' }, { header: 'ضریب همبستگی', key: 'r', type: 'dec' }, { header: 'p-value', key: 'p', type: 'dec' }],
            rows: E.pairs });
        }
      }
      return IBP.excel.exportTables({
        filename: 'تحلیل پورتفوی محصول', subtitle: scopeLabel(),
        summary: {
          title: 'خلاصه تحلیل پورتفوی محصول', pairs: [
            ['محدوده', scopeLabel()], ['تعداد محصول', T.skuCount], ['فروش دوره (ریال)', Math.round(T.revenue)],
            ['رشد حجمی سبد', T.volumeGrowth !== null ? F.signedPct(T.volumeGrowth) : '—', 'مقایسه با دوره مشابه قبل'],
            ['رشد اسمی فروش', T.revenueGrowth !== null ? F.signedPct(T.revenueGrowth) : '—', 'شامل اثر افزایش قیمت'],
            ['حاشیه سود ناخالص سبد', F.pct(T.margin)],
            ['سهم ۲۰٪ محصولات برتر', F.pct(T.top20Share, 0), T.top20Count + ' محصول'],
            ['محصولات کلاس C', T.cCount, 'سهم فروش ' + F.pct(T.cShare)],
            ['محصولات نیازمند تصمیم (حذف/توقف)', T.phaseOutCount],
            ['شاخص تمرکز هرفیندال (HHI)', E && E.concentration.hhi !== null ? F.num(E.concentration.hhi) : '—', 'بالای ۱۵۰۰ = تمرکز متوسط، بالای ۲۵۰۰ = تمرکز بالا'],
            ['ضریب جینی فروش', E && E.concentration.gini !== null ? F.num(E.concentration.gini, 2) : '—', '۰ = توزیع یکنواخت، ۱ = تمرکز کامل'],
            ['موتور تحلیل', E ? 'پایتون (تحلیل پیشرفته)' : 'محاسبه پایه برنامه']
          ]
        },
        sheets: sheets
      });
    });
  }
  IBP.portfolioExport = exportAll;

  /* ---------------- نمایش ---------------- */
  function render(root) {
    var R = compute(), T = R.totals;
    function rerender() { root.textContent = ''; render(root); }
    var engineOn = IBP.engine.online();

    root.appendChild(UI.pageHead({
      title: 'پورتفوی محصول',
      badge: engineOn ? UI.statusBadge('ai', 'تحلیل پیشرفته پایتون فعال') : UI.statusBadge('neutral', 'حالت پایه'),
      desc: 'سبد محصولات را از نظر سهم فروش، رشد، سودآوری، نوسان تقاضا و چرخه عمر بسنجید و برای هر محصول تصمیم بگیرید.',
      actions: [UI.excelButton('خروجی Excel تحلیل کامل', exportAll, { primary: true })]
    }));

    /* فیلترها */
    var famSel = h('select', { 'aria-label': 'خانواده' }, h('option', { value: '' }, 'همه خانواده‌ها'));
    S.all('families').forEach(function (f) { famSel.appendChild(h('option', { value: f.id }, f.name)); });
    famSel.value = state.family;
    var plantSel = h('select', { 'aria-label': 'کارخانه' }, h('option', { value: '' }, 'همه کارخانه‌ها'));
    S.all('plants').forEach(function (p) { plantSel.appendChild(h('option', { value: p.id }, p.name)); });
    plantSel.value = state.plant;
    var seg = h('div.seg', { role: 'group', 'aria-label': 'بازه زمانی' });
    [6, 12].forEach(function (m) {
      seg.appendChild(h('button' + (state.months === m ? '.on' : ''), { type: 'button', 'aria-pressed': state.months === m ? 'true' : 'false', onclick: function () { state.months = m; rerender(); } }, F.num(m) + ' ماه'));
    });
    famSel.addEventListener('change', function () { state.family = famSel.value; state.cell = ''; rerender(); });
    plantSel.addEventListener('change', function () { state.plant = plantSel.value; state.cell = ''; rerender(); });
    root.appendChild(h('div.filter-row', h('span.filter-pill', { html: icon('filter', 15) + '<span>محدوده</span>' }), famSel, plantSel, seg,
      h('span.scope-note', 'دوره تحلیل: ' + J.label(R.periods[0]) + ' تا ' + J.label(R.periods[R.periods.length - 1]))));

    /* شاخص‌ها */
    var kpis = h('div.kpis');
    kpis.appendChild(UI.kpi({ icon: 'box', label: 'محصولات دارای فروش', value: T.activeCount, format: function (v) { return F.num(v); }, foot: '<span>از ' + F.num(T.skuCount) + ' محصول تعریف‌شده</span>' }));
    kpis.appendChild(UI.kpi({ icon: 'pie', label: 'سهم ۲۰٪ محصولات برتر', value: T.top20Share, format: function (v) { return F.pct(v, 0); }, foot: '<span>' + F.num(T.top20Count) + ' محصول برتر از کل فروش</span>' }));
    kpis.appendChild(UI.kpi({ icon: 'layers', label: 'دنباله سبد (کلاس C)', value: T.cCount, format: function (v) { return F.num(v); }, foot: '<span>سهم فروش فقط ' + F.pct(T.cShare) + '</span>' }));
    kpis.appendChild(UI.kpi({ icon: 'trend', label: 'رشد حجمی سبد', value: T.volumeGrowth, format: function (v) { return F.signedPct(v); }, text: '—', foot: '<span>رشد اسمی فروش ' + F.signedPct(T.revenueGrowth) + '</span>' }));
    kpis.appendChild(UI.kpi({ icon: 'coins', label: 'حاشیه سود ناخالص سبد', value: T.margin, format: function (v) { return F.pct(v); }, text: '—', foot: '<span>میانگین وزنی بر اساس فروش</span>' }));
    kpis.appendChild(UI.kpi({ icon: 'flag', label: 'نیازمند تصمیم', value: T.phaseOutCount, format: function (v) { return F.num(v); }, foot: T.phaseOutCount ? UI.statusBadge('warning', 'حذف، توقف یا جایگزینی') : UI.statusBadge('good', 'موردی نیست') }));
    root.appendChild(kpis);

    var grid = h('div.dash-grid');
    root.appendChild(grid);

    /* ماتریس ABC-XYZ */
    var mxCard = UI.card({ title: 'ماتریس ABC-XYZ', sub: 'ارزش فروش × پایداری تقاضا · روی هر خانه کلیک کنید تا جدول فیلتر شود', icon: 'table', span: 5 });
    var mx = h('div.matrix');
    mx.appendChild(h('div'));
    ['X', 'Y', 'Z'].forEach(function (x) { mx.appendChild(h('div.mx-h', x === 'X' ? 'X · پایدار' : x === 'Y' ? 'Y · متغیر' : 'Z · نامنظم')); });
    var maxShare = Math.max.apply(null, Object.keys(R.matrix).map(function (k) { return R.matrix[k].share; }).concat([0.0001]));
    ['A', 'B', 'C'].forEach(function (a) {
      mx.appendChild(h('div.mx-h', a));
      ['X', 'Y', 'Z'].forEach(function (x) {
        var c = R.matrix[a + x], k = a + x;
        var step = c.count ? Math.max(1, Math.min(6, Math.ceil((c.share / maxShare) * 6))) : 0;
        var style = step ? { background: 'var(--seq-' + step + ')', color: step >= 4 ? 'var(--seq-ink-dark)' : 'var(--seq-ink-light)' } : { background: 'var(--surface-2)', color: 'var(--muted)' };
        var cell = h('button.mx-cell' + (state.cell === k ? '.sel' : ''), { type: 'button', style: style, 'aria-pressed': state.cell === k ? 'true' : 'false', onclick: function () { state.cell = state.cell === k ? '' : k; rerender(); } },
          h('div.mx-k', k), h('div.mx-v', F.num(c.count) + ' محصول'), h('div.mx-s', F.pct(c.share) + ' فروش'));
        cell.addEventListener('pointermove', function (e) { C.showTip(e, 'خانه ' + k, [{ label: 'تعداد محصول', value: F.num(c.count) }, { label: 'سهم فروش', value: F.pct(c.share) }, { label: 'فروش', value: F.money(c.revenue) }]); });
        cell.addEventListener('pointerleave', C.hideTip);
        mx.appendChild(cell);
      });
    });
    mxCard.body.appendChild(mx);
    mxCard.body.appendChild(h('div.heat-legend', { style: { padding: '12px 0 0' }, html: '<span>AX: محصولات کلیدی و قابل پیش‌بینی</span><span>·</span><span>CZ: کم‌ارزش و نامنظم (کاندید ساده‌سازی)</span>' }));
    grid.appendChild(mxCard.el);

    /* پارتو */
    var parCard = UI.card({ title: 'منحنی پارتو فروش', sub: F.num(T.top20Count) + ' محصول برتر (۲۰٪) معادل ' + F.pct(T.top20Share, 0) + ' فروش', icon: 'chart', span: 7 });
    C.columns(parCard.body, {
      labels: R.rows.map(function (r) { return String(r.rank); }),
      tipTitles: R.rows.map(function (r) { return r.rank + '. ' + r.product.name; }),
      series: [{ name: 'سهم فروش محصول', values: R.rows.map(function (r) { return r.share; }), colors: R.rows.map(function (r) { return ABC_COLOR[r.abc]; }) }],
      lines: [{ name: 'سهم تجمعی', values: R.rows.map(function (r) { return r.cumShare; }), color: 'var(--series-7)' }],
      format: function (v) { return F.pct(v, 0); }, tipFormat: function (v) { return F.pct(v); }, height: 250, maxValue: 1,
      refLine: { value: P.thresholds().a, label: 'مرز A (' + F.pct(P.thresholds().a, 0) + ')' }
    });
    parCard.body.appendChild(h('div.chart-legend', { style: { marginTop: '8px' }, html: '<span class="lg-item"><span class="lg-key rect" style="--c:var(--series-1)"></span>کلاس A</span><span class="lg-item"><span class="lg-key rect" style="--c:var(--series-2)"></span>کلاس B</span><span class="lg-item"><span class="lg-key rect" style="--c:var(--series-3)"></span>کلاس C</span>' }));
    grid.appendChild(parCard.el);

    /* نقشه رشد و سودآوری */
    var withGrowth = R.rows.filter(function (r) { return r.growth !== null && r.margin !== null; });
    var bubCard = UI.card({ title: 'نقشه رشد و سودآوری', sub: 'محور افقی: رشد حجمی سالانه · محور عمودی: حاشیه سود · اندازه: فروش · ' + F.num(R.rows.length - withGrowth.length) + ' محصول جدید بدون سابقه مقایسه حذف شده‌اند', icon: 'scatter', span: 8 });
    C.scatter(bubCard.body, {
      points: withGrowth.map(function (r) {
        return { x: Math.max(-0.8, Math.min(1.5, r.growth)), y: r.margin, size: r.revenue, color: ABC_COLOR[r.abc], label: r.product.name, id: r.id,
          rows: [{ label: 'فروش', value: F.money(r.revenue) }, { label: 'کلاس', value: r.abc + r.xyz }, { label: 'توصیه', value: P.RECS[r.rec].label }] };
      }),
      xFormat: function (v) { return F.pct(v, 0); }, yFormat: function (v) { return F.pct(v, 0); }, xLabel: 'رشد حجمی', yLabel: 'حاشیه سود',
      xTitle: 'رشد حجمی سالانه', yTitle: 'حاشیه سود ناخالص', height: 340,
      quadrants: { x: 0, y: T.margin, labels: ['ستاره‌ها: رشد و سود بالا', 'سودآوران بالغ', 'بازبینی یا حذف', 'رشد کم‌بازده'] },
      legend: [{ label: 'کلاس A', color: ABC_COLOR.A }, { label: 'کلاس B', color: ABC_COLOR.B }, { label: 'کلاس C', color: ABC_COLOR.C }],
      onClick: function (pt) { var p = S.get('products', pt.id); if (p) IBP.form.editRecord('products', p, function () { IBP.app.render(true); }); }
    });
    grid.appendChild(bubCard.el);

    /* الگوی تقاضا */
    var patCard = UI.card({ title: 'الگوی تقاضا', sub: 'طبقه‌بندی Syntetos–Boylan بر اساس ADI و CV²', icon: 'flask', span: 4 });
    var pg = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' } });
    ['erratic', 'lumpy', 'smooth', 'intermittent'].forEach(function (k) {
      var n = R.patterns[k], share = R.rows.length ? n / R.rows.length : 0;
      pg.appendChild(h('div.seg-card',
        h('div.sc-head', h('span', P.PATTERNS[k].label), h('span', { style: { marginInlineStart: 'auto', fontSize: '20px' } }, F.num(n))),
        h('div.progress', { style: { margin: '6px 0' } }, h('span', { style: { width: (share * 100) + '%' } })),
        h('div.sc-desc', P.PATTERNS[k].desc)));
    });
    patCard.body.appendChild(pg);
    patCard.body.appendChild(h('div.cell-sub', { style: { marginTop: '10px' } }, 'ADI = میانگین فاصله بین ماه‌های دارای فروش · مرزها: ADI = ۱٫۳۲ و CV² = ۰٫۴۹'));
    grid.appendChild(patCard.el);

    /* چرخه عمر */
    var lcCard = UI.card({ title: 'چرخه عمر محصولات', sub: 'تعداد و فروش هر مرحله', icon: 'cycle', span: 5 });
    var stages = Object.keys(R.lifecycle);
    C.hbars(lcCard.body, {
      items: stages.map(function (k, i) { return { label: k + ' (' + F.num(R.lifecycle[k].count) + ')', value: R.lifecycle[k].revenue, color: C.seriesColor(i), sub: [{ label: 'تعداد محصول', value: F.num(R.lifecycle[k].count) }] }; }),
      format: function (v) { return F.compact(v); }, valueLabel: 'فروش'
    });
    grid.appendChild(lcCard.el);

    /* رویدادهای پورتفوی */
    var evCard = UI.card({ title: 'رویدادهای سبد محصول', sub: 'معرفی‌های اخیر، توقف‌های برنامه‌ریزی‌شده و جایگزینی‌ها', icon: 'flag', span: 7, flush: true });
    var events = [];
    R.rows.forEach(function (r) {
      var p = r.product;
      if (p.lifecycle === 'معرفی' && p.launchDate) events.push({ date: p.launchDate, kind: 'launch', r: r });
      if (p.phaseOutDate) events.push({ date: p.phaseOutDate, kind: 'phaseout', r: r });
      else if (r.rec === 'candidate' || r.rec === 'drop') events.push({ date: null, kind: 'candidate', r: r });
    });
    events.sort(function (a, b) { return String(a.date || '9999').localeCompare(String(b.date || '9999')); });
    var evList = h('ul.alerts', { style: { maxHeight: '320px' } });
    if (!events.length) evList.appendChild(h('li.alert-item', { html: UI.statusBadge('good', 'رویدادی ثبت نشده است') }));
    events.slice(0, 30).forEach(function (ev) {
      var p = ev.r.product;
      var title = ev.kind === 'launch' ? 'معرفی محصول: ' + p.name : ev.kind === 'phaseout' ? 'توقف برنامه‌ریزی‌شده: ' + p.name : 'کاندید خروج از سبد: ' + p.name;
      var detail = ev.kind === 'launch' ? 'تاریخ معرفی ' + J.isoToJalaliStr(ev.date) + ' · فروش دوره ' + F.money(ev.r.revenue)
        : ev.kind === 'phaseout' ? 'تاریخ توقف ' + J.isoToJalaliStr(ev.date) + (p.successorId ? ' · جایگزین: ' + S.name('products', p.successorId) : ' · جایگزین تعیین نشده')
          : 'کلاس ' + ev.r.abc + ' · رشد ' + F.signedPct(ev.r.growth) + ' · حاشیه ' + F.pct(ev.r.margin);
      var lvl = ev.kind === 'launch' ? 'info' : 'warning';
      var item = h('li.alert-item',
        h('div.alert-icon.' + (lvl === 'info' ? 'warning' : 'critical'), { style: lvl === 'info' ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : null, html: icon(ev.kind === 'launch' ? 'sparkles' : 'flag', 16) }),
        h('div', h('div.alert-text', title), h('div.alert-detail', detail)),
        h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: function () { IBP.form.editRecord('products', p, function () { IBP.app.render(true); }); } }, 'ویرایش'));
      evList.appendChild(item);
    });
    evCard.body.appendChild(evList);
    grid.appendChild(evCard.el);

    /* تحلیل پیشرفته پایتون */
    var advCard = UI.card({ title: 'تحلیل پیشرفته (موتور پایتون)', sub: 'تجزیه روند و فصل (رگرسیون)، آزمون معناداری روند، خوشه‌بندی K-Means، شاخص تمرکز و تشخیص جایگزینی محصولات', icon: 'python', span: 12 });
    grid.appendChild(advCard.el);
    var tableHost = UI.card({ title: 'جدول تحلیل محصولات', sub: 'همه شاخص‌ها و توصیه اقدام برای هر محصول' + (state.cell ? ' · فیلتر: خانه ' + state.cell : ''), icon: 'list', span: 12, flush: true });
    if (state.cell) tableHost.tools.appendChild(h('button.btn.btn-sm.btn-soft', { type: 'button', onclick: function () { state.cell = ''; rerender(); } }, 'حذف فیلتر ' + state.cell));
    tableHost.tools.appendChild(UI.excelIconButton(exportAll, 'خروجی Excel'));
    grid.appendChild(tableHost.el);

    function drawTable(E) {
      tableHost.body.textContent = '';
      var rows = state.cell ? R.rows.filter(function (r) { return r.abc + r.xyz === state.cell; }) : R.rows;
      var cols = [
        { key: 'rank', label: '#', align: 'num', value: function (r) { return r.rank; } },
        { key: 'name', label: 'محصول', value: function (r) { return r.product.name; }, render: function (r) { return F.escape(r.product.name) + '<div class="cell-sub code">' + F.escape(r.product.code) + ' · ' + F.escape(S.name('families', r.product.familyId)) + '</div>'; }, text: function (r) { return r.product.name + ' ' + r.product.code; } },
        { key: 'revenue', label: 'فروش', align: 'num', value: function (r) { return r.revenue; }, render: function (r) { return '<span class="bar-cell"><span>' + F.compact(r.revenue) + '</span><span class="bar" style="width:' + Math.max(2, Math.round(r.share / (R.rows[0] ? R.rows[0].share : 1) * 60)) + 'px"></span></span>'; } },
        { key: 'share', label: 'سهم', align: 'num', value: function (r) { return r.share; }, render: function (r) { return F.pct(r.share); } },
        { key: 'growth', label: 'رشد حجمی', align: 'num', value: function (r) { return r.growth; }, render: function (r) { return r.growth === null ? '<span class="muted">جدید</span>' : '<span class="delta ' + (r.growth > 0.02 ? 'up-good' : r.growth < -0.02 ? 'down-bad' : 'flat') + '">' + F.signedPct(r.growth) + '</span>'; } },
        { key: 'margin', label: 'حاشیه', align: 'num', value: function (r) { return r.margin; }, render: function (r) { return F.pct(r.margin); } },
        { key: 'class', label: 'ABC/XYZ', value: function (r) { return r.abc + r.xyz; }, render: function (r) { return '<span class="tag ' + r.abc + '">' + r.abc + '</span> <span class="tag">' + r.xyz + '</span>'; } },
        { key: 'pattern', label: 'الگوی تقاضا', value: function (r) { return r.pattern ? P.PATTERNS[r.pattern].label : ''; } },
        { key: 'trend', label: 'روند ۱۲ ماه', sortable: false, render: function (r) { return C.sparkline(r.series.slice(-12), { width: 86, height: 24 }); } }
      ];
      if (E) {
        cols.push(
          { key: 'season', label: 'فصلی بودن', align: 'num', value: function (r) { var e = E.byId[r.id]; return e ? e.seasonalStrength : null; }, render: function (r) { var e = E.byId[r.id]; return e && e.seasonalStrength !== null ? F.pct(e.seasonalStrength, 0) + (e.peakMonth ? '<div class="cell-sub">اوج: ' + J.MONTHS[e.peakMonth - 1] + '</div>' : '') : '—'; } },
          { key: 'tdir', label: 'روند آماری', value: function (r) { var e = E.byId[r.id]; return e ? e.trendDir : ''; }, render: function (r) { var e = E.byId[r.id]; if (!e) return '—'; var lv = e.trendDir === 'up' ? 'good' : e.trendDir === 'down' ? 'critical' : 'neutral'; return UI.statusBadge(lv, TREND_LABEL[e.trendDir]) + (e.trendSlopePct !== null && e.trendDir !== 'flat' ? '<div class="cell-sub">' + F.signedPct(e.trendSlopePct) + ' در سال</div>' : ''); } },
          { key: 'cluster', label: 'بخش', value: function (r) { var e = E.byId[r.id]; return e && E.clusterById[e.cluster] ? E.clusterById[e.cluster].label : ''; } }
        );
      }
      cols.push({ key: 'rec', label: 'توصیه', value: function (r) { return P.RECS[r.rec].label; }, render: function (r) { return UI.statusBadge(P.RECS[r.rec].level, P.RECS[r.rec].label); } });
      IBP.grid(tableHost.body, {
        rows: function () { return rows; }, columns: cols, pageSize: 15, sortKey: 'rank', sortDir: 1,
        filters: [
          { label: 'توصیه', options: Object.keys(P.RECS).map(function (k) { return { value: k, label: P.RECS[k].label }; }), test: function (r, v) { return r.rec === v; } },
          { label: 'الگوی تقاضا', options: Object.keys(P.PATTERNS).map(function (k) { return { value: k, label: P.PATTERNS[k].label }; }), test: function (r, v) { return r.pattern === v; } },
          { label: 'چرخه عمر', options: IBP.schema.field('products', 'lifecycle').options.map(function (o) { return { value: o, label: o }; }), test: function (r, v) { return r.product.lifecycle === v; } }
        ],
        onRowClick: function (r) { IBP.form.editRecord('products', r.product, function () { IBP.app.render(true); }); }
      });
    }

    function drawAdvanced(E) {
      advCard.body.textContent = '';
      if (!E) {
        var err = engineCache.error;
        advCard.body.appendChild(h('div.engine-panel',
          h('div.ep-icon', { html: icon('python', 22) }),
          h('div', { style: { flex: 1, minWidth: '240px' } },
            h('div.ep-t', err ? 'خطا در تحلیل پیشرفته' : 'موتور تحلیل پایتون در دسترس نیست'),
            h('div.ep-d', { html: err ? F.escape(err) : 'برای فعال شدن تجزیه روند و فصل، آزمون روند، خوشه‌بندی و تشخیص جایگزینی، موتور را اجرا کنید: در پوشه <code>engine</code> فایل <code>start_engine.bat</code> (ویندوز) را اجرا کنید. تحلیل‌های پایه بالا بدون موتور هم کار می‌کنند.' })),
          h('button.btn.btn-sm', { type: 'button', html: icon('refresh', 15) + '<span>بررسی مجدد اتصال</span>', onclick: function () { IBP.engine.check().then(function (ok) { if (ok) rerender(); else IBP.ui.toast('موتور پایتون پاسخ نمی‌دهد', 'warning'); }); } })));
        return;
      }
      var conc = E.concentration || {};
      var top = h('div', { style: { display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' } },
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' }, html: C.ring(conc.gini || 0, { size: 68, label: conc.gini !== null && conc.gini !== undefined ? F.num(conc.gini, 2) : '—' }) + '<div><div style="font-weight:700">ضریب جینی فروش</div><div class="cell-sub">۰ = یکنواخت · ۱ = تمرکز کامل</div></div>' }),
        h('div', h('div', { style: { fontWeight: 700, fontSize: '20px' } }, conc.hhi !== null && conc.hhi !== undefined ? F.num(conc.hhi) : '—'), h('div.cell-sub', 'شاخص هرفیندال (HHI) · ' + (conc.hhi > 2500 ? 'تمرکز بالا' : conc.hhi > 1500 ? 'تمرکز متوسط' : 'متنوع'))),
        h('div', h('div', { style: { fontWeight: 700, fontSize: '20px' } }, E.summary.avgSeasonalStrength !== null ? F.pct(E.summary.avgSeasonalStrength, 0) : '—'), h('div.cell-sub', 'میانگین قدرت فصلی')),
        h('div', h('div', { style: { fontWeight: 700, fontSize: '20px' } }, F.num(E.summary.trendUp) + ' / ' + F.num(E.summary.trendDown)), h('div.cell-sub', 'روند صعودی / نزولی معنادار (p < ۰٫۰۵)')),
        h('span', { style: { marginInlineStart: 'auto' }, html: UI.statusBadge('ai', 'پایتون · ' + F.num(E.summary.decomposed) + ' سری تجزیه شد') }));
      advCard.body.appendChild(top);
      var segs = h('div.seg-cards');
      E.clusters.forEach(function (c, i) {
        segs.appendChild(h('div.seg-card',
          h('div.sc-head', h('span.swatch', { style: { background: C.seriesColor(i + 3) } }), h('span', c.label)),
          h('div.sc-stats', h('div', h('b', F.num(c.count)), 'محصول'), h('div', h('b', F.compact(c.revenue)), 'فروش'), h('div', h('b', F.signedPct(c.growth)), 'رشد'), h('div', h('b', F.pct(c.margin, 0)), 'حاشیه')),
          h('div.sc-desc', c.description)));
      });
      advCard.body.appendChild(segs);
      var pairBox = h('div', { style: { marginTop: '16px' } }, h('div', { style: { fontWeight: 700, marginBottom: '8px' } }, 'جایگزینی و هم‌خواری فروش'));
      if (!E.pairs || !E.pairs.length) pairBox.appendChild(h('div.cell-sub', 'جفت محصولی با رفتار جایگزین معنادار در یک خانواده یافت نشد.'));
      (E.pairs || []).forEach(function (pr) {
        pairBox.appendChild(h('div.alert-item', { style: { borderTop: '1px solid var(--border)', padding: '10px 0' } },
          h('div.alert-icon.warning', { html: icon('scenario', 16) }),
          h('div', h('div.alert-text', S.name('products', pr.a) + ' ↔ ' + S.name('products', pr.b)),
            h('div.alert-detail', 'همبستگی نوسانات ' + F.num(pr.r, 2) + ' (p = ' + F.num(pr.p, 4) + ') — افزایش فروش یکی با کاهش دیگری همراه است؛ در پیش‌بینی و تبلیغات با هم دیده شوند.'))));
      });
      advCard.body.appendChild(pairBox);
    }

    drawTable(engineCache.key === engineKey() ? engineCache.data : null);
    if (engineOn) {
      advCard.body.appendChild(h('div.engine-panel', h('div.ep-icon', { html: icon('cpu', 22) }), h('div', h('div.ep-t', 'در حال تحلیل با موتور پایتون…'), h('div.ep-d', 'تجزیه روند و فصل و خوشه‌بندی ' + F.num(R.rows.length) + ' محصول'))));
      loadEngine(R).then(function (E) { if (!advCard.el.isConnected) return; drawAdvanced(E); drawTable(E); });
    } else drawAdvanced(null);
  }
  IBP.register('portfolio', { title: 'پورتفوی محصول', render: render });
})(window.IBP = window.IBP || {});
