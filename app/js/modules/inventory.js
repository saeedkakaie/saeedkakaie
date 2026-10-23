/*
 * موجودی و MRP (فاز ۴):
 *   projection  پیش‌بینی موجودی محصول (ارزش، تناژ، پوشش) بر اساس برنامه تولید؛ کمبود، زیر ذخیره اطمینان و مازاد
 *   safety      ذخیره اطمینان هر محصول: روش، σ خطای پیش‌بینی، سطح خدمت، معادل روز و ارزش
 *   mrp         نیاز ناخالص و خالص مواد، سفارش‌های برنامه‌ریزی‌شده خرید با زمان تأمین و MOQ، سفارش‌های دیرکرد
 *   ic          درخواست‌های درون‌گروهی این شرکت از شرکت‌های تأمین‌کننده هلدینگ و انتشار آن برای آن‌ها
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var TABS = [['projection', 'پیش‌بینی موجودی', 'warehouse'], ['safety', 'ذخیره اطمینان', 'target'], ['mrp', 'نیاز مواد و خرید (MRP)', 'truck'], ['ic', 'درخواست‌های درون‌گروهی', 'share']];
  var state = { sel: null, mat: null, months: 12, filter: 'all' };

  function cur() { return IBP.supply.current(); }
  function slice(a) { return a.slice(0, state.months); }
  function statusOf(r) {
    if (A.sum(slice(r.shortage)) > 0.5) return { level: 'critical', label: 'کمبود' };
    if (r.inventory.slice(0, state.months).some(function (v, i) { return v < r.ss[i] * 0.999 - 0.5; })) return { level: 'warning', label: 'زیر ذخیره اطمینان' };
    var c = r.cover[0];
    if (c !== null && c > (S.settings().excessMonths || 3)) return { level: 'excess', label: 'مازاد' };
    return { level: 'good', label: 'متعادل' };
  }

  /* ======================= پیش‌بینی موجودی ======================= */
  function renderProjection(root) {
    var c = cur(), pl = c.plan, per = slice(pl.periods);
    var rows = pl.rows;
    var stats = { critical: 0, warning: 0, excess: 0, good: 0 };
    rows.forEach(function (r) { stats[statusOf(r).level]++; });
    var v0 = A.inventoryValue().finished, vEnd = pl.invValue[per.length - 1];
    var covers = rows.map(function (r) { return r.cover[0]; }).filter(function (v) { return v !== null && isFinite(v); });
    var kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'ارزش موجودی محصول فعلی', value: v0, format: function (v) { return F.money(v, { unit: false }); }, unit: F.moneyUnit(), foot: 'پایان افق: ' + F.money(vEnd) }));
    kp.appendChild(UI.kpi({ icon: 'warehouse', label: 'موجودی پایان ماه اول', value: pl.invTons[0], format: function (v) { return F.num(v, 0); }, unit: 'تن', foot: 'اوج افق: ' + F.num(Math.max.apply(null, slice(pl.invTons)), 0) + ' تن' }));
    kp.appendChild(UI.kpi({ icon: 'clock', label: 'میانه پوشش موجودی', value: covers.length ? covers.sort(function (a, b) { return a - b; })[Math.floor(covers.length / 2)] : 0, format: function (v) { return F.num(v, 1); }, unit: 'ماه', foot: 'بر اساس تقاضای ماه بعد' }));
    kp.appendChild(UI.kpi({ icon: 'critical', label: 'محصولات با کمبود', value: stats.critical, format: F.num, foot: 'در ' + F.num(per.length) + ' ماه افق' }));
    kp.appendChild(UI.kpi({ icon: 'alert', label: 'زیر ذخیره اطمینان', value: stats.warning, format: F.num, foot: 'حداقل یک ماه' }));
    kp.appendChild(UI.kpi({ icon: 'layers', label: 'موجودی مازاد', value: stats.excess, format: F.num, foot: 'پوشش بیش از ' + F.num(S.settings().excessMonths || 3) + ' ماه' }));
    root.appendChild(kp);
    var grid = h('div.dash-grid'); root.appendChild(grid);

    var sel = state.sel && rows.some(function (r) { return r.product.id === state.sel; }) ? rows.filter(function (r) { return r.product.id === state.sel; })[0] : null;
    var c1 = UI.card({ title: sel ? sel.product.name : 'ارزش موجودی پیش‌بینی‌شده', sub: sel ? 'موجودی پایان ماه در برابر ذخیره اطمینان و تقاضا (' + (sel.product.uom || '') + ')' : 'ارزش موجودی محصول (' + F.moneyUnit() + ') و ارزش ذخیره اطمینان · برای انتخاب محصول از جدول استفاده کنید', icon: 'chart', span: 8,
      tools: sel ? [h('button.btn.btn-sm', { type: 'button', html: '<span>نمای کل</span>', onclick: function () { state.sel = null; IBP.app.render(true); } })] : [] });
    var box = h('div'); c1.body.appendChild(box);
    var scale = S.settings().displayScale || 1e9;
    if (sel) {
      C.columns(box, {
        labels: per.map(J.shortLabel), tipTitles: per.map(J.label), height: 280,
        series: [{ name: 'تقاضا', values: slice(sel.demand), color: 'var(--series-2)' }, { name: 'تولید', values: slice(sel.production), color: 'var(--series-1)' }],
        lines: [{ name: 'موجودی پایان ماه', values: slice(sel.inventory), color: 'var(--series-3)' }, { name: 'ذخیره اطمینان', values: slice(sel.ss), color: 'var(--text-2)', dash: true }],
        format: F.compact, tipFormat: function (v) { return F.num(v) + ' ' + (sel.product.uom || ''); }
      });
    } else {
      var ssVal = per.map(function (_, i) { return A.sum(rows, function (r) { return r.ss[i] * (r.product.unitCost || 0); }) / scale; });
      C.line(box, {
        labels: per.map(J.shortLabel), tipLabels: per.map(J.label), height: 280,
        series: [{ name: 'ارزش موجودی', values: slice(pl.invValue).map(function (v) { return v / scale; }), color: 'var(--series-1)', area: true }, { name: 'ارزش ذخیره اطمینان', values: ssVal, color: 'var(--series-2)', dash: true }],
        format: function (v) { return F.num(v, 0); }, labelFormat: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); }
      });
    }
    grid.appendChild(c1.el);

    var c2 = UI.card({ title: 'وضعیت موجودی محصولات', sub: 'برای فیلتر جدول کلیک کنید', icon: 'pie', span: 4 });
    var LBL = { critical: 'کمبود', warning: 'زیر ذخیره اطمینان', excess: 'مازاد', good: 'متعادل' }, COL = { critical: 'var(--critical)', warning: 'var(--warning)', excess: 'var(--series-7)', good: 'var(--good)' };
    C.donut(c2.body, {
      items: Object.keys(stats).filter(function (k) { return stats[k]; }).map(function (k) { return { key: k, label: LBL[k], value: stats[k], color: COL[k] }; }),
      format: F.num, valueLabel: 'تعداد محصول', center: { value: F.num(rows.length), label: 'محصول' },
      onClick: function (it) { state.filter = state.filter === it.key ? 'all' : it.key; IBP.app.render(true); }
    });
    grid.appendChild(c2.el);

    var list = state.filter === 'all' ? rows : rows.filter(function (r) { return statusOf(r).level === state.filter; });
    var c3 = UI.card({ title: 'پیش‌بینی موجودی محصولات', sub: (state.filter !== 'all' ? 'فیلتر: ' + LBL[state.filter] + ' · ' : '') + 'موجودی پایان هر ماه از برنامه تولید · برای نمودار روی سطر کلیک کنید', icon: 'list', span: 12, flush: true,
      exportFn: function () {
        var cols = [{ header: 'کد', value: function (r) { return r.product.code; }, type: 'code' }, { header: 'محصول', value: function (r) { return r.product.name; }, type: 'text' }, { header: 'وضعیت', value: function (r) { return statusOf(r).label; }, type: 'text' }, { header: 'موجودی فعلی', value: function (r) { return r.open; }, type: 'int' }];
        pl.periods.forEach(function (p, i) { cols.push({ header: J.year(p) + '/' + String(J.month(p)).padStart(2, '0'), type: 'int', value: function (r) { return r.inventory[i]; } }); });
        return IBP.excel.exportTables({ filename: 'پیش‌بینی موجودی ' + J.label(pl.cycle), sheets: [{ name: 'موجودی پایان ماه', title: 'پیش‌بینی موجودی پایان ماه', columns: cols, rows: rows, freezeCols: 2 },
          { name: 'ارزش موجودی', title: 'ارزش و تناژ موجودی پیش‌بینی‌شده', columns: [{ header: 'ماه', value: function (x) { return J.label(x.p); }, type: 'text' }, { header: 'ارزش موجودی', value: function (x) { return pl.invValue[x.i]; }, type: 'money' }, { header: 'موجودی (تن)', value: function (x) { return pl.invTons[x.i]; }, type: 'num' }],
            rows: pl.periods.map(function (p, i) { return { p: p, i: i }; }), charts: [{ type: 'line', x: 0, y: [1], title: 'ارزش موجودی' }] }] });
      } });
    IBP.grid(c3.body, {
      rows: function () { return list; }, pageSize: 15,
      onRowClick: function (r) { state.sel = r.product.id; IBP.app.render(true); window.scrollTo(0, 0); },
      columns: [
        { key: 'n', label: 'محصول', value: function (r) { return r.product.name; }, render: function (r) { return F.escape(r.product.name) + '<div class="cell-sub code">' + F.escape(r.product.code) + '</div>'; }, text: function (r) { return r.product.name + ' ' + r.product.code; } },
        { key: 'st', label: 'وضعیت', value: function (r) { return statusOf(r).label; }, render: function (r) { var s = statusOf(r); return UI.statusBadge(s.level, s.label); } },
        { key: 'o', label: 'موجودی فعلی', align: 'num', value: function (r) { return r.open; }, render: function (r) { return F.num(r.open); } },
        { key: 'ss', label: 'ذخیره اطمینان', align: 'num', value: function (r) { return r.ss[0]; }, render: function (r) { return F.num(r.ss[0]); } },
        { key: 'c', label: 'پوشش (ماه)', align: 'num', value: function (r) { return r.cover[0]; }, render: function (r) { return r.cover[0] === null ? '—' : F.num(r.cover[0], 1); } },
        { key: 'sh', label: 'کمبود افق', align: 'num', value: function (r) { return A.sum(slice(r.shortage)); }, render: function (r) { var v = A.sum(slice(r.shortage)); return v > 0.5 ? '<span class="delta down-bad">' + F.num(v) + '</span>' : '—'; } },
        { key: 'f', label: 'سطح خدمت', align: 'num', value: function (r) { return r.fillRate; }, render: function (r) { return F.pct(r.fillRate, 1); } },
        { key: 'v', label: 'ارزش پایان افق', align: 'num', value: function (r) { return r.inventory[per.length - 1] * (r.product.unitCost || 0); }, render: function (r) { return F.money(r.inventory[per.length - 1] * (r.product.unitCost || 0)); } },
        { key: 'sp', label: 'روند موجودی', sortable: false, render: function (r) { return C.sparkline(slice(r.inventory), { width: 100, height: 26 }); } }
      ]
    });
    grid.appendChild(c3.el);
  }

  /* ======================= ذخیره اطمینان ======================= */
  function renderSafety(root) {
    var c = cur(), pl = c.plan, o = pl.options, st = S.settings();
    var panel = h('div.engine-panel', { style: { marginBottom: '16px', flexWrap: 'wrap' } }, h('div.ep-icon', { html: icon('target', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } }, h('div.ep-t', o.ssMethod === 'days' ? 'ذخیره اطمینان بر اساس روز تعریف‌شده هر محصول' : 'ذخیره اطمینان آماری: z × σ خطای پیش‌بینی × تقاضا × √زمان بازپرسازی'),
        h('div.ep-d', 'سطح خدمت هدف ' + F.pct(o.serviceLevel, 0) + ' (z = ' + F.num(pl.z, 2) + ') · زمان بازپرسازی ' + F.num(1 + o.productionLeadDays / 30, 2) + ' ماه · σ از خطای بک‌تست روش منتخب پیش‌بینی (یا نوسان فروش) · سقف با ماندگاری محصول')));
    var mk = function (label, el) { return h('label.bt-ctl', h('span', label), el); };
    var method = h('select', h('option', { value: 'statistical' }, 'آماری (سطح خدمت)'), h('option', { value: 'days' }, 'روز ثابت هر محصول'));
    method.value = o.ssMethod;
    method.addEventListener('change', function () { S.saveSettings({ ssMethod: method.value }); IBP.supply.clearOptimized(); IBP.app.render(true); });
    var sl = h('select');
    [0.9, 0.93, 0.95, 0.97, 0.98, 0.99].forEach(function (v) { sl.appendChild(h('option', { value: v }, F.pct(v, 0))); });
    sl.value = String(st.serviceLevelTarget || 0.95);
    sl.addEventListener('change', function () { S.saveSettings({ serviceLevelTarget: Number(sl.value) }); IBP.supply.clearOptimized(); IBP.app.render(true); });
    panel.appendChild(h('div.bt-controls', mk('روش', method), mk('سطح خدمت هدف', sl)));
    root.appendChild(panel);
    var grid = h('div.dash-grid'); root.appendChild(grid);
    var rows = pl.rows;
    var fams = S.all('families').map(function (f) {
      var rs = rows.filter(function (r) { return r.product.familyId === f.id; });
      return { f: f, v: A.sum(rs, function (r) { return r.ss[0] * (r.product.unitCost || 0); }) };
    }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
    var c1 = UI.card({ title: 'ارزش ذخیره اطمینان خانواده‌ها', sub: 'ماه اول افق (' + F.moneyUnit() + ')', icon: 'coins', span: 5 });
    C.hbars(c1.body, { items: fams.map(function (x, i) { return { label: x.f.name, value: x.v, color: x.f.color || C.seriesColor(i) }; }), format: function (v) { return F.money(v); }, valueLabel: 'ارزش' });
    grid.appendChild(c1.el);
    var c2 = UI.card({ title: 'عدم قطعیت و ذخیره اطمینان', sub: 'محور افقی: خطای نسبی پیش‌بینی · محور عمودی: ذخیره اطمینان بر حسب روز · اندازه: ارزش', icon: 'scatter', span: 7 });
    var bx = h('div'); c2.body.appendChild(bx);
    C.scatter(bx, {
      points: rows.map(function (r) { var d = r.demand[1] || r.demand[0] || 0; return { x: r.rel, y: d > 0 ? r.ss[0] / d * 30 : 0, size: r.ss[0] * (r.product.unitCost || 0), color: r.product.abc === 'A' ? 'var(--series-1)' : r.product.abc === 'B' ? 'var(--series-2)' : 'var(--series-3)', label: r.product.name, short: r.product.code, id: r.product.id, rows: [{ label: 'ذخیره اطمینان', value: F.num(r.ss[0]) + ' ' + (r.product.uom || '') }, { label: 'سیاست روز محصول', value: F.num(r.product.safetyStockDays || 0) + ' روز' }] }; }),
      xFormat: function (v) { return F.pct(v, 0); }, yFormat: function (v) { return F.num(v, 0); }, xTitle: 'خطای نسبی پیش‌بینی (σ)', yTitle: 'ذخیره اطمینان (روز)', xLabel: 'خطای نسبی', yLabel: 'روز پوشش', height: 300, labelTop: 6,
      legend: [{ label: 'کلاس A', color: 'var(--series-1)' }, { label: 'کلاس B', color: 'var(--series-2)' }, { label: 'کلاس C', color: 'var(--series-3)' }],
      onClick: function (p) { state.sel = p.id; IBP.app.navigate('#/inventory/projection'); }
    });
    grid.appendChild(c2.el);
    var c3 = UI.card({ title: 'ذخیره اطمینان محصولات', sub: 'مقایسه روش آماری با سیاست روز ثابت', icon: 'list', span: 12, flush: true,
      exportFn: function () {
        return IBP.excel.exportTables({ filename: 'ذخیره اطمینان ' + J.label(pl.cycle), sheets: [{ name: 'ذخیره اطمینان', title: 'ذخیره اطمینان محصولات — سطح خدمت ' + F.pct(o.serviceLevel, 0), columns: [
          { header: 'کد', value: function (r) { return r.product.code; }, type: 'code' }, { header: 'محصول', value: function (r) { return r.product.name; }, type: 'text' }, { header: 'کلاس', value: function (r) { return (r.product.abc || '') + (r.product.xyz || ''); }, type: 'text' },
          { header: 'خطای نسبی پیش‌بینی', value: function (r) { return r.rel; }, type: 'pct' }, { header: 'ذخیره اطمینان (واحد)', value: function (r) { return r.ss[0]; }, type: 'int' },
          { header: 'معادل روز', value: function (r) { var d = r.demand[1] || r.demand[0]; return d ? r.ss[0] / d * 30 : null; }, type: 'num' }, { header: 'سیاست روز محصول', value: function (r) { return r.product.safetyStockDays || 0; }, type: 'int' },
          { header: 'ارزش', value: function (r) { return r.ss[0] * (r.product.unitCost || 0); }, type: 'money' }], rows: rows }] });
      } });
    IBP.grid(c3.body, {
      rows: function () { return rows; }, pageSize: 15,
      columns: [
        { key: 'n', label: 'محصول', value: function (r) { return r.product.name; }, render: function (r) { return F.escape(r.product.name) + '<div class="cell-sub code">' + F.escape(r.product.code) + '</div>'; } },
        { key: 'k', label: 'کلاس', value: function (r) { return (r.product.abc || '') + (r.product.xyz || ''); } },
        { key: 'rel', label: 'خطای نسبی', align: 'num', value: function (r) { return r.rel; }, render: function (r) { return F.pct(r.rel, 0); } },
        { key: 'ss', label: 'ذخیره اطمینان', align: 'num', value: function (r) { return r.ss[0]; }, render: function (r) { return F.num(r.ss[0]) + ' <span class="cell-sub">' + F.escape(r.product.uom || '') + '</span>'; } },
        { key: 'd', label: 'معادل روز', align: 'num', value: function (r) { var d = r.demand[1] || r.demand[0]; return d ? r.ss[0] / d * 30 : null; }, render: function (r) { var d = r.demand[1] || r.demand[0]; return d ? F.num(r.ss[0] / d * 30, 1) : '—'; } },
        { key: 'pd', label: 'سیاست روز', align: 'num', value: function (r) { return r.product.safetyStockDays || 0; } },
        { key: 'v', label: 'ارزش', align: 'num', value: function (r) { return r.ss[0] * (r.product.unitCost || 0); }, render: function (r) { return F.money(r.ss[0] * (r.product.unitCost || 0)); } }
      ]
    });
    grid.appendChild(c3.el);
  }

  /* ======================= MRP ======================= */
  function exportMrp(m) {
    var per = m.periods;
    var mk = function (title, key) {
      var cols = [{ header: 'کد', value: function (r) { return r.material.code; }, type: 'code' }, { header: 'ماده', value: function (r) { return r.material.name; }, type: 'text' }, { header: 'واحد', value: function (r) { return r.material.uom; }, type: 'text' }];
      per.forEach(function (p, i) { cols.push({ header: J.year(p) + '/' + String(J.month(p)).padStart(2, '0'), type: 'int', value: function (r) { return r[key][i]; } }); });
      cols.push({ header: 'جمع', type: 'int', value: function (r) { return A.sum(r[key]); } });
      return { name: title, title: title + ' — چرخه ' + J.label(m.cycle), columns: cols, rows: m.rows, freezeCols: 2 };
    };
    return IBP.excel.exportTables({ filename: 'MRP و برنامه خرید ' + J.label(m.cycle), sheets: [
      { name: 'سفارش‌های خرید', title: 'سفارش‌های برنامه‌ریزی‌شده خرید', columns: [
        { header: 'ماده', value: function (x) { return x.r.material.name; }, type: 'text' }, { header: 'تأمین‌کننده', value: function (x) { return x.r.supplier ? x.r.supplier.name : ''; }, type: 'text' },
        { header: 'ماه صدور', value: function (x) { return J.label(per[x.rel]); }, type: 'text' }, { header: 'ماه دریافت', value: function (x) { return J.label(per[x.t]); }, type: 'text' },
        { header: 'مقدار', value: function (x) { return x.qty; }, type: 'int' }, { header: 'واحد', value: function (x) { return x.r.material.uom; }, type: 'text' }, { header: 'ارزش', value: function (x) { return x.qty * (x.r.material.unitCost || 0); }, type: 'money' },
        { header: 'وضعیت', value: function (x) { return x.late ? 'دیرکرد — نیاز به پیگیری فوری' : x.r.internal ? 'درون‌گروهی' : ''; }, type: 'text' }], rows: orders(m) },
      mk('نیاز ناخالص', 'gross'), mk('نیاز خالص', 'net'), mk('دریافت برنامه‌ریزی‌شده', 'receipts'), mk('صدور سفارش', 'releases'), mk('موجودی پیش‌بینی‌شده', 'projected')
    ] });
  }
  function orders(m) {
    var out = [];
    m.rows.forEach(function (r) {
      r.receipts.forEach(function (q, t) {
        if (q <= 0) return;
        out.push({ r: r, t: t, rel: Math.max(0, t - r.leadMonths), qty: q, late: r.late.indexOf(t) >= 0 });
      });
    });
    return out.sort(function (a, b) { return a.rel - b.rel || b.qty * b.r.material.unitCost - a.qty * a.r.material.unitCost; });
  }

  function renderMrp(root) {
    var c = cur(), m = c.mrp, per = slice(m.periods);
    var od = orders(m), scale = S.settings().displayScale || 1e9;
    var kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'ارزش خرید افق', value: A.sum(slice(m.purchaseValue)), format: function (v) { return F.money(v, { unit: false }); }, unit: F.moneyUnit(), foot: F.num(per.length) + ' ماه' }));
    kp.appendChild(UI.kpi({ icon: 'box', label: 'مواد دارای نیاز', value: m.rows.length, format: F.num, foot: F.num(m.rows.filter(function (r) { return r.internal; }).length) + ' ماده درون‌گروهی' }));
    kp.appendChild(UI.kpi({ icon: 'truck', label: 'سفارش‌های برنامه‌ریزی‌شده', value: od.length, format: F.num, foot: 'صدور این ماه: ' + F.num(od.filter(function (x) { return x.rel === 0; }).length) }));
    kp.appendChild(UI.kpi({ icon: 'critical', label: 'مواد با سفارش دیرکرد', value: m.lateCount, format: F.num, foot: 'زمان تأمین بیش از فاصله تا نیاز' }));
    var icT = Object.keys(m.ic).reduce(function (s, k) { return s + A.sum(slice(m.ic[k].tons)); }, 0);
    kp.appendChild(UI.kpi({ icon: 'share', label: 'درخواست از شرکت‌های گروه', value: icT, format: function (v) { return F.num(v, 0); }, unit: 'تن', foot: F.num(Object.keys(m.ic).length) + ' شرکت تأمین‌کننده' }));
    kp.appendChild(UI.kpi({ icon: 'warehouse', label: 'ارزش موجودی مواد', value: A.inventoryValue().materials, format: function (v) { return F.money(v, { unit: false }); }, unit: F.moneyUnit(), foot: 'موجودی فعلی انبار مواد' }));
    root.appendChild(kp);
    var grid = h('div.dash-grid'); root.appendChild(grid);

    var c1 = UI.card({ title: 'ارزش خرید ماهانه', sub: 'ارزش دریافت‌های برنامه‌ریزی‌شده (' + F.moneyUnit() + ') به تفکیک درون‌گروهی و بیرونی', icon: 'chart', span: 7, exportFn: function () { return exportMrp(m); } });
    var bx = h('div'); c1.body.appendChild(bx);
    var ext = per.map(function (_, i) { return A.sum(m.rows.filter(function (r) { return !r.internal; }), function (r) { return r.receipts[i] * (r.material.unitCost || 0); }) / scale; });
    var intl = per.map(function (_, i) { return A.sum(m.rows.filter(function (r) { return r.internal; }), function (r) { return r.receipts[i] * (r.material.unitCost || 0); }) / scale; });
    C.columns(bx, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, series: [{ name: 'تأمین‌کنندگان بیرونی', values: ext, color: 'var(--series-1)' }, { name: 'درون‌گروهی', values: intl, color: 'var(--series-4)' }], format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); }, height: 270 });
    grid.appendChild(c1.el);

    var sup = {};
    m.rows.forEach(function (r) { var k = r.internal ? 'IC-' + r.internal : (r.supplier ? r.supplier.name : 'نامشخص'); sup[k] = (sup[k] || 0) + A.sum(slice(r.receipts)) * (r.material.unitCost || 0); });
    var c2 = UI.card({ title: 'سهم تأمین‌کنندگان', sub: 'ارزش خرید افق', icon: 'pie', span: 5 });
    C.donut(c2.body, { items: Object.keys(sup).sort(function (a, b) { return sup[b] - sup[a]; }).slice(0, 8).map(function (k, i) { return { label: k.indexOf('IC-') === 0 ? IBP.templates.companyName(k.slice(3)) + ' (گروه)' : k, value: sup[k], color: C.seriesColor(i) }; }), format: function (v) { return F.money(v); }, valueLabel: 'ارزش خرید' });
    grid.appendChild(c2.el);

    // جزئیات ماده منتخب (جدول زمان‌بندی MRP)
    var sel = m.rows.filter(function (r) { return r.material.id === state.mat; })[0] || m.rows[0];
    if (sel) {
      var c3 = UI.card({ title: 'جدول MRP: ' + sel.material.name, sub: (sel.supplier ? sel.supplier.name + ' · ' : '') + 'زمان تأمین ' + F.num(sel.material.leadTimeDays || 0) + ' روز · MOQ ' + F.num(sel.material.moq || 0) + ' · ذخیره اطمینان ' + F.num(sel.ss) + ' ' + (sel.material.uom || ''), icon: 'table', span: 12, flush: true });
      var ms = h('select', { 'aria-label': 'ماده' });
      m.rows.forEach(function (r) { ms.appendChild(h('option', { value: r.material.id }, r.material.code + ' — ' + r.material.name)); });
      ms.value = sel.material.id;
      ms.addEventListener('change', function () { state.mat = ms.value; IBP.app.render(true); });
      c3.tools.appendChild(ms);
      var t = h('table.data-table.plan-table'), hr = h('tr', h('th.pt-name', 'ردیف'));
      per.forEach(function (p) { hr.appendChild(h('th.num', J.shortLabel(p))); });
      t.appendChild(h('thead', hr));
      var tb = h('tbody');
      [['نیاز ناخالص', 'gross'], ['دریافت برنامه‌ریزی‌شده', 'receipts'], ['موجودی پیش‌بینی‌شده', 'projected'], ['نیاز خالص', 'net'], ['صدور سفارش', 'releases']].forEach(function (rw) {
        var tr = h('tr', h('td.pt-name', rw[0]));
        per.forEach(function (_, i) {
          var v = sel[rw[1]][i], late = rw[1] === 'receipts' && sel.late.indexOf(i) >= 0;
          tr.appendChild(h('td.num' + (late ? '.st-short' : rw[1] === 'projected' && v < sel.ss - 0.5 ? '.st-ss' : ''), { title: late ? 'دیرکرد: زمان تأمین کافی نیست' : '' }, v ? F.num(v) : '—'));
        });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      c3.body.appendChild(h('div.plan-wrap', t));
      grid.appendChild(c3.el);
    }

    var c4 = UI.card({ title: 'سفارش‌های برنامه‌ریزی‌شده خرید', sub: 'به ترتیب زمان صدور · قرمز = دیرکرد', icon: 'truck', span: 12, flush: true, exportFn: function () { return exportMrp(m); } });
    IBP.grid(c4.body, {
      rows: function () { return od; }, pageSize: 15,
      onRowClick: function (x) { state.mat = x.r.material.id; IBP.app.render(true); window.scrollTo(0, 0); },
      columns: [
        { key: 'm', label: 'ماده', value: function (x) { return x.r.material.name; }, render: function (x) { return F.escape(x.r.material.name) + '<div class="cell-sub code">' + F.escape(x.r.material.code) + '</div>'; }, text: function (x) { return x.r.material.name + ' ' + x.r.material.code; } },
        { key: 's', label: 'تأمین‌کننده', value: function (x) { return x.r.supplier ? x.r.supplier.name : ''; }, render: function (x) { return F.escape(x.r.supplier ? x.r.supplier.name : '—') + (x.r.internal ? ' ' + UI.statusBadge('info', 'درون‌گروهی') : ''); } },
        { key: 'rel', label: 'صدور', value: function (x) { return x.rel; }, render: function (x) { return J.label(m.periods[x.rel]); } },
        { key: 't', label: 'دریافت', value: function (x) { return x.t; }, render: function (x) { return J.label(m.periods[x.t]); } },
        { key: 'q', label: 'مقدار', align: 'num', value: function (x) { return x.qty; }, render: function (x) { return F.num(x.qty) + ' <span class="cell-sub">' + F.escape(x.r.material.uom || '') + '</span>'; } },
        { key: 'v', label: 'ارزش', align: 'num', value: function (x) { return x.qty * (x.r.material.unitCost || 0); }, render: function (x) { return F.money(x.qty * (x.r.material.unitCost || 0)); } },
        { key: 'st', label: 'وضعیت', value: function (x) { return x.late ? 1 : 0; }, render: function (x) { return x.late ? UI.statusBadge('critical', 'دیرکرد') : x.rel === 0 ? UI.statusBadge('warning', 'صدور این ماه') : UI.statusBadge('neutral', 'برنامه‌ریزی‌شده'); } }
      ]
    });
    grid.appendChild(c4.el);
  }

  /* ======================= درون‌گروهی ======================= */
  function icPayload(m) {
    var byCompany = {};
    Object.keys(m.ic).forEach(function (code) {
      var out = byCompany[code] = {};
      m.ic[code].items.forEach(function (r) {
        var pc = r.material.internalProductCode; if (!pc) return;
        var kg = out[pc] = out[pc] || {};
        r.receipts.forEach(function (q, t) { if (q > 0) kg[m.periods[t]] = (kg[m.periods[t]] || 0) + (r.material.uom === 'تن' ? q * 1000 : q); });
      });
    });
    return { cycle: m.cycle, at: new Date().toISOString(), source: 'MRP', byCompany: byCompany };
  }
  function renderIc(root) {
    var c = cur(), m = c.mrp, per = slice(m.periods), pub = S.meta('icRequests');
    var codes = Object.keys(m.ic);
    root.appendChild(h('div.engine-panel', { style: { marginBottom: '16px' } }, h('div.ep-icon', { html: icon('share', 22) }),
      h('div', { style: { flex: 1, minWidth: '260px' } }, h('div.ep-t', 'درخواست مواد از شرکت‌های هلدینگ (بر اساس MRP)'),
        h('div.ep-d', pub && pub.cycle === m.cycle ? 'آخرین انتشار: ' + J.isoToJalaliStr(pub.at.slice(0, 10)) + ' ' + pub.at.slice(11, 16) + ' — شرکت‌های تأمین‌کننده در «تقاضای درون‌گروهی» همین اعداد را دریافت می‌کنند.' : 'پس از انتشار، شرکت تأمین‌کننده نیاز زمان‌بندی‌شده این شرکت را (به‌جای برآورد از BOM) در برنامه تقاضای خود دریافت می‌کند.')),
      h('button.btn.btn-primary', { type: 'button', html: icon('upload', 15) + '<span>انتشار درخواست‌ها برای شرکت‌های گروه</span>', onclick: function () {
        S.setMeta('icRequests', icPayload(m));
        S.flush().then(function () { IBP.holding.saveSummary(); UI.toast('درخواست‌های درون‌گروهی منتشر شد', 'success'); IBP.app.render(true); });
      } })));
    var grid = h('div.dash-grid'); root.appendChild(grid);
    if (!codes.length) { grid.appendChild(h('div.card.span-12', h('div.card-body', 'این شرکت ماده‌ای از شرکت‌های دیگر هلدینگ دریافت نمی‌کند. نیازهای شرکت‌های خریدار را در «برنامه‌ریزی تقاضا ← تقاضای درون‌گروهی» ببینید.'))); return; }
    var c1 = UI.card({ title: 'درخواست ماهانه از شرکت‌های گروه', sub: 'تن · دریافت‌های برنامه‌ریزی‌شده MRP', icon: 'chart', span: 12 });
    var bx = h('div'); c1.body.appendChild(bx);
    C.columns(bx, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, series: codes.map(function (k, i) { return { name: IBP.templates.companyName(k) + ' (' + k + ')', values: slice(m.ic[k].tons), color: C.seriesColor(i) }; }), format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' تن'; }, height: 260 });
    grid.appendChild(c1.el);
    codes.forEach(function (k) {
      var ic = m.ic[k];
      var card = UI.card({ title: IBP.templates.companyName(k) + ' (' + k + ')', sub: F.num(ic.items.length) + ' ماده · ارزش افق ' + F.money(ic.value), icon: 'factory', span: 12, flush: true });
      var t = h('table.data-table.plan-table'), hr = h('tr', h('th.pt-name', 'ماده / کالای تأمین‌کننده'));
      per.forEach(function (p) { hr.appendChild(h('th.num', J.shortLabel(p))); });
      hr.appendChild(h('th.num', 'جمع'));
      t.appendChild(h('thead', hr));
      var tb = h('tbody');
      ic.items.forEach(function (r) {
        var tr = h('tr', h('td.pt-name', { html: F.escape(r.material.name) + '<div class="cell-sub"><span class="code">' + F.escape(r.material.internalProductCode || '') + '</span> · ' + F.escape(r.material.uom || '') + '</div>' }));
        per.forEach(function (_, i) { tr.appendChild(h('td.num', r.receipts[i] ? F.num(r.receipts[i]) : '—')); });
        tr.appendChild(h('td.num.pt-total', F.num(A.sum(slice(r.receipts)))));
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      card.body.appendChild(h('div.plan-wrap', t));
      grid.appendChild(card.el);
    });
  }

  /* ======================= صفحه ======================= */
  function render(root, params) {
    var tab = TABS.some(function (t) { return t[0] === params[0]; }) ? params[0] : 'projection';
    var tabs = h('div.tabbar', { role: 'tablist' });
    TABS.forEach(function (t) { tabs.appendChild(h('a.tab' + (t[0] === tab ? '.on' : ''), { href: '#/inventory/' + t[0], role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', html: icon(t[2], 16) + '<span>' + t[1] + '</span>' })); });
    if (!S.count('products')) {
      root.appendChild(UI.pageHead({ title: 'موجودی و MRP' }));
      root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.')));
      return;
    }
    var pl = cur().plan;
    var monthsSel = h('div.seg', [6, 12, 18].map(function (mm) { return h('button' + (state.months === mm ? '.on' : ''), { type: 'button', onclick: function () { state.months = mm; IBP.app.render(true); } }, F.num(mm) + ' ماه'); }));
    root.appendChild(UI.pageHead({
      title: 'موجودی و MRP',
      badge: pl.engine === 'python' ? UI.statusBadge('ai', 'برنامه تولید بهینه (LP)') : UI.statusBadge('neutral', 'برنامه تولید داخلی'),
      desc: S.settings().companyName + ' · چرخه ' + J.label(pl.cycle) + ' · بر اساس برنامه تولید بخش «تأمین و ظرفیت»',
      actions: [monthsSel]
    }));
    root.appendChild(tabs);
    var host = h('div'); root.appendChild(host);
    ({ projection: renderProjection, safety: renderSafety, mrp: renderMrp, ic: renderIc })[tab](host);
  }

  IBP.register('inventory', { title: 'موجودی و MRP', render: render });
})(window.IBP = window.IBP || {});
