/*
 * گزارش‌ساز (فاز ۶): جدول محوری (Pivot) روی داده‌های برنامه با نمودار خودکار و خروجی Excel.
 *   مجموعه‌داده‌ها: فروش واقعی، پیش‌بینی‌ها، برنامه تولید، سودآوری برنامه، تصمیم‌ها و اقدامات
 *   سطر و ستون: هر بُعد مجموعه‌داده (ماه، خانواده، محصول، کانال، منطقه، ...)؛ شاخص: مقدار، تن، مبلغ، سود و ...
 *   تمرکز: کلیک روی هر سطر آن عضو را فیلتر و یک سطح پایین‌تر می‌رود (خانواده ← محصول)؛ مسیر بالای جدول برای بازگشت
 *   گزارش‌های آماده و ذخیره گزارش‌های کاربر
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var state = { cfg: null, crumbs: [] };

  var DRILL = { family: 'product', channel: 'customer', region: 'customer', year: 'month', area: 'title', status: 'title' };
  var DIM_LABEL = { month: 'ماه', year: 'سال', family: 'خانواده', product: 'محصول', customer: 'مشتری', channel: 'کانال', region: 'منطقه', tier: 'سطح مشتری', version: 'نسخه پیش‌بینی', abc: 'کلاس ABC', model: 'خط تولید', area: 'حوزه', status: 'وضعیت', kind: 'نوع', owner: 'مسئول', title: 'عنوان', cycle: 'جلسه' };

  /* ---------------- مجموعه‌داده‌ها ---------------- */
  function prodDims(p) { return { family: S.name('families', p.familyId), product: p.name, abc: p.abc || '—' }; }
  var DATASETS = {
    sales: {
      label: 'فروش واقعی', icon: 'chart', dims: ['month', 'year', 'family', 'product', 'customer', 'channel', 'region', 'tier', 'abc'],
      measures: { revenue: ['مبلغ فروش', 'money'], qty: ['مقدار', 'int'], tons: ['تن', 'num'], gross: ['سود ناخالص', 'money'], margin: ['حاشیه ناخالص', 'ratio:gross/revenue'] },
      facts: function () {
        var cu = {}, pr = {};
        S.all('customers').forEach(function (c) { cu[c.id] = c; });
        S.all('products').forEach(function (p) { pr[p.id] = p; });
        var ctx = A.ctx(), from = J.addMonths(ctx.cycle, -24);
        return S.all('salesActuals').filter(function (s) { return s.period >= from; }).map(function (s) {
          var p = pr[s.productId] || {}, c = cu[s.customerId] || {};
          return Object.assign({ month: s.period, year: J.year(s.period), customer: c.name || '—', channel: S.name('channels', c.channelId), region: S.name('regions', c.regionId), tier: c.tier || '—',
            revenue: s.revenue, qty: s.qty, tons: s.qty * (p.unitWeightKg || 0) / 1000,
            // بهای تمام‌شده دوره‌های گذشته با همان نرخ تورم قیمت‌ها به گذشته برده می‌شود تا حاشیه‌ها هم‌سنج باشند
            gross: s.revenue - s.qty * (p.unitCost || 0) * Math.pow(1 + ctx.inflation, J.diff(ctx.cycle, s.period)) }, prodDims(p));
        });
      }
    },
    forecast: {
      label: 'پیش‌بینی چرخه جاری', icon: 'trend', dims: ['version', 'month', 'family', 'product', 'abc'],
      measures: { qty: ['مقدار', 'int'], tons: ['تن', 'num'], revenue: ['مبلغ', 'money'] },
      facts: function () {
        var cyc = A.ctx().cycle, disc = A.avgDiscount(), pr = {};
        S.all('products').forEach(function (p) { pr[p.id] = p; });
        return S.all('forecasts').filter(function (f) { return f.cycle === cyc; }).map(function (f) {
          var p = pr[f.productId] || {};
          return Object.assign({ version: f.version, month: f.period, qty: f.qty, tons: f.qty * (p.unitWeightKg || 0) / 1000, revenue: p.unitPrice ? f.qty * A.priceAt(p, f.period) * (1 - disc) : 0 }, prodDims(p));
        });
      }
    },
    plan: {
      label: 'برنامه تولید و موجودی', icon: 'factory', dims: ['month', 'family', 'product', 'abc'],
      measures: { demand: ['تقاضا', 'int'], production: ['تولید', 'int'], inventory: ['موجودی پایان ماه', 'int'], shortage: ['کمبود', 'int'], prodTons: ['تولید (تن)', 'num'], invValue: ['ارزش موجودی', 'money'] },
      facts: function () {
        var pl = IBP.supply.current().plan, out = [];
        pl.rows.forEach(function (r) {
          pl.periods.forEach(function (per, t) {
            out.push(Object.assign({ month: per, demand: r.demand[t], production: r.production[t], inventory: r.inventory[t], shortage: r.shortage[t],
              prodTons: r.production[t] * (r.product.unitWeightKg || 0) / 1000, invValue: r.inventory[t] * (r.product.unitCost || 0) }, prodDims(r.product)));
          });
        });
        return out;
      }
    },
    profit: {
      label: 'سودآوری برنامه ۱۲ ماه', icon: 'coins', dims: ['family', 'product', 'abc'],
      measures: { revenue: ['درآمد', 'money'], cogs: ['بهای تمام‌شده', 'money'], gross: ['سود ناخالص', 'money'], margin: ['حاشیه ناخالص', 'ratio:gross/revenue'], lost: ['فروش ازدست‌رفته', 'money'] },
      facts: function () {
        var f = IBP.finance.current();
        return Object.keys(f.byProduct).map(function (pid) { var x = f.byProduct[pid]; return Object.assign({ revenue: x.revenue, cogs: x.cogs, gross: x.gross, lost: x.lost }, prodDims(x.product)); });
      }
    },
    actions: {
      label: 'تصمیم‌ها و اقدامات', icon: 'check', dims: ['area', 'status', 'kind', 'owner', 'cycle', 'title'],
      measures: { count: ['تعداد', 'int'] },
      facts: function () { return S.all('actions').map(function (a) { return { area: a.area || '—', status: a.status, kind: a.kind, owner: a.owner || '—', cycle: a.cycle, title: a.title, count: 1 }; }); }
    }
  };

  var PRESETS = [
    { name: 'فروش ماهانه خانواده‌ها', ds: 'sales', rows: 'family', cols: 'month', measure: 'revenue', icon: 'chart' },
    { name: 'کانال × منطقه', ds: 'sales', rows: 'channel', cols: 'region', measure: 'tons', icon: 'map' },
    { name: 'حاشیه سود مشتریان', ds: 'sales', rows: 'customer', cols: '', measure: 'margin', icon: 'users' },
    { name: 'آماری در برابر اجماعی', ds: 'forecast', rows: 'family', cols: 'version', measure: 'tons', icon: 'trend' },
    { name: 'برنامه تولید محصولات', ds: 'plan', rows: 'product', cols: 'month', measure: 'production', icon: 'factory' },
    { name: 'سودآوری خانواده‌ها', ds: 'profit', rows: 'family', cols: '', measure: 'gross', icon: 'coins' },
    { name: 'اقدامات به تفکیک حوزه و وضعیت', ds: 'actions', rows: 'area', cols: 'status', measure: 'count', icon: 'check' }
  ];

  /* ---------------- محاسبه جدول محوری ---------------- */
  var fcache = { v: -1 };
  /** ردیف‌های فروش و پیش‌بینی تا تغییر بعدی داده‌ها نگه داشته می‌شوند (برنامه و سودآوری هر بار از برنامه جاری) */
  function factsOf(key) {
    if (key !== 'sales' && key !== 'forecast') return DATASETS[key].facts();
    if (fcache.v !== S.version) fcache = { v: S.version };
    if (!fcache[key]) fcache[key] = DATASETS[key].facts();
    return fcache[key];
  }
  function pivot(cfg) {
    var ds = DATASETS[cfg.ds], facts = factsOf(cfg.ds);
    (cfg.filters || []).forEach(function (f) { facts = facts.filter(function (x) { return String(x[f.dim]) === String(f.value); }); });
    if (cfg.where) facts = facts.filter(cfg.where);
    var mdef = ds.measures[cfg.measure], ratio = /^ratio:(\w+)\/(\w+)$/.exec(mdef[1]);
    var rows = {}, cols = {}, cells = {}, rt = {}, ct = {}, tot = { a: 0, b: 0 };
    facts.forEach(function (x) {
      var r = x[cfg.rows], c = cfg.cols ? x[cfg.cols] : '__all';
      rows[r] = 1; cols[c] = 1;
      var a = ratio ? x[ratio[1]] || 0 : x[cfg.measure] || 0, b = ratio ? x[ratio[2]] || 0 : 0;
      var k = r + '\u0001' + c;
      var cell = cells[k] = cells[k] || { a: 0, b: 0 }; cell.a += a; cell.b += b;
      var R = rt[r] = rt[r] || { a: 0, b: 0 }; R.a += a; R.b += b;
      var Cc = ct[c] = ct[c] || { a: 0, b: 0 }; Cc.a += a; Cc.b += b;
      tot.a += a; tot.b += b;
    });
    var val = function (o) { return !o ? null : ratio ? (o.b ? o.a / o.b : null) : o.a; };
    var rowKeys = Object.keys(rows).sort(function (x, y) { return (val(rt[y]) || 0) - (val(rt[x]) || 0); });
    if (cfg.order === 'asc') rowKeys.reverse();
    if (cfg.rows === 'month' || cfg.rows === 'year' || cfg.rows === 'cycle') rowKeys.sort();
    var colKeys = Object.keys(cols);
    if (cfg.cols === 'month' || cfg.cols === 'year' || cfg.cols === 'cycle') colKeys.sort(); else colKeys.sort(function (x, y) { return (val(ct[y]) || 0) - (val(ct[x]) || 0); });
    if (cfg.top && rowKeys.length > cfg.top) rowKeys = rowKeys.slice(0, cfg.top);
    return { ds: ds, facts: facts.length, rowKeys: rowKeys, colKeys: colKeys, cell: function (r, c) { return val(cells[r + '\u0001' + c]); }, rowTotal: function (r) { return val(rt[r]); }, colTotal: function (c) { return val(ct[c]); }, total: val(tot), type: ratio ? 'pct' : mdef[1], mlabel: mdef[0] };
  }
  function keyLabel(dim, k) {
    if (k === '__all') return DATASETS[state.cfg.ds].measures[state.cfg.measure][0];
    if (dim === 'month' || dim === 'cycle') return J.label(+k);
    if (dim === 'year') return F.num(+k);
    return k;
  }
  function fmtV(v, type) {
    if (v === null || v === undefined) return '—';
    if (type === 'pct') return F.pct(v, 1);
    if (type === 'money') return F.num(v / (S.settings().displayScale || 1e9), 1);
    if (type === 'num') return F.num(v, v < 100 ? 1 : 0);
    return F.num(v);
  }

  function exportPivot(P, cfg) {
    var cols = [{ header: DIM_LABEL[cfg.rows] || cfg.rows, value: function (r) { return keyLabel(cfg.rows, r); }, type: 'text', width: 26 }];
    var t = P.type === 'pct' ? 'pct' : P.type === 'money' ? 'money' : P.type === 'num' ? 'num' : 'int';
    P.colKeys.forEach(function (c) { cols.push({ header: keyLabel(cfg.cols, c), value: function (r) { return P.cell(r, c); }, type: t }); });
    if (cfg.cols) cols.push({ header: 'جمع', value: function (r) { return P.rowTotal(r); }, type: t });
    return IBP.excel.exportTables({ filename: 'گزارش ' + (cfg.name || P.ds.label), sheets: [{ name: 'گزارش', title: (cfg.name || P.ds.label) + ' — ' + P.mlabel + (P.type === 'money' ? ' (ریال)' : ''), subtitle: (cfg.filters || []).map(function (f) { return (DIM_LABEL[f.dim] || f.dim) + ': ' + keyLabel(f.dim, f.value); }).join(' · '), columns: cols, rows: P.rowKeys, freezeCols: 1,
      charts: P.colKeys.length <= 12 ? [{ type: cfg.cols === 'month' ? 'line' : 'bar', x: 0, y: P.colKeys.map(function (_, i) { return i + 1; }), title: P.mlabel, limit: 15 }] : [] }] });
  }

  /* ---------------- صفحه ---------------- */
  function render(root) {
    if (!S.count('products')) { root.appendChild(UI.pageHead({ title: 'گزارش‌ها' })); root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.'))); return; }
    var saved = S.meta('reports') || [];
    if (!state.cfg) state.cfg = Object.assign({ filters: [], top: 25 }, PRESETS[0]);
    var cfg = state.cfg, ds = DATASETS[cfg.ds];
    root.appendChild(UI.pageHead({ title: 'گزارش‌ساز', badge: UI.statusBadge('info', 'جدول محوری تعاملی'), desc: S.settings().companyName + ' · مجموعه‌داده، سطر، ستون و شاخص را انتخاب کنید · کلیک روی هر سطر = تمرکز و رفتن به سطح پایین‌تر' }));

    // گزارش‌های آماده و ذخیره‌شده
    var pres = h('div.rep-presets');
    PRESETS.concat(saved).forEach(function (p, i) {
      var isSaved = i >= PRESETS.length;
      var on = p.name === cfg.name;
      var b = h('button.rep-preset' + (on ? '.on' : ''), { type: 'button', onclick: function () { state.cfg = Object.assign({ filters: [], top: 25 }, JSON.parse(JSON.stringify(p))); state.crumbs = []; IBP.app.render(true); } },
        h('span.rp-icon', { html: icon(p.icon || 'report', 16) }), h('span', p.name), isSaved ? h('span.rp-del', { title: 'حذف', html: icon('x', 12), onclick: function (e) { e.stopPropagation(); S.setMeta('reports', saved.filter(function (x) { return x.name !== p.name; })); IBP.app.render(true); } }) : null);
      pres.appendChild(b);
    });
    root.appendChild(pres);

    // پیکربندی
    var mk = function (label, options, value, onChange) {
      var s = h('select', { 'aria-label': label });
      options.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
      s.value = value;
      s.addEventListener('change', function () { onChange(s.value); state.cfg.name = 'گزارش سفارشی'; IBP.app.render(true); });
      return h('label.bt-ctl', h('span', label), s);
    };
    var dimOpts = ds.dims.map(function (d) { return [d, DIM_LABEL[d] || d]; });
    var bar = h('div.rep-config.card',
      mk('مجموعه‌داده', Object.keys(DATASETS).map(function (k) { return [k, DATASETS[k].label]; }), cfg.ds, function (v) { cfg.ds = v; cfg.rows = DATASETS[v].dims[0]; cfg.cols = ''; cfg.measure = Object.keys(DATASETS[v].measures)[0]; cfg.filters = []; state.crumbs = []; }),
      mk('سطر', dimOpts, cfg.rows, function (v) { cfg.rows = v; }),
      mk('ستون', [['', '— بدون ستون —']].concat(dimOpts.filter(function (d) { return d[0] !== cfg.rows; })), cfg.cols || '', function (v) { cfg.cols = v; }),
      mk('شاخص', Object.keys(ds.measures).map(function (k) { return [k, ds.measures[k][0]]; }), cfg.measure, function (v) { cfg.measure = v; }),
      mk('تعداد سطر', [[10, '۱۰ برتر'], [25, '۲۵ برتر'], [100, '۱۰۰ برتر'], [0, 'همه']], cfg.top || 0, function (v) { cfg.top = +v; }),
      h('button.btn.btn-sm', { type: 'button', html: icon('check', 14) + '<span>ذخیره گزارش</span>', onclick: function () {
        var inp = h('input', { type: 'text', value: cfg.name && cfg.name !== 'گزارش سفارشی' ? cfg.name : '' });
        UI.modal({ title: 'ذخیره گزارش', body: h('div.field', h('label', 'نام گزارش'), inp), actions: [{ label: 'انصراف' }, { label: 'ذخیره', primary: true, onClick: function () {
          var nm = inp.value.trim() || 'گزارش من'; cfg.name = nm;
          S.setMeta('reports', saved.filter(function (x) { return x.name !== nm; }).concat([JSON.parse(JSON.stringify(Object.assign({}, cfg, { icon: DATASETS[cfg.ds].icon })))]));
          UI.toast('گزارش ذخیره شد', 'success'); IBP.app.render(true);
        } }] });
      } }));
    root.appendChild(bar);

    var P = pivot(cfg);
    // مسیر تمرکز
    if ((cfg.filters || []).length) {
      var cr = h('div.rep-crumbs', h('button.btn.btn-sm', { type: 'button', html: icon('refresh', 13) + '<span>همه</span>', onclick: function () { var first = state.crumbs[0]; if (first) cfg.rows = first.rows; cfg.filters = []; state.crumbs = []; IBP.app.render(true); } }));
      cfg.filters.forEach(function (f, i) {
        cr.appendChild(h('span.rep-crumb', { html: icon('chevronLeft', 13) + '<b>' + F.escape(DIM_LABEL[f.dim] || f.dim) + ':</b> ' + F.escape(keyLabel(f.dim, f.value)) }));
        cr.lastChild.addEventListener('click', function () { var c = state.crumbs[i + 1]; cfg.filters = cfg.filters.slice(0, i + 1); if (c) cfg.rows = c.rows; state.crumbs = state.crumbs.slice(0, i + 1); IBP.app.render(true); });
      });
      root.appendChild(cr);
    }

    var grid = h('div.dash-grid'); root.appendChild(grid);
    var unit = P.type === 'money' ? ' (' + F.moneyUnit() + ')' : '';
    // نمودار
    var chCard = UI.card({ title: (cfg.name || 'گزارش') + ' — ' + P.mlabel + unit, sub: F.num(P.facts) + ' رکورد · ' + (DIM_LABEL[cfg.rows] || '') + (cfg.cols ? ' × ' + (DIM_LABEL[cfg.cols] || '') : ''), icon: DATASETS[cfg.ds].icon, span: 12, exportFn: function () { return exportPivot(P, cfg); } });
    var cb = h('div'); chCard.body.appendChild(cb);
    var scale = P.type === 'money' ? (S.settings().displayScale || 1e9) : 1;
    var vf = function (v) { return P.type === 'pct' ? F.pct(v, 0) : F.num(v, v < 10 ? 1 : 0); };
    var rk = P.rowKeys.slice(0, 15);
    if (cfg.cols === 'month' || cfg.rows === 'month') {
      var timeKeys = cfg.cols === 'month' ? P.colKeys : P.rowKeys, serKeys = cfg.cols === 'month' ? rk : (cfg.cols ? P.colKeys.slice(0, 8) : ['__all']);
      C.line(cb, { labels: timeKeys.map(function (k) { return J.shortLabel(+k); }), tipLabels: timeKeys.map(function (k) { return J.label(+k); }), height: 300, dataLabels: 'auto',
        series: serKeys.slice(0, 8).map(function (sk, i) { return { name: keyLabel(cfg.cols === 'month' ? cfg.rows : cfg.cols, sk), values: timeKeys.map(function (tk) { var v = cfg.cols === 'month' ? P.cell(sk, tk) : P.cell(tk, sk); return v === null ? null : v / scale; }), color: C.seriesColor(i) }; }),
        format: vf, tipFormat: function (v) { return fmtV(v * scale, P.type); } });
    } else {
      C.columns(cb, { labels: rk.map(function (k) { return keyLabel(cfg.rows, k); }), height: 300, stacked: !!cfg.cols && P.type !== 'pct',
        series: (cfg.cols ? P.colKeys.slice(0, 8) : ['__all']).map(function (ck, i) { return { name: keyLabel(cfg.cols, ck), values: rk.map(function (r) { var v = P.cell(r, ck); return v === null ? 0 : v / scale; }), color: C.seriesColor(i) }; }),
        format: vf, tipFormat: function (v) { return fmtV(v * scale, P.type); },
        onClick: function (i) { drill(rk[i]); } });
    }
    grid.appendChild(chCard.el);

    // جدول محوری
    var tc = UI.card({ title: 'جدول محوری', sub: 'رنگ خانه‌ها متناسب با مقدار · روی نام هر سطر کلیک کنید تا روی آن تمرکز شود', icon: 'table', span: 12, flush: true, exportFn: function () { return exportPivot(P, cfg); } });
    var vals = [];
    P.rowKeys.forEach(function (r) { P.colKeys.forEach(function (c) { var v = P.cell(r, c); if (v !== null) vals.push(v); }); });
    var lo = Math.min.apply(null, vals.concat([0])), hi = Math.max.apply(null, vals.concat([1]));
    var t = h('table.data-table.plan-table.pivot'), hr = h('tr', h('th.pt-name', DIM_LABEL[cfg.rows] || cfg.rows));
    P.colKeys.forEach(function (c) { hr.appendChild(h('th.num', keyLabel(cfg.cols, c))); });
    if (cfg.cols) hr.appendChild(h('th.num', 'جمع'));
    t.appendChild(h('thead', hr));
    var tb = h('tbody'), canDrill = !!DRILL[cfg.rows] && ds.dims.indexOf(DRILL[cfg.rows]) >= 0;
    P.rowKeys.forEach(function (r) {
      var tr = h('tr', h('td.pt-name' + (canDrill || cfg.rows !== 'title' ? '.drill' : ''), { title: canDrill ? 'تمرکز و رفتن به ' + DIM_LABEL[DRILL[cfg.rows]] : 'تمرکز روی همین مورد', onclick: function () { drill(r); } }, keyLabel(cfg.rows, r)));
      P.colKeys.forEach(function (c) {
        var v = P.cell(r, c);
        var k = hi > lo && v !== null ? (v - lo) / (hi - lo) : 0;
        tr.appendChild(h('td.num', { style: { background: v === null ? '' : 'color-mix(in srgb, var(--series-1) ' + Math.round(6 + 38 * k) + '%, transparent)' } }, fmtV(v, P.type)));
      });
      if (cfg.cols) tr.appendChild(h('td.num.pt-total', fmtV(P.rowTotal(r), P.type)));
      tb.appendChild(tr);
    });
    var tr2 = h('tr.pt-d0', h('td.pt-name', 'جمع کل'));
    P.colKeys.forEach(function (c) { tr2.appendChild(h('td.num', fmtV(P.colTotal(c), P.type))); });
    if (cfg.cols) tr2.appendChild(h('td.num', fmtV(P.total, P.type)));
    tb.appendChild(tr2);
    t.appendChild(tb);
    tc.body.appendChild(h('div.plan-wrap', t));
    grid.appendChild(tc.el);

    function drill(r) {
      var next = DRILL[cfg.rows];
      state.crumbs.push({ rows: cfg.rows });
      cfg.filters = (cfg.filters || []).concat([{ dim: cfg.rows, value: r }]);
      if (next && ds.dims.indexOf(next) >= 0) cfg.rows = next;
      cfg.name = cfg.name || 'گزارش';
      IBP.app.render(true);
    }
  }

  IBP.reports = { pivot: pivot, facts: factsOf, DATASETS: DATASETS, PRESETS: PRESETS, DIM_LABEL: DIM_LABEL };
  IBP.register('reports', { title: 'گزارش‌ها', render: render });
})(window.IBP = window.IBP || {});
