/*
 * تأمین و ظرفیت (فاز ۴):
 *   mps       برنامه تولید ماهانه با محدودیت ظرفیت: تولید، موجودی پایان ماه، کمبود، پیش‌ساخت و اضافه‌کاری؛
 *             ویرایش دستی تولید هر ماه (بازنویسی برنامه خودکار) و بهینه‌سازی خطی با موتور پایتون
 *   capacity  بار ظرفیت خطوط (نقشه حرارتی)، تفکیک بار هر خط به محصولات، گلوگاه‌ها و راهکارها (اضافه‌کاری، شیفت اضافه)
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var TABS = [['mps', 'برنامه تولید (MPS)', 'factory'], ['capacity', 'ظرفیت سرانگشتی (RCCP)', 'gear']];
  var state = { months: 12, sel: null, res: null, family: 'all' };

  function plan() { return IBP.supply.current().plan; }
  function tons(p, q) { return (q || 0) * (p.unitWeightKg || 0) / 1000; }
  function slice(arr) { return arr.slice(0, state.months); }

  function engineBtn() {
    var on = IBP.engine.online(), run = S.meta('supplyRun');
    var b = h('button.btn' + (on ? '.btn-primary' : ''), { type: 'button', html: icon(on ? 'python' : 'cpu', 15) + '<span>' + (on ? 'بهینه‌سازی با پایتون (LP)' : 'محاسبه مجدد برنامه') + '</span>' });
    b.addEventListener('click', function () {
      UI.busy(b, function () {
        return IBP.supply.optimize().then(function (r) {
          UI.toast(r.engine === 'python' ? 'برنامه تولید بهینه با برنامه‌ریزی خطی محاسبه شد' : 'برنامه تولید با روش داخلی محاسبه شد', 'success');
          IBP.app.render(true);
        });
      });
    });
    var wrap = [b];
    if (run && run.engine === 'python') {
      wrap.push(h('button.btn', { type: 'button', html: icon('refresh', 15) + '<span>بازگشت به روش داخلی</span>', onclick: function () { IBP.supply.clearOptimized(); IBP.app.render(true); } }));
    }
    return wrap;
  }

  function kpis(pl) {
    var k = pl.kpi, kp = h('div.kpis');
    kp.appendChild(UI.kpi({ icon: 'target', label: 'سطح خدمت برنامه (Fill rate)', value: k.fillRate, format: function (v) { return F.pct(v, 1); }, foot: 'هدف ' + F.pct(S.settings().serviceLevelTarget || 0.95, 0) + ' · کمبود ' + F.money(k.shortageValue) }));
    kp.appendChild(UI.kpi({ icon: 'gear', label: 'میانگین بهره‌برداری خطوط', value: k.avgUtil, format: function (v) { return F.pct(v, 0); }, foot: F.num(pl.resources.length) + ' خط تولید' }));
    kp.appendChild(UI.kpi({ icon: 'alert', label: 'ماه‌های گلوگاه', value: k.bottlenecks, format: F.num, foot: 'خط × ماه با بار بیش از ظرفیت عادی' }));
    kp.appendChild(UI.kpi({ icon: 'layers', label: 'پیش‌ساخت فصلی', value: k.prebuildTons, format: function (v) { return F.num(v, 0); }, unit: 'تن', foot: 'تولید زودتر برای پوشش اوج' }));
    kp.appendChild(UI.kpi({ icon: 'clock', label: 'اضافه‌کاری لازم', value: k.overtimeHours, format: function (v) { return F.num(v, 0); }, unit: 'ساعت', foot: 'سقف ' + F.pct(pl.options.overtimePct, 0) + ' ظرفیت' }));
    kp.appendChild(UI.kpi({ icon: 'warehouse', label: 'محصولات زیر ذخیره اطمینان', value: k.belowSS, format: F.num, foot: 'در حداقل یک ماه افق' }));
    return kp;
  }

  /* ======================= برنامه تولید ======================= */
  function exportMps(pl) {
    var per = pl.periods;
    var mk = function (title, key, type) {
      var cols = [{ header: 'کد', value: function (r) { return r.product.code; }, type: 'code' }, { header: 'محصول', value: function (r) { return r.product.name; }, type: 'text' }, { header: 'واحد', value: function (r) { return r.product.uom; }, type: 'text' }];
      per.forEach(function (p, i) { cols.push({ header: J.year(p) + '/' + String(J.month(p)).padStart(2, '0'), type: type || 'int', value: function (r) { return r[key][i]; } }); });
      cols.push({ header: 'جمع', type: type || 'int', value: function (r) { return A.sum(r[key]); } });
      return { name: title, title: title + ' — چرخه ' + J.label(pl.cycle), columns: cols, rows: pl.rows, freezeCols: 2 };
    };
    var monthly = per.map(function (p, i) { return { p: p, i: i }; });
    return IBP.excel.exportTables({
      filename: 'برنامه تولید ' + J.label(pl.cycle),
      summary: { title: 'خلاصه برنامه تولید', pairs: [['روش', pl.engine === 'python' ? 'بهینه‌سازی خطی (پایتون)' : 'روش ابتکاری داخلی'], ['سطح خدمت برنامه', F.pct(pl.kpi.fillRate, 1)], ['پیش‌ساخت', F.num(pl.kpi.prebuildTons, 0) + ' تن'], ['اضافه‌کاری', F.num(pl.kpi.overtimeHours, 0) + ' ساعت'], ['ماه‌های گلوگاه', F.num(pl.kpi.bottlenecks), 'خط × ماه بالای ظرفیت عادی']] },
      sheets: [
        { name: 'خلاصه تناژ', title: 'تقاضا، تولید و موجودی (تن)', columns: [{ header: 'ماه', value: function (x) { return J.label(x.p); }, type: 'text' }, { header: 'تقاضا', value: function (x) { return pl.demTons[x.i]; }, type: 'num' }, { header: 'تولید', value: function (x) { return pl.prodTons[x.i]; }, type: 'num' }, { header: 'موجودی پایان ماه', value: function (x) { return pl.invTons[x.i]; }, type: 'num' }, { header: 'ارزش موجودی', value: function (x) { return pl.invValue[x.i]; }, type: 'money' }],
          rows: monthly, charts: [{ type: 'bar', x: 0, y: [1, 2], title: 'تقاضا و تولید (تن)' }, { type: 'line', x: 0, y: [3], title: 'موجودی پایان ماه (تن)', anchor: 'H22' }] },
        mk('تولید', 'production'), mk('تقاضا', 'demand'), mk('موجودی پایان ماه', 'inventory'), mk('ذخیره اطمینان', 'ss'), mk('کمبود', 'shortage'), mk('پیش‌ساخت', 'prebuild')
      ]
    });
  }

  function renderMps(root) {
    var pl = plan(), per = slice(pl.periods), n = per.length;
    var overrides = S.meta('mpsOverrides') || {};
    root.appendChild(kpis(pl));
    var grid = h('div.dash-grid');
    root.appendChild(grid);

    var sel = state.sel && pl.rows.some(function (r) { return r.product.id === state.sel; }) ? state.sel : null;
    var rowsF = state.family === 'all' ? pl.rows : pl.rows.filter(function (r) { return r.product.familyId === state.family; });
    var agg = function (key) { return per.map(function (_, i) { return A.sum(rowsF, function (r) { return tons(r.product, r[key][i]); }); }); };
    var c1 = UI.card({ title: sel ? S.name('products', sel) : 'تقاضا، تولید و موجودی' + (state.family !== 'all' ? ' — ' + S.name('families', state.family) : ''), sub: sel ? 'واحد محصول · ستون: تولید (پیش‌ساخت و اضافه‌کاری جدا) · خط: تقاضا، موجودی و ذخیره اطمینان' : 'تن · برای جزئیات هر ماه روی ستون کلیک کنید', icon: 'chart', span: 8,
      tools: sel ? [h('button.btn.btn-sm', { type: 'button', html: '<span>نمای کل</span>', onclick: function () { state.sel = null; IBP.app.render(true); } })] : [] });
    var box = h('div'); c1.body.appendChild(box);
    if (sel) {
      var r = pl.rows.filter(function (x) { return x.product.id === sel; })[0];
      var regular = slice(r.production).map(function (v, i) { return Math.max(0, v - r.prebuild[i] - r.overtime[i]); });
      C.columns(box, {
        labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, height: 290,
        series: [{ name: 'تولید عادی', values: regular, color: 'var(--series-1)' }, { name: 'پیش‌ساخت', values: slice(r.prebuild), color: 'var(--series-7)' }, { name: 'اضافه‌کاری', values: slice(r.overtime), color: 'var(--series-4)' }],
        lines: [{ name: 'تقاضا', values: slice(r.demand), color: 'var(--series-2)' }, { name: 'موجودی پایان ماه', values: slice(r.inventory), color: 'var(--series-3)' }, { name: 'ذخیره اطمینان', values: slice(r.ss), color: 'var(--text-2)', dash: true }],
        format: F.compact, tipFormat: function (v) { return F.num(v) + ' ' + (r.product.uom || ''); }
      });
    } else {
      C.columns(box, {
        labels: per.map(J.shortLabel), tipTitles: per.map(J.label), height: 290,
        series: [{ name: 'تقاضا', values: agg('demand'), color: 'var(--series-2)' }, { name: 'تولید', values: agg('production'), color: 'var(--series-1)' }],
        lines: [{ name: 'موجودی پایان ماه', values: agg('inventory'), color: 'var(--series-3)' }, { name: 'پیش‌ساخت', values: agg('prebuild'), color: 'var(--series-7)', dash: true }],
        format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' تن'; },
        onClick: function (i) { monthDetail(pl, i); }
      });
    }
    grid.appendChild(c1.el);

    // خانواده‌ها: سطح خدمت و پیش‌ساخت
    var fams = S.all('families').map(function (f) {
      var rs = pl.rows.filter(function (r) { return r.product.familyId === f.id; });
      var d = A.sum(rs, function (r) { return A.sum(slice(r.demand)); }), s = A.sum(rs, function (r) { return A.sum(slice(r.shortage)); });
      return { f: f, fill: d ? 1 - s / d : 1, tons: A.sum(rs, function (r) { return A.sum(slice(r.production), function (v) { return tons(r.product, v); }); }), n: rs.length };
    }).filter(function (x) { return x.n; });
    var c2 = UI.card({ title: 'سطح خدمت خانواده‌ها', sub: 'درصد تقاضای پوشش‌داده‌شده با برنامه · برای فیلتر کلیک کنید', icon: 'target', span: 4 });
    C.hbars(c2.body, {
      items: fams.map(function (x) { return { id: x.f.id, label: x.f.name, value: x.fill, color: x.fill >= (S.settings().serviceLevelTarget || 0.95) ? 'var(--good)' : x.fill >= 0.9 ? 'var(--warning)' : 'var(--critical)', sub: [{ label: 'تولید برنامه', value: F.num(x.tons, 0) + ' تن' }] }; }),
      format: function (v) { return F.pct(v, 1); }, max: 1, valueLabel: 'سطح خدمت', active: state.family,
      onClick: function (it) { state.family = state.family === it.id ? 'all' : it.id; state.sel = null; IBP.app.render(true); }
    });
    grid.appendChild(c2.el);

    // جدول برنامه تولید (قابل ویرایش)
    var nOv = Object.keys(overrides).reduce(function (s, k) { return s + Object.keys(overrides[k] || {}).length; }, 0);
    var c3 = UI.card({ title: 'برنامه تولید ماهانه', sub: 'مقدار تولید هر ماه قابل ویرایش است (بازنویسی برنامه خودکار) · زیر هر عدد: موجودی پایان ماه · رنگ: قرمز = کمبود، زرد = زیر ذخیره اطمینان، آبی = پیش‌ساخت', icon: 'table', span: 12, flush: true, exportFn: function () { return exportMps(pl); },
      tools: nOv ? [h('button.btn.btn-sm', { type: 'button', html: icon('refresh', 14) + '<span>حذف ' + F.num(nOv) + ' بازنویسی</span>', onclick: function () { S.setMeta('mpsOverrides', {}); IBP.supply.clearOptimized(); IBP.app.render(true); } })] : [] });
    var wrap = h('div.plan-wrap'), tbl = h('table.data-table.plan-table.mps-table');
    var hr = h('tr', h('th.pt-name', 'محصول'));
    var frozen = S.settings().frozenMonths || 0;
    per.forEach(function (p, i) { hr.appendChild(h('th.num' + (i < frozen ? '.frozen' : ''), { html: J.shortLabel(p) + (i < frozen ? '<div class="cell-sub">منجمد</div>' : '') })); });
    hr.appendChild(h('th.num', 'جمع'));
    hr.appendChild(h('th.num', 'سطح خدمت'));
    tbl.appendChild(h('thead', hr));
    var tb = h('tbody');
    rowsF.forEach(function (r) {
      var p = r.product, ov = overrides[p.id] || {};
      var tr = h('tr' + (sel === p.id ? '.sel' : ''));
      tr.appendChild(h('td.pt-name', { html: F.escape(p.name) + '<div class="cell-sub"><span class="code">' + F.escape(p.code) + '</span> · ' + F.escape(p.uom || '') + ' · ' + (p.abc || '') + (p.xyz || '') + ' · موجودی اول ' + F.num(r.open) + '</div>', onclick: function () { state.sel = state.sel === p.id ? null : p.id; IBP.app.render(true); window.scrollTo(0, 0); } }));
      per.forEach(function (period, i) {
        var cls = r.shortage[i] > 0.5 ? '.st-short' : r.inventory[i] < r.ss[i] * 0.999 - 0.5 ? '.st-ss' : r.prebuild[i] > 0.5 ? '.st-pre' : '';
        var inp = h('input.cell-input', { type: 'text', inputmode: 'numeric', value: F.num(r.production[i]), 'aria-label': p.name + ' ' + J.label(period) });
        if (ov[period] !== undefined) inp.classList.add('overridden');
        if (i < frozen) inp.disabled = true;
        inp.addEventListener('focus', function () { inp.select(); });
        inp.addEventListener('change', function () {
          var v = F.parseNumber(inp.value), all = S.meta('mpsOverrides') || {};
          all[p.id] = all[p.id] || {};
          if (v === null || isNaN(v) || inp.value.trim() === '') delete all[p.id][period]; else all[p.id][period] = Math.max(0, v);
          S.setMeta('mpsOverrides', all);
          IBP.supply.clearOptimized();
          IBP.app.render(true);
        });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
        var tip = 'تقاضا ' + F.num(r.demand[i]) + ' · ذخیره اطمینان ' + F.num(r.ss[i]) + (r.prebuild[i] > 0.5 ? ' · پیش‌ساخت ' + F.num(r.prebuild[i]) : '') + (r.overtime[i] > 0.5 ? ' · اضافه‌کاری ' + F.num(r.overtime[i]) : '') + (r.shortage[i] > 0.5 ? ' · کمبود ' + F.num(r.shortage[i]) : '');
        tr.appendChild(h('td.pt-cell' + cls + (i < frozen ? '.frozen' : ''), { title: tip }, inp, h('div.cell-sub.num', 'موجودی ' + F.num(r.inventory[i]))));
      });
      tr.appendChild(h('td.num.pt-total', F.num(A.sum(slice(r.production)))));
      var d = A.sum(slice(r.demand)), fill = d ? 1 - A.sum(slice(r.shortage)) / d : 1;
      tr.appendChild(h('td.num', { html: '<span class="delta ' + (fill >= (S.settings().serviceLevelTarget || 0.95) ? 'up-good' : 'down-bad') + '">' + F.pct(fill, 1) + '</span>' }));
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
    c3.body.appendChild(wrap);
    c3.body.appendChild(h('div.heat-legend', { html: '<i style="background:var(--critical-soft)"></i> کمبود <i style="background:var(--warning-soft)"></i> زیر ذخیره اطمینان <i style="background:var(--accent-soft)"></i> پیش‌ساخت <i style="box-shadow:inset 0 0 0 2px var(--series-4)"></i> بازنویسی دستی' }));
    grid.appendChild(c3.el);
  }

  function monthDetail(pl, i) {
    var per = pl.periods[i];
    var rows = pl.rows.filter(function (r) { return r.demand[i] > 0 || r.production[i] > 0; }).sort(function (a, b) { return tons(b.product, b.production[i]) - tons(a.product, a.production[i]); });
    var t = h('table.data-table');
    t.appendChild(h('thead', h('tr', h('th', 'محصول'), h('th.num', 'تقاضا'), h('th.num', 'تولید'), h('th.num', 'پیش‌ساخت'), h('th.num', 'اضافه‌کاری'), h('th.num', 'موجودی پایان'), h('th.num', 'کمبود'))));
    var tb = h('tbody');
    rows.forEach(function (r) {
      tb.appendChild(h('tr', h('td', r.product.name), h('td.num', F.num(r.demand[i])), h('td.num', F.num(r.production[i])), h('td.num', F.num(r.prebuild[i])), h('td.num', F.num(r.overtime[i])), h('td.num', F.num(r.inventory[i])),
        h('td.num', { html: r.shortage[i] > 0.5 ? '<span class="delta down-bad">' + F.num(r.shortage[i]) + '</span>' : '—' })));
    });
    t.appendChild(tb);
    UI.modal({ title: 'برنامه ' + J.label(per), size: 'lg', body: h('div', { style: { maxHeight: '60vh', overflow: 'auto' } }, t), actions: [{ label: 'بستن' }] });
  }

  /* ======================= ظرفیت ======================= */
  function exportCapacity(pl) {
    var per = pl.periods;
    var cols = [{ header: 'خط تولید', value: function (x) { return x.resource.name; }, type: 'text' }, { header: 'ظرفیت ماهانه (ساعت)', value: function (x) { return x.cap; }, type: 'num' }];
    per.forEach(function (p, i) { cols.push({ header: J.year(p) + '/' + String(J.month(p)).padStart(2, '0'), type: 'pct', value: function (x) { return x.util[i]; } }); });
    return IBP.excel.exportTables({ filename: 'ظرفیت خطوط ' + J.label(pl.cycle), sheets: [
      { name: 'بهره‌برداری', title: 'بهره‌برداری خطوط از ظرفیت عادی', columns: cols, rows: pl.resources, freezeCols: 1 },
      { name: 'گلوگاه‌ها', title: 'گلوگاه‌ها و راهکار', columns: [{ header: 'خط', value: function (x) { return x.res.resource.name; }, type: 'text' }, { header: 'ماه', value: function (x) { return J.label(per[x.i]); }, type: 'text' }, { header: 'بار (ساعت)', value: function (x) { return x.res.hours[x.i]; }, type: 'num' }, { header: 'ظرفیت (ساعت)', value: function (x) { return x.res.cap; }, type: 'num' }, { header: 'بهره‌برداری', value: function (x) { return x.res.util[x.i]; }, type: 'pct' }, { header: 'راهکار', value: function (x) { return remedy(x.res, x.i); }, type: 'text' }], rows: bottlenecks(pl) }
    ] });
  }
  function bottlenecks(pl) {
    var out = [];
    pl.resources.forEach(function (r) { r.util.forEach(function (u, i) { if (u > (S.settings().utilizationWarn || 0.85)) out.push({ res: r, i: i, u: u }); }); });
    return out.sort(function (a, b) { return b.u - a.u; });
  }
  function shiftHours(res) { var plant = S.get('plants', res.plantId); return (res.hoursPerShift || 8) * (plant && plant.workingDays || 25) * (res.efficiency || 1); }
  function remedy(r, i) {
    var u = r.util[i], over = r.hours[i] - r.cap;
    if (u <= 1) return u > (S.settings().utilizationWarn || 0.85) ? 'نزدیک سقف؛ پایش و آماده‌سازی اضافه‌کاری' : '';
    var sh = shiftHours(r.resource);
    if (r.resource.shifts < 3 && over > sh * 0.5) return 'افزودن شیفت (+' + F.num(sh, 0) + ' ساعت) یا انتقال به خط جایگزین';
    return 'اضافه‌کاری ' + F.num(over, 0) + ' ساعت یا پیش‌ساخت در ماه‌های کم‌بار';
  }

  function renderCapacity(root) {
    var pl = plan(), per = slice(pl.periods);
    root.appendChild(kpis(pl));
    var grid = h('div.dash-grid');
    root.appendChild(grid);
    var warn = S.settings().utilizationWarn || 0.85;
    var c1 = UI.card({ title: 'RCCP: بار برنامه تولید (MPS) بر خطوط', sub: 'برنامه‌ریزی ظرفیت سرانگشتی · درصد بهره‌برداری از ظرفیت عادی هر خط در هر ماه · برای تفکیک بار روی خط کلیک کنید', icon: 'gear', span: 12, exportFn: function () { return exportCapacity(pl); } });
    C.heatmap(c1.body, {
      corner: 'خط / ماه',
      rows: pl.resources.map(function (r) { return { id: r.resource.id, label: r.resource.name, sub: F.num(r.cap, 0) + ' ساعت · ' + F.num(r.resource.shifts) + ' شیفت', r: r }; }),
      cols: per.map(function (p, i) { return { id: i, label: J.shortLabel(p), title: J.label(p) }; }),
      value: function (row, col) { return row.r.util[col.id]; },
      format: function (v) { return F.pct(v, 0); }, valueLabel: 'بهره‌برداری',
      color: function (v) { return v > 1.001 ? 'color-mix(in srgb, var(--critical) 70%, transparent)' : C.scaleColor(v, 0.45, 1.08); },
      title: function (row, col) { return row.label + ' · ' + col.title + ' · ' + F.num(row.r.hours[col.id], 0) + ' از ' + F.num(row.r.cap, 0) + ' ساعت'; },
      onClick: function (row) { state.res = row.id; IBP.app.render(true); }
    });
    grid.appendChild(c1.el);

    var resSel = pl.resources.filter(function (r) { return r.resource.id === state.res; })[0] || pl.resources.slice().sort(function (a, b) { return b.peak - a.peak; })[0];
    if (resSel) {
      var pids = Object.keys(resSel.byProduct).sort(function (a, b) { return A.sum(resSel.byProduct[b]) - A.sum(resSel.byProduct[a]); });
      var top = pids.slice(0, 6), rest = pids.slice(6);
      var series = top.map(function (pid, i) { return { name: S.name('products', pid), values: slice(resSel.byProduct[pid]), color: C.seriesColor(i) }; });
      if (rest.length) series.push({ name: 'سایر', values: per.map(function (_, i) { return A.sum(rest, function (pid) { return resSel.byProduct[pid][i]; }); }), color: 'var(--series-8)' });
      var c2 = UI.card({ title: 'تفکیک بار: ' + resSel.resource.name, sub: 'ساعت تولید هر محصول در ماه · خط‌چین = ظرفیت عادی', icon: 'chart', span: 8 });
      var sel = h('select', { 'aria-label': 'خط تولید' });
      pl.resources.forEach(function (r) { sel.appendChild(h('option', { value: r.resource.id }, r.resource.name)); });
      sel.value = resSel.resource.id;
      sel.addEventListener('change', function () { state.res = sel.value; IBP.app.render(true); });
      c2.tools.appendChild(sel);
      var box = h('div'); c2.body.appendChild(box);
      C.columns(box, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, series: series, refLine: { value: resSel.cap, label: 'ظرفیت ' + F.num(resSel.cap, 0) + ' ساعت' }, format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' ساعت'; }, height: 290 });
      grid.appendChild(c2.el);
    }

    // RCCP به تفکیک خانواده (Bill of Resources): ساعت لازم هر خانواده در برابر ظرفیت کل خطوط
    var famOf = {};
    S.all('products').forEach(function (p) { famOf[p.id] = p.familyId; });
    var fams = S.all('families'), capTot = A.sum(pl.resources, function (r) { return r.cap; });
    var fh = {};
    pl.resources.forEach(function (r) { Object.keys(r.byProduct).forEach(function (pid) { var f = famOf[pid]; fh[f] = fh[f] || per.map(function () { return 0; }); per.forEach(function (_, i) { fh[f][i] += r.byProduct[pid][i] || 0; }); }); });
    var cR = UI.card({ title: 'RCCP به تفکیک خانواده محصول', sub: 'ساعت تولید لازم برای برنامه هر خانواده · خط‌چین = ظرفیت عادی کل خطوط (' + F.num(capTot, 0) + ' ساعت)', icon: 'layers', span: 12 });
    var rb = h('div'); cR.body.appendChild(rb);
    C.columns(rb, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), stacked: true, height: 260,
      series: fams.filter(function (f) { return fh[f.id]; }).map(function (f, i) { return { name: f.name, values: fh[f.id], color: f.color || C.seriesColor(i) }; }),
      lines: [{ name: 'ظرفیت با اضافه‌کاری', values: per.map(function () { return capTot * (1 + (pl.options.overtimePct || 0)); }), color: 'var(--critical)', dash: true }],
      refLine: { value: capTot, label: 'ظرفیت عادی' }, format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' ساعت'; } });
    grid.appendChild(cR.el);

    var bn = bottlenecks(pl);
    var c3 = UI.card({ title: 'گلوگاه‌ها و راهکار', sub: 'ماه‌هایی که بار بیش از ' + F.pct(warn, 0) + ' ظرفیت است', icon: 'alert', span: 4, flush: true });
    if (!bn.length) c3.body.appendChild(h('div.cell-sub', { style: { padding: '16px 18px' } }, 'در افق برنامه گلوگاهی وجود ندارد.'));
    var list = h('ul.alerts');
    bn.slice(0, 12).forEach(function (x) {
      list.appendChild(h('li.alert-item',
        h('div.alert-icon.' + (x.u > 1 ? 'critical' : 'warning'), { html: icon(x.u > 1 ? 'critical' : 'alert', 16) }),
        h('div', h('div.alert-text', x.res.resource.name + ' · ' + J.label(pl.periods[x.i]) + ' — ' + F.pct(x.u, 0)), h('div.alert-detail', remedy(x.res, x.i)))));
    });
    c3.body.appendChild(list);
    grid.appendChild(c3.el);

    var c4 = UI.card({ title: 'خلاصه خطوط', sub: 'ظرفیت، بار و اوج بهره‌برداری در افق', icon: 'list', span: 12, flush: true });
    IBP.grid(c4.body, {
      rows: function () { return pl.resources; }, pageSize: 20,
      onRowClick: function (r) { state.res = r.resource.id; IBP.app.render(true); window.scrollTo(0, 0); },
      columns: [
        { key: 'n', label: 'خط تولید', value: function (r) { return r.resource.name; }, render: function (r) { return F.escape(r.resource.name) + '<div class="cell-sub code">' + F.escape(r.resource.code) + '</div>'; } },
        { key: 's', label: 'شیفت', align: 'num', value: function (r) { return r.resource.shifts; } },
        { key: 'c', label: 'ظرفیت ماهانه (ساعت)', align: 'num', value: function (r) { return r.cap; }, render: function (r) { return F.num(r.cap, 0); } },
        { key: 'h', label: 'بار افق (ساعت)', align: 'num', value: function (r) { return A.sum(slice(r.hours)); }, render: function (r) { return F.num(A.sum(slice(r.hours)), 0); } },
        { key: 'a', label: 'میانگین بهره‌برداری', align: 'num', value: function (r) { return r.avg; }, render: function (r) { return F.pct(r.avg, 0); } },
        { key: 'p', label: 'اوج', align: 'num', value: function (r) { return r.peak; }, render: function (r) { return '<span class="delta ' + (r.peak > 1 ? 'down-bad' : r.peak > warn ? 'flat' : 'up-good') + '">' + F.pct(r.peak, 0) + '</span>'; } },
        { key: 'o', label: 'اضافه‌کاری (ساعت)', align: 'num', value: function (r) { return A.sum(r.overtime); }, render: function (r) { return F.num(A.sum(r.overtime), 0); } },
        { key: 'sp', label: 'روند بار', sortable: false, render: function (r) { return C.sparkline(slice(r.util).map(function (u) { return u || 0; }), { width: 100, height: 26 }); } }
      ]
    });
    grid.appendChild(c4.el);
  }

  /* ======================= صفحه ======================= */
  function render(root, params) {
    var tab = TABS.some(function (t) { return t[0] === params[0]; }) ? params[0] : 'mps';
    var tabs = h('div.tabbar', { role: 'tablist' });
    TABS.forEach(function (t) { tabs.appendChild(h('a.tab' + (t[0] === tab ? '.on' : ''), { href: '#/supply/' + t[0], role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', html: icon(t[2], 16) + '<span>' + t[1] + '</span>' })); });
    var st = S.settings();
    var monthsSel = h('div.seg', [6, 12, 18].map(function (m) { return h('button' + (state.months === m ? '.on' : ''), { type: 'button', onclick: function () { state.months = m; IBP.app.render(true); } }, F.num(m) + ' ماه'); }));
    if (!S.count('products')) {
      root.appendChild(UI.pageHead({ title: 'تأمین و ظرفیت' }));
      root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.')));
      return;
    }
    var pl = plan();
    root.appendChild(UI.pageHead({
      title: 'تأمین و ظرفیت',
      badge: pl.engine === 'python' ? UI.statusBadge('ai', 'بهینه‌سازی خطی') : UI.statusBadge('neutral', 'روش ابتکاری داخلی'),
      desc: st.companyName + ' · چرخه ' + J.label(pl.cycle) + ' · مبنای تقاضا: برنامه ' + (pl.options.version || 'اجماعی') + ' · ذخیره اطمینان ' + (pl.options.ssMethod === 'days' ? 'بر اساس روز' : 'آماری با سطح خدمت ' + F.pct(pl.options.serviceLevel, 0)),
      actions: [monthsSel].concat(engineBtn())
    }));
    root.appendChild(tabs);
    var host = h('div');
    root.appendChild(host);
    ({ mps: renderMps, capacity: renderCapacity })[tab](host);
  }

  IBP.register('supply', { title: 'تأمین و ظرفیت', render: render });
})(window.IBP = window.IBP || {});
