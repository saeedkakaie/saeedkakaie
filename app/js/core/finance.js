/*
 * تطبیق مالی و سناریوها (فاز ۵).
 *
 * سود و زیان برنامه (هر ماه افق):
 *   درآمد       = فروش برنامه (تقاضا − کمبود) × قیمت روز × (۱ − تخفیف میانگین کانال‌ها) × (۱ + تغییر قیمت)
 *   بهای مواد   = فروش × هزینه مواد هر واحد از BOM (تورم ماهانه مواد؛ مواد وارداتی با تغییر نرخ ارز)
 *   تبدیل       = فروش × (هزینه ساعت خط ÷ تولید در ساعت) مسیر اصلی
 *   سربار       = فروش × (بهای تمام‌شده استاندارد − مواد − تبدیل)
 *   سود ناخالص  = درآمد − بهای تمام‌شده
 *   سود عملیاتی برنامه = سود ناخالص − صرف اضافه‌کاری − هزینه نگهداری موجودی
 * سرمایه در گردش: موجودی محصول و مواد + مطالبات (دوره وصول وزنی مشتریان) − بدهی تأمین‌کنندگان (دوره پرداخت)
 * پل بودجه: درآمد بودجه ← اثر حجم ((مقدار برنامه − مقدار بودجه) × قیمت بودجه) ← اثر قیمت و ترکیب ← درآمد برنامه
 * سناریو: ضریب تقاضا (کل یا خانواده)، قیمت، مواد، ارز، هزینه تبدیل و ظرفیت؛ برنامه تولید برای هر سناریو دوباره ساخته می‌شود.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali, S = IBP.store, A = IBP.analytics;

  var DRIVERS = [
    { key: 'demand', label: 'تغییر تقاضا', min: -40, max: 40, step: 1 },
    { key: 'price', label: 'تغییر قیمت فروش', min: -20, max: 40, step: 1 },
    { key: 'material', label: 'تغییر بهای مواد', min: -20, max: 60, step: 1 },
    { key: 'fx', label: 'تغییر نرخ ارز (مواد وارداتی)', min: -20, max: 80, step: 1 },
    { key: 'conversion', label: 'تغییر هزینه تبدیل (دستمزد و انرژی)', min: -20, max: 60, step: 1 },
    { key: 'capacity', label: 'تغییر ظرفیت خطوط', min: -30, max: 40, step: 1 }
  ];

  function settings() {
    var st = S.settings();
    return {
      costInflation: st.costInflation !== undefined ? st.costInflation : 0.02,
      holdingRate: st.holdingRate !== undefined ? st.holdingRate : 0.015,
      overtimePremium: st.overtimePremium !== undefined ? st.overtimePremium : 0.5,
      dpoDays: st.dpoDays !== undefined ? st.dpoDays : 45
    };
  }

  /** هزینه استاندارد هر محصول: مواد (داخلی/وارداتی/درون‌گروهی)، تبدیل و سربار */
  function unitCosts() {
    var mats = {}, sup = {};
    S.all('suppliers').forEach(function (s) { sup[s.id] = s; });
    S.all('materials').forEach(function (m) { mats[m.id] = m; });
    var out = {};
    S.all('products').forEach(function (p) { out[p.id] = { matDom: 0, matImp: 0, matIc: 0, conv: 0, overhead: 0 }; });
    S.all('bom').forEach(function (b) {
      var m = mats[b.materialId], u = out[b.productId];
      if (!m || !u) return;
      var c = b.qtyPer * (1 + (b.scrap || 0)) * (m.unitCost || 0);
      if (m.internalCompany) u.matIc += c;
      else if (sup[m.supplierId] && sup[m.supplierId].isImport) u.matImp += c;
      else u.matDom += c;
    });
    var prim = {};
    S.all('routings').forEach(function (r) { if ((r.priority || 1) === 1 && r.unitsPerHour > 0) prim[r.productId] = r; });
    S.all('products').forEach(function (p) {
      var u = out[p.id], r = prim[p.id], res = r ? S.get('resources', r.resourceId) : null;
      u.conv = r && res ? (res.costPerHour || 0) / r.unitsPerHour : 0;
      var mat = u.matDom + u.matImp + u.matIc;
      u.overhead = Math.max(0, (p.unitCost || 0) - mat - u.conv);
      u.std = mat + u.conv + u.overhead;
    });
    return out;
  }

  /** دوره وصول وزنی مشتریان (روز) بر اساس فروش ۱۲ ماه */
  function dsoDays() {
    var w = 0, t = 0, cu = {};
    S.all('customers').forEach(function (c) { cu[c.id] = c; });
    var set = new Set(J.range(J.addMonths(A.ctx().cycle, -12), 12));
    S.all('salesActuals').forEach(function (s) {
      if (!set.has(s.period)) return;
      var c = cu[s.customerId]; if (!c) return;
      w += s.revenue; t += s.revenue * (c.paymentDays || 0);
    });
    return w ? t / w : 30;
  }

  /**
   * سود و زیان، سرمایه در گردش و مقایسه بودجه برای یک برنامه تأمین.
   * sp: { plan, mrp } از IBP.supply ؛ d: محرک‌های سناریو به درصد { price, material, fx, conversion }
   */
  function compute(sp, d) {
    d = d || {};
    var pl = sp.plan, per = pl.periods, T = per.length, fs = settings(), uc = unitCosts();
    var disc = A.avgDiscount();
    var kP = 1 + (d.price || 0) / 100, kM = 1 + (d.material || 0) / 100, kFx = 1 + (d.fx || 0) / 100, kC = 1 + (d.conversion || 0) / 100;
    var z = function () { return new Array(T).fill(0); };
    var tot = { revenue: z(), material: z(), conversion: z(), overhead: z(), cogs: z(), gross: z(), overtime: z(), holding: z(), operating: z(), lost: z(), salesQty: z(), tons: z() };
    var byProduct = {};
    var budget = new Map();
    S.all('budgets').forEach(function (b) { budget.set(b.productId + '|' + b.period, b); });
    var bud = { revenue: z(), qty: z(), has: z(), cogs: z() };
    var bridge = { budget: 0, volume: 0, priceMix: 0, plan: 0, months: 0 };

    pl.rows.forEach(function (r) {
      var p = r.product, u = uc[p.id] || { matDom: 0, matImp: 0, matIc: 0, conv: 0, overhead: 0 };
      var bp = byProduct[p.id] = { product: p, revenue: 0, cogs: 0, gross: 0, qty: 0, lost: 0 };
      for (var t = 0; t < T; t++) {
        var infl = Math.pow(1 + fs.costInflation, t);
        var sold = Math.max(0, r.demand[t] - r.shortage[t]);
        var price = A.priceAt(p, per[t]) * (1 - disc) * kP;
        var mat = (u.matDom + u.matIc) * infl * kM + u.matImp * infl * kM * kFx;
        var conv = u.conv * infl * kC, oh = u.overhead * infl;
        var rev = sold * price;
        tot.revenue[t] += rev; tot.material[t] += sold * mat; tot.conversion[t] += sold * conv; tot.overhead[t] += sold * oh;
        tot.lost[t] += r.shortage[t] * price; tot.salesQty[t] += sold; tot.tons[t] += sold * (p.unitWeightKg || 0) / 1000;
        tot.holding[t] += r.inventory[t] * (p.unitCost || 0) * infl * fs.holdingRate;
        bp.revenue += rev; bp.cogs += sold * (mat + conv + oh); bp.qty += sold; bp.lost += r.shortage[t] * price;
        var b = budget.get(p.id + '|' + per[t]);
        if (b) {
          bud.revenue[t] += b.revenue || 0; bud.qty[t] += b.qty || 0; bud.has[t] = 1;
          bud.cogs[t] += (b.qty || 0) * (p.unitCost || 0) * infl;
          var bPrice = b.qty ? (b.revenue || 0) / b.qty : price;
          bridge.budget += b.revenue || 0; bridge.volume += (sold - (b.qty || 0)) * bPrice; bridge.plan += rev;
        }
      }
      bp.gross = bp.revenue - bp.cogs;
    });
    bridge.priceMix = bridge.plan - bridge.budget - bridge.volume;
    bridge.months = A.sum(bud.has);
    // صرف اضافه‌کاری
    pl.resources.forEach(function (r) {
      for (var t = 0; t < T; t++) tot.overtime[t] += (r.overtime[t] || 0) * (r.resource.costPerHour || 0) * fs.overtimePremium * Math.pow(1 + fs.costInflation, t) * kC;
    });
    for (var t = 0; t < T; t++) {
      tot.cogs[t] = tot.material[t] + tot.conversion[t] + tot.overhead[t];
      tot.gross[t] = tot.revenue[t] - tot.cogs[t];
      tot.operating[t] = tot.gross[t] - tot.overtime[t] - tot.holding[t];
    }
    // سرمایه در گردش
    var dso = dsoDays(), wc = { inventory: z(), materials: z(), receivables: z(), payables: z(), net: z(), purchases: z() };
    var m = sp.mrp;
    for (t = 0; t < T; t++) {
      wc.inventory[t] = pl.invValue[t];
      wc.materials[t] = m ? A.sum(m.rows, function (x) { return Math.max(0, x.projected[t]) * (x.material.unitCost || 0); }) : 0;
      wc.purchases[t] = m ? A.sum(m.rows, function (x) { var imp = x.supplier && x.supplier.isImport; return x.receipts[t] * (x.material.unitCost || 0) * kM * (imp ? kFx : 1); }) : 0;
      wc.receivables[t] = tot.revenue[t] * dso / 30;
      wc.payables[t] = wc.purchases[t] * fs.dpoDays / 30;
      wc.net[t] = wc.inventory[t] + wc.materials[t] + wc.receivables[t] - wc.payables[t];
    }
    var n12 = Math.min(12, T);
    var s12 = function (a) { return A.sum(a.slice(0, n12)); };
    var families = {};
    Object.keys(byProduct).forEach(function (pid) {
      var x = byProduct[pid], f = x.product.familyId;
      var fa = families[f] = families[f] || { familyId: f, revenue: 0, cogs: 0, gross: 0, lost: 0 };
      fa.revenue += x.revenue; fa.cogs += x.cogs; fa.gross += x.gross; fa.lost += x.lost;
    });
    var rev12 = s12(tot.revenue), gp12 = s12(tot.gross), op12 = s12(tot.operating);
    var budMonths = [];
    for (t = 0; t < n12; t++) if (bud.has[t]) budMonths.push(t);
    var budRev = A.sum(budMonths, function (i) { return bud.revenue[i]; }), planRevB = A.sum(budMonths, function (i) { return tot.revenue[i]; });
    return {
      periods: per, months12: n12, drivers: d, totals: tot, budget: bud, bridge: bridge, wc: wc, dso: dso, dpo: fs.dpoDays,
      byProduct: byProduct, byFamily: families, unitCosts: uc,
      kpi: {
        revenue: rev12, gross: gp12, gm: rev12 ? gp12 / rev12 : null, operating: op12, opm: rev12 ? op12 / rev12 : null,
        lost: s12(tot.lost), tons: s12(tot.tons), overtime: s12(tot.overtime), holding: s12(tot.holding),
        fillRate: pl.kpi.fillRate, util: pl.kpi.avgUtil, invEnd: pl.invValue[n12 - 1], nwcEnd: wc.net[n12 - 1],
        budgetRevenue: budRev, budgetGap: budRev ? planRevB / budRev - 1 : null, budgetMonths: budMonths.length
      }
    };
  }

  /** برنامه و مالی جاری (بدون سناریو) */
  function current() {
    var c = IBP.supply.current();
    return compute({ plan: c.plan, mrp: c.mrp }, {});
  }

  /** اجرای یک سناریو: برنامه تولید با تقاضا و ظرفیت تغییرکرده + مالی */
  function runScenario(sc) {
    var d = Object.assign({ demand: 0, price: 0, material: 0, fx: 0, conversion: 0, capacity: 0 }, sc.drivers || {});
    var df = 1 + d.demand / 100;
    var famF = sc.drivers && sc.drivers.families ? sc.drivers.families : null;
    var dfac = df;
    if (famF && Object.keys(famF).length) {
      dfac = { all: df };
      Object.keys(famF).forEach(function (fid) { dfac[fid] = df * (1 + (famF[fid] || 0) / 100); });
    }
    var sp = IBP.supply.scenario({ demandFactor: dfac, capacityFactor: 1 + d.capacity / 100 });
    var f = compute(sp, d);
    f.plan = sp.plan; f.mrp = sp.mrp;
    return f;
  }

  /** حساسیت سود ناخالص ۱۲ ماه به ±delta در هر محرک (نمودار گردبادی) */
  function sensitivity(delta) {
    delta = delta || 10;
    var base = runScenario({ drivers: {} }).kpi;
    return DRIVERS.map(function (dr) {
      var lo = {}, hi = {};
      lo[dr.key] = -delta; hi[dr.key] = delta;
      var a = runScenario({ drivers: lo }).kpi, b = runScenario({ drivers: hi }).kpi;
      return { key: dr.key, label: dr.label, low: a.gross - base.gross, high: b.gross - base.gross, lowOp: a.operating - base.operating, highOp: b.operating - base.operating, lowFill: a.fillRate, highFill: b.fillRate };
    }).sort(function (x, y) { return Math.max(Math.abs(y.low), Math.abs(y.high)) - Math.max(Math.abs(x.low), Math.abs(x.high)); }).concat([{ base: base }]);
  }

  /* ---------------- شبیه‌سازی مونت‌کارلو ---------------- */
  /** ورودی مشترک شبیه‌سازی (برای موتور پایتون و شبیه‌ساز داخلی) */
  function mcPayload(f, runs) {
    var pl = f.plan || IBP.supply.current().plan, n = f.months12, disc = A.avgDiscount(), uc = f.unitCosts;
    var d = f.drivers || {}, kP = 1 + (d.price || 0) / 100, kM = 1 + (d.material || 0) / 100, kFx = 1 + (d.fx || 0) / 100, kC = 1 + (d.conversion || 0) / 100;
    var ci = settings().costInflation;
    return {
      runs: runs || 2000, months: n, seed: 7,
      products: pl.rows.map(function (r) {
        var u = uc[r.product.id] || { matDom: 0, matImp: 0, matIc: 0, conv: 0, overhead: 0 };
        return {
          id: r.product.id, rel: r.rel, open: r.open,
          demand: r.demand.slice(0, n), production: r.production.slice(0, n),
          price: pl.periods.slice(0, n).map(function (per) { return A.priceAt(r.product, per) * (1 - disc) * kP; }),
          cost: pl.periods.slice(0, n).map(function (_, t) { var k = Math.pow(1 + ci, t); return ((u.matDom + u.matIc) * kM + u.matImp * kM * kFx) * k + u.conv * k * kC + u.overhead * k; })
        };
      }),
      // مقایسه با بودجه فقط در ماه‌هایی که بودجه دارند
      budgetMask: f.periods.slice(0, n).map(function (_, t) { return f.budget && f.budget.has[t] ? 1 : 0; }),
      budgetGross: f.budget ? A.sum(f.periods.slice(0, n).map(function (_, t) { return f.budget.has[t] ? f.budget.revenue[t] - f.budget.cogs[t] : 0; })) : 0,
      budgetRevenue: f.kpi.budgetRevenue || 0
    };
  }
  function normal(R) { var u = 1 - R(), v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function quant(a, q) { var i = (a.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }
  /** شبیه‌سازی داخلی: خطای تقاضا (ضریب محصول + نوفه ماهانه) با فروش محدود به موجودی و تولید برنامه */
  function monteCarloLocal(pay) {
    var R = IBP.seed.rng(pay.seed || 7), N = pay.runs, revs = [], gps = [], fills = [], revB = [], gpB = [];
    var mask = pay.budgetMask || [];
    for (var k = 0; k < N; k++) {
      var rev = 0, gp = 0, dem = 0, sold = 0, rb = 0, gb = 0;
      pay.products.forEach(function (p) {
        var zp = normal(R), inv = p.open;
        for (var t = 0; t < pay.months; t++) {
          var e = p.rel * (0.6 * zp + 0.8 * normal(R));
          var d = Math.max(0, p.demand[t] * (1 + e));
          var avail = inv + p.production[t], s = Math.min(d, avail);
          inv = avail - s;
          rev += s * p.price[t]; gp += s * (p.price[t] - p.cost[t]); dem += d; sold += s;
          if (mask[t]) { rb += s * p.price[t]; gb += s * (p.price[t] - p.cost[t]); }
        }
      });
      revs.push(rev); gps.push(gp); fills.push(dem ? sold / dem : 1); revB.push(rb); gpB.push(gb);
    }
    return summarize(revs, gps, fills, pay, revB, gpB);
  }
  function summarize(revs, gps, fills, pay, revB, gpB) {
    var sr = revs.slice().sort(function (a, b) { return a - b; }), sg = gps.slice().sort(function (a, b) { return a - b; }), sf = fills.slice().sort(function (a, b) { return a - b; });
    var lo = sg[0], hi = sg[sg.length - 1], B = 24, w = (hi - lo) / B || 1, hist = new Array(B).fill(0);
    sg.forEach(function (v) { hist[Math.min(B - 1, Math.floor((v - lo) / w))]++; });
    return {
      engine: 'local', runs: revs.length,
      revenue: { p10: quant(sr, 0.1), p50: quant(sr, 0.5), p90: quant(sr, 0.9), mean: A.sum(revs) / revs.length },
      gross: { p10: quant(sg, 0.1), p50: quant(sg, 0.5), p90: quant(sg, 0.9), mean: A.sum(gps) / gps.length },
      fill: { p10: quant(sf, 0.1), p50: quant(sf, 0.5), p90: quant(sf, 0.9) },
      probGrossBudget: pay.budgetGross ? gpB.filter(function (v) { return v >= pay.budgetGross; }).length / gpB.length : null,
      probRevenueBudget: pay.budgetRevenue ? revB.filter(function (v) { return v >= pay.budgetRevenue; }).length / revB.length : null,
      hist: { lo: lo, width: w, counts: hist }
    };
  }
  /** شبیه‌سازی با موتور پایتون (۵۰۰۰ اجرا) یا داخلی (۱۰۰۰ اجرا) */
  function monteCarlo(f) {
    if (IBP.engine.online()) {
      var pay = mcPayload(f, 5000);
      return IBP.engine.call('/scenarios/montecarlo', pay, { timeout: 120000 }).then(function (r) { r.engine = 'python'; return r; }, function () { return monteCarloLocal(mcPayload(f, 1000)); });
    }
    return Promise.resolve(monteCarloLocal(mcPayload(f, 1000)));
  }

  /* ---------------- سناریوهای ذخیره‌شده ---------------- */
  function list() { return S.meta('scenarios') || []; }
  function save(arr) { S.setMeta('scenarios', arr); return S.flush(); }
  function presets() {
    return [
      { name: 'خوش‌بینانه', color: '#1baf7a', drivers: { demand: 10, price: 3, material: 0, fx: 0, conversion: 0, capacity: 0 }, note: 'رشد بازار و موفقیت کمپین‌ها' },
      { name: 'بدبینانه', color: '#e34948', drivers: { demand: -10, price: 0, material: 15, fx: 20, conversion: 10, capacity: 0 }, note: 'رکود تقاضا و افزایش بهای نهاده‌ها' },
      { name: 'شوک ارزی', color: '#eda100', drivers: { demand: -3, price: 8, material: 5, fx: 35, conversion: 5, capacity: 0 }, note: 'افزایش نرخ ارز و انتقال بخشی به قیمت' },
      { name: 'افزایش ظرفیت', color: '#6250d6', drivers: { demand: 8, price: 0, material: 0, fx: 0, conversion: 6, capacity: 15 }, note: 'شیفت اضافه در خطوط گلوگاهی' }
    ];
  }

  IBP.finance = { DRIVERS: DRIVERS, settings: settings, unitCosts: unitCosts, compute: compute, current: current, runScenario: runScenario, sensitivity: sensitivity, mcPayload: mcPayload, monteCarloLocal: monteCarloLocal, monteCarlo: monteCarlo, list: list, save: save, presets: presets };
})(window.IBP = window.IBP || {});
