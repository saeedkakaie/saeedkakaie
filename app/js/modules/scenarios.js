/*
 * سناریوها (فاز ۵): ساخت سناریوهای «اگر... آنگاه...» با محرک‌های تقاضا (کل یا خانواده)، قیمت، مواد، ارز، تبدیل و ظرفیت؛
 * بازسازی برنامه تولید و سود و زیان هر سناریو، مقایسه کنار هم، شبیه‌سازی مونت‌کارلو و ثبت سناریوی منتخب با دلیل تصمیم.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var FN = function () { return IBP.finance; };
  var cache = { v: -1, res: {} };
  var state = { mc: null, mcResult: null, mcBusy: false };

  function sc() { return S.settings().displayScale || 1e9; }
  function m(v) { return v / sc(); }
  function money(v) { return F.money(v, { digits: 0 }); }
  function uid() { return 'sc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /** نتیجه سناریو با کش (بر اساس نسخه داده و محرک‌ها) */
  function result(s) {
    if (cache.v !== S.version) cache = { v: S.version, res: {} };
    var key = JSON.stringify(s.drivers || {});
    if (!cache.res[key]) cache.res[key] = FN().runScenario(s);
    return cache.res[key];
  }
  function base() { return { id: 'base', name: 'برنامه پایه', color: '#2a78d6', drivers: {}, note: 'برنامه اجماعی و ظرفیت فعلی' }; }

  var KPIS = [
    ['revenue', 'درآمد ۱۲ ماه', 'money'], ['gross', 'سود ناخالص', 'money'], ['gm', 'حاشیه ناخالص', 'pct'], ['operating', 'سود عملیاتی برنامه', 'money'],
    ['lost', 'فروش ازدست‌رفته', 'money'], ['fillRate', 'سطح خدمت', 'pct'], ['util', 'بهره‌برداری خطوط', 'pct'], ['invEnd', 'موجودی پایان دوره', 'money'], ['nwcEnd', 'سرمایه در گردش', 'money'], ['tons', 'تناژ فروش', 'tons']
  ];
  function fmtK(v, t) { return v === null || v === undefined ? '—' : t === 'pct' ? F.pct(v, 1) : t === 'tons' ? F.num(v, 0) + ' تن' : money(v); }

  function driverChips(d) {
    var out = [];
    FN().DRIVERS.forEach(function (dr) { var v = (d || {})[dr.key]; if (v) out.push(UI.statusBadge(v > 0 ? 'info' : 'warning', dr.label.replace('تغییر ', '') + ' ' + (v > 0 ? '+' : '') + F.num(v) + '٪')); });
    var fam = (d || {}).families || {};
    Object.keys(fam).forEach(function (fid) { if (fam[fid]) out.push(UI.statusBadge('neutral', S.name('families', fid) + ' ' + (fam[fid] > 0 ? '+' : '') + F.num(fam[fid]) + '٪')); });
    return out.length ? out.join('') : UI.statusBadge('neutral', 'بدون تغییر');
  }

  /* ---------------- ویرایشگر سناریو ---------------- */
  function editor(s0) {
    var s = JSON.parse(JSON.stringify(s0 || { id: uid(), name: 'سناریوی جدید', color: '#6250d6', drivers: {}, note: '' }));
    s.drivers = s.drivers || {}; s.drivers.families = s.drivers.families || {};
    var name = h('input', { type: 'text', value: s.name }), note = h('textarea', { rows: 2 }, s.note || '');
    var color = h('input', { type: 'color', value: s.color || '#6250d6' });
    var preview = h('div.sc-preview');
    var drawPreview = UI.debounce(function () {
      var r = FN().runScenario({ drivers: s.drivers }).kpi, b = result(base()).kpi;
      preview.innerHTML = [['سود ناخالص', r.gross, b.gross, 'money'], ['درآمد', r.revenue, b.revenue, 'money'], ['سطح خدمت', r.fillRate, b.fillRate, 'pct']].map(function (x) {
        var d = x[3] === 'pct' ? x[1] - x[2] : (x[2] ? x[1] / x[2] - 1 : 0);
        return '<div><span>' + x[0] + '</span><b>' + fmtK(x[1], x[3]) + '</b><span class="delta ' + (d >= 0 ? 'up-good' : 'down-bad') + '">' + (x[3] === 'pct' ? (d >= 0 ? '+' : '') + F.num(d * 100, 1) + ' واحد' : F.signedPct(d)) + '</span></div>';
      }).join('');
    }, 250);
    var sliders = FN().DRIVERS.map(function (dr) {
      var v = s.drivers[dr.key] || 0, out = h('b.sl-v', (v > 0 ? '+' : '') + F.num(v) + '٪');
      var inp = h('input', { type: 'range', min: dr.min, max: dr.max, step: dr.step, value: v, 'aria-label': dr.label });
      inp.addEventListener('input', function () { s.drivers[dr.key] = +inp.value; out.textContent = (inp.value > 0 ? '+' : '') + F.num(+inp.value) + '٪'; drawPreview(); });
      return h('div.sl-row', h('label', dr.label), inp, out);
    });
    var famBox = h('div.form-grid');
    S.all('families').forEach(function (fm) {
      var inp = h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', value: s.drivers.families[fm.id] || '', placeholder: '0' });
      inp.addEventListener('change', function () { var v = F.parseNumber(inp.value); if (v) s.drivers.families[fm.id] = v; else delete s.drivers.families[fm.id]; drawPreview(); });
      famBox.appendChild(h('div.field', h('label', fm.name + ' (٪)'), inp));
    });
    var body = h('div',
      h('div.form-grid', h('div.field.wide', h('label', 'نام سناریو'), name), h('div.field', h('label', 'رنگ'), color)),
      h('div.sl-box', sliders),
      h('details.sc-fam', h('summary', 'تغییر تقاضای خانواده‌ها (علاوه بر تغییر کل)'), famBox),
      h('div.field', { style: { marginTop: '10px' } }, h('label', 'فرضیات و توضیح'), note),
      h('div.cell-sub', { style: { margin: '10px 0 4px' } }, 'پیش‌نمایش نسبت به برنامه پایه:'), preview);
    drawPreview();
    UI.modal({ title: s0 ? 'ویرایش سناریو' : 'سناریوی جدید', size: 'lg', body: body, actions: [{ label: 'انصراف' }, { label: 'ذخیره سناریو', primary: true, onClick: function () {
      s.name = name.value.trim() || 'سناریو'; s.note = note.value.trim(); s.color = color.value;
      var list = FN().list().filter(function (x) { return x.id !== s.id; });
      s.updatedAt = new Date().toISOString(); if (!s.createdAt) s.createdAt = s.updatedAt;
      list.push(s);
      FN().save(list).then(function () { UI.toast('سناریو «' + s.name + '» ذخیره شد', 'success'); IBP.app.render(true); });
    } }] });
  }

  function choose(s) {
    var reason = h('textarea', { rows: 3, placeholder: 'دلیل انتخاب این سناریو برای جلسه بازنگری مدیریت…' });
    UI.modal({ title: 'انتخاب «' + s.name + '» به‌عنوان سناریوی نهایی', body: h('div.field', h('label', 'دلیل تصمیم'), reason), actions: [{ label: 'انصراف' }, { label: 'ثبت تصمیم', primary: true, onClick: function () {
      var list = FN().list().map(function (x) { x.chosen = x.id === s.id; if (x.id === s.id) x.decision = { at: new Date().toISOString(), reason: reason.value.trim() }; return x; });
      FN().save(list).then(function () { UI.toast('سناریوی نهایی ثبت شد', 'success'); IBP.app.render(true); });
    } }] });
  }

  /* ---------------- مونت‌کارلو ---------------- */
  function mcCard(all) {
    var sel = all.filter(function (x) { return x.id === state.mc; })[0] || all[0];
    var card = UI.card({ title: 'شبیه‌سازی مونت‌کارلو', sub: 'عدم قطعیت تقاضا بر اساس خطای بک‌تست هر محصول؛ فروش به تولید و موجودی برنامه محدود است', icon: 'python', span: 12 });
    var s = h('select', { 'aria-label': 'سناریو' });
    all.forEach(function (x) { s.appendChild(h('option', { value: x.id }, x.name)); });
    s.value = sel.id;
    s.addEventListener('change', function () { state.mc = s.value; state.mcResult = null; IBP.app.render(true); });
    var btn = h('button.btn.btn-primary.btn-sm', { type: 'button', html: icon('play', 14) + '<span>' + (IBP.engine.online() ? 'اجرای ۵٬۰۰۰ شبیه‌سازی (پایتون)' : 'اجرای ۱٬۰۰۰ شبیه‌سازی') + '</span>' });
    btn.addEventListener('click', function () {
      UI.busy(btn, function () {
        return FN().monteCarlo(result(sel)).then(function (r) { state.mc = sel.id; state.mcResult = r; IBP.app.render(true); });
      });
    });
    card.tools.appendChild(s); card.tools.appendChild(btn);
    var r = state.mcResult && state.mc === sel.id ? state.mcResult : null;
    if (!r) { card.body.appendChild(h('div.cell-sub', 'سناریو را انتخاب و شبیه‌سازی را اجرا کنید.')); return card; }
    var kp = h('div.kpis', { style: { marginBottom: '14px' } });
    kp.appendChild(UI.kpi({ icon: 'trend', label: 'سود ناخالص P10 (بدبینانه)', value: m(r.gross.p10), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: '۹۰٪ احتمال بیشتر از این' }));
    kp.appendChild(UI.kpi({ icon: 'target', label: 'سود ناخالص P50 (میانه)', value: m(r.gross.p50), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'برنامه قطعی: ' + money(result(sel).kpi.gross) }));
    kp.appendChild(UI.kpi({ icon: 'sparkles', label: 'سود ناخالص P90 (خوش‌بینانه)', value: m(r.gross.p90), format: function (v) { return F.num(v, 0); }, unit: F.moneyUnit(), foot: 'سقف با ظرفیت برنامه' }));
    kp.appendChild(UI.kpi({ icon: 'coins', label: 'احتمال تحقق سود بودجه', value: r.probGrossBudget, format: function (v) { return F.pct(v, 0); }, text: '—', foot: 'در ماه‌های دارای بودجه' }));
    kp.appendChild(UI.kpi({ icon: 'chart', label: 'احتمال تحقق درآمد بودجه', value: r.probRevenueBudget, format: function (v) { return F.pct(v, 0); }, text: '—', foot: 'درآمد P50: ' + money(r.revenue.p50) }));
    kp.appendChild(UI.kpi({ icon: 'factory', label: 'سطح خدمت P10 تا P90', text: F.pct(r.fill.p10, 0) + ' – ' + F.pct(r.fill.p90, 0), foot: F.num(r.runs) + ' اجرا · ' + (r.engine === 'python' ? 'موتور پایتون' : 'موتور داخلی') }));
    card.body.appendChild(kp);
    var hb = h('div'); card.body.appendChild(hb);
    var labels = r.hist.counts.map(function (_, i) { return F.num(m(r.hist.lo + (i + 0.5) * r.hist.width), 0); });
    var cols = r.hist.counts.map(function (_, i) { var v = r.hist.lo + (i + 0.5) * r.hist.width; return v < r.gross.p10 ? 'var(--series-2)' : v > r.gross.p90 ? 'var(--series-3)' : 'var(--series-1)'; });
    C.columns(hb, { labels: labels, tipTitles: r.hist.counts.map(function (_, i) { return 'سود ناخالص ' + F.num(m(r.hist.lo + i * r.hist.width), 0) + ' تا ' + F.num(m(r.hist.lo + (i + 1) * r.hist.width), 0) + ' ' + F.moneyUnit(); }),
      series: [{ name: 'تعداد اجرا', values: r.hist.counts, colors: cols, color: 'var(--series-1)' }], format: function (v) { return F.num(v); }, height: 240, dataLabels: false });
    card.body.appendChild(h('div.heat-legend', { html: '<i style="background:var(--series-2)"></i> زیر P10 <i style="background:var(--series-1)"></i> بین P10 و P90 <i style="background:var(--series-3)"></i> بالای P90 · محور افقی: سود ناخالص ۱۲ ماه (' + F.moneyUnit() + ')' }));
    return card;
  }

  /* ---------------- صفحه ---------------- */
  function exportAll(all, res) {
    var cols = [{ header: 'شاخص', value: function (k) { return k[1]; }, type: 'text', width: 24 }];
    all.forEach(function (s, i) { cols.push({ header: s.name, value: function (k) { return res[i].kpi[k[0]]; }, type: 'money' }); });
    var rows = KPIS.slice();
    return IBP.excel.exportTables({ filename: 'مقایسه سناریوها', sheets: [
      { name: 'مقایسه', title: 'مقایسه سناریوها (۱۲ ماه)', columns: cols, rows: rows.filter(function (k) { return k[2] === 'money'; }) },
      { name: 'نسبت‌ها', title: 'نسبت‌های سناریوها', columns: [{ header: 'شاخص', value: function (k) { return k[1]; }, type: 'text' }].concat(all.map(function (s, i) { return { header: s.name, value: function (k) { return res[i].kpi[k[0]]; }, type: 'pct' }; })), rows: KPIS.filter(function (k) { return k[2] === 'pct'; }) },
      { name: 'محرک‌ها', title: 'فرضیات سناریوها', columns: [{ header: 'سناریو', value: function (s) { return s.name; }, type: 'text' }].concat(FN().DRIVERS.map(function (dr) { return { header: dr.label + ' (٪)', value: function (s) { return (s.drivers || {})[dr.key] || 0; }, type: 'num' }; })).concat([{ header: 'توضیح', value: function (s) { return s.note || ''; }, type: 'text' }, { header: 'منتخب', value: function (s) { return s.chosen ? 'بله — ' + ((s.decision || {}).reason || '') : ''; }, type: 'text' }]), rows: all },
      { name: 'سود ناخالص', title: 'سود ناخالص و عملیاتی سناریوها', columns: [{ header: 'سناریو', value: function (x) { return x.s.name; }, type: 'text' }, { header: 'سود ناخالص', value: function (x) { return x.r.kpi.gross; }, type: 'money' }, { header: 'سود عملیاتی', value: function (x) { return x.r.kpi.operating; }, type: 'money' }], rows: all.map(function (s, i) { return { s: s, r: res[i] }; }), charts: [{ type: 'bar', x: 0, y: [1, 2], title: 'سود سناریوها' }] }
    ] });
  }

  function render(root) {
    if (!S.count('products')) { root.appendChild(UI.pageHead({ title: 'سناریوها' })); root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.'))); return; }
    var saved = FN().list(), all = [base()].concat(saved), res = all.map(result), b = res[0].kpi;
    var addBtn = h('button.btn.btn-primary', { type: 'button', html: icon('plus', 16) + '<span>سناریوی جدید</span>', onclick: function () { editor(null); } });
    var presetBtn = h('button.btn', { type: 'button', html: icon('wand', 16) + '<span>سناریوهای نمونه</span>', onclick: function () {
      var have = saved.map(function (x) { return x.name; });
      var add = FN().presets().filter(function (p) { return have.indexOf(p.name) < 0; }).map(function (p) { p.id = uid(); p.createdAt = new Date().toISOString(); return p; });
      FN().save(saved.concat(add)).then(function () { UI.toast(F.num(add.length) + ' سناریوی نمونه افزوده شد', 'success'); IBP.app.render(true); });
    } });
    root.appendChild(UI.pageHead({ title: 'سناریوها', badge: UI.statusBadge('info', F.num(saved.length) + ' سناریو'), desc: S.settings().companyName + ' · هر سناریو برنامه تولید (با محدودیت ظرفیت) و سود و زیان را دوباره می‌سازد · افق ۱۲ ماه',
      actions: [presetBtn, UI.excelButton('خروجی مقایسه', function () { return exportAll(all, res); }), addBtn] }));

    var grid = h('div.dash-grid'); root.appendChild(grid);
    // کارت‌های سناریو
    var cards = h('div.sc-grid', { style: { gridColumn: 'span 12' } });
    all.forEach(function (s, i) {
      var k = res[i].kpi, dg = b.gross ? k.gross / b.gross - 1 : 0;
      var el = h('article.card.sc-card' + (s.chosen ? '.chosen' : ''), { style: { '--sc': s.color || C.seriesColor(i) } },
        h('div.sc-head', h('span.sc-dot'), h('div', { style: { minWidth: 0 } }, h('div.sc-name', s.name), h('div.cell-sub', s.note || '')), s.chosen ? h('span', { html: UI.statusBadge('good', 'منتخب') }) : null),
        h('div.sc-chips', { html: driverChips(s.drivers) }),
        h('div.sc-stats',
          h('div', h('span', 'سود ناخالص'), h('b', money(k.gross)), s.id !== 'base' ? h('span.delta.' + (dg >= 0 ? 'up-good' : 'down-bad'), F.signedPct(dg)) : null),
          h('div', h('span', 'درآمد'), h('b', money(k.revenue))),
          h('div', h('span', 'سطح خدمت'), h('b', F.pct(k.fillRate, 1))),
          h('div', h('span', 'حاشیه'), h('b', F.pct(k.gm, 1)))),
        s.decision && s.decision.reason ? h('div.sc-decision', { html: icon('check', 14) + '<span>' + F.escape(s.decision.reason) + '</span>' }) : null,
        h('div.sc-actions',
          h('button.btn.btn-sm', { type: 'button', html: icon('python', 14) + '<span>مونت‌کارلو</span>', onclick: function () { state.mc = s.id; state.mcResult = null; IBP.app.render(true); setTimeout(function () { var x = document.querySelector('.mc-anchor'); if (x) x.scrollIntoView({ behavior: 'smooth' }); }, 50); } }),
          s.id !== 'base' ? h('button.btn.btn-sm', { type: 'button', html: icon('check', 14) + '<span>انتخاب نهایی</span>', onclick: function () { choose(s); } }) : null,
          s.id !== 'base' ? h('button.icon-btn', { type: 'button', title: 'ویرایش', 'aria-label': 'ویرایش سناریو', html: icon('edit', 15), onclick: function () { editor(s); } }) : null,
          s.id !== 'base' ? h('button.icon-btn.danger', { type: 'button', title: 'حذف', 'aria-label': 'حذف سناریو', html: icon('trash', 15), onclick: function () {
            UI.confirm('سناریو «' + s.name + '» حذف شود؟', { danger: true, ok: 'حذف' }).then(function (ok) { if (ok) FN().save(saved.filter(function (x) { return x.id !== s.id; })).then(function () { IBP.app.render(true); }); });
          } }) : null));
      cards.appendChild(el);
    });
    grid.appendChild(cards);

    var c1 = UI.card({ title: 'مقایسه سود سناریوها', sub: 'سود ناخالص و سود عملیاتی ۱۲ ماه (' + F.moneyUnit() + ') · خط‌چین: برنامه پایه', icon: 'chart', span: 7 });
    var b1 = h('div'); c1.body.appendChild(b1);
    C.columns(b1, { labels: all.map(function (s) { return s.name; }), height: 280,
      series: [{ name: 'سود ناخالص', values: res.map(function (r) { return m(r.kpi.gross); }), colors: all.map(function (s, i) { return s.color || C.seriesColor(i); }), color: 'var(--series-1)' }, { name: 'سود عملیاتی برنامه', values: res.map(function (r) { return m(r.kpi.operating); }), color: 'var(--series-8)' }],
      refLine: { value: m(b.gross), label: 'پایه' }, format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); } });
    grid.appendChild(c1.el);

    var c2 = UI.card({ title: 'سطح خدمت و فروش ازدست‌رفته', sub: 'اثر ظرفیت بر هر سناریو', icon: 'factory', span: 5 });
    C.hbars(c2.body, { items: all.map(function (s, i) { return { label: s.name, value: res[i].kpi.fillRate, color: s.color || C.seriesColor(i), sub: [{ label: 'فروش ازدست‌رفته', value: money(res[i].kpi.lost) }, { label: 'بهره‌برداری خطوط', value: F.pct(res[i].kpi.util, 0) }] }; }), format: function (v) { return F.pct(v, 1); }, max: 1, valueLabel: 'سطح خدمت' });
    grid.appendChild(c2.el);

    // جدول مقایسه
    var c3 = UI.card({ title: 'جدول مقایسه سناریوها', sub: 'اختلاف با برنامه پایه زیر هر عدد', icon: 'table', span: 12, flush: true, exportFn: function () { return exportAll(all, res); } });
    var t = h('table.data-table.plan-table'), hr = h('tr', h('th.pt-name', 'شاخص'));
    all.forEach(function (s) { hr.appendChild(h('th.num', { html: '<span class="sc-th" style="--sc:' + F.escape(s.color || '#2a78d6') + '"></span>' + F.escape(s.name) })); });
    t.appendChild(h('thead', hr));
    var tb = h('tbody');
    KPIS.forEach(function (k) {
      var tr = h('tr', h('td.pt-name', k[1]));
      res.forEach(function (r, i) {
        var v = r.kpi[k[0]], bv = b[k[0]], d = null;
        if (i > 0 && v !== null && bv !== null && v !== undefined) d = k[2] === 'pct' ? (v - bv) * 100 : (bv ? v / bv - 1 : null);
        var good = k[0] === 'lost' || k[0] === 'invEnd' || k[0] === 'nwcEnd' ? d !== null && d <= 0 : d !== null && d >= 0;
        tr.appendChild(h('td.num', { html: fmtK(v, k[2]) + (d !== null && Math.abs(d) > 1e-9 ? '<div class="cell-sub"><span class="delta ' + (good ? 'up-good' : 'down-bad') + '">' + (k[2] === 'pct' ? (d > 0 ? '+' : '') + F.num(d, 1) + ' واحد' : F.signedPct(d)) + '</span></div>' : '') }));
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    c3.body.appendChild(h('div.plan-wrap', t));
    grid.appendChild(c3.el);

    var mc = mcCard(all);
    mc.el.classList.add('mc-anchor');
    grid.appendChild(mc.el);
  }

  IBP.register('scenarios', { title: 'سناریوها', render: render });
})(window.IBP = window.IBP || {});
