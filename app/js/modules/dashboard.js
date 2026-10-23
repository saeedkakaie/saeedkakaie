/*
 * داشبورد مدیریتی: شاخص‌های کلیدی، روند فروش و پیش‌بینی، ظرفیت، هشدارها و چرخه IBP.
 * فیلترهای بالای صفحه (خانواده و کارخانه) روی همه بخش‌ها و خروجی‌های Excel اعمال می‌شوند.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var state = { family: '', plant: '', mode: 'revenue' };
  var STATUS_LABEL = { critical: 'کمبود', warning: 'نزدیک ذخیره اطمینان', excess: 'مازاد', ok: 'مناسب' };
  var STATUS_LEVEL = { critical: 'critical', warning: 'warning', excess: 'excess', ok: 'good' };

  function deltaHtml(v, upIsGood, suffix) {
    if (v === null || v === undefined || !isFinite(v)) return '<span class="delta flat">—</span>';
    var cls = Math.abs(v) < 0.005 ? 'flat' : (v > 0 ? (upIsGood ? 'up-good' : 'up-bad') : (upIsGood ? 'down-bad' : 'down-good'));
    var arrow = Math.abs(v) < 0.005 ? '' : (v > 0 ? '▲' : '▼');
    return '<span class="delta ' + cls + '">' + arrow + ' ' + F.signedPct(v) + '</span>' + (suffix ? '<span>' + suffix + '</span>' : '');
  }

  /** همه محاسبات داشبورد برای فیلتر جاری (مشترک بین نمایش و خروجی Excel) */
  function model() {
    var ctx = A.ctx(), st = ctx.settings, cycle = ctx.cycle, last = ctx.lastActual;
    var fam = state.family && S.get('families', state.family) ? state.family : '';
    var plant = state.plant && S.get('plants', state.plant) ? state.plant : '';
    state.family = fam; state.plant = plant;
    var pf = null;
    if (fam || plant) {
      pf = function (p) { return (!fam || p.familyId === fam) && (!plant || p.plantId === plant); };
      pf.key = fam + '|' + plant;
    }
    var M = { ctx: ctx, st: st, cycle: cycle, last: last, fam: fam, plant: plant, pf: pf, scale: st.displayScale || 1e9 };
    M.unit = F.moneyUnit(M.scale);
    M.scopeLabel = [fam ? S.name('families', fam) : 'همه خانواده‌ها', plant ? S.name('plants', plant) : 'همه کارخانه‌ها'].join(' · ');
    M.hist24 = J.range(J.addMonths(cycle, -24), 24);
    M.ltm = M.hist24.slice(12); M.prev12 = M.hist24.slice(0, 12);
    M.next12 = J.range(cycle, 12);
    var next3 = J.range(cycle, 3);
    M.ltmSeries = A.salesSeries(M.ltm, pf);
    var prevSeries = A.salesSeries(M.prev12, pf);
    M.revLtm = A.sum(M.ltmSeries, function (x) { return x.revenue; });
    M.revPrev = A.sum(prevSeries, function (x) { return x.revenue; });
    M.margin = M.revLtm ? 1 - A.sum(M.ltmSeries, function (x) { return x.cost; }) / M.revLtm : null;
    M.marginPrev = M.revPrev ? 1 - A.sum(prevSeries, function (x) { return x.cost; }) / M.revPrev : null;
    var fsm = st.fiscalStartMonth || 1, fy = J.fiscalYear(last, fsm);
    var ytd = J.between(J.period(fy, fsm), last);
    M.ytdAct = A.sum(ytd, function (p) { return A.salesTotal(p, pf).revenue; });
    M.ytdBud = A.sum(ytd, function (p) { return A.budgetTotal(p, pf).revenue; });
    M.lastAct = A.salesTotal(last, pf).revenue; M.lastBud = A.budgetTotal(last, pf).revenue;
    M.acc3 = A.accuracy(J.range(J.addMonths(cycle, -3), 3), pf);
    M.acc12 = A.accuracy(J.range(J.addMonths(cycle, -12), 12), pf);
    M.cov = A.coverage().filter(function (c) { return !pf || pf(c.product); });
    M.invValue = A.sum(M.cov, function (c) { return c.value; });
    var cogsNext = A.sum(next3, function (p) { return A.forecastTotal(p, 'اجماعی', cycle, pf).cost; }) / 3;
    M.monthsCover = cogsNext ? M.invValue / cogsNext : null;
    M.shortCount = M.cov.filter(function (c) { return c.status === 'critical'; }).length;
    var famRes = null;
    if (fam) {
      famRes = new Set();
      S.all('routings').forEach(function (r) { var p = S.get('products', r.productId); if (p && p.familyId === fam) famRes.add(r.resourceId); });
    }
    M.resFilter = function (r) { return (!plant || r.plantId === plant) && (!famRes || famRes.has(r.id)); };
    M.periods6 = J.range(cycle, 6);
    M.cap6 = A.capacityLoad(M.periods6).filter(function (r) { return M.resFilter(r.resource); }).sort(function (a, b) { return b.peak - a.peak; });
    var h3 = 0, c3 = 0;
    M.cap6.forEach(function (r) { r.periods.slice(0, 3).forEach(function (p) { h3 += p.hours; c3 += p.capacity; }); });
    M.util3 = c3 ? h3 / c3 : null;
    M.hotLines = M.cap6.filter(function (r) { return r.peak > (st.utilizationWarn || 0.85); }).length;
    M.overLines = M.cap6.filter(function (r) { return r.peak > (st.utilizationMax || 1); }).length;
    M.accTarget = st.forecastAccuracyTarget || 0.8;
    // روند
    M.trend = M.hist24.concat(M.next12).map(function (p, i) {
      var isHist = i < 24, a = isHist ? A.salesTotal(p, pf) : null, f = isHist ? null : A.forecastTotal(p, 'اجماعی', cycle, pf), b = A.budgetTotal(p, pf);
      return { period: p, actQty: a ? a.qty : null, actRev: a ? a.revenue : null, fcQty: f ? f.qty : null, fcRev: f ? f.revenue : null, budQty: b.qty || null, budRev: b.revenue || null };
    });
    // خانواده / محصول
    var byProduct = A.salesBy('product', M.ltm).filter(function (r) { return r.record && (!pf || pf(r.record)); });
    if (fam) {
      M.famItems = byProduct.slice(0, 12).map(function (r) { return { label: r.name, value: r.revenue, qty: r.qty, color: (S.get('families', fam) || {}).color }; });
    } else {
      var agg = new Map();
      byProduct.forEach(function (r) { var a = agg.get(r.record.familyId) || { revenue: 0, qty: 0 }; a.revenue += r.revenue; a.qty += r.qty; agg.set(r.record.familyId, a); });
      M.famItems = S.all('families').map(function (f) { var a = agg.get(f.id) || { revenue: 0, qty: 0 }; return { label: f.name, value: a.revenue, qty: a.qty, color: f.color }; })
        .filter(function (x) { return x.value > 0; }).sort(function (a, b) { return b.value - a.value; });
    }
    // کانال
    var ltmSet = new Set(M.ltm), chAgg = new Map();
    S.all('salesActuals').forEach(function (s) {
      if (!ltmSet.has(s.period)) return;
      if (pf) { var p = S.get('products', s.productId); if (!p || !pf(p)) return; }
      var c = S.get('customers', s.customerId), k = c ? c.channelId : null;
      chAgg.set(k, (chAgg.get(k) || 0) + s.revenue);
    });
    M.chItems = S.all('channels').map(function (c, i) { return { label: c.name, value: chAgg.get(c.id) || 0, color: C.seriesColor(i) }; }).filter(function (x) { return x.value > 0; });
    // هشدارها
    M.alerts = A.alerts().filter(function (a) {
      if (a.productId && pf) { var p = S.get('products', a.productId); return p && pf(p); }
      if (a.resourceId) { var r = S.get('resources', a.resourceId); return r && M.resFilter(r); }
      return true;
    });
    // محصولات
    var revBy = new Map(); byProduct.forEach(function (r) { revBy.set(r.id, r.revenue); });
    var si = A.salesIndex(), accBy = new Map(), covBy = new Map();
    M.acc3.byProduct.forEach(function (r) { accBy.set(r.productId, r); });
    M.cov.forEach(function (c) { covBy.set(c.product.id, c); });
    M.products = S.all('products').filter(function (p) { return !pf || pf(p); }).map(function (p) {
      var a = accBy.get(p.id), c = covBy.get(p.id);
      return {
        p: p, rev: revBy.get(p.id) || 0, acc: a ? a.accuracy : null, bias: a ? a.bias : null, cov: c || null,
        trend: M.ltm.map(function (per) { var m = si.get(per); var v = m && m.get(p.id); return v ? v.qty : 0; })
      };
    });
    M.steps = S.all('cycleSteps').filter(function (s) { return s.cycle === cycle; }).sort(function (a, b) { return a.order - b.order; });
    return M;
  }

  /* ---------------- خروجی‌های Excel ---------------- */
  function sheetTrend(M) {
    return {
      name: 'روند فروش', title: 'روند فروش، پیش‌بینی و بودجه', subtitle: M.scopeLabel + ' · مبالغ به ریال',
      columns: [
        { header: 'دوره', value: function (r) { return J.label(r.period); }, type: 'text' },
        { header: 'نوع', value: function (r) { return r.actQty !== null ? 'واقعی' : 'پیش‌بینی'; }, type: 'text' },
        { header: 'فروش واقعی (مقدار)', key: 'actQty', type: 'int' }, { header: 'فروش واقعی (ریال)', key: 'actRev', type: 'money' },
        { header: 'پیش‌بینی اجماعی (مقدار)', key: 'fcQty', type: 'int' }, { header: 'پیش‌بینی اجماعی (ریال)', key: 'fcRev', type: 'money' },
        { header: 'بودجه (مقدار)', key: 'budQty', type: 'int' }, { header: 'بودجه (ریال)', key: 'budRev', type: 'money' }
      ],
      rows: M.trend,
      charts: [{ type: 'line', title: 'فروش واقعی، پیش‌بینی و بودجه (ریال)', x: 0, y: [3, 5, 7], anchor: 'K4', width: 24, height: 10 }]
    };
  }
  function sheetFamilies(M) {
    return {
      name: M.fam ? 'محصولات خانواده' : 'خانواده‌ها', title: M.fam ? 'فروش محصولات ' + S.name('families', M.fam) : 'فروش بر اساس خانواده محصول', subtitle: '۱۲ ماه اخیر',
      columns: [{ header: 'عنوان', key: 'label', type: 'text' }, { header: 'مقدار فروش', key: 'qty', type: 'int' }, { header: 'مبلغ فروش (ریال)', key: 'value', type: 'money' },
        { header: 'سهم', value: function (r) { var t = A.sum(M.famItems, function (x) { return x.value; }); return t ? r.value / t : null; }, type: 'pct' }],
      rows: M.famItems, totals: ['qty', 'value'],
      charts: [{ type: 'bar', direction: 'bar', title: 'فروش ۱۲ ماه', x: 0, y: [2], anchor: 'G4' }]
    };
  }
  function sheetChannels(M) {
    var t = A.sum(M.chItems, function (x) { return x.value; });
    return {
      name: 'کانال‌ها', title: 'سهم کانال‌های فروش', subtitle: '۱۲ ماه اخیر',
      columns: [{ header: 'کانال', key: 'label', type: 'text' }, { header: 'مبلغ فروش (ریال)', key: 'value', type: 'money' }, { header: 'سهم', value: function (r) { return t ? r.value / t : null; }, type: 'pct' }],
      rows: M.chItems, totals: ['value'],
      charts: [{ type: 'pie', title: 'سهم کانال‌ها', x: 0, y: [1], anchor: 'F4' }]
    };
  }
  function sheetAccuracy(M) {
    return {
      name: 'دقت پیش‌بینی', title: 'دقت پیش‌بینی ماهانه (lag-1)', subtitle: 'دقت = ۱ − WMAPE · هدف ' + F.pct(M.accTarget, 0),
      columns: [{ header: 'دوره', value: function (r) { return J.label(r.period); }, type: 'text' }, { header: 'دقت', key: 'accuracy', type: 'pct' }, { header: 'سوگیری', key: 'bias', type: 'pct' }],
      rows: M.acc12.byPeriod.filter(function (x) { return x.hasData; }),
      charts: [{ type: 'bar', title: 'دقت پیش‌بینی', x: 0, y: [1], anchor: 'F4' }]
    };
  }
  function sheetCapacity(M) {
    var warn = M.st.utilizationWarn || 0.85, max = M.st.utilizationMax || 1;
    var cols = [{ header: 'خط / منبع', value: function (r) { return r.resource.name; }, type: 'text' }, { header: 'کارخانه', value: function (r) { return S.name('plants', r.resource.plantId); }, type: 'text' },
      { header: 'ساعت در دسترس ماهانه', value: function (r) { return Math.round(r.capacity); }, type: 'int' }];
    M.periods6.forEach(function (p, i) { cols.push({ header: J.label(p), value: function (r) { return r.periods[i].util; }, type: 'pct', util: true }); });
    cols.push({ header: 'اوج بهره‌برداری', value: function (r) { return r.peak; }, type: 'pct', util: true });
    return {
      name: 'ظرفیت', title: 'بار ظرفیت خطوط تولید — ۶ ماه آینده', subtitle: 'ساعت مورد نیاز ÷ ساعت در دسترس',
      columns: cols, rows: M.cap6,
      cellStyle: function (row, col, v) {
        if (!col.util || v === null) return null;
        if (v > max) return { fill: 'FFD03B3B', color: 'FFFFFFFF', bold: true };
        if (v > warn) return { fill: 'FFFDF3DC', color: 'FF8A5A00', bold: true };
        return null;
      }
    };
  }
  function sheetAlerts(M) {
    return {
      name: 'هشدارها', title: 'هشدارها و استثناها',
      columns: [{ header: 'سطح', value: function (a) { return a.level === 'critical' ? 'بحرانی' : 'هشدار'; }, type: 'text' }, { header: 'نوع', key: 'type', type: 'text' }, { header: 'عنوان', key: 'text', type: 'text' }, { header: 'جزئیات', key: 'detail', type: 'text' }],
      rows: M.alerts,
      cellStyle: function (row, col) { return col.header === 'سطح' && row.level === 'critical' ? { color: 'FFB42323', bold: true } : null; }
    };
  }
  function sheetProducts(M) {
    return {
      name: 'محصولات', title: 'عملکرد محصولات', subtitle: M.scopeLabel, freezeCols: 2,
      columns: [
        { header: 'کد', value: function (r) { return r.p.code; }, type: 'code' }, { header: 'محصول', value: function (r) { return r.p.name; }, type: 'text' },
        { header: 'خانواده', value: function (r) { return S.name('families', r.p.familyId); }, type: 'text' },
        { header: 'ABC', value: function (r) { return r.p.abc; }, type: 'text' }, { header: 'XYZ', value: function (r) { return r.p.xyz; }, type: 'text' },
        { header: 'فروش ۱۲ ماه (ریال)', key: 'rev', type: 'money' },
        { header: 'دقت پیش‌بینی ۳ ماه', key: 'acc', type: 'pct' }, { header: 'سوگیری', key: 'bias', type: 'pct' },
        { header: 'موجودی', value: function (r) { return r.cov ? r.cov.qty : null; }, type: 'int' },
        { header: 'پوشش (ماه)', value: function (r) { return r.cov && isFinite(r.cov.months) ? Math.round(r.cov.months * 10) / 10 : null; }, type: 'num', digits: 1 },
        { header: 'وضعیت موجودی', value: function (r) { return r.cov ? STATUS_LABEL[r.cov.status] : ''; }, type: 'text' }
      ],
      rows: M.products.slice().sort(function (a, b) { return b.rev - a.rev; }), totals: ['rev'],
      cellStyle: function (row, col) {
        if (col.header !== 'وضعیت موجودی' || !row.cov) return null;
        return row.cov.status === 'critical' ? { fill: 'FFFBE7E7', color: 'FFB42323', bold: true } : row.cov.status === 'warning' ? { fill: 'FFFDF3DC', color: 'FF8A5A00' } : null;
      }
    };
  }
  function exportAll() {
    var M = model();
    var done = M.steps.filter(function (s) { return s.status === 'تکمیل'; }).length;
    return IBP.excel.exportTables({
      filename: 'داشبورد مدیریتی IBP', subtitle: M.scopeLabel,
      summary: {
        title: 'خلاصه شاخص‌های کلیدی — چرخه ' + J.label(M.cycle),
        pairs: [
          ['محدوده', M.scopeLabel], ['چرخه برنامه‌ریزی', J.label(M.cycle)], ['آخرین ماه بسته‌شده', J.label(M.last)],
          ['فروش ۱۲ ماه اخیر (ریال)', Math.round(M.revLtm)], ['رشد نسبت به ۱۲ ماه قبل', M.revPrev ? F.pct(M.revLtm / M.revPrev - 1) : '—', 'اسمی (شامل اثر قیمت)'],
          ['تحقق بودجه ' + J.label(M.last), M.lastBud ? F.pct(M.lastAct / M.lastBud, 0) : '—'], ['تحقق بودجه از ابتدای سال', M.ytdBud ? F.pct(M.ytdAct / M.ytdBud, 0) : '—'],
          ['دقت پیش‌بینی ۳ ماه', F.pct(M.acc3.accuracy, 0), 'هدف ' + F.pct(M.accTarget, 0)], ['سوگیری پیش‌بینی ۳ ماه', F.signedPct(M.acc3.bias), 'مثبت = بیش‌برآورد'],
          ['حاشیه سود ناخالص ۱۲ ماه', F.pct(M.margin)], ['ارزش موجودی محصول (ریال)', Math.round(M.invValue)], ['پوشش موجودی (ماه)', M.monthsCover !== null ? F.num(M.monthsCover, 1) : '—'],
          ['محصولات با خطر کمبود', M.shortCount], ['بهره‌برداری ظرفیت ۳ ماه آینده', F.pct(M.util3, 0)], ['خطوط پربار', M.hotLines],
          ['پیشرفت چرخه IBP', F.num(done) + ' از ' + F.num(M.steps.length) + ' مرحله']
        ]
      },
      sheets: [sheetTrend(M), sheetFamilies(M), sheetChannels(M), sheetAccuracy(M), sheetCapacity(M), sheetAlerts(M), sheetProducts(M)]
    });
  }
  IBP.dashboardExport = exportAll;
  function exportOne(builder, name) {
    return function () { var M = model(); return IBP.excel.exportTables({ filename: name, subtitle: M.scopeLabel, sheets: [builder(M)] }); };
  }

  /* ---------------- نمایش ---------------- */
  function render(root) {
    if (!S.count('products')) {
      root.appendChild(h('div.card', h('div.roadmap-hero', h('div.roadmap-icon', { html: icon('cloud', 28) }),
        h('div', h('h2', 'هنوز داده‌ای ثبت نشده است'), h('p', 'برای شروع، از «مرکز داده» یک الگوی آماده صنعت را بارگذاری کنید یا فایل Excel داده‌های خودتان را وارد کنید.'),
          h('p', h('a.btn.btn-primary', { href: '#/datahub', style: { marginTop: '12px' } }, 'رفتن به مرکز داده'))))));
      return;
    }
    var M = model(), st = M.st, scale = M.scale, unit = M.unit;
    function rerender() { root.textContent = ''; render(root); }

    /* ---------------- بنر با شاخص‌های حلقه‌ای متحرک ---------------- */
    function heroGauges(M, done, crit) {
      var sp = null;
      try { sp = IBP.supply.current().plan; } catch (e) { sp = null; }
      var g = function (v, label, sub, from, to, href) {
        return h(href ? 'a.hero-gauge' : 'div.hero-gauge', href ? { href: href } : {}, h('div', { html: C.ring(v, { size: 62, stroke: 6, track: 'rgba(255,255,255,0.14)', from: from, to: to, fontSize: 14, label: v === null || v === undefined ? '—' : F.pct(v, 0) }) }),
          h('div', h('div.hg-l', label), h('div.hg-s', sub)));
      };
      return h('div.hero-gauges',
        g(M.steps.length ? done / M.steps.length : null, 'پیشرفت چرخه', F.num(done) + ' از ' + F.num(M.steps.length) + ' مرحله', '#60a5fa', '#22d3ee', '#/cycle'),
        g(M.acc3.accuracy, 'دقت پیش‌بینی', 'هدف ' + F.pct(M.accTarget, 0), '#a78bfa', '#60a5fa', '#/demand/accuracy'),
        g(sp ? sp.kpi.fillRate : null, 'سطح خدمت برنامه', sp ? F.num(sp.kpi.bottlenecks) + ' ماه گلوگاه' : '', '#34d399', '#22d3ee', '#/supply'),
        h('a.hero-gauge.count', { href: '#/dashboard', onclick: function (e) { e.preventDefault(); var el = document.querySelector('.alerts'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
          h('div.hg-n', F.num(crit)), h('div', h('div.hg-l', 'استثنای بحرانی'), h('div.hg-s', F.num(M.alerts.length - crit) + ' هشدار دیگر'))));
    }

    /* ---------------- بنر ---------------- */
    var done = M.steps.filter(function (s) { return s.status === 'تکمیل'; }).length;
    var crit = M.alerts.filter(function (a) { return a.level === 'critical'; }).length;
    root.appendChild(h('section.hero',
      h('div',
        h('h2', 'چرخه برنامه‌ریزی ' + J.label(M.cycle)),
        h('p', st.companyName + ' · ' + (st.industry || 'شرکت تولیدی') + ' · آخرین ماه بسته‌شده ' + J.label(M.last)),
        h('div.hero-actions', { style: { marginTop: '14px' } },
          h('a.btn.btn-sm', { href: '#/datahub', html: icon('cloud', 15) + '<span>مرکز داده</span>' }),
          h('a.btn.btn-sm', { href: '#/portfolio', html: icon('layers', 15) + '<span>تحلیل پورتفوی</span>' }),
          UI.excelButton('خروجی Excel کامل داشبورد', exportAll, { small: true }))),
      heroGauges(M, done, crit)
    ));

    /* ---------------- فیلترها ---------------- */
    var famSel = h('select', { 'aria-label': 'خانواده محصول' }, h('option', { value: '' }, 'همه خانواده‌ها'));
    S.all('families').forEach(function (f) { famSel.appendChild(h('option', { value: f.id }, f.name)); });
    famSel.value = M.fam;
    var plantSel = h('select', { 'aria-label': 'کارخانه' }, h('option', { value: '' }, 'همه کارخانه‌ها'));
    S.all('plants').forEach(function (p) { plantSel.appendChild(h('option', { value: p.id }, p.name)); });
    plantSel.value = M.plant;
    famSel.addEventListener('change', function () { state.family = famSel.value; rerender(); });
    plantSel.addEventListener('change', function () { state.plant = plantSel.value; rerender(); });
    root.appendChild(h('div.filter-row',
      h('span.filter-pill', { html: icon('filter', 15) + '<span>محدوده</span>' }), famSel, plantSel,
      h('span.scope-note', 'مبالغ به ' + unit)));

    /* ---------------- شاخص‌ها ---------------- */
    var kpis = h('div.kpis');
    kpis.appendChild(UI.kpi({
      icon: 'chart', label: 'فروش ۱۲ ماه اخیر', value: M.revLtm / scale, format: function (v) { return F.num(v); }, unit: unit,
      foot: deltaHtml(M.revPrev ? M.revLtm / M.revPrev - 1 : null, true, 'نسبت به ۱۲ ماه قبل'),
      spark: C.sparkline(M.ltmSeries.map(function (x) { return x.revenue; }))
    }));
    kpis.appendChild(UI.kpi({
      icon: 'target', label: 'تحقق بودجه ' + J.monthName(M.last), value: M.lastBud ? M.lastAct / M.lastBud : null, format: function (v) { return F.pct(v, 0); }, text: '—',
      foot: M.ytdBud ? '<span>از ابتدای سال: <b>' + F.pct(M.ytdAct / M.ytdBud, 0) + '</b></span>' : '<span>بودجه‌ای ثبت نشده</span>'
    }));
    kpis.appendChild(UI.kpi({
      icon: 'trend', label: 'دقت پیش‌بینی (۳ ماه)', value: M.acc3.accuracy, format: function (v) { return F.pct(v, 0); }, text: '—',
      foot: '<span>سوگیری ' + F.signedPct(M.acc3.bias) + ' · هدف ' + F.pct(M.accTarget, 0) + '</span>',
      spark: C.sparkline(M.acc12.byPeriod.map(function (x) { return x.accuracy; }))
    }));
    kpis.appendChild(UI.kpi({
      icon: 'coins', label: 'حاشیه سود ناخالص', value: M.margin, format: function (v) { return F.pct(v); }, text: '—',
      foot: deltaHtml(M.margin !== null && M.marginPrev !== null ? M.margin - M.marginPrev : null, true, 'تغییر واحد درصد'),
      spark: C.sparkline(M.ltmSeries.map(function (x) { return x.revenue ? 1 - x.cost / x.revenue : 0; }))
    }));
    kpis.appendChild(UI.kpi({
      icon: 'warehouse', label: 'ارزش موجودی محصول', value: M.invValue / scale, format: function (v) { return F.num(v); }, unit: unit,
      foot: '<span>پوشش ' + (M.monthsCover !== null ? F.num(M.monthsCover, 1) + ' ماه' : '—') + '</span>' + (M.shortCount ? UI.statusBadge('critical', M.shortCount + ' کمبود') : '')
    }));
    kpis.appendChild(UI.kpi({
      icon: 'factory', label: 'بهره‌برداری ظرفیت (۳ ماه آینده)', value: M.util3, format: function (v) { return F.pct(v, 0); }, text: '—',
      foot: M.hotLines ? UI.statusBadge(M.overLines ? 'critical' : 'warning', M.hotLines + ' خط پربار') : UI.statusBadge('good', 'ظرفیت کافی')
    }));
    root.appendChild(kpis);

    var grid = h('div.dash-grid');
    root.appendChild(grid);

    /* ---------------- روند ---------------- */
    var seg = h('div.seg', { role: 'group', 'aria-label': 'واحد نمایش' });
    var trend = UI.card({ title: 'روند فروش، پیش‌بینی و بودجه', sub: '۲۴ ماه گذشته و ۱۲ ماه آینده · پیش‌بینی اجماعی چرخه ' + J.label(M.cycle), icon: 'trend', span: 8, tools: [seg], exportFn: exportOne(sheetTrend, 'روند فروش و پیش‌بینی') });
    [['revenue', 'مبلغ'], ['qty', 'مقدار']].forEach(function (m, idx) {
      seg.appendChild(h('button' + (state.mode === m[0] ? '.on' : ''), { type: 'button', 'aria-pressed': state.mode === m[0] ? 'true' : 'false', onclick: function () {
        state.mode = m[0]; drawTrend();
        seg.querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', i === idx); b.setAttribute('aria-pressed', i === idx ? 'true' : 'false'); });
      } }, m[1]));
    });
    var trendBox = h('div');
    trend.body.appendChild(trendBox);
    grid.appendChild(trend.el);
    function drawTrend() {
      var money = state.mode === 'revenue';
      var act = M.trend.map(function (r) { return money ? r.actRev : r.actQty; });
      var fc = M.trend.map(function (r, i) { return i === 23 ? act[23] : (money ? r.fcRev : r.fcQty); });
      var bud = M.trend.map(function (r) { return money ? r.budRev : r.budQty; });
      C.line(trendBox, {
        labels: M.trend.map(function (r) { return J.shortLabel(r.period); }),
        tipLabels: M.trend.map(function (r) { return J.label(r.period); }),
        series: [
          { name: 'فروش واقعی', values: act, color: 'var(--series-1)', area: true },
          { name: 'پیش‌بینی اجماعی', values: fc, color: 'var(--series-1)', dash: true },
          { name: 'بودجه', values: bud, color: 'var(--series-2)', endDot: false }
        ],
        format: money ? function (v) { return F.num(v / scale); } : F.compact,
        tipFormat: money ? function (v) { return F.money(v, { scale: scale }); } : function (v) { return F.num(v); },
        height: 290, markIndex: 24, markLabel: 'افق برنامه‌ریزی'
      });
    }
    drawTrend();

    /* ---------------- چرخه IBP ---------------- */
    var cyc = UI.card({ title: 'چرخه IBP ' + J.label(M.cycle), sub: M.steps.length ? F.num(done) + ' از ' + F.num(M.steps.length) + ' مرحله تکمیل شده' : 'مراحل این چرخه تعریف نشده', icon: 'cycle', span: 4,
      tools: [h('a.btn.btn-sm.btn-soft', { href: '#/cycle' }, 'مدیریت')] });
    if (M.steps.length) {
      cyc.body.appendChild(h('div.progress', { role: 'progressbar', 'aria-valuenow': Math.round(done / M.steps.length * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: (done / M.steps.length * 100) + '%' } })));
      var ul = h('ol.steps');
      M.steps.forEach(function (s) {
        var cls = s.status === 'تکمیل' ? 'done' : s.status === 'در حال انجام' ? 'active' : s.status === 'تأخیر' ? 'late' : '';
        var lvl = s.status === 'تکمیل' ? 'good' : s.status === 'تأخیر' ? 'critical' : s.status === 'در حال انجام' ? 'info' : 'neutral';
        ul.appendChild(h('li.step' + (cls ? '.' + cls : ''),
          h('div.step-dot' + (cls ? '.' + cls : ''), { html: s.status === 'تکمیل' ? icon('check', 14) : String(s.order) }),
          h('div', h('div.step-name', s.name), h('div.step-meta', s.owner + (s.dueDate ? ' · سررسید ' + J.isoToJalaliStr(s.dueDate) : ''))),
          h('div', { html: UI.statusBadge(lvl, s.status) })));
      });
      cyc.body.appendChild(ul);
    }
    grid.appendChild(cyc.el);

    /* ---------------- خانواده ---------------- */
    var byFam = UI.card({ title: M.fam ? 'فروش محصولات ' + S.name('families', M.fam) : 'فروش بر اساس خانواده محصول', sub: '۱۲ ماه اخیر · ' + unit, icon: 'layers', span: 5, exportFn: exportOne(sheetFamilies, 'فروش خانواده‌ها') });
    C.hbars(byFam.body, { items: M.famItems.map(function (x) { return { label: x.label, value: x.value, color: x.color, sub: [{ label: 'مقدار', value: F.num(x.qty) }] }; }), format: function (v) { return F.num(v / scale); }, valueLabel: 'فروش (' + unit + ')' });
    grid.appendChild(byFam.el);

    /* ---------------- کانال ---------------- */
    var byCh = UI.card({ title: 'سهم کانال‌های فروش', sub: '۱۲ ماه اخیر', icon: 'pie', span: 3, exportFn: exportOne(sheetChannels, 'سهم کانال‌های فروش') });
    C.donut(byCh.body, { items: M.chItems, format: function (v) { return F.money(v, { scale: scale }); }, valueLabel: 'فروش', center: { value: F.num(M.chItems.length), label: 'کانال' }, size: 150 });
    grid.appendChild(byCh.el);

    /* ---------------- دقت ---------------- */
    var accCard = UI.card({ title: 'دقت پیش‌بینی ماهانه', sub: 'یک ماه قبل از وقوع (lag-1) · ۱ − WMAPE', icon: 'target', span: 4, exportFn: exportOne(sheetAccuracy, 'دقت پیش‌بینی') });
    var accPer = M.acc12.byPeriod.filter(function (x) { return x.hasData; });
    if (accPer.length) {
      C.columns(accCard.body, {
        labels: accPer.map(function (x) { return J.shortLabel(x.period); }),
        tipTitles: accPer.map(function (x) { return J.label(x.period); }),
        series: [{ name: 'دقت پیش‌بینی', values: accPer.map(function (x) { return x.accuracy; }), color: 'var(--series-1)' }],
        format: function (v) { return F.pct(v, 0); }, height: 210,
        refLine: { value: M.accTarget, label: 'هدف ' + F.pct(M.accTarget, 0) }
      });
    } else accCard.body.appendChild(h('p.muted', 'سابقه پیش‌بینی برای سنجش دقت ثبت نشده است.'));
    grid.appendChild(accCard.el);

    /* ---------------- ظرفیت ---------------- */
    var capCard = UI.card({ title: 'بار ظرفیت خطوط تولید', sub: '۶ ماه آینده · ساعت مورد نیاز ÷ ساعت در دسترس', icon: 'factory', span: 7, flush: true, exportFn: exportOne(sheetCapacity, 'بار ظرفیت خطوط') });
    var tbl = h('table.heat');
    var hr = h('tr', h('th.res', 'خط / منبع'));
    M.periods6.forEach(function (p) { hr.appendChild(h('th', J.shortLabel(p))); });
    tbl.appendChild(h('thead', hr));
    var tb = h('tbody');
    var warn = st.utilizationWarn || 0.85, max = st.utilizationMax || 1;
    function heatStyle(u) {
      var step = u < 0.5 ? 1 : u < 0.65 ? 2 : u < 0.75 ? 3 : u < warn ? 4 : u <= max ? 5 : 6;
      return { background: 'var(--seq-' + step + ')', color: step >= 4 ? 'var(--seq-ink-dark)' : 'var(--seq-ink-light)' };
    }
    M.cap6.forEach(function (r) {
      var tr = h('tr', h('th.res', { title: r.resource.name + ' — ' + S.name('plants', r.resource.plantId) }, r.resource.name));
      r.periods.forEach(function (p) {
        var over = p.util > max;
        var td = h('td' + (over ? '.over' : ''), { style: over ? null : heatStyle(p.util || 0), tabindex: 0 }, (over ? '! ' : '') + F.pct(p.util, 0));
        td.addEventListener('pointermove', function (e) {
          C.showTip(e, r.resource.name + ' · ' + J.label(p.period), [
            { label: 'بهره‌برداری', value: F.pct(p.util, 0) }, { label: 'ساعت مورد نیاز', value: F.num(p.hours) }, { label: 'ساعت در دسترس', value: F.num(p.capacity) }]);
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
      '<span style="margin-inline-start:12px">' + UI.statusBadge('critical', 'بالای ظرفیت') + '</span>' }));
    grid.appendChild(capCard.el);
    var supplyCard = null;
    try {
      var SP = IBP.supply.current().plan, p12 = SP.periods.slice(0, 12);
      supplyCard = UI.card({ title: 'برنامه تولید و موجودی ۱۲ ماه آینده', sub: 'تن · تقاضای اجماعی، تولید با محدودیت ظرفیت و موجودی پایان ماه · سطح خدمت برنامه ' + F.pct(SP.kpi.fillRate, 1), icon: 'factory', span: 12,
        tools: [h('a.btn.btn-sm', { href: '#/supply', html: '<span>برنامه تولید</span>' + icon('chevronLeft', 14) })] });
      var sb = h('div'); supplyCard.body.appendChild(sb);
      C.columns(sb, { labels: p12.map(J.shortLabel), tipTitles: p12.map(J.label), height: 250,
        series: [{ name: 'تقاضا', values: SP.demTons.slice(0, 12), color: 'var(--series-2)' }, { name: 'تولید', values: SP.prodTons.slice(0, 12), color: 'var(--series-1)' }],
        lines: [{ name: 'موجودی پایان ماه', values: SP.invTons.slice(0, 12), color: 'var(--series-3)' }],
        format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' تن'; }, onClick: function () { IBP.app.navigate('#/supply'); } });
    } catch (e) { supplyCard = null; }

    /* ---------------- هشدارها ---------------- */
    var alCard = UI.card({ title: 'هشدارها و استثناها', sub: 'مواردی که در جلسات بازنگری باید بررسی شوند', icon: 'alert', span: 5, flush: true, exportFn: exportOne(sheetAlerts, 'هشدارها و استثناها') });
    alCard.tools.insertBefore(h('div.alert-summary', { html: UI.statusBadge('critical', F.num(crit)) + UI.statusBadge('warning', F.num(M.alerts.length - crit)) }), alCard.tools.firstChild);
    var al = h('ul.alerts');
    if (!M.alerts.length) al.appendChild(h('li.alert-item', { html: UI.statusBadge('good', 'موردی برای بررسی وجود ندارد') }));
    M.alerts.slice(0, 40).forEach(function (a) {
      al.appendChild(h('li.alert-item',
        h('div.alert-icon.' + a.level, { html: icon(a.level === 'critical' ? 'critical' : 'alert', 16) }),
        h('div', h('div.alert-text', a.text), h('div.alert-detail', a.detail)),
        h('span.alert-type', a.type)));
    });
    alCard.body.appendChild(al);
    grid.appendChild(alCard.el);

    if (supplyCard) grid.appendChild(supplyCard.el);

    /* ---------------- محصولات ---------------- */
    var prodCard = UI.card({ title: 'عملکرد محصولات', sub: 'فروش ۱۲ ماه، روند، دقت پیش‌بینی و پوشش موجودی', icon: 'box', span: 12, flush: true, exportFn: exportOne(sheetProducts, 'عملکرد محصولات') });
    IBP.grid(prodCard.body, {
      pageSize: 10, sortKey: 'rev', sortDir: -1,
      rows: function () { return M.products; },
      onRowClick: function (r) { IBP.form.editRecord('products', r.p, function () { IBP.app.render(true); }); },
      filters: [{ label: 'وضعیت موجودی', options: Object.keys(STATUS_LABEL).map(function (k) { return { value: k, label: STATUS_LABEL[k] }; }), test: function (r, v) { return r.cov && r.cov.status === v; } },
        { label: 'کلاس ABC', options: ['A', 'B', 'C'].map(function (x) { return { value: x, label: x }; }), test: function (r, v) { return r.p.abc === v; } }],
      columns: [
        { key: 'name', label: 'محصول', value: function (r) { return r.p.name; }, render: function (r) { return F.escape(r.p.name) + '<div class="cell-sub code">' + F.escape(r.p.code) + '</div>'; }, text: function (r) { return r.p.name + ' ' + r.p.code; } },
        { key: 'family', label: 'خانواده', value: function (r) { return S.name('families', r.p.familyId); }, render: function (r) { var f = S.get('families', r.p.familyId); return '<span class="swatch" style="background:' + F.escape(f ? f.color : '#999') + '"></span>' + F.escape(f ? f.name : '—'); } },
        { key: 'abc', label: 'ABC/XYZ', value: function (r) { return (r.p.abc || 'Z') + (r.p.xyz || 'Z'); }, render: function (r) { return '<span class="tag ' + (r.p.abc || '') + '">' + (r.p.abc || '—') + '</span> <span class="tag">' + (r.p.xyz || '—') + '</span>'; } },
        { key: 'rev', label: 'فروش ۱۲ ماه (' + unit + ')', align: 'num', value: function (r) { return r.rev; }, render: function (r) { return F.num(r.rev / scale, 1); } },
        { key: 'trend', label: 'روند مقدار', sortable: false, render: function (r) { return C.sparkline(r.trend, { width: 92, height: 26 }); } },
        { key: 'acc', label: 'دقت پیش‌بینی', align: 'num', value: function (r) { return r.acc; }, render: function (r) { return r.acc !== null ? F.pct(r.acc, 0) : '—'; } },
        { key: 'cover', label: 'پوشش موجودی', value: function (r) { return r.cov && isFinite(r.cov.months) ? r.cov.months : 999; }, render: function (r) {
          if (!r.cov) return '—';
          return UI.statusBadge(STATUS_LEVEL[r.cov.status], (isFinite(r.cov.months) ? F.num(r.cov.months, 1) + ' ماه' : '∞') + ' · ' + STATUS_LABEL[r.cov.status]);
        } }
      ]
    });
    grid.appendChild(prodCard.el);
  }

  IBP.register('dashboard', { title: 'داشبورد مدیریتی', render: render });
})(window.IBP = window.IBP || {});
