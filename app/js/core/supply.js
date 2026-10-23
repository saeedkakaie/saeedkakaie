/*
 * برنامه‌ریزی تأمین (فاز ۴): برنامه تولید با محدودیت ظرفیت (MPS)، پیش‌بینی موجودی، ذخیره اطمینان و نیاز مواد (MRP).
 *
 * ورودی: برنامه اجماعی چرخه جاری (یا آماری اگر اجماعی ثبت نشده)، موجودی ابتدای دوره، مسیرهای تولید و ظرفیت خطوط، BOM و موجودی مواد.
 *
 * ذخیره اطمینان:
 *   آماری: SS = z(سطح خدمت) × σ خطای نسبی پیش‌بینی × تقاضای ماه × √(زمان بازپرسازی بر حسب ماه)
 *          σ از خطای بک‌تست روش منتخب (یا ضریب تغییرات فروش) گرفته می‌شود؛ سقف آن با ماندگاری محصول محدود است.
 *   روز:   SS = روز ذخیره اطمینان محصول ÷ ۳۰ × تقاضای ماه
 *
 * برنامه تولید (روش ابتکاری داخل برنامه):
 *   برای هر ماه و هر محصول (به ترتیب اولویت ABC) نیاز خالص = تقاضا + ذخیره اطمینان − موجودی؛ گرد به اندازه بچ.
 *   تخصیص به ترتیب: ظرفیت عادی خط اصلی ← خط جایگزین ← پیش‌ساخت در ماه‌های قبل (با رعایت ماندگاری)
 *   ← اضافه‌کاری (تا سقف تنظیمات) ← کمبود.
 *   در موتور پایتون همین مسئله با برنامه‌ریزی خطی (کمینه‌سازی هزینه نگهداری، اضافه‌کاری، خط جایگزین و کمبود) حل می‌شود.
 *
 * MRP: نیاز ناخالص مواد = تولید × مقدار در BOM × (۱ + ضایعات)؛ نیاز خالص با موجودی، سفارش در راه و ذخیره اطمینان مواد؛
 *   سفارش برنامه‌ریزی‌شده با حداقل سفارش (MOQ) و صدور به اندازه زمان تأمین زودتر. مواد درون‌گروهی = تقاضا برای شرکت تأمین‌کننده.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali, S = IBP.store, A = IBP.analytics;
  var cache = { v: -1, key: '' };

  function zOf(p) {
    // تابع معکوس نرمال (تقریب Acklam) برای سطح خدمت
    p = Math.min(0.9999, Math.max(0.5, p));
    var a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    var b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    var c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    var q, r;
    if (p > 0.97575) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function options(o) {
    var st = S.settings();
    o = o || {};
    return {
      months: o.months || Math.min(st.horizonMonths || 18, 18),
      serviceLevel: o.serviceLevel || st.serviceLevelTarget || 0.95,
      ssMethod: o.ssMethod || st.ssMethod || 'statistical',
      overtimePct: o.overtimePct !== undefined ? o.overtimePct : (st.overtimePct !== undefined ? st.overtimePct : 0.1),
      prebuildMonths: o.prebuildMonths !== undefined ? o.prebuildMonths : (st.prebuildMonths !== undefined ? st.prebuildMonths : 3),
      productionLeadDays: o.productionLeadDays || st.productionLeadDays || 7,
      version: o.version || st.supplyVersion || 'اجماعی',
      overrides: o.overrides || S.meta('mpsOverrides') || {}
    };
  }

  /** داده پایه برنامه: محصولات، تقاضا، موجودی، مسیرها، ظرفیت */
  function inputs(opts) {
    var o = options(opts), ctx = A.ctx(), cycle = ctx.cycle;
    var periods = J.range(cycle, o.months);
    var fmap = A.forecastMap(o.version, cycle);
    if (!fmap.size) fmap = A.forecastMap('آماری', cycle);
    var inv = A.inventoryByProduct(), run = S.meta('statRun');
    var z = zOf(o.serviceLevel), L = 1 + o.productionLeadDays / 30;
    var rank = { A: 0, B: 1, C: 2 };
    var products = S.all('products').filter(function (p) { return p.active !== false && p.lifecycle !== 'توقف'; })
      .sort(function (a, b) { return (rank[a.abc] || 2) - (rank[b.abc] || 2) || (b.unitPrice || 0) - (a.unitPrice || 0); });
    var hist = J.range(J.addMonths(cycle, -12), 12), si = A.salesIndex();
    var routes = {};
    S.all('routings').forEach(function (r) { if (r.unitsPerHour > 0) (routes[r.productId] = routes[r.productId] || []).push(r); });
    Object.keys(routes).forEach(function (k) { routes[k].sort(function (a, b) { return (a.priority || 1) - (b.priority || 1); }); });

    var items = products.map(function (p) {
      var dem = periods.map(function (per) { var m = fmap.get(p.id); return m ? (m.get(per) || 0) : 0; });
      // σ نسبی خطای پیش‌بینی: بک‌تست روش منتخب، در غیر این صورت ضریب تغییرات فروش ۱۲ ماه
      var rel = null, rp = run && run.cycle === cycle && run.products ? run.products[p.id] : null;
      if (rp) { var mt = rp.metrics && rp.metrics[rp.method]; rel = mt && mt.rmse !== null && mt.rmse !== undefined ? mt.rmse : rp.score; }
      if (rel === null || rel === undefined) {
        var ys = hist.map(function (per) { var m = si.get(per), v = m && m.get(p.id); return v ? v.qty : 0; });
        var mu = A.sum(ys) / ys.length || 0, sd = Math.sqrt(A.sum(ys, function (v) { return (v - mu) * (v - mu); }) / ys.length);
        rel = mu > 0 ? Math.min(1, 0.6 * sd / mu) : 0.3;
      }
      rel = Math.min(1.2, Math.max(0.03, rel));
      var shelfM = p.shelfLifeDays ? p.shelfLifeDays / 30 : 99;
      var ss = dem.map(function (d, t) {
        var nxt = dem[t + 1] !== undefined ? (d + dem[t + 1]) / 2 : d;
        var v = o.ssMethod === 'days' ? (p.safetyStockDays || 0) / 30 * nxt : z * rel * nxt * Math.sqrt(L);
        return Math.max(0, Math.min(v, nxt * Math.max(0.1, shelfM * 0.4)));
      });
      return {
        product: p, demand: dem, ss: ss, rel: rel, open: inv.get(p.id) || 0, shelfMonths: shelfM,
        batch: p.batchSize > 0 ? p.batchSize : 0, routes: routes[p.id] || [],
        maxCarry: Math.max(0, Math.min(o.prebuildMonths, Math.floor(shelfM * 0.6)))
      };
    });
    var resources = S.all('resources').map(function (r) { return { resource: r, cap: A.resourceCapacity(r) }; });
    return { o: o, cycle: cycle, periods: periods, items: items, resources: resources, z: z };
  }

  function hoursFor(route, qty) { return qty > 0 ? qty / route.unitsPerHour + (route.setupHours || 0) * 0.5 : 0; }

  /** برنامه تولید ابتکاری با محدودیت ظرفیت */
  function planLocal(inp) {
    var T = inp.periods.length, o = inp.o;
    var capLeft = {}, capOT = {};
    inp.resources.forEach(function (r) { capLeft[r.resource.id] = inp.periods.map(function () { return r.cap; }); capOT[r.resource.id] = inp.periods.map(function () { return r.cap * o.overtimePct; }); });
    var alloc = []; // {pid, rid, t, qty, kind}
    var frozen = Math.max(0, S.settings().frozenMonths || 0);
    var state = {};
    inp.items.forEach(function (it) { state[it.product.id] = { inv: it.open, prod: new Array(T).fill(0), extra: new Array(T).fill(0), short: new Array(T).fill(0) }; });

    function take(it, t, qty, kind, useOT) {
      // تخصیص qty در ماه t روی مسیرهای مجاز؛ خروجی: مقدار تخصیص‌یافته
      var done = 0;
      it.routes.forEach(function (rt, ri) {
        if (done >= qty - 1e-9) return;
        if (kind === 'primary' && ri > 0) return;
        if (kind === 'alt' && ri === 0) return;
        var pool = useOT ? capOT[rt.resourceId] : capLeft[rt.resourceId];
        if (!pool) return;
        var hrs = pool[t];
        if (hrs <= 0.01) return;
        var q = Math.min(qty - done, hrs * rt.unitsPerHour);
        if (q <= 0) return;
        pool[t] -= q / rt.unitsPerHour;
        done += q;
        alloc.push({ pid: it.product.id, rid: rt.resourceId, t: t, qty: q, kind: useOT ? 'overtime' : (ri === 0 ? 'primary' : 'alt') });
      });
      return done;
    }

    for (var t = 0; t < T; t++) {
      inp.items.forEach(function (it) {
        var st = state[it.product.id], pid = it.product.id;
        var avail = st.inv + st.extra[t];
        var ov = (o.overrides[pid] || {})[inp.periods[t]];
        var need = ov !== undefined && ov !== null ? ov : Math.max(0, it.demand[t] + it.ss[t] - avail);
        if (ov === undefined && need > 0 && it.batch) need = Math.ceil(need / it.batch - 1e-9) * it.batch;
        if (!it.routes.length) { st.prod[t] += need; avail += need; }
        else if (need > 0) {
          var got = take(it, t, need, 'primary', false);
          if (got < need) got += take(it, t, need - got, 'alt', false);
          // پیش‌ساخت در ماه‌های قبل (بعد از افق منجمد، در محدوده ماندگاری)
          for (var k = 1; got < need && k <= it.maxCarry && t - k >= Math.min(frozen, t); k++) {
            var before = alloc.length;
            got += take(it, t - k, need - got, 'any', false);
            for (var ai = before; ai < alloc.length; ai++) { alloc[ai].kind = 'prebuild'; alloc[ai].prebuildFor = t; }
          }
          if (got < need) got += take(it, t, need - got, 'any', true);
          avail += got;
          st.prod[t] += got;
        }
        var end = avail - it.demand[t];
        if (end < 0) { st.short[t] = -end; end = 0; }
        st.inv = end;
      });
    }
    return project(inp, alloc);
  }

  /** پیش‌بینی موجودی، کمبود، بار ظرفیت و شاخص‌ها از تخصیص تولید */
  function project(inp, alloc, engine) {
    var T = inp.periods.length, byP = {}, byR = {};
    inp.items.forEach(function (it) { byP[it.product.id] = { prod: new Array(T).fill(0), prebuild: new Array(T).fill(0), overtime: new Array(T).fill(0), alt: new Array(T).fill(0) }; });
    inp.resources.forEach(function (r) {
      byR[r.resource.id] = { resource: r.resource, cap: r.cap, hours: new Array(T).fill(0), overtime: new Array(T).fill(0), byProduct: {} };
    });
    var routeOf = {};
    S.all('routings').forEach(function (r) { routeOf[r.productId + '|' + r.resourceId] = r; });
    alloc.forEach(function (a) {
      var bp = byP[a.pid]; if (!bp) return;
      bp.prod[a.t] += a.qty;
      if (a.kind === 'prebuild') bp.prebuild[a.t] += a.qty;
      if (a.kind === 'overtime') bp.overtime[a.t] += a.qty;
      if (a.kind === 'alt') bp.alt[a.t] += a.qty;
      var rr = byR[a.rid], rt = routeOf[a.pid + '|' + a.rid];
      if (rr && rt) {
        var hrs = a.qty / rt.unitsPerHour;
        rr.hours[a.t] += hrs;
        if (a.kind === 'overtime') rr.overtime[a.t] += hrs;
        var bpr = rr.byProduct[a.pid] = rr.byProduct[a.pid] || new Array(T).fill(0);
        bpr[a.t] += hrs;
      }
    });
    var rows = inp.items.map(function (it) {
      var bp = byP[it.product.id], inv = it.open, invArr = [], short = [], cover = [];
      if (!it.routes.length) {
        // محصول بدون مسیر تولید (کالای بازرگانی): تأمین به اندازه نیاز
        var v = it.open;
        for (var t0 = 0; t0 < T; t0++) { var n0 = Math.max(0, it.demand[t0] + it.ss[t0] - v); bp.prod[t0] = n0; v = v + n0 - it.demand[t0]; }
      }
      for (var t = 0; t < T; t++) {
        var end = inv + bp.prod[t] - it.demand[t];
        short.push(end < 0 ? -end : 0);
        inv = Math.max(0, end);
        invArr.push(inv);
        var nd = it.demand[t + 1] !== undefined ? it.demand[t + 1] : it.demand[t];
        cover.push(nd > 0 ? inv / nd : null);
      }
      var p = it.product, dem = A.sum(it.demand), sh = A.sum(short);
      return {
        product: p, demand: it.demand, ss: it.ss, production: bp.prod, prebuild: bp.prebuild, overtime: bp.overtime, alt: bp.alt,
        inventory: invArr, shortage: short, cover: cover, open: it.open, rel: it.rel,
        fillRate: dem > 0 ? 1 - sh / dem : 1,
        belowSS: invArr.filter(function (v, i) { return v < it.ss[i] * 0.999 - 0.5; }).length,
        excess: invArr.filter(function (v, i) { return it.demand[i + 1] !== undefined && v > (it.demand[i + 1] || 0) * (S.settings().excessMonths || 3); }).length
      };
    });
    var res = inp.resources.map(function (r) {
      var x = byR[r.resource.id];
      x.util = x.hours.map(function (hh) { return x.cap ? hh / x.cap : null; });
      x.peak = Math.max.apply(null, x.util.concat([0]));
      x.avg = A.sum(x.util, function (u) { return u || 0; }) / T;
      return x;
    });
    var totDem = 0, totShort = 0, totDemV = 0, totShortV = 0;
    rows.forEach(function (r) {
      totDem += A.sum(r.demand); totShort += A.sum(r.shortage);
      totDemV += A.sum(r.demand) * (r.product.unitPrice || 0); totShortV += A.sum(r.shortage) * (r.product.unitPrice || 0);
    });
    var invValue = inp.periods.map(function (_, t) { return A.sum(rows, function (r) { return r.inventory[t] * (r.product.unitCost || 0); }); });
    var invTons = inp.periods.map(function (_, t) { return A.sum(rows, function (r) { return r.inventory[t] * (r.product.unitWeightKg || 0) / 1000; }); });
    var prodTons = inp.periods.map(function (_, t) { return A.sum(rows, function (r) { return r.production[t] * (r.product.unitWeightKg || 0) / 1000; }); });
    var demTons = inp.periods.map(function (_, t) { return A.sum(rows, function (r) { return r.demand[t] * (r.product.unitWeightKg || 0) / 1000; }); });
    return {
      engine: engine || 'local', cycle: inp.cycle, periods: inp.periods, options: inp.o, z: inp.z,
      rows: rows, resources: res,
      kpi: {
        fillRate: totDem ? 1 - totShort / totDem : 1, fillRateValue: totDemV ? 1 - totShortV / totDemV : 1,
        shortageValue: totShortV, prebuild: A.sum(rows, function (r) { return A.sum(r.prebuild); }),
        prebuildTons: A.sum(rows, function (r) { return A.sum(r.prebuild) * (r.product.unitWeightKg || 0) / 1000; }),
        overtimeHours: A.sum(res, function (r) { return A.sum(r.overtime); }),
        bottlenecks: A.sum(res, function (r) { return r.util.filter(function (u) { return u > 1.0001; }).length; }),
        avgUtil: res.length ? A.sum(res, function (r) { return r.avg; }) / res.length : 0,
        belowSS: rows.filter(function (r) { return r.belowSS > 0; }).length
      },
      invValue: invValue, invTons: invTons, prodTons: prodTons, demTons: demTons
    };
  }

  /* ---------------- MRP ---------------- */
  function mrp(plan) {
    var T = plan.periods.length, mats = {}, cycle = plan.cycle;
    var bom = S.all('bom');
    var prodBy = {};
    plan.rows.forEach(function (r) { prodBy[r.product.id] = r.production; });
    bom.forEach(function (b) {
      var pr = prodBy[b.productId]; if (!pr) return;
      var m = mats[b.materialId] = mats[b.materialId] || { gross: new Array(T).fill(0), users: {} };
      for (var t = 0; t < T; t++) {
        var g = pr[t] * b.qtyPer * (1 + (b.scrap || 0));
        m.gross[t] += g;
        if (g > 0) m.users[b.productId] = (m.users[b.productId] || 0) + g;
      }
    });
    var onHand = {}, onOrder = {};
    S.all('materialInventory').forEach(function (r) { onHand[r.materialId] = (onHand[r.materialId] || 0) + (r.qty || 0); onOrder[r.materialId] = (onOrder[r.materialId] || 0) + (r.onOrder || 0); });
    var rows = Object.keys(mats).map(function (mid) {
      var mat = S.get('materials', mid); if (!mat) return null;
      var g = mats[mid].gross, avg = A.sum(g) / T;
      var lt = Math.max(0, Math.ceil(((mat.leadTimeDays || 0) - 5) / 30));
      var ss = (mat.safetyStockDays || 0) / 30 * avg;
      var moq = mat.moq || 0;
      var oh = onHand[mid] || 0, sched = onOrder[mid] || 0;
      var proj = [], receipts = new Array(T).fill(0), releases = new Array(T).fill(0), net = new Array(T).fill(0), late = [];
      var inv = oh;
      for (var t = 0; t < T; t++) {
        var rec = t === Math.min(T - 1, Math.max(0, lt - 1)) ? sched : 0;
        var avail = inv + rec - g[t];
        if (avail < ss) {
          var need = ss - avail;
          net[t] = need;
          var qty = moq > 0 ? Math.max(need, moq) : need;
          if (moq > 0) qty = Math.ceil(qty / moq - 1e-9) * moq;
          receipts[t] = qty;
          var rel = t - lt;
          if (rel < 0) { late.push(t); rel = 0; }
          releases[rel] += qty;
          avail += qty;
        }
        inv = avail;
        proj.push(inv);
      }
      var sup = S.get('suppliers', mat.supplierId);
      return {
        material: mat, supplier: sup, gross: g, net: net, receipts: receipts, releases: releases, projected: proj, ss: ss,
        onHand: oh, onOrder: sched, leadMonths: lt, late: late, users: mats[mid].users,
        value: A.sum(receipts) * (mat.unitCost || 0), internal: mat.internalCompany || ''
      };
    }).filter(Boolean).sort(function (a, b) { return b.value - a.value; });
    // درخواست‌های درون‌گروهی (به تفکیک شرکت تأمین‌کننده)
    var ic = {};
    rows.forEach(function (r) {
      if (!r.internal) return;
      var c = ic[r.internal] = ic[r.internal] || { company: r.internal, items: [], tons: new Array(T).fill(0), value: 0 };
      c.items.push(r);
      r.receipts.forEach(function (q, t) { c.tons[t] += (r.material.uom === 'کیلوگرم' ? q / 1000 : r.material.uom === 'تن' ? q : 0); });
      c.value += r.value;
    });
    return {
      cycle: cycle, periods: plan.periods, rows: rows, ic: ic,
      purchaseValue: plan.periods.map(function (_, t) { return A.sum(rows, function (r) { return r.receipts[t] * (r.material.unitCost || 0); }); }),
      lateCount: rows.filter(function (r) { return r.late.length; }).length
    };
  }

  /* ---------------- اجرای کامل و نگهداری نتیجه ---------------- */
  function compute(opts) {
    var key = JSON.stringify(opts || {}) + '|' + JSON.stringify(S.meta('mpsOverrides') || {});
    if (cache.v === S.version && cache.key === key && cache.plan) return cache;
    var inp = inputs(opts);
    var engineRun = S.meta('supplyRun');
    var plan = planLocal(inp);
    cache = { v: S.version, key: key, plan: plan, mrp: mrp(plan), inputs: inp, engineRun: engineRun };
    return cache;
  }

  /** بسته ارسالی به موتور پایتون برای بهینه‌سازی خطی */
  function enginePayload(inp) {
    return {
      periods: inp.periods, overtimePct: inp.o.overtimePct, frozen: S.settings().frozenMonths || 0,
      products: inp.items.map(function (it) {
        return {
          id: it.product.id, demand: it.demand, ss: it.ss, open: it.open, maxCarry: it.maxCarry,
          unitCost: it.product.unitCost || 0, unitPrice: it.product.unitPrice || 0, priority: it.product.abc || 'C',
          routes: it.routes.map(function (r, i) { return { resourceId: r.resourceId, unitsPerHour: r.unitsPerHour, alt: i > 0 }; })
        };
      }),
      resources: inp.resources.map(function (r) { return { id: r.resource.id, capacity: r.cap, costPerHour: r.resource.costPerHour || 0 }; })
    };
  }

  /** بهینه‌سازی با موتور پایتون (LP)؛ در صورت عدم دسترسی، روش ابتکاری */
  function optimize(opts) {
    var inp = inputs(opts);
    if (!IBP.engine.online()) return Promise.resolve({ plan: planLocal(inp), engine: 'local' });
    return IBP.engine.call('/supply/optimize', enginePayload(inp), { timeout: 120000 }).then(function (r) {
      var alloc = r.allocations.map(function (a) { return { pid: a.productId, rid: a.resourceId, t: a.t, qty: a.qty, kind: a.kind }; });
      var plan = project(inp, alloc, 'python');
      plan.solver = { status: r.status, objective: r.objective, seconds: r.seconds };
      S.setMeta('supplyRun', { cycle: inp.cycle, at: new Date().toISOString(), engine: 'python', status: r.status, objective: r.objective, alloc: r.allocations });
      cache = { v: S.version, key: '__lp', plan: plan, mrp: mrp(plan), inputs: inp };
      return { plan: plan, engine: 'python' };
    }, function () { return { plan: planLocal(inp), engine: 'local' }; });
  }

  /** اگر بهینه‌سازی پایتون برای همین چرخه ذخیره شده باشد، همان را بازسازی می‌کند */
  function current(opts) {
    var run = S.meta('supplyRun');
    if (run && run.engine === 'python' && run.cycle === A.ctx().cycle && run.alloc && (!opts || !opts.local)) {
      if (cache.key === '__lp:' + S.version && cache.plan) return cache;
      var inp = inputs(opts);
      var alloc = run.alloc.map(function (a) { return { pid: a.productId, rid: a.resourceId, t: a.t, qty: a.qty, kind: a.kind }; });
      var plan = project(inp, alloc, 'python');
      plan.solver = { status: run.status, objective: run.objective, at: run.at };
      cache = { v: S.version, key: '__lp:' + S.version, plan: plan, mrp: mrp(plan), inputs: inp };
      return cache;
    }
    return compute(opts);
  }
  function clearOptimized() { S.setMeta('supplyRun', null); cache = { v: -1 }; }

  IBP.supply = { zOf: zOf, options: options, inputs: inputs, planLocal: planLocal, project: project, mrp: mrp, compute: compute, current: current, optimize: optimize, enginePayload: enginePayload, clearOptimized: clearOptimized };
})(window.IBP = window.IBP || {});
