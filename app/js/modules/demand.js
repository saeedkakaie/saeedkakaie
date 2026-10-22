/*
 * برنامه‌ریزی تقاضا (فاز ۳):
 *   plan      برنامه اجماعی: جدول ماهانه شرکت ← خانواده ← محصول، ویرایش در هر سطح با تفکیک خودکار،
 *             واحد مقدار/تن/مبلغ، افق منجمد، سوابق تغییر، بازگشت، ورود و خروج Excel
 *   stat      اجرای پیش‌بینی آماری (پایتون یا موتور داخلی)، روش منتخب و خطای اعتبارسنجی هر محصول
 *   accuracy  دقت و ارزش افزوده پیش‌بینی (FVA): ساده، آماری و اجماعی
 *   events    تقویم مناسبت‌ها (رمضان و محرم قمری، کمپین‌ها) و اثر آن‌ها بر هر خانواده؛ برآورد آماری اثر
 *   ic        تقاضای درون‌گروهی: دریافت نیاز شرکت‌های خریدار هلدینگ از برنامه آن‌ها
 *   review    بسته جلسه بازنگری تقاضا: شکاف با بودجه و سال قبل، ریسک‌ها و تغییرات
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var TABS = [
    ['plan', 'برنامه اجماعی', 'table'], ['stat', 'پیش‌بینی آماری', 'cpu'], ['accuracy', 'دقت و ارزش افزوده', 'target'],
    ['events', 'مناسبت‌ها', 'flag'], ['ic', 'تقاضای درون‌گروهی', 'share'], ['review', 'بازنگری تقاضا', 'review']
  ];
  var UNITS = { qty: 'مقدار', ton: 'تن', rev: 'مبلغ' };
  var state = { unit: 'qty', months: 12, sel: 'all', open: {}, reason: 'سایر', note: '', accMonths: 6, statSel: null, icData: null };
  var undoStack = [];

  /* ======================= ابزار مشترک ======================= */
  function base() {
    var st = S.settings(), cycle = st.cyclePeriod;
    var horizon = st.horizonMonths || 18;
    return { st: st, cycle: cycle, fut: J.range(cycle, horizon), frozen: Math.max(0, st.frozenMonths || 0), hist12: J.range(J.addMonths(cycle, -12), 12) };
  }
  function activeProducts() {
    var fams = S.all('families'), order = {};
    fams.forEach(function (f, i) { order[f.id] = i; });
    return S.all('products').filter(function (p) { return p.active !== false && p.lifecycle !== 'توقف'; })
      .sort(function (a, b) { return (order[a.familyId] - order[b.familyId]) || String(a.code).localeCompare(String(b.code)); });
  }
  function conv(p, per, qty, unit) {
    if (qty === null || qty === undefined) return null;
    if (unit === 'ton') return qty * (p.unitWeightKg || 0) / 1000;
    if (unit === 'rev') return qty * A.priceAt(p, per) * (1 - A.avgDiscount());
    return qty;
  }
  function inv(p, per, val, unit) {
    if (unit === 'ton') return p.unitWeightKg ? val * 1000 / p.unitWeightKg : 0;
    if (unit === 'rev') { var k = A.priceAt(p, per) * (1 - A.avgDiscount()); return k ? val / k : 0; }
    return val;
  }
  function fmtUnit(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return '—';
    if (unit === 'rev') return F.num(v / (S.settings().displayScale || 1e9), 1);
    if (unit === 'ton') return F.num(v, v < 100 ? 1 : 0);
    return F.num(v);
  }
  function unitLabel(unit) { return unit === 'rev' ? F.moneyUnit() : unit === 'ton' ? 'تن' : 'واحد'; }
  function vmap(version, cycle) { return A.forecastMap(version, cycle); }
  function q(map, pid, per) { var m = map.get(pid); return m ? (m.get(per) || 0) : 0; }
  function actual(pid, per) { var m = A.salesIndex().get(per), v = m && m.get(pid); return v ? v.qty : 0; }
  function budgetMap() {
    var m = new Map();
    S.all('budgets').forEach(function (b) { m.set(b.productId + '|' + b.period, b.qty); });
    return m;
  }
  function nodeProducts(key, list) {
    list = list || activeProducts();
    if (!key || key === 'all') return list;
    var parts = key.split(':');
    if (parts[0] === 'f') return list.filter(function (p) { return p.familyId === parts[1]; });
    return list.filter(function (p) { return p.id === parts[1]; });
  }
  function nodeLabel(key) {
    if (!key || key === 'all') return S.settings().companyName + ' (کل شرکت)';
    var parts = key.split(':');
    return parts[0] === 'f' ? 'خانواده ' + S.name('families', parts[1]) : S.name('products', parts[1]);
  }
  function lunarBadge(per) {
    var ld = IBP.events.lunarDays(per), out = [];
    if (ld.ramadan / ld.days >= 0.25) out.push('رمضان');
    if (ld.muharram >= 4) out.push('محرم');
    return out;
  }

  /** ثبت گروهی مقادیر اجماعی + سوابق تغییر. changes: [{productId, period, qty}] */
  function applyConsensus(changes, log) {
    var b = base(), idx = new Map();
    S.all('forecasts').forEach(function (f) { if (f.version === 'اجماعی' && f.cycle === b.cycle) idx.set(f.productId + '|' + f.period, f); });
    var recs = [], undo = [];
    changes.forEach(function (c) {
      var k = c.productId + '|' + c.period, cur = idx.get(k);
      var qty = Math.max(0, Math.round(c.qty));
      undo.push({ productId: c.productId, period: c.period, qty: cur ? cur.qty : 0, existed: !!cur });
      if (cur) recs.push(Object.assign({}, cur, { qty: qty }));
      else recs.push({ id: S.uid(), version: 'اجماعی', cycle: b.cycle, period: c.period, productId: c.productId, qty: qty });
    });
    if (recs.length) S.bulkUpsert('forecasts', recs);
    var adjIds = [];
    (log || []).forEach(function (l) {
      var r = S.insert('demandAdjustments', Object.assign({ cycle: b.cycle, reason: state.reason, note: state.note, at: new Date().toISOString() }, l));
      adjIds.push(r.id);
    });
    undoStack.push({ changes: undo, adjIds: adjIds });
    if (undoStack.length > 30) undoStack.shift();
  }
  function undoLast() {
    var u = undoStack.pop();
    if (!u) { UI.toast('تغییری برای بازگشت نیست', 'info'); return; }
    var b = base(), idx = new Map();
    S.all('forecasts').forEach(function (f) { if (f.version === 'اجماعی' && f.cycle === b.cycle) idx.set(f.productId + '|' + f.period, f); });
    var recs = [], removeIds = [];
    u.changes.forEach(function (c) {
      var cur = idx.get(c.productId + '|' + c.period);
      if (!cur) return;
      if (c.existed) recs.push(Object.assign({}, cur, { qty: c.qty })); else removeIds.push(cur.id);
    });
    if (recs.length) S.bulkUpsert('forecasts', recs);
    if (removeIds.length) S.remove('forecasts', removeIds);
    if (u.adjIds.length) S.remove('demandAdjustments', u.adjIds);
    UI.toast('آخرین تغییر برگردانده شد', 'success');
  }

  /** تغییر مقدار یک گره (کل/خانواده/محصول) در یک ماه با تفکیک متناسب به محصولات */
  function setNodeValue(key, per, newVal, unit) {
    var b = base(), cons = vmap('اجماعی', b.cycle), stat = vmap('آماری', b.cycle);
    var prods = nodeProducts(key);
    var cur = prods.map(function (p) { return conv(p, per, q(cons, p.id, per), unit); });
    var tot = cur.reduce(function (s, v) { return s + v; }, 0);
    var weights = cur;
    if (tot <= 0) {
      weights = prods.map(function (p) { return conv(p, per, q(stat, p.id, per), unit); });
      if (weights.reduce(function (s, v) { return s + v; }, 0) <= 0) weights = prods.map(function () { return 1; });
    }
    var wsum = weights.reduce(function (s, v) { return s + v; }, 0) || 1;
    var changes = prods.map(function (p, i) { return { productId: p.id, period: per, qty: inv(p, per, newVal * weights[i] / wsum, unit) }; });
    var level = !key || key === 'all' ? 'شرکت' : key.charAt(0) === 'f' ? 'خانواده' : 'محصول';
    applyConsensus(changes, [{ period: per, level: level, target: nodeLabel(key), oldQty: Math.round(tot), newQty: Math.round(newVal), note: (state.note || '') + (unit !== 'qty' ? ' [واحد: ' + UNITS[unit] + ']' : '') }]);
  }

  /* ======================= خروجی Excel ======================= */
  function wideSheet(name, title, version, b, prods) {
    var map = version === 'budget' ? null : version === 'ly' ? null : vmap(version, b.cycle), bm = version === 'budget' ? budgetMap() : null;
    var cols = [{ header: 'کد کالا', value: function (p) { return p.code; }, type: 'code' }, { header: 'محصول', value: function (p) { return p.name; }, type: 'text' },
      { header: 'خانواده', value: function (p) { return S.name('families', p.familyId); }, type: 'text' }, { header: 'واحد', value: function (p) { return p.uom; }, type: 'text' }];
    b.fut.forEach(function (per) {
      cols.push({ header: J.year(per) + '/' + String(J.month(per)).padStart(2, '0'), type: 'int', value: function (p) {
        if (bm) return bm.get(p.id + '|' + per) || 0;
        if (version === 'ly') return actual(p.id, J.addMonths(per, -12));
        return q(map, p.id, per);
      } });
    });
    cols.push({ header: 'جمع', type: 'int', value: function (p) { return b.fut.reduce(function (s, per) { return s + (bm ? (bm.get(p.id + '|' + per) || 0) : version === 'ly' ? actual(p.id, J.addMonths(per, -12)) : q(map, p.id, per)); }, 0); } });
    return { name: name, title: title, subtitle: 'چرخه ' + J.label(b.cycle) + ' · مقادیر به واحد هر محصول', columns: cols, rows: prods, freezeCols: 2 };
  }
  function exportPlan() {
    var b = base(), prods = activeProducts();
    var tons = [];
    S.all('families').forEach(function (f) {
      var ps = prods.filter(function (p) { return p.familyId === f.id; });
      if (!ps.length) return;
      var cons = vmap('اجماعی', b.cycle), stat = vmap('آماری', b.cycle);
      var row = { family: f.name };
      row.cons = A.sum(ps, function (p) { return A.sum(b.fut.slice(0, 12), function (per) { return conv(p, per, q(cons, p.id, per), 'ton'); }); });
      row.stat = A.sum(ps, function (p) { return A.sum(b.fut.slice(0, 12), function (per) { return conv(p, per, q(stat, p.id, per), 'ton'); }); });
      row.ly = A.sum(ps, function (p) { return A.sum(b.fut.slice(0, 12), function (per) { return conv(p, per, actual(p.id, J.addMonths(per, -12)), 'ton'); }); });
      tons.push(row);
    });
    return IBP.excel.exportTables({
      filename: 'برنامه تقاضا ' + (S.settings().companyCode || '') + ' ' + J.label(b.cycle),
      sheets: [
        wideSheet('اجماعی', 'پیش‌بینی اجماعی (قابل ویرایش و بارگذاری مجدد)', 'اجماعی', b, prods),
        wideSheet('آماری', 'پیش‌بینی آماری', 'آماری', b, prods),
        wideSheet('بودجه', 'بودجه', 'budget', b, prods),
        wideSheet('سال قبل', 'فروش واقعی سال قبل (ماه‌های متناظر)', 'ly', b, prods),
        { name: 'تناژ خانواده‌ها', title: 'تناژ ۱۲ ماه آینده بر اساس خانواده', columns: [{ header: 'خانواده', key: 'family', type: 'text' }, { header: 'اجماعی (تن)', key: 'cons', type: 'num' }, { header: 'آماری (تن)', key: 'stat', type: 'num' }, { header: 'سال قبل (تن)', key: 'ly', type: 'num' },
          { header: 'رشد نسبت به سال قبل', value: function (r) { return r.ly ? r.cons / r.ly - 1 : null; }, type: 'pct' }], rows: tons, totals: ['cons', 'stat', 'ly'],
          charts: [{ type: 'bar', title: 'تناژ اجماعی و سال قبل', x: 0, y: [1, 3], anchor: 'H4' }] }
      ]
    });
  }
  function importPlan() {
    var input = h('input', { type: 'file', accept: '.xlsx' });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      IBP.excel.readFile(file).then(function (wb) {
        var sh = wb.sheets.filter(function (s) { return s.name.indexOf('اجماعی') >= 0; })[0] || wb.sheets[0];
        var b = base(), rows = sh.rows, hdrIdx = rows.findIndex(function (r) { return r && r.some(function (c) { return String(c || '').indexOf('کد کالا') >= 0; }); });
        if (hdrIdx < 0) throw new Error('ستون «کد کالا» در برگه «' + sh.name + '» یافت نشد');
        var hdr = rows[hdrIdx], codeCol = hdr.findIndex(function (c) { return String(c || '').indexOf('کد کالا') >= 0; });
        var perCols = [];
        hdr.forEach(function (c, i) {
          var pp = IBP.dataio.parseCell({ type: 'period' }, c);
          if (pp.v && b.fut.indexOf(pp.v) >= 0) perCols.push({ i: i, per: pp.v });
        });
        var frozenSet = new Set(b.fut.slice(0, b.frozen));
        var cons = vmap('اجماعی', b.cycle), changes = [], skippedFrozen = 0, unknown = [];
        for (var r = hdrIdx + 1; r < rows.length; r++) {
          var row = rows[r] || [], code = row[codeCol];
          if (code === null || code === undefined || String(code).trim() === '') continue;
          var p = S.byCode('products', String(code).trim());
          if (!p) { unknown.push(code); continue; }
          perCols.forEach(function (pc) {
            var v = IBP.dataio.parseCell({ type: 'number' }, row[pc.i]);
            if (v.v === null || v.v === undefined) return;
            if (Math.round(v.v) === q(cons, p.id, pc.per)) return;
            if (frozenSet.has(pc.per)) { skippedFrozen++; return; }
            changes.push({ productId: p.id, period: pc.per, qty: v.v });
          });
        }
        UI.modal({
          title: 'ورود برنامه اجماعی از Excel', size: 'sm',
          body: '<p class="confirm-text">' + F.num(perCols.length) + ' ماه شناسایی شد · <b>' + F.num(changes.length) + '</b> خانه تغییر کرده' +
            (skippedFrozen ? ' · ' + F.num(skippedFrozen) + ' تغییر در افق منجمد نادیده گرفته می‌شود' : '') + (unknown.length ? ' · کد ناشناخته: ' + F.escape(unknown.slice(0, 5).join('، ')) : '') + '</p>',
          actions: [{ label: 'انصراف' }, { label: 'اعمال تغییرات', primary: true, onClick: function () {
            if (!changes.length) return;
            var byPer = {};
            changes.forEach(function (c) { byPer[c.period] = (byPer[c.period] || 0) + 1; });
            state.reason = 'ورود از Excel';
            applyConsensus(changes, Object.keys(byPer).map(function (per) { return { period: +per, level: 'شرکت', target: 'ورود از فایل ' + file.name, newQty: byPer[per], note: F.num(byPer[per]) + ' محصول' }; }));
            UI.toast(F.num(changes.length) + ' مقدار اجماعی به‌روزرسانی شد', 'success');
            IBP.app.render(true);
          } }]
        });
      }).catch(function (e) { UI.toast(e.message, 'error'); });
    });
    input.click();
  }

  /* ======================= برنامه اجماعی ======================= */
  function renderPlan(root) {
    var b = base(), unit = state.unit, prods = activeProducts();
    var cons = vmap('اجماعی', b.cycle), stat = vmap('آماری', b.cycle);
    var months = b.fut.slice(0, state.months), frozenSet = new Set(b.fut.slice(0, b.frozen));
    var bm = budgetMap();
    function sumNode(key, per, fn) { return A.sum(nodeProducts(key, prods), function (p) { return conv(p, per, fn(p, per), unit) || 0; }); }
    var fCons = function (p, per) { return q(cons, p.id, per); }, fStat = function (p, per) { return q(stat, p.id, per); };
    var fBud = function (p, per) { return bm.get(p.id + '|' + per) || 0; }, fLy = function (p, per) { return actual(p.id, J.addMonths(per, -12)); };

    /* شاخص‌ها */
    var m12 = b.fut.slice(0, 12);
    var tc = A.sum(m12, function (per) { return sumNode('all', per, fCons); }), ts = A.sum(m12, function (per) { return sumNode('all', per, fStat); });
    var tl = A.sum(m12, function (per) { return sumNode('all', per, fLy); });
    // مقایسه با بودجه فقط در ماه‌هایی که بودجه دارند (معمولاً تا پایان سال مالی جاری)
    var budMonths = m12.filter(function (per) { return sumNode('all', per, fBud) > 0; });
    var tb = A.sum(budMonths, function (per) { return sumNode('all', per, fBud); }), tcb = A.sum(budMonths, function (per) { return sumNode('all', per, fCons); });
    var nAdj = S.all('demandAdjustments').filter(function (a) { return a.cycle === b.cycle; }).length;
    var kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'trend', label: 'اجماعی ۱۲ ماه آینده', value: unit === 'rev' ? tc / (S.settings().displayScale || 1e9) : tc, format: function (v) { return F.num(v); }, unit: unitLabel(unit), foot: '<span>' + J.label(m12[0]) + ' تا ' + J.label(m12[11]) + '</span>' }));
    kp.appendChild(UI.kpi({ icon: 'cpu', label: 'تفاوت با پیش‌بینی آماری', value: ts ? tc / ts - 1 : null, format: F.signedPct, text: '—', foot: '<span>اثر قضاوت فروش و بازاریابی</span>' }));
    kp.appendChild(UI.kpi({ icon: 'target', label: 'تفاوت با بودجه', value: tb ? tcb / tb - 1 : null, format: F.signedPct, text: '—', foot: tb ? '<span>' + F.num(budMonths.length) + ' ماه دارای بودجه (تا ' + J.label(budMonths[budMonths.length - 1]) + ')</span>' : '<span>بودجه‌ای برای این افق ثبت نشده</span>' }));
    kp.appendChild(UI.kpi({ icon: 'chart', label: 'رشد نسبت به سال قبل', value: tl ? tc / tl - 1 : null, format: F.signedPct, text: '—', foot: '<span>ماه‌های متناظر سال قبل</span>' }));
    kp.appendChild(UI.kpi({ icon: 'lock', label: 'افق منجمد', value: b.frozen, format: function (v) { return F.num(v) + ' ماه'; }, foot: '<span>ماه‌های قفل‌شده برای تغییر</span>' }));
    kp.appendChild(UI.kpi({ icon: 'edit', label: 'تغییرات این چرخه', value: nAdj, format: function (v) { return F.num(v); }, foot: undoStack.length ? '<span>' + F.num(undoStack.length) + ' مورد قابل بازگشت</span>' : '<span>سوابق در پایین صفحه</span>' }));
    root.appendChild(kp);

    /* ابزار */
    var unitSeg = h('div.seg', { role: 'group', 'aria-label': 'واحد' });
    Object.keys(UNITS).forEach(function (u) { unitSeg.appendChild(h('button' + (unit === u ? '.on' : ''), { type: 'button', onclick: function () { state.unit = u; IBP.app.render(true); } }, UNITS[u])); });
    var monSeg = h('div.seg', { role: 'group', 'aria-label': 'افق نمایش' });
    [6, 12, 18].forEach(function (m) { if (m <= b.fut.length) monSeg.appendChild(h('button' + (state.months === m ? '.on' : ''), { type: 'button', onclick: function () { state.months = m; IBP.app.render(true); } }, F.num(m) + ' ماه')); });
    var reasonSel = h('select', { 'aria-label': 'دلیل تغییر' });
    IBP.schema.field('demandAdjustments', 'reason').options.forEach(function (o) { reasonSel.appendChild(h('option', { value: o }, o)); });
    reasonSel.value = state.reason;
    reasonSel.addEventListener('change', function () { state.reason = reasonSel.value; });
    var noteIn = h('input', { type: 'text', placeholder: 'توضیح تغییر (اختیاری)', value: state.note, style: { width: '200px' } });
    noteIn.addEventListener('input', function () { state.note = noteIn.value; });
    root.appendChild(h('div.filter-row',
      h('span.filter-pill', { html: icon('filter', 15) + '<span>نمایش</span>' }), unitSeg, monSeg,
      h('span.filter-pill', { html: icon('edit', 15) + '<span>دلیل تغییر</span>' }), reasonSel, noteIn,
      h('span.spacer'),
      h('button.btn.btn-sm', { type: 'button', html: icon('refresh', 15) + '<span>بازگشت</span>', onclick: function () { undoLast(); IBP.app.render(true); } }),
      h('button.btn.btn-sm', { type: 'button', html: icon('upload', 15) + '<span>ورود از Excel</span>', onclick: importPlan }),
      UI.excelButton('خروجی Excel', exportPlan, { small: true })));

    var grid = h('div.dash-grid');
    root.appendChild(grid);

    /* نمودار گره انتخابی */
    var sel = state.sel || 'all';
    var chartCard = UI.card({ title: 'روند ' + nodeLabel(sel), sub: '۱۲ ماه گذشته و افق برنامه · ' + unitLabel(unit), icon: 'trend', span: 8 });
    var chartBox = h('div');
    chartCard.body.appendChild(chartBox);
    grid.appendChild(chartCard.el);
    var hist = b.hist12, all = hist.concat(months);
    var actS = hist.map(function (per) { return sumNode(sel, per, function (p, pp) { return actual(p.id, pp); }); });
    var lastAct = actS[actS.length - 1];
    C.line(chartBox, {
      labels: all.map(J.shortLabel), tipLabels: all.map(function (per) { var bdg = lunarBadge(per); return J.label(per) + (bdg.length ? ' · ' + bdg.join('، ') : ''); }),
      series: [
        { name: 'فروش واقعی', values: actS.concat(months.map(function () { return null; })), color: 'var(--series-1)', area: true },
        { name: 'اجماعی', values: hist.map(function (_, i) { return i === hist.length - 1 ? lastAct : null; }).concat(months.map(function (per) { return sumNode(sel, per, fCons); })), color: 'var(--series-1)', dash: true },
        { name: 'آماری', values: hist.map(function () { return null; }).concat(months.map(function (per) { return sumNode(sel, per, fStat); })), color: 'var(--series-3)' },
        { name: 'بودجه', values: all.map(function (per) { var v = sumNode(sel, per, fBud); return v || null; }), color: 'var(--series-2)', endDot: false },
        { name: 'سال قبل', values: hist.map(function () { return null; }).concat(months.map(function (per) { return sumNode(sel, per, fLy); })), color: 'var(--series-7)', endDot: false }
      ],
      format: function (v) { return unit === 'rev' ? F.compact(v) : F.compact(v); }, tipFormat: function (v) { return fmtUnit(v, unit) + ' ' + unitLabel(unit); },
      height: 280, markIndex: hist.length, markLabel: 'افق برنامه'
    });

    /* جزئیات انتخاب */
    var det = UI.card({ title: 'جزئیات', sub: nodeLabel(sel), icon: 'info', span: 4 });
    var selProds = nodeProducts(sel, prods);
    var run = S.meta('statRun');
    if (sel.charAt(0) === 'p' && selProds[0]) {
      var p0 = selProds[0], r0 = run && run.cycle === b.cycle && run.products ? run.products[p0.id] : null;
      det.body.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' } },
        h('div', { html: '<b>' + F.escape(p0.name) + '</b> <span class="code">' + F.escape(p0.code) + '</span>' }),
        h('div', { html: 'روش آماری: ' + (r0 ? UI.statusBadge('ai', r0.label) + (r0.score !== null && r0.score !== undefined ? ' <span class="cell-sub">خطای اعتبارسنجی ' + F.pct(r0.score) + '</span>' : '') : '<span class="muted">پیش‌بینی آماری هنوز اجرا نشده</span>') }),
        h('div', { html: 'وزن واحد: ' + F.num(p0.unitWeightKg || 0, 1) + ' کیلوگرم · ماندگاری ' + (p0.shelfLifeDays ? F.num(p0.shelfLifeDays) + ' روز' : '—') }),
        p0.intercompany ? h('div', { html: UI.statusBadge('info', 'کالای درون‌گروهی') }) : null));
    } else {
      det.body.appendChild(h('div.cell-sub', { style: { lineHeight: '2' } }, 'برای دیدن روند و جزئیات، روی نام شرکت، خانواده یا محصول در جدول کلیک کنید. با کلیک روی هر خانه ماه، مقدار را تغییر دهید؛ تغییر خانواده یا کل شرکت به‌نسبت سهم فعلی بین محصولات تقسیم می‌شود.'));
    }
    var adjs = S.all('demandAdjustments').filter(function (a) { return a.cycle === b.cycle; }).slice(-6).reverse();
    var al = h('ul.alerts', { style: { maxHeight: '190px', marginTop: '10px' } });
    adjs.forEach(function (a) {
      al.appendChild(h('li.alert-item', { style: { padding: '8px 0' } }, h('div.alert-icon', { style: { background: 'var(--accent-soft)', color: 'var(--accent)' }, html: icon('edit', 14) }),
        h('div', h('div.alert-text', a.target + ' · ' + J.label(a.period)), h('div.alert-detail', a.reason + (a.oldQty !== null && a.oldQty !== undefined ? ' · ' + F.num(a.oldQty) + ' ← ' + F.num(a.newQty) : '') + (a.note ? ' · ' + a.note : '')))));
    });
    if (adjs.length) det.body.appendChild(h('div', h('div', { style: { fontWeight: 700, marginTop: '12px', fontSize: '13px' } }, 'آخرین تغییرات'), al));
    grid.appendChild(det.el);

    /* جدول برنامه */
    var gcard = UI.card({ title: 'جدول برنامه اجماعی', sub: 'روی خانه‌ها کلیک کنید تا ویرایش شوند · ' + unitLabel(unit) + ' · خانه‌های کهربایی بیش از ۲۰٪ با پیش‌بینی آماری فاصله دارند', icon: 'table', span: 12, flush: true });
    grid.appendChild(gcard.el);
    var tbl = h('table.data-table.plan-table');
    var hr = h('tr', h('th.pt-name', 'شرکت / خانواده / محصول'));
    months.forEach(function (per) {
      var bd = lunarBadge(per);
      hr.appendChild(h('th.num' + (frozenSet.has(per) ? '.frozen' : ''), { title: frozenSet.has(per) ? 'افق منجمد' : '' },
        h('div', J.shortLabel(per)), bd.length ? h('div.ev-tag', bd.join(' · ')) : null, frozenSet.has(per) ? h('div', { html: icon('lock', 12), style: { display: 'inline-block', opacity: 0.6 } }) : null));
    });
    hr.appendChild(h('th.num', 'جمع'));
    tbl.appendChild(h('thead', hr));
    var tb2 = h('tbody');
    function addRow(key, label, sub, depth, toggle) {
      var tr = h('tr.pt-row.pt-d' + depth + (state.sel === key ? '.sel' : ''));
      var nameTd = h('td.pt-name', { style: { paddingInlineStart: (12 + depth * 18) + 'px' } },
        toggle ? h('button.pt-tog', { type: 'button', 'aria-label': 'باز و بسته کردن', html: icon(state.open[key] ? 'chevronDown' : 'chevronLeft', 14), onclick: function (e) { e.stopPropagation(); state.open[key] = !state.open[key]; IBP.app.render(true); } }) : null,
        h('span.pt-label', label), sub ? h('span.cell-sub', ' ' + sub) : null);
      nameTd.addEventListener('click', function () { state.sel = key; IBP.app.render(true); });
      tr.appendChild(nameTd);
      var tot = 0;
      months.forEach(function (per) {
        var v = sumNode(key, per, fCons), sv = sumNode(key, per, fStat);
        tot += v;
        var dev = sv > 0 ? v / sv - 1 : 0;
        var td = h('td.num.pt-cell' + (frozenSet.has(per) ? '.frozen' : '.ed') + (Math.abs(dev) > 0.2 && sv > 0 ? '.dev' : ''), { tabindex: frozenSet.has(per) ? null : 0, 'data-k': key, 'data-p': per, title: 'آماری: ' + fmtUnit(sv, unit) + (sv ? ' · فاصله ' + F.signedPct(dev) : '') }, fmtUnit(v, unit));
        tr.appendChild(td);
      });
      tr.appendChild(h('td.num.pt-total', fmtUnit(tot, unit)));
      tb2.appendChild(tr);
    }
    addRow('all', S.settings().companyName, S.settings().companyCode, 0, false);
    S.all('families').forEach(function (f) {
      var ps = prods.filter(function (p) { return p.familyId === f.id; });
      if (!ps.length) return;
      var fk = 'f:' + f.id;
      addRow(fk, f.name, F.num(ps.length) + ' محصول', 1, true);
      if (state.open[fk]) ps.forEach(function (p) { addRow('p:' + p.id, p.name, p.code + (p.intercompany ? ' · درون‌گروهی' : ''), 2, false); });
    });
    tbl.appendChild(tb2);
    tbl.addEventListener('click', function (e) { var td = e.target.closest('td.ed'); if (td && !td.querySelector('input')) editCell(td); });
    tbl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var td = e.target.closest('td.ed'); if (td && !td.querySelector('input')) { e.preventDefault(); editCell(td); } } });
    gcard.tools.appendChild(h('button.btn.btn-sm.btn-ghost', { type: 'button', onclick: function () { S.all('families').forEach(function (f) { state.open['f:' + f.id] = true; }); IBP.app.render(true); } }, 'باز کردن همه'));
    gcard.tools.appendChild(h('button.btn.btn-sm.btn-soft', { type: 'button', html: icon('cpu', 14) + '<span>آماری ← اجماعی</span>', onclick: function () { copyStat(sel); } }));
    gcard.tools.appendChild(h('button.btn.btn-sm.btn-soft', { type: 'button', html: icon('trend', 14) + '<span>تغییر درصدی</span>', onclick: function () { pctDialog(sel); } }));
    gcard.body.appendChild(h('div.table-wrap.plan-wrap', tbl));

    function editCell(td) {
      var key = td.getAttribute('data-k'), per = +td.getAttribute('data-p');
      var cur = sumNode(key, per, fCons);
      var inp = h('input.cell-input', { type: 'text', inputmode: 'decimal', dir: 'ltr', value: unit === 'rev' ? String(Math.round(cur / (S.settings().displayScale || 1e9) * 10) / 10) : String(Math.round(cur * 10) / 10) });
      td.textContent = '';
      td.appendChild(inp);
      inp.focus(); inp.select();
      var done = false;
      function commit(save) {
        if (done) return;
        done = true;
        var v = F.parseNumber(inp.value);
        if (save && v !== null && v >= 0) {
          if (unit === 'rev') v = v * (S.settings().displayScale || 1e9);
          if (Math.abs(v - cur) > 1e-6) { setNodeValue(key, per, v, unit); IBP.app.render(true); return; }
        }
        td.textContent = fmtUnit(cur, unit);
      }
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') commit(false); });
      inp.addEventListener('blur', function () { commit(true); });
    }
    function copyStat(key) {
      var editable = b.fut.slice(b.frozen);
      UI.confirm('پیش‌بینی آماری برای «' + nodeLabel(key) + '» در ' + F.num(editable.length) + ' ماه خارج از افق منجمد جایگزین اجماعی شود؟', { ok: 'جایگزینی' }).then(function (ok) {
        if (!ok) return;
        var ch = [];
        nodeProducts(key, prods).forEach(function (p) { editable.forEach(function (per) { ch.push({ productId: p.id, period: per, qty: q(stat, p.id, per) }); }); });
        applyConsensus(ch, [{ period: editable[0], level: key === 'all' ? 'شرکت' : key.charAt(0) === 'f' ? 'خانواده' : 'محصول', target: nodeLabel(key), note: 'جایگزینی با پیش‌بینی آماری (' + F.num(editable.length) + ' ماه)' }]);
        UI.toast('پیش‌بینی آماری جایگزین شد', 'success');
        IBP.app.render(true);
      });
    }
    function pctDialog(key) {
      var pct = h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', value: '5' });
      var from = h('select'), to = h('select');
      b.fut.forEach(function (per, i) {
        if (i < b.frozen) return;
        from.appendChild(h('option', { value: per }, J.label(per)));
        to.appendChild(h('option', { value: per }, J.label(per)));
      });
      to.value = String(b.fut[Math.min(b.fut.length - 1, b.frozen + 5)]);
      UI.modal({
        title: 'تغییر درصدی — ' + nodeLabel(key), size: 'sm',
        body: h('div.form-grid', h('div.field.wide', h('label', 'درصد تغییر (منفی برای کاهش)'), h('div.input-suffix', pct, h('span', '٪'))), h('div.field', h('label', 'از ماه'), from), h('div.field', h('label', 'تا ماه'), to)),
        actions: [{ label: 'انصراف' }, { label: 'اعمال', primary: true, onClick: function () {
          var k = F.parseNumber(pct.value);
          if (k === null) { UI.toast('درصد معتبر وارد کنید', 'warning'); return false; }
          var a = +from.value, z = +to.value, ch = [];
          if (z < a) { var t = a; a = z; z = t; }
          nodeProducts(key, prods).forEach(function (p) { b.fut.forEach(function (per) { if (per >= a && per <= z) ch.push({ productId: p.id, period: per, qty: q(cons, p.id, per) * (1 + k / 100) }); }); });
          applyConsensus(ch, [{ period: a, level: key === 'all' ? 'شرکت' : key.charAt(0) === 'f' ? 'خانواده' : 'محصول', target: nodeLabel(key), note: F.signedPct(k / 100) + ' از ' + J.label(a) + ' تا ' + J.label(z) }]);
          UI.toast('تغییر ' + F.signedPct(k / 100) + ' اعمال شد', 'success');
          IBP.app.render(true);
        } }]
      });
    }
  }

  /* ======================= پیش‌بینی آماری ======================= */
  function renderStat(root) {
    var b = base(), run = S.meta('statRun'), engineOn = IBP.engine.online();
    var valid = run && run.cycle === b.cycle;
    var panel = h('div.engine-panel', { style: { marginBottom: '16px' } },
      h('div.ep-icon', { html: icon(engineOn ? 'python' : 'cpu', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } },
        h('div.ep-t', engineOn ? 'موتور پایتون متصل: هولت-وینترز، رگرسیون با مناسبت‌ها، کراستون/TSB و ترکیب مدل‌ها' : 'موتور داخلی برنامه: روش‌های فصلی، روند میرا، رگرسیون مناسبت‌ها و کراستون'),
        h('div.ep-d', valid ? 'آخرین اجرا: ' + J.isoToJalaliStr(run.at.slice(0, 10)) + ' ' + run.at.slice(11, 16) + ' · ' + (run.engine === 'python' ? 'موتور پایتون' : 'موتور داخلی') + ' · ' + F.num(run.history) + ' ماه سابقه · ' + F.num(Object.keys(run.products).length) + ' محصول'
          : 'پیش‌بینی آماری این چرخه با داده تاریخی ساخته شده است. برای انتخاب خودکار بهترین روش هر محصول، پیش‌بینی را اجرا کنید.')),
      h('button.btn.btn-primary', { type: 'button', html: icon('play', 15) + '<span>اجرای پیش‌بینی آماری</span>', onclick: function () {
        var btn = this;
        btn.disabled = true; btn.querySelector('span').textContent = 'در حال محاسبه…';
        IBP.forecast.run().then(function (r) {
          UI.toast('پیش‌بینی آماری ' + F.num(Object.keys(r.results).length) + ' محصول با ' + (r.engine === 'python' ? 'موتور پایتون' : 'موتور داخلی') + ' انجام شد', 'success');
          IBP.app.render(true);
        }, function (e) { UI.toast(e.message, 'error'); btn.disabled = false; });
      } }));
    root.appendChild(panel);
    var prods = activeProducts(), stat = vmap('آماری', b.cycle), cons = vmap('اجماعی', b.cycle);
    var grid = h('div.dash-grid');
    root.appendChild(grid);

    var methods = {};
    if (valid) Object.keys(run.products).forEach(function (pid) { var l = run.products[pid].label; methods[l] = (methods[l] || 0) + 1; });
    var mCard = UI.card({ title: 'روش‌های انتخاب‌شده', sub: valid ? 'انتخاب خودکار با کمترین خطای اعتبارسنجی چرخشی' : 'پس از اجرا نمایش داده می‌شود', icon: 'cpu', span: 4 });
    if (valid) C.hbars(mCard.body, { items: Object.keys(methods).sort(function (a, c) { return methods[c] - methods[a]; }).map(function (k, i) { return { label: k, value: methods[k], color: C.seriesColor(i) }; }), format: function (v) { return F.num(v); }, valueLabel: 'تعداد محصول' });
    else mCard.body.appendChild(h('div.cell-sub', 'هنوز اجرا نشده است.'));
    grid.appendChild(mCard.el);

    var selId = state.statSel && S.get('products', state.statSel) ? state.statSel : (prods[0] && prods[0].id);
    var p = S.get('products', selId);
    var hist = J.range(J.addMonths(b.cycle, -24), 24), fut = b.fut.slice(0, 12);
    var lo = new Map(), hi = new Map();
    S.all('forecasts').forEach(function (f) { if (f.version === 'آماری' && f.cycle === b.cycle && f.productId === selId) { lo.set(f.period, f.lo); hi.set(f.period, f.hi); } });
    var pc = UI.card({ title: p ? p.name : '—', sub: 'فروش ۲۴ ماه، پیش‌بینی آماری با بازه ۸۰٪ و اجماعی', icon: 'trend', span: 8 });
    var psel = h('select', { 'aria-label': 'محصول' });
    prods.forEach(function (x) { psel.appendChild(h('option', { value: x.id }, x.code + ' — ' + x.name)); });
    psel.value = selId || '';
    psel.addEventListener('change', function () { state.statSel = psel.value; IBP.app.render(true); });
    pc.tools.appendChild(psel);
    var box = h('div');
    pc.body.appendChild(box);
    if (p) {
      var allP = hist.concat(fut), act = hist.map(function (per) { return actual(p.id, per); });
      C.line(box, {
        labels: allP.map(J.shortLabel), tipLabels: allP.map(function (per) { var bd = lunarBadge(per); return J.label(per) + (bd.length ? ' · ' + bd.join('، ') : ''); }),
        series: [
          { name: 'فروش واقعی', values: act.concat(fut.map(function () { return null; })), color: 'var(--series-1)', area: true },
          { name: 'آماری', values: hist.map(function (_, i) { return i === hist.length - 1 ? act[i] : null; }).concat(fut.map(function (per) { return q(stat, p.id, per); })), color: 'var(--series-3)' },
          { name: 'حد بالا ۸۰٪', values: hist.map(function () { return null; }).concat(fut.map(function (per) { var v = hi.get(per); return v === null || v === undefined ? null : v; })), color: 'var(--series-3)', dash: true, endDot: false },
          { name: 'حد پایین ۸۰٪', values: hist.map(function () { return null; }).concat(fut.map(function (per) { var v = lo.get(per); return v === null || v === undefined ? null : v; })), color: 'var(--series-3)', dash: true, endDot: false },
          { name: 'اجماعی', values: hist.map(function () { return null; }).concat(fut.map(function (per) { return q(cons, p.id, per); })), color: 'var(--series-2)' }
        ],
        format: F.compact, tipFormat: function (v) { return F.num(v) + ' ' + (p.uom || ''); }, height: 280, markIndex: hist.length, markLabel: 'افق'
      });
      var rp = valid ? run.products[p.id] : null;
      if (rp && rp.scores) {
        var sc = Object.keys(rp.scores).filter(function (k) { return rp.scores[k] !== null && rp.scores[k] !== undefined; });
        pc.body.appendChild(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }, html: sc.map(function (k) { return UI.statusBadge(k === rp.method ? 'good' : 'neutral', (IBP.forecast.METHODS[k] || k) + ': ' + F.pct(rp.scores[k])); }).join('') }));
      }
    }
    grid.appendChild(pc.el);

    var tCard = UI.card({ title: 'نتایج پیش‌بینی آماری محصولات', sub: 'خطای اعتبارسنجی = WMAPE پیش‌بینی ۱ تا ۳ ماهه در سه مبدأ گذشته', icon: 'list', span: 12, flush: true,
      exportFn: function () {
        return IBP.excel.exportTables({ filename: 'پیش‌بینی آماری ' + J.label(b.cycle), sheets: [wideSheet('آماری', 'پیش‌بینی آماری', 'آماری', b, prods), {
          name: 'روش‌ها', title: 'روش منتخب و خطای اعتبارسنجی', columns: [{ header: 'کد', value: function (x) { return x.code; }, type: 'code' }, { header: 'محصول', value: function (x) { return x.name; }, type: 'text' },
            { header: 'روش منتخب', value: function (x) { return valid && run.products[x.id] ? run.products[x.id].label : ''; }, type: 'text' },
            { header: 'خطای اعتبارسنجی', value: function (x) { return valid && run.products[x.id] ? run.products[x.id].score : null; }, type: 'pct' },
            { header: 'سهم ماه‌های بدون فروش', value: function (x) { return valid && run.products[x.id] ? run.products[x.id].zeroShare : null; }, type: 'pct' }], rows: prods }] });
      } });
    IBP.grid(tCard.body, {
      rows: function () { return prods; }, pageSize: 15,
      onRowClick: function (x) { state.statSel = x.id; IBP.app.render(true); window.scrollTo(0, 0); },
      columns: [
        { key: 'name', label: 'محصول', value: function (x) { return x.name; }, render: function (x) { return F.escape(x.name) + '<div class="cell-sub code">' + F.escape(x.code) + '</div>'; }, text: function (x) { return x.name + ' ' + x.code; } },
        { key: 'fam', label: 'خانواده', value: function (x) { return S.name('families', x.familyId); } },
        { key: 'm', label: 'روش منتخب', value: function (x) { return valid && run.products[x.id] ? run.products[x.id].label : ''; }, render: function (x) { var r = valid && run.products[x.id]; return r ? UI.statusBadge('ai', r.label) : '<span class="muted">—</span>'; } },
        { key: 's', label: 'خطای اعتبارسنجی', align: 'num', value: function (x) { var r = valid && run.products[x.id]; return r ? r.score : null; }, render: function (x) { var r = valid && run.products[x.id]; return r && r.score !== null && r.score !== undefined ? F.pct(r.score) : '—'; } },
        { key: 'n12', label: 'آماری ۱۲ ماه', align: 'num', value: function (x) { return A.sum(fut, function (per) { return q(stat, x.id, per); }); }, render: function (x) { return F.num(A.sum(fut, function (per) { return q(stat, x.id, per); })); } },
        { key: 'c12', label: 'اجماعی ۱۲ ماه', align: 'num', value: function (x) { return A.sum(fut, function (per) { return q(cons, x.id, per); }); }, render: function (x) { return F.num(A.sum(fut, function (per) { return q(cons, x.id, per); })); } },
        { key: 'gap', label: 'فاصله اجماعی', align: 'num', value: function (x) { var s = A.sum(fut, function (per) { return q(stat, x.id, per); }); return s ? A.sum(fut, function (per) { return q(cons, x.id, per); }) / s - 1 : null; }, render: function (x) { var s = A.sum(fut, function (per) { return q(stat, x.id, per); }); var g = s ? A.sum(fut, function (per) { return q(cons, x.id, per); }) / s - 1 : null; return g === null ? '—' : '<span class="delta ' + (Math.abs(g) > 0.2 ? 'up-bad' : 'flat') + '">' + F.signedPct(g) + '</span>'; } },
        { key: 'sp', label: 'روند ۲۴ ماه', sortable: false, render: function (x) { return C.sparkline(hist.map(function (per) { return actual(x.id, per); }), { width: 90, height: 24 }); } }
      ]
    });
    grid.appendChild(tCard.el);
  }

  /* ======================= دقت و FVA ======================= */
  function accuracyOf(kind, periods, prods) {
    var ids = new Set(prods.map(function (p) { return p.id; })), absE = 0, err = 0, act = 0, byP = {}, byPer = [];
    periods.forEach(function (per) {
      var map = kind === 'naive' ? null : vmap(kind === 'stat' ? 'آماری' : 'اجماعی', J.addMonths(per, -1));
      var pe = 0, pa = 0, has = false;
      prods.forEach(function (p) {
        if (!ids.has(p.id)) return;
        var a = actual(p.id, per), f;
        if (kind === 'naive') f = actual(p.id, J.addMonths(per, -1));
        else { var m = map.get(p.id); if (!m || !m.has(per)) return; f = m.get(per); }
        has = true;
        absE += Math.abs(f - a); err += f - a; act += a; pe += Math.abs(f - a); pa += a;
        var r = byP[p.id] = byP[p.id] || { abs: 0, err: 0, act: 0, errs: [] };
        r.abs += Math.abs(f - a); r.err += f - a; r.act += a; r.errs.push(f - a);
      });
      byPer.push({ period: per, accuracy: has && pa ? Math.max(0, 1 - pe / pa) : null });
    });
    Object.keys(byP).forEach(function (k) {
      var r = byP[k], mad = r.errs.reduce(function (s, e) { return s + Math.abs(e); }, 0) / Math.max(1, r.errs.length);
      r.accuracy = r.act ? Math.max(0, 1 - r.abs / r.act) : null; r.bias = r.act ? r.err / r.act : null;
      r.ts = mad ? r.errs.reduce(function (s, e) { return s + e; }, 0) / mad : 0;
    });
    return { accuracy: act ? Math.max(0, 1 - absE / act) : null, bias: act ? err / act : null, byPeriod: byPer, byProduct: byP };
  }
  function renderAccuracy(root) {
    var b = base(), prods = activeProducts(), n = state.accMonths;
    var periods = J.range(J.addMonths(b.cycle, -n), n);
    var V = { naive: accuracyOf('naive', periods, prods), stat: accuracyOf('stat', periods, prods), cons: accuracyOf('cons', periods, prods) };
    var seg = h('div.seg', { role: 'group', 'aria-label': 'بازه' });
    [3, 6, 12].forEach(function (m) { seg.appendChild(h('button' + (n === m ? '.on' : ''), { type: 'button', onclick: function () { state.accMonths = m; IBP.app.render(true); } }, F.num(m) + ' ماه')); });
    root.appendChild(h('div.filter-row', h('span.filter-pill', { html: icon('clock', 15) + '<span>بازه سنجش</span>' }), seg,
      h('span.scope-note', 'پیش‌بینی ثبت‌شده یک ماه قبل از وقوع (lag-1) · دقت = ۱ − WMAPE · FVA = بهبود دقت نسبت به مرحله قبل')));
    var kp = h('div.kpis');
    var fvaStat = V.stat.accuracy !== null && V.naive.accuracy !== null ? V.stat.accuracy - V.naive.accuracy : null;
    var fvaCons = V.cons.accuracy !== null && V.stat.accuracy !== null ? V.cons.accuracy - V.stat.accuracy : null;
    kp.appendChild(UI.kpi({ icon: 'clock', label: 'دقت پیش‌بینی ساده (ماه قبل)', value: V.naive.accuracy, format: function (v) { return F.pct(v, 0); }, text: '—', foot: '<span>معیار مبنا</span>' }));
    kp.appendChild(UI.kpi({ icon: 'cpu', label: 'دقت پیش‌بینی آماری', value: V.stat.accuracy, format: function (v) { return F.pct(v, 0); }, text: '—', foot: '<span>سوگیری ' + F.signedPct(V.stat.bias) + '</span>' }));
    kp.appendChild(UI.kpi({ icon: 'users', label: 'دقت پیش‌بینی اجماعی', value: V.cons.accuracy, format: function (v) { return F.pct(v, 0); }, text: '—', foot: '<span>سوگیری ' + F.signedPct(V.cons.bias) + '</span>' }));
    kp.appendChild(UI.kpi({ icon: 'sparkles', label: 'ارزش افزوده آماری (FVA)', value: fvaStat, format: function (v) { return (v >= 0 ? '+' : '') + F.num(v * 100, 1) + ' واحد'; }, text: '—', foot: '<span>آماری نسبت به ساده</span>' }));
    kp.appendChild(UI.kpi({ icon: 'users', label: 'ارزش افزوده قضاوت (FVA)', value: fvaCons, format: function (v) { return (v >= 0 ? '+' : '') + F.num(v * 100, 1) + ' واحد'; }, text: '—', foot: fvaCons !== null && fvaCons < 0 ? UI.statusBadge('warning', 'تعدیل‌ها دقت را کم کرده‌اند') : UI.statusBadge('good', 'تعدیل‌ها مفید بوده‌اند') }));
    var tsBad = Object.keys(V.cons.byProduct).filter(function (k) { return Math.abs(V.cons.byProduct[k].ts) > 4; }).length;
    kp.appendChild(UI.kpi({ icon: 'alert', label: 'سیگنال ردیابی خارج از کنترل', value: tsBad, format: function (v) { return F.num(v); }, foot: '<span>|TS| > ۴: سوگیری مداوم</span>' }));
    root.appendChild(kp);
    var grid = h('div.dash-grid');
    root.appendChild(grid);
    var lc = UI.card({ title: 'دقت ماهانه سه مرحله پیش‌بینی', sub: 'هر نقطه: دقت پیش‌بینی ثبت‌شده یک ماه قبل', icon: 'trend', span: 7 });
    C.line(lc.body, {
      labels: periods.map(J.shortLabel), tipLabels: periods.map(function (per) { var bd = lunarBadge(per); return J.label(per) + (bd.length ? ' · ' + bd.join('، ') : ''); }),
      series: [
        { name: 'ساده', values: V.naive.byPeriod.map(function (x) { return x.accuracy; }), color: 'var(--series-7)' },
        { name: 'آماری', values: V.stat.byPeriod.map(function (x) { return x.accuracy; }), color: 'var(--series-3)' },
        { name: 'اجماعی', values: V.cons.byPeriod.map(function (x) { return x.accuracy; }), color: 'var(--series-1)' }
      ], format: function (v) { return F.pct(v, 0); }, height: 260
    });
    grid.appendChild(lc.el);
    var famRows = S.all('families').map(function (f) {
      var ps = prods.filter(function (p) { return p.familyId === f.id; });
      var s = accuracyOf('stat', periods, ps), c = accuracyOf('cons', periods, ps);
      return { name: f.name, color: f.color, stat: s.accuracy, cons: c.accuracy, fva: s.accuracy !== null && c.accuracy !== null ? c.accuracy - s.accuracy : null };
    }).filter(function (r) { return r.cons !== null; });
    var fc = UI.card({ title: 'ارزش افزوده قضاوت به تفکیک خانواده', sub: 'دقت اجماعی منهای دقت آماری (واحد درصد)', icon: 'layers', span: 5 });
    var maxAbs = Math.max.apply(null, famRows.map(function (r) { return Math.abs(r.fva || 0); }).concat([0.01]));
    famRows.forEach(function (r) {
      var v = r.fva || 0;
      fc.body.appendChild(h('div.hb-row', h('div.hb-label', r.name), h('div.fva-track', h('div.fva-bar' + (v < 0 ? '.neg' : ''), { style: { width: (Math.abs(v) / maxAbs * 50) + '%' } })), h('div.hb-value', (v >= 0 ? '+' : '') + F.num(v * 100, 1))));
    });
    grid.appendChild(fc.el);
    var rows = prods.map(function (p) {
      var s = V.stat.byProduct[p.id], c = V.cons.byProduct[p.id], nv = V.naive.byProduct[p.id];
      return { p: p, naive: nv ? nv.accuracy : null, stat: s ? s.accuracy : null, cons: c ? c.accuracy : null, bias: c ? c.bias : null, ts: c ? c.ts : null, fva: s && c && s.accuracy !== null && c.accuracy !== null ? c.accuracy - s.accuracy : null };
    }).filter(function (r) { return r.cons !== null || r.stat !== null; });
    var tc = UI.card({ title: 'دقت به تفکیک محصول', sub: 'محصولات با FVA منفی یا سیگنال ردیابی بالا نیازمند بازبینی فرایند تعدیل هستند', icon: 'list', span: 12, flush: true,
      exportFn: function () {
        return IBP.excel.exportTables({ filename: 'دقت و ارزش افزوده پیش‌بینی', subtitle: F.num(n) + ' ماه اخیر',
          summary: { title: 'خلاصه دقت پیش‌بینی (' + F.num(n) + ' ماه)', pairs: [['دقت ساده', F.pct(V.naive.accuracy, 0)], ['دقت آماری', F.pct(V.stat.accuracy, 0)], ['دقت اجماعی', F.pct(V.cons.accuracy, 0)], ['FVA آماری', fvaStat === null ? '—' : F.num(fvaStat * 100, 1) + ' واحد درصد'], ['FVA قضاوت', fvaCons === null ? '—' : F.num(fvaCons * 100, 1) + ' واحد درصد'], ['سوگیری اجماعی', F.signedPct(V.cons.bias)]] },
          sheets: [
            { name: 'ماهانه', title: 'دقت ماهانه', columns: [{ header: 'ماه', value: function (r) { return J.label(r.period); }, type: 'text' }, { header: 'ساده', value: function (r, i) { return r.naive; }, type: 'pct' }, { header: 'آماری', key: 'stat', type: 'pct' }, { header: 'اجماعی', key: 'cons', type: 'pct' }],
              rows: periods.map(function (per, i) { return { period: per, naive: V.naive.byPeriod[i].accuracy, stat: V.stat.byPeriod[i].accuracy, cons: V.cons.byPeriod[i].accuracy }; }),
              charts: [{ type: 'line', title: 'دقت ماهانه', x: 0, y: [1, 2, 3], anchor: 'G4' }] },
            { name: 'محصولات', title: 'دقت و FVA محصولات', columns: [{ header: 'کد', value: function (r) { return r.p.code; }, type: 'code' }, { header: 'محصول', value: function (r) { return r.p.name; }, type: 'text' }, { header: 'دقت ساده', key: 'naive', type: 'pct' }, { header: 'دقت آماری', key: 'stat', type: 'pct' }, { header: 'دقت اجماعی', key: 'cons', type: 'pct' }, { header: 'FVA قضاوت', key: 'fva', type: 'pct' }, { header: 'سوگیری', key: 'bias', type: 'pct' }, { header: 'سیگنال ردیابی', key: 'ts', type: 'dec' }], rows: rows,
              cellStyle: function (r, c) { return c.header === 'FVA قضاوت' && r.fva < 0 ? { color: 'FFB42323', bold: true } : c.header === 'سیگنال ردیابی' && Math.abs(r.ts) > 4 ? { fill: 'FFFDF3DC', bold: true } : null; } }
          ] });
      } });
    IBP.grid(tc.body, {
      rows: function () { return rows; }, pageSize: 15, sortKey: 'fva', sortDir: 1,
      columns: [
        { key: 'name', label: 'محصول', value: function (r) { return r.p.name; }, render: function (r) { return F.escape(r.p.name) + '<div class="cell-sub code">' + F.escape(r.p.code) + '</div>'; } },
        { key: 'naive', label: 'ساده', align: 'num', value: function (r) { return r.naive; }, render: function (r) { return F.pct(r.naive, 0); } },
        { key: 'stat', label: 'آماری', align: 'num', value: function (r) { return r.stat; }, render: function (r) { return F.pct(r.stat, 0); } },
        { key: 'cons', label: 'اجماعی', align: 'num', value: function (r) { return r.cons; }, render: function (r) { return F.pct(r.cons, 0); } },
        { key: 'fva', label: 'FVA قضاوت', align: 'num', value: function (r) { return r.fva; }, render: function (r) { return r.fva === null ? '—' : '<span class="delta ' + (r.fva >= 0 ? 'up-good' : 'down-bad') + '">' + (r.fva >= 0 ? '+' : '') + F.num(r.fva * 100, 1) + '</span>'; } },
        { key: 'bias', label: 'سوگیری', align: 'num', value: function (r) { return r.bias; }, render: function (r) { return F.signedPct(r.bias); } },
        { key: 'ts', label: 'سیگنال ردیابی', align: 'num', value: function (r) { return r.ts; }, render: function (r) { return r.ts === null ? '—' : Math.abs(r.ts) > 4 ? UI.statusBadge('warning', F.num(r.ts, 1)) : F.num(r.ts, 1); } }
      ]
    });
    grid.appendChild(tc.el);
  }

  /* ======================= مناسبت‌ها ======================= */
  var estimateCache = null;
  function renderEvents(root) {
    var b = base(), periods = J.range(J.addMonths(b.cycle, -12), 12 + Math.min(18, b.fut.length));
    var cal = IBP.events.calendar(periods);
    root.appendChild(h('div.engine-panel', { style: { marginBottom: '16px' } }, h('div.ep-icon', { html: icon('flag', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } }, h('div.ep-t', 'مناسبت‌های قمری هر سال حدود ۱۱ روز جلو می‌آیند'),
        h('div.ep-d', 'رمضان و محرم در ماه‌های شمسی جابه‌جا می‌شوند و ضریب فصلی آن‌ها را نمی‌بیند؛ این‌جا شدت هر مناسبت در هر ماه از تقویم قمری ' + (IBP.events.usingUmmAlQura ? 'ام‌القری' : 'حسابی') + ' محاسبه و در پیش‌بینی آماری لحاظ می‌شود. نوروز، بازگشایی مدارس و تابستان در فصلی‌بودن مدل‌ها دیده می‌شوند.')),
      h('a.btn.btn-sm', { href: '#/masterdata/events', html: icon('edit', 14) + '<span>مدیریت مناسبت‌ها</span>' })));
    var grid = h('div.dash-grid');
    root.appendChild(grid);
    var calCard = UI.card({ title: 'تقویم مناسبت‌ها', sub: 'شدت هر مناسبت در هر ماه (سهم روزهای ماه)', icon: 'calendar', span: 12, flush: true,
      exportFn: function () {
        var cols = [{ header: 'مناسبت', value: function (r) { return r.event.name; }, type: 'text' }];
        periods.forEach(function (per, i) { cols.push({ header: J.label(per), value: function (r) { return r.values[i]; }, type: 'pct' }); });
        return IBP.excel.exportTables({ filename: 'تقویم مناسبت‌ها', sheets: [{ name: 'تقویم', title: 'شدت مناسبت‌ها در ماه‌های شمسی', columns: cols, rows: cal }] });
      } });
    var tbl = h('table.heat');
    var hr = h('tr', h('th.res', 'مناسبت'));
    periods.forEach(function (per) { hr.appendChild(h('th' + (per === b.cycle ? '.cur' : ''), J.shortLabel(per))); });
    tbl.appendChild(h('thead', hr));
    var tb = h('tbody');
    cal.forEach(function (row) {
      var tr = h('tr', h('th.res', row.event.name));
      row.values.forEach(function (v, i) {
        var step = v <= 0 ? 0 : v < 0.2 ? 2 : v < 0.45 ? 3 : v < 0.7 ? 4 : 5;
        var td = h('td', { style: step ? { background: 'var(--seq-' + step + ')', color: step >= 4 ? 'var(--seq-ink-dark)' : 'var(--seq-ink-light)' } : { color: 'var(--muted)' } }, v > 0 ? F.pct(v, 0) : '·');
        td.addEventListener('pointermove', function (e) { var ld = IBP.events.lunarDays(periods[i]); C.showTip(e, row.event.name + ' · ' + J.label(periods[i]), [{ label: 'شدت', value: F.pct(v, 0) }, { label: 'روزهای رمضان', value: F.num(ld.ramadan) }, { label: 'روزهای دهه محرم', value: F.num(ld.muharram) }]); });
        td.addEventListener('pointerleave', C.hideTip);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    calCard.body.appendChild(h('div.table-wrap', { style: { padding: '8px 14px 14px' } }, tbl));
    grid.appendChild(calCard.el);

    var impCard = UI.card({ title: 'اثر مناسبت‌ها بر خانواده‌ها', sub: 'درصد تغییر تقاضا در یک ماه کامل مناسبت · روی مقدار کلیک کنید تا ویرایش شود', icon: 'trend', span: 12, flush: true });
    var est = estimateCache && estimateCache.key === S.version ? estimateCache : null;
    impCard.tools.appendChild(h('button.btn.btn-sm.btn-primary', { type: 'button', html: icon('sparkles', 14) + '<span>برآورد از داده تاریخی</span>', onclick: function () {
      var btn = this; btn.disabled = true;
      IBP.forecast.estimateEvents().then(function (r) { estimateCache = { key: S.version, engine: r.engine, effects: r.effects }; IBP.app.render(true); }, function (e) { btn.disabled = false; UI.toast(e.message, 'error'); });
    } }));
    var events = S.all('events'), fams = S.all('families');
    var tbl2 = h('table.data-table');
    var hr2 = h('tr', h('th', { style: { padding: '10px 12px' } }, 'خانواده'));
    events.forEach(function (ev) { hr2.appendChild(h('th.num', { style: { padding: '10px 12px' } }, ev.name)); });
    tbl2.appendChild(h('thead', hr2));
    var tb2 = h('tbody');
    fams.forEach(function (f) {
      var tr = h('tr', h('td', h('span.swatch', { style: { background: f.color } }), f.name));
      events.forEach(function (ev) {
        var im = S.all('eventImpacts').filter(function (x) { return x.eventId === ev.id && x.familyId === f.id; })[0];
        var e = est ? est.effects.filter(function (x) { return x.familyId === f.id && ((x.event === 'ramadan' && ev.kind === 'رمضان') || (x.event === 'muharram' && ev.kind === 'محرم')); })[0] : null;
        var td = h('td.num.ed', { tabindex: 0 });
        td.innerHTML = (im ? '<b>' + F.signedPct(im.uplift) + '</b>' + (im.source === 'برآورد آماری' ? ' ' + UI.statusBadge('ai', 'آماری') : '') : '<span class="muted">—</span>') +
          (e ? '<div class="cell-sub">برآورد: ' + F.signedPct(e.uplift) + ' (' + F.signedPct(e.lo) + ' تا ' + F.signedPct(e.hi) + ')' + (e.p < 0.05 ? ' ✓' : ' · معنادار نیست') + '</div>' : '');
        td.addEventListener('click', function () {
          var inp = h('input.cell-input', { type: 'text', dir: 'ltr', value: im ? String(Math.round(im.uplift * 1000) / 10) : '0' });
          td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
          var done = false;
          function commit() {
            if (done) return; done = true;
            var v = F.parseNumber(inp.value);
            if (v !== null) {
              if (im) S.update('eventImpacts', im.id, { uplift: v / 100, source: 'کارشناسی' });
              else if (v !== 0) S.insert('eventImpacts', { eventId: ev.id, familyId: f.id, uplift: v / 100, source: 'کارشناسی' });
            }
            IBP.app.render(true);
          }
          inp.addEventListener('keydown', function (k) { if (k.key === 'Enter') commit(); if (k.key === 'Escape') { done = true; IBP.app.render(true); } });
          inp.addEventListener('blur', commit);
        });
        tr.appendChild(td);
      });
      tb2.appendChild(tr);
    });
    tbl2.appendChild(tb2);
    impCard.body.appendChild(h('div.table-wrap', tbl2));
    if (est) {
      var sig = est.effects.filter(function (x) { return x.p < 0.05; });
      impCard.body.appendChild(h('div.engine-panel', { style: { margin: '14px' } }, h('div.ep-icon', { html: icon(est.engine === 'python' ? 'python' : 'cpu', 20) }),
        h('div', { style: { flex: 1 } }, h('div.ep-t', 'برآورد آماری با ' + (est.engine === 'python' ? 'موتور پایتون (OLS با خطای استاندارد مقاوم)' : 'موتور داخلی'), ''),
          h('div.ep-d', 'مدل: log(تقاضا) ~ روند + اثر ماه + شدت رمضان + شدت محرم، روی مجموع فروش هر خانواده · ' + F.num(sig.length) + ' اثر معنادار (p < ۰٫۰۵) از ' + F.num(est.effects.length))),
        h('button.btn.btn-sm.btn-primary', { type: 'button', disabled: sig.length ? null : true, html: icon('check', 14) + '<span>اعمال اثرهای معنادار</span>', onclick: function () {
          sig.forEach(function (x) {
            var ev = events.filter(function (e2) { return e2.kind === (x.event === 'ramadan' ? 'رمضان' : 'محرم'); })[0];
            if (!ev) return;
            var im = S.all('eventImpacts').filter(function (y) { return y.eventId === ev.id && y.familyId === x.familyId; })[0];
            var val = Math.round(x.uplift * 100) / 100;
            if (im) S.update('eventImpacts', im.id, { uplift: val, source: 'برآورد آماری' });
            else S.insert('eventImpacts', { eventId: ev.id, familyId: x.familyId, uplift: val, source: 'برآورد آماری' });
          });
          UI.toast(F.num(sig.length) + ' اثر به‌روزرسانی شد؛ برای به‌کارگیری، پیش‌بینی آماری را دوباره اجرا کنید', 'success');
          IBP.app.render(true);
        } })));
    }
    grid.appendChild(impCard.el);
  }

  /* ======================= تقاضای درون‌گروهی ======================= */
  function loadIc() {
    var me = S.settings().companyCode, H = IBP.holding, b = base();
    var others = H.list().filter(function (c) { return c.code !== me; });
    return Promise.all(others.map(function (c) { return H.readCompany(c.code).catch(function () { return null; }); })).then(function (datas) {
      var rows = [];
      datas.forEach(function (d) {
        if (!d) return;
        var rec = d.records, cyc = d.settings.cyclePeriod;
        var mats = (rec.materials || []).filter(function (m) { return String(m.internalCompany || '').toUpperCase() === String(me).toUpperCase(); });
        if (!mats.length) return;
        var consMap = new Map();
        (rec.forecasts || []).forEach(function (f) { if (f.version === 'اجماعی' && f.cycle === cyc) consMap.set(f.productId + '|' + f.period, f.qty); });
        mats.forEach(function (m) {
          var target = S.byCode('products', m.internalProductCode);
          var kg = {};
          (rec.bom || []).filter(function (x) { return x.materialId === m.id; }).forEach(function (bl) {
            b.fut.forEach(function (per) { kg[per] = (kg[per] || 0) + (consMap.get(bl.productId + '|' + per) || 0) * bl.qtyPer * (1 + (bl.scrap || 0)); });
          });
          rows.push({ buyer: d.company, material: m, target: target, kg: kg, units: b.fut.map(function (per) { return target && target.unitWeightKg ? (kg[per] || 0) / target.unitWeightKg : null; }), buyerCycle: cyc });
        });
      });
      return { at: Date.now(), rows: rows };
    });
  }
  function renderIc(root) {
    var b = base(), me = S.settings().companyCode;
    var myIc = activeProducts().filter(function (p) { return p.intercompany; });
    var myMats = S.all('materials').filter(function (m) { return m.internalCompany; });
    root.appendChild(h('div.engine-panel', { style: { marginBottom: '16px' } }, h('div.ep-icon', { html: icon('share', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } }, h('div.ep-t', 'جریان‌های درون‌گروهی هلدینگ'),
        h('div.ep-d', 'نیاز شرکت‌های خریدار از برنامه اجماعی آن‌ها × فهرست مواد (BOM) محاسبه و به واحد کالای این شرکت تبدیل می‌شود. هر شرکت داده خودش را دارد؛ این صفحه فقط داده شرکت‌های دیگر را می‌خواند.')),
      h('button.btn.btn-primary', { type: 'button', html: icon('refresh', 15) + '<span>دریافت نیاز شرکت‌های خریدار</span>', onclick: function () {
        loadIc().then(function (d) { state.icData = d; IBP.app.render(true); }, function (e) { UI.toast(e.message, 'error'); });
      } })));
    var grid = h('div.dash-grid');
    root.appendChild(grid);
    var cons = vmap('اجماعی', b.cycle), months = b.fut.slice(0, 12);
    var data = state.icData;
    var sCard = UI.card({ title: 'این شرکت به‌عنوان تأمین‌کننده', sub: myIc.length ? F.num(myIc.length) + ' کالای درون‌گروهی' : 'کالای درون‌گروهی تعریف نشده است', icon: 'factory', span: 12, flush: true });
    grid.appendChild(sCard.el);
    if (!data) sCard.body.appendChild(h('div.cell-sub', { style: { padding: '16px 18px' } }, 'برای محاسبه، «دریافت نیاز شرکت‌های خریدار» را بزنید.'));
    else {
      var rows = data.rows.filter(function (r) { return r.target; });
      if (!rows.length) sCard.body.appendChild(h('div.cell-sub', { style: { padding: '16px 18px' } }, 'هیچ شرکتی از این شرکت (' + me + ') ماده درون‌گروهی دریافت نمی‌کند.'));
      var byTarget = {};
      rows.forEach(function (r) { (byTarget[r.target.id] = byTarget[r.target.id] || []).push(r); });
      var tbl = h('table.data-table');
      var hr = h('tr', h('th', { style: { padding: '10px 12px' } }, 'کالا / خریدار'));
      months.forEach(function (per) { hr.appendChild(h('th.num', { style: { padding: '10px 8px' } }, J.shortLabel(per))); });
      hr.appendChild(h('th.num', { style: { padding: '10px 12px' } }, 'جمع'));
      tbl.appendChild(h('thead', hr));
      var tb = h('tbody'), applyList = [];
      Object.keys(byTarget).forEach(function (tid) {
        var t = S.get('products', tid), list = byTarget[tid];
        var need = months.map(function (_, i) { return list.reduce(function (s, r) { return s + (r.units[i] || 0); }, 0); });
        list.forEach(function (r) {
          var tr = h('tr', h('td', { html: F.escape(r.buyer.name) + ' <span class="code">' + F.escape(r.buyer.code) + '</span><div class="cell-sub">' + F.escape(r.material.name) + ' · چرخه ' + J.label(r.buyerCycle) + '</div>' }));
          months.forEach(function (_, i) { tr.appendChild(h('td.num', F.num(r.units[i] || 0, 1))); });
          tr.appendChild(h('td.num', F.num(r.units.slice(0, 12).reduce(function (s, v) { return s + (v || 0); }, 0), 1)));
          tb.appendChild(tr);
        });
        var trN = h('tr.pt-d1', h('td', { html: '<b>جمع نیاز: ' + F.escape(t.name) + '</b> <span class="cell-sub">' + F.escape(t.uom || '') + '</span>' }));
        months.forEach(function (_, i) { trN.appendChild(h('td.num', h('b', F.num(need[i], 1)))); });
        trN.appendChild(h('td.num', h('b', F.num(need.reduce(function (s, v) { return s + v; }, 0), 1))));
        tb.appendChild(trN);
        var trC = h('tr', h('td', { html: 'اجماعی فعلی <span class="cell-sub">' + (t.intercompany ? 'کالای فقط درون‌گروهی' : 'فروش بیرونی هم دارد') + '</span>' }));
        months.forEach(function (per, i) {
          var c = q(cons, t.id, per), gap = need[i] ? c / need[i] - 1 : 0;
          trC.appendChild(h('td.num' + (Math.abs(gap) > 0.1 ? '.dev' : ''), F.num(c)));
        });
        trC.appendChild(h('td.num', F.num(A.sum(months, function (per) { return q(cons, t.id, per); }))));
        tb.appendChild(trC);
        if (t.intercompany) b.fut.forEach(function (per, i) { if (i >= b.frozen && i < months.length) applyList.push({ productId: t.id, period: per, qty: need[i] }); });
      });
      tbl.appendChild(tb);
      sCard.body.appendChild(h('div.table-wrap', tbl));
      if (applyList.length) sCard.tools.appendChild(h('button.btn.btn-sm.btn-primary', { type: 'button', html: icon('check', 14) + '<span>جایگزینی اجماعی کالاهای درون‌گروهی</span>', onclick: function () {
        state.reason = 'تقاضای درون‌گروهی';
        applyConsensus(applyList, [{ period: applyList[0].period, level: 'شرکت', target: 'کالاهای درون‌گروهی', note: 'از برنامه شرکت‌های خریدار (' + F.num(applyList.length) + ' خانه)' }]);
        UI.toast('برنامه اجماعی کالاهای درون‌گروهی از نیاز شرکت‌های خریدار به‌روز شد', 'success');
        IBP.app.render(true);
      } }));
      sCard.tools.appendChild(UI.excelIconButton(function () {
        var cols = [{ header: 'شرکت خریدار', value: function (r) { return r.buyer.name; }, type: 'text' }, { header: 'کالا', value: function (r) { return r.target.name; }, type: 'text' }, { header: 'ماده در شرکت خریدار', value: function (r) { return r.material.name; }, type: 'text' }];
        months.forEach(function (per, i) { cols.push({ header: J.label(per), value: function (r) { return r.units[i]; }, type: 'num', digits: 1 }); });
        return IBP.excel.exportTables({ filename: 'تقاضای درون‌گروهی ' + me, sheets: [{ name: 'نیاز خریداران', title: 'نیاز شرکت‌های خریدار از ' + S.settings().companyName, columns: cols, rows: rows }] });
      }));
    }
    var bCard = UI.card({ title: 'این شرکت به‌عنوان خریدار', sub: 'موادی که از شرکت‌های دیگر هلدینگ تأمین می‌شود', icon: 'truck', span: 12, flush: true });
    if (!myMats.length) bCard.body.appendChild(h('div.cell-sub', { style: { padding: '16px 18px' } }, 'این شرکت ماده درون‌گروهی ندارد.'));
    else {
      var reqRows = myMats.map(function (m) {
        var kg = months.map(function (per) {
          return S.all('bom').filter(function (x) { return x.materialId === m.id; }).reduce(function (s, bl) { return s + q(cons, bl.productId, per) * bl.qtyPer * (1 + (bl.scrap || 0)); }, 0);
        });
        return { m: m, kg: kg, sup: IBP.holding.byCode(m.internalCompany) };
      });
      IBP.grid(bCard.body, {
        rows: function () { return reqRows; }, pageSize: 10,
        columns: [
          { key: 'm', label: 'ماده', value: function (r) { return r.m.name; } },
          { key: 's', label: 'شرکت تأمین‌کننده', value: function (r) { return r.sup ? r.sup.name : r.m.internalCompany; }, render: function (r) { return F.escape(r.sup ? r.sup.name : r.m.internalCompany) + ' <span class="code">' + F.escape(r.m.internalCompany) + ':' + F.escape(r.m.internalProductCode || '') + '</span>'; } },
          { key: 'n3', label: 'نیاز ۳ ماه (تن)', align: 'num', value: function (r) { return A.sum(r.kg.slice(0, 3), function (v) { return v; }) / 1000; }, render: function (r) { return F.num(A.sum(r.kg.slice(0, 3), function (v) { return v; }) / 1000, 1); } },
          { key: 'n12', label: 'نیاز ۱۲ ماه (تن)', align: 'num', value: function (r) { return A.sum(r.kg, function (v) { return v; }) / 1000; }, render: function (r) { return F.num(A.sum(r.kg, function (v) { return v; }) / 1000, 1); } },
          { key: 'sp', label: 'روند نیاز', sortable: false, render: function (r) { return C.sparkline(r.kg, { width: 100, height: 24 }); } }
        ]
      });
    }
    grid.appendChild(bCard.el);
  }

  /* ======================= بازنگری تقاضا ======================= */
  function renderReview(root) {
    var b = base(), prods = activeProducts(), m12 = b.fut.slice(0, 12);
    var cons = vmap('اجماعی', b.cycle), stat = vmap('آماری', b.cycle), bm = budgetMap();
    var lo = new Map(), hi = new Map();
    S.all('forecasts').forEach(function (f) { if (f.version === 'آماری' && f.cycle === b.cycle) { lo.set(f.productId + '|' + f.period, f.lo); hi.set(f.productId + '|' + f.period, f.hi); } });
    function tons(p, fn) { return A.sum(m12, function (per) { return conv(p, per, fn(p, per), 'ton'); }); }
    function rev(p, fn) { return A.sum(m12, function (per) { return conv(p, per, fn(p, per), 'rev'); }); }
    var fC = function (p, per) { return q(cons, p.id, per); }, fS = function (p, per) { return q(stat, p.id, per); };
    var fB = function (p, per) { return bm.get(p.id + '|' + per) || 0; }, fL = function (p, per) { return actual(p.id, J.addMonths(per, -12)); };
    var budM = m12.filter(function (per) { return prods.some(function (p) { return fB(p, per) > 0; }); });
    var famRows = S.all('families').map(function (f) {
      var ps = prods.filter(function (p) { return p.familyId === f.id; });
      var consB = A.sum(ps, function (p) { return A.sum(budM, function (per) { return conv(p, per, fC(p, per), 'ton'); }); });
      return { f: f, cons: A.sum(ps, function (p) { return tons(p, fC); }), consB: consB, stat: A.sum(ps, function (p) { return tons(p, fS); }), bud: A.sum(ps, function (p) { return tons(p, fB); }), ly: A.sum(ps, function (p) { return tons(p, fL); }), consRev: A.sum(ps, function (p) { return rev(p, fC); }), budRev: A.sum(ps, function (p) { return rev(p, fB); }) };
    }).filter(function (r) { return r.cons || r.ly; });
    var T = famRows.reduce(function (a, r) { ['cons', 'consB', 'stat', 'bud', 'ly', 'consRev', 'budRev'].forEach(function (k) { a[k] = (a[k] || 0) + r[k]; }); return a; }, {});
    var risks = [];
    prods.forEach(function (p) {
      var c = A.sum(b.fut.slice(0, 6), function (per) { return q(cons, p.id, per); });
      var lsum = A.sum(b.fut.slice(0, 6), function (per) { var v = lo.get(p.id + '|' + per); return v === null || v === undefined ? NaN : v; });
      var hsum = A.sum(b.fut.slice(0, 6), function (per) { var v = hi.get(p.id + '|' + per); return v === null || v === undefined ? NaN : v; });
      if (!isFinite(lsum) || !isFinite(hsum)) return;
      if (c > hsum) risks.push({ p: p, kind: 'بالاتر از بازه آماری', c: c, bound: hsum, gap: c / hsum - 1, level: 'warning' });
      else if (c < lsum) risks.push({ p: p, kind: 'پایین‌تر از بازه آماری', c: c, bound: lsum, gap: c / lsum - 1, level: 'critical' });
    });
    var kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'stack', label: 'تناژ اجماعی ۱۲ ماه', value: T.cons, format: function (v) { return F.num(v); }, unit: 'تن', foot: '<span>' + J.label(m12[0]) + ' تا ' + J.label(m12[11]) + '</span>' }));
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'فروش ریالی اجماعی ۱۲ ماه', value: T.consRev / (S.settings().displayScale || 1e9), format: function (v) { return F.num(v); }, unit: F.moneyUnit() }));
    kp.appendChild(UI.kpi({ icon: 'target', label: 'شکاف تناژ با بودجه', value: T.bud ? T.consB / T.bud - 1 : null, format: F.signedPct, text: '—', foot: T.bud ? '<span>' + F.num(budM.length) + ' ماه دارای بودجه · ' + F.num(T.bud) + ' تن</span>' : '<span>بودجه‌ای برای این افق ثبت نشده</span>' }));
    kp.appendChild(UI.kpi({ icon: 'chart', label: 'رشد تناژ نسبت به سال قبل', value: T.ly ? T.cons / T.ly - 1 : null, format: F.signedPct, text: '—' }));
    kp.appendChild(UI.kpi({ icon: 'cpu', label: 'قضاوت نسبت به آماری', value: T.stat ? T.cons / T.stat - 1 : null, format: F.signedPct, text: '—', foot: '<span>اختلاف اجماعی با آماری</span>' }));
    kp.appendChild(UI.kpi({ icon: 'alert', label: 'محصولات خارج از بازه آماری', value: risks.length, format: function (v) { return F.num(v); }, foot: '<span>۶ ماه آینده، بازه ۸۰٪</span>' }));
    root.appendChild(kp);
    var grid = h('div.dash-grid');
    root.appendChild(grid);
    var ch = UI.card({ title: 'تناژ ماهانه: اجماعی، بودجه و سال قبل', sub: 'تن · ۱۲ ماه آینده', icon: 'chart', span: 7 });
    C.columns(ch.body, {
      labels: m12.map(J.shortLabel), tipTitles: m12.map(J.label),
      series: [{ name: 'اجماعی', values: m12.map(function (per) { return A.sum(prods, function (p) { return conv(p, per, fC(p, per), 'ton'); }); }), color: 'var(--series-1)' }],
      lines: [{ name: 'بودجه', values: m12.map(function (per) { var v = A.sum(prods, function (p) { return conv(p, per, fB(p, per), 'ton'); }); return v || null; }), color: 'var(--series-2)' },
        { name: 'سال قبل', values: m12.map(function (per) { return A.sum(prods, function (p) { return conv(p, per, fL(p, per), 'ton'); }); }), color: 'var(--series-7)' }],
      format: F.compact, tipFormat: function (v) { return F.num(v) + ' تن'; }, height: 260
    });
    grid.appendChild(ch.el);
    var rc = UI.card({ title: 'ریسک‌های برنامه', sub: 'اجماعی ۶ ماه آینده خارج از بازه ۸۰٪ پیش‌بینی آماری', icon: 'alert', span: 5, flush: true });
    var rl = h('ul.alerts');
    if (!risks.length) rl.appendChild(h('li.alert-item', { html: UI.statusBadge('good', 'همه محصولات داخل بازه آماری هستند') }));
    risks.sort(function (a, c) { return Math.abs(c.gap) - Math.abs(a.gap); }).slice(0, 20).forEach(function (r) {
      rl.appendChild(h('li.alert-item', h('div.alert-icon.' + r.level, { html: icon(r.level === 'critical' ? 'critical' : 'alert', 16) }),
        h('div', h('div.alert-text', r.p.name), h('div.alert-detail', r.kind + ' · اجماعی ' + F.num(r.c) + ' در برابر ' + F.num(r.bound) + ' (' + F.signedPct(r.gap) + ')'))));
    });
    rc.body.appendChild(rl);
    grid.appendChild(rc.el);
    function exportReview() {
      return IBP.excel.exportTables({
        filename: 'بسته جلسه بازنگری تقاضا ' + J.label(b.cycle),
        summary: { title: 'بازنگری تقاضا — ' + S.settings().companyName + ' — چرخه ' + J.label(b.cycle), pairs: [
          ['تناژ اجماعی ۱۲ ماه', Math.round(T.cons), 'تن'], ['تناژ بودجه', Math.round(T.bud || 0), 'تن · ' + budM.length + ' ماه دارای بودجه'], ['شکاف با بودجه', T.bud ? F.signedPct(T.consB / T.bud - 1) : '—', 'فقط ماه‌های دارای بودجه'],
          ['تناژ سال قبل', Math.round(T.ly || 0), 'تن'], ['رشد نسبت به سال قبل', T.ly ? F.signedPct(T.cons / T.ly - 1) : '—'],
          ['فروش ریالی اجماعی', Math.round(T.consRev), 'ریال'], ['قضاوت نسبت به آماری', T.stat ? F.signedPct(T.cons / T.stat - 1) : '—'], ['محصولات خارج از بازه آماری', risks.length]] },
        sheets: [
          { name: 'خانواده‌ها', title: 'تناژ ۱۲ ماه به تفکیک خانواده', columns: [{ header: 'خانواده', value: function (r) { return r.f.name; }, type: 'text' }, { header: 'اجماعی (تن)', key: 'cons', type: 'num' }, { header: 'آماری (تن)', key: 'stat', type: 'num' }, { header: 'بودجه (تن)', key: 'bud', type: 'num' }, { header: 'سال قبل (تن)', key: 'ly', type: 'num' },
            { header: 'شکاف با بودجه', value: function (r) { return r.bud ? r.consB / r.bud - 1 : null; }, type: 'pct' }, { header: 'رشد سالانه', value: function (r) { return r.ly ? r.cons / r.ly - 1 : null; }, type: 'pct' }], rows: famRows, totals: ['cons', 'stat', 'bud', 'ly'],
            charts: [{ type: 'bar', title: 'اجماعی، بودجه و سال قبل (تن)', x: 0, y: [1, 3, 4], anchor: 'J4' }] },
          { name: 'ریسک‌ها', title: 'محصولات خارج از بازه آماری', columns: [{ header: 'محصول', value: function (r) { return r.p.name; }, type: 'text' }, { header: 'وضعیت', key: 'kind', type: 'text' }, { header: 'اجماعی ۶ ماه', key: 'c', type: 'int' }, { header: 'مرز بازه', key: 'bound', type: 'int' }, { header: 'فاصله', key: 'gap', type: 'pct' }], rows: risks },
          { name: 'سوابق تغییر', title: 'تغییرات برنامه در این چرخه', columns: [{ header: 'ماه', value: function (a) { return J.label(a.period); }, type: 'text' }, { header: 'سطح', key: 'level', type: 'text' }, { header: 'مورد', key: 'target', type: 'text' }, { header: 'قبلی', key: 'oldQty', type: 'int' }, { header: 'جدید', key: 'newQty', type: 'int' }, { header: 'دلیل', key: 'reason', type: 'text' }, { header: 'توضیح', key: 'note', type: 'text' }],
            rows: S.all('demandAdjustments').filter(function (a) { return a.cycle === b.cycle; }) },
          wideSheet('اجماعی', 'پیش‌بینی اجماعی محصولات', 'اجماعی', b, prods)
        ]
      });
    }
    var fcard = UI.card({ title: 'خلاصه خانواده‌ها', sub: 'تن · ۱۲ ماه آینده', icon: 'layers', span: 12, flush: true, exportFn: exportReview, exportLabel: 'بسته Excel جلسه بازنگری تقاضا' });
    IBP.grid(fcard.body, {
      rows: function () { return famRows; }, pageSize: 20,
      columns: [
        { key: 'f', label: 'خانواده', value: function (r) { return r.f.name; }, render: function (r) { return '<span class="swatch" style="background:' + F.escape(r.f.color) + '"></span>' + F.escape(r.f.name); } },
        { key: 'cons', label: 'اجماعی', align: 'num', value: function (r) { return r.cons; }, render: function (r) { return F.num(r.cons); } },
        { key: 'stat', label: 'آماری', align: 'num', value: function (r) { return r.stat; }, render: function (r) { return F.num(r.stat); } },
        { key: 'bud', label: 'بودجه', align: 'num', value: function (r) { return r.bud; }, render: function (r) { return F.num(r.bud); } },
        { key: 'ly', label: 'سال قبل', align: 'num', value: function (r) { return r.ly; }, render: function (r) { return F.num(r.ly); } },
        { key: 'gb', label: 'شکاف با بودجه', align: 'num', value: function (r) { return r.bud ? r.consB / r.bud - 1 : null; }, render: function (r) { var g = r.bud ? r.consB / r.bud - 1 : null; return g === null ? '—' : '<span class="delta ' + (g >= 0 ? 'up-good' : 'down-bad') + '">' + F.signedPct(g) + '</span>'; } },
        { key: 'gl', label: 'رشد سالانه', align: 'num', value: function (r) { return r.ly ? r.cons / r.ly - 1 : null; }, render: function (r) { var g = r.ly ? r.cons / r.ly - 1 : null; return g === null ? '—' : '<span class="delta ' + (g >= 0 ? 'up-good' : 'down-bad') + '">' + F.signedPct(g) + '</span>'; } }
      ]
    });
    grid.appendChild(fcard.el);
    var actions = document.querySelector('#content .page-head .actions');
    if (actions) actions.appendChild(UI.excelButton('بسته Excel جلسه', exportReview, { primary: true }));
  }

  /* ======================= صفحه ======================= */
  function render(root, params) {
    var tab = TABS.some(function (t) { return t[0] === params[0]; }) ? params[0] : 'plan';
    var b = base();
    var tabs = h('div.tabbar', { role: 'tablist' });
    TABS.forEach(function (t) {
      tabs.appendChild(h('a.tab' + (t[0] === tab ? '.on' : ''), { href: '#/demand/' + t[0], role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', html: icon(t[2], 16) + '<span>' + t[1] + '</span>' }));
    });
    root.appendChild(UI.pageHead({
      title: 'برنامه‌ریزی تقاضا',
      badge: IBP.engine.online() ? UI.statusBadge('ai', 'موتور پایتون فعال') : UI.statusBadge('neutral', 'موتور داخلی'),
      desc: S.settings().companyName + ' (' + (S.settings().companyCode || '') + ') · چرخه ' + J.label(b.cycle) + ' · افق ' + F.num(b.fut.length) + ' ماه' + (b.frozen ? ' · ' + F.num(b.frozen) + ' ماه منجمد' : ''),
      actions: []
    }));
    root.appendChild(tabs);
    if (!S.count('products')) { root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.'))); return; }
    var host = h('div');
    root.appendChild(host);
    ({ plan: renderPlan, stat: renderStat, accuracy: renderAccuracy, events: renderEvents, ic: renderIc, review: renderReview })[tab](host);
  }

  IBP.demand = { applyConsensus: applyConsensus, setNodeValue: setNodeValue, accuracyOf: accuracyOf };
  IBP.register('demand', { title: 'برنامه‌ریزی تقاضا', render: render });
})(window.IBP = window.IBP || {});
