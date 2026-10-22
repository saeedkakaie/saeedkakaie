/*
 * مولد داده تستی.
 * از روی یک الگوی صنعت، یک شرکت تولیدی کامل می‌سازد:
 * داده پایه + ۲۴ ماه فروش واقعی + پیش‌بینی ۱۸ ماه آینده + سوابق پیش‌بینی برای سنجش دقت
 * + بودجه سال مالی + موجودی محصول و مواد + مراحل چرخه IBP.
 * مولد تصادفی با seed ثابت است تا هر بار همان داده تولید شود.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali;
  var COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  var REGIONS = [
    { code: 'R1', name: 'تهران و البرز', manager: 'مهندس رضایی' },
    { code: 'R2', name: 'شمال', manager: 'خانم احمدی' },
    { code: 'R3', name: 'شرق', manager: 'مهندس کریمی' },
    { code: 'R4', name: 'غرب', manager: 'خانم محمدی' },
    { code: 'R5', name: 'جنوب', manager: 'مهندس حسینی' },
    { code: 'R6', name: 'مرکز', manager: 'خانم نوری' }
  ];
  var EXPORT_REGION = { code: 'R9', name: 'بازارهای صادراتی', manager: 'مهندس صادقی' };
  var NAMES = ['آریا', 'سپهر', 'البرز', 'کوثر', 'مهرگان', 'پارسیان', 'آفتاب', 'نگین', 'ستاره شرق', 'زاگرس', 'دماوند', 'خلیج فارس',
    'کاسپین', 'آرمان', 'بهار', 'نوین', 'پیشگام', 'اطلس', 'سپید', 'رهآورد', 'افق', 'کیمیا', 'آوند', 'تابان', 'مروارید',
    'ارغوان', 'سهند', 'سبلان', 'هامون', 'آرین', 'پرشین', 'یاس', 'شایان', 'بامداد', 'فراز', 'ماهان'];
  var SUPPLIER_NAMES = ['تأمین‌گستر', 'بسپار', 'فراورده‌های صنعتی', 'پویا', 'آسیا', 'صنایع بسته‌بندی', 'شیمی', 'بازرگانی خارجی', 'فلزات', 'تجهیز'];
  var SUPPLIER_CITIES = ['تهران', 'اصفهان', 'تبریز', 'شیراز', 'مشهد', 'قزوین', 'دبی', 'استانبول', 'گوانگجو'];

  function rng(seed) {
    var a = seed >>> 0;
    var f = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = function (lo, hi) { return lo + (hi - lo) * f(); };
    f.int = function (lo, hi) { return Math.floor(f.range(lo, hi + 1)); };
    f.pick = function (arr) { return arr[Math.floor(f() * arr.length)]; };
    f.normal = function () {
      var u = 1 - f(), v = f();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    f.shuffle = function (arr) {
      var a2 = arr.slice();
      for (var i = a2.length - 1; i > 0; i--) { var j = Math.floor(f() * (i + 1)); var t = a2[i]; a2[i] = a2[j]; a2[j] = t; }
      return a2;
    };
    return f;
  }

  function roundTo(v, step) { return Math.round(v / step) * step; }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function lastDayIso(p) {
    var jy = J.year(p), jm = J.month(p);
    var g = J.toGregorian(jy, jm, J.monthLength(jy, jm));
    return g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
  }
  function dayIso(p, day) {
    var jy = J.year(p), jm = J.month(p);
    var g = J.toGregorian(jy, jm, Math.min(day, J.monthLength(jy, jm)));
    return g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
  }

  /**
   * تولید داده کامل. خروجی: { entity: [records] , settings }
   * opts: { templateId, cyclePeriod, historyMonths, horizonMonths, seed }
   */
  function generate(opts) {
    opts = opts || {};
    var tpl = IBP.templates.get(opts.templateId || 'food');
    var R = rng(opts.seed || 1405);
    var cycle = opts.cyclePeriod || J.currentPeriod();
    var H = opts.historyMonths || 24, F = opts.horizonMonths || 18;
    var histPeriods = J.range(J.addMonths(cycle, -H), H);
    var futPeriods = J.range(cycle, F);
    var inflation = 0.025; // تورم ماهانه قیمت فروش
    var id = 0;
    function nid(prefix) { id++; return prefix + id.toString(36); }

    var out = {
      plants: [], warehouses: [], resources: [], families: [], products: [], routings: [],
      suppliers: [], materials: [], bom: [], channels: [], regions: [], customers: [],
      salesActuals: [], forecasts: [], budgets: [], inventory: [], materialInventory: [], cycleSteps: []
    };

    /* ---------- کارخانه و انبار ---------- */
    var plantWh = {};
    tpl.plants.forEach(function (p) {
      var rec = { id: nid('pl'), code: p.code, name: p.name, city: p.city, workingDays: 25, active: true };
      out.plants.push(rec);
      var fg = { id: nid('wh'), code: 'FG-' + p.code, name: 'انبار محصول ' + p.city, plantId: rec.id, type: 'محصول نهایی', capacity: R.int(3, 8) * 1000 };
      var rm = { id: nid('wh'), code: 'RM-' + p.code, name: 'انبار مواد ' + p.city, plantId: rec.id, type: 'مواد اولیه', capacity: R.int(2, 5) * 1000 };
      out.warehouses.push(fg, rm);
      plantWh[rec.id] = { fg: fg, rm: rm };
    });
    var dc = { id: nid('wh'), code: 'DC-01', name: 'مرکز توزیع تهران', plantId: out.plants[0].id, type: 'توزیع', capacity: 6000 };
    out.warehouses.push(dc);

    /* ---------- بازار ---------- */
    var hasExport = tpl.channels.some(function (c) { return c.export; });
    REGIONS.concat(hasExport ? [EXPORT_REGION] : []).forEach(function (r) {
      out.regions.push({ id: nid('rg'), code: r.code, name: r.name, manager: r.manager });
    });
    var domesticRegions = out.regions.filter(function (r) { return r.code !== 'R9'; });
    var exportRegion = out.regions.filter(function (r) { return r.code === 'R9'; })[0];

    var names = R.shuffle(NAMES), ni = 0;
    tpl.channels.forEach(function (c) {
      var ch = { id: nid('ch'), code: c.code, name: c.name, discount: c.discount };
      out.channels.push(ch);
      var n = Math.max(2, Math.round(c.weight * 1.2));
      for (var i = 0; i < n; i++) {
        var nm = names[ni % names.length] + (ni >= names.length ? ' ' + (Math.floor(ni / names.length) + 1) : '');
        ni++;
        var region = c.export ? exportRegion : (i < domesticRegions.length ? domesticRegions[i] : R.pick(domesticRegions));
        var tier = R() < 0.2 ? 'کلیدی' : (R() < 0.45 ? 'مهم' : 'عادی');
        out.customers.push({
          id: nid('cu'), code: 'C' + pad3(out.customers.length + 1), name: c.prefix + ' ' + nm + (c.export ? ' (' + R.pick(['عراق', 'افغانستان', 'ارمنستان', 'تاجیکستان', 'عمان']) + ')' : ''),
          channelId: ch.id, regionId: region.id, tier: tier,
          creditLimit: roundTo(R.range(5, 80) * 1e9, 1e9), paymentDays: R.pick([0, 15, 30, 45, 60, 90]),
          _w: (tier === 'کلیدی' ? 3 : tier === 'مهم' ? 1.6 : 1) * R.range(0.5, 1.5), _disc: c.discount
        });
      }
    });

    /* ---------- تأمین‌کنندگان و مواد ---------- */
    var supNames = R.shuffle(SUPPLIER_NAMES);
    for (var s = 0; s < 8; s++) {
      var imp = s >= 6;
      out.suppliers.push({
        id: nid('sp'), code: 'S' + pad3(s + 1),
        name: (imp ? 'شرکت ' : 'گروه ') + supNames[s % supNames.length] + ' ' + names[(s + 7) % names.length],
        city: imp ? R.pick(['دبی', 'استانبول', 'گوانگجو']) : R.pick(SUPPLIER_CITIES.slice(0, 6)),
        leadTimeDays: imp ? R.int(45, 90) : R.int(7, 30), reliability: Math.round(R.range(imp ? 0.7 : 0.82, 0.98) * 100) / 100, isImport: imp
      });
    }
    var matByName = {};
    function material(m) {
      if (matByName[m.name]) return matByName[m.name];
      var sup = R.pick(out.suppliers);
      var rec = {
        id: nid('mt'), code: (m.type === 'بسته‌بندی' ? 'PK-' : m.type === 'قطعه' ? 'CP-' : 'RM-') + pad3(out.materials.length + 1),
        name: m.name, type: m.type, uom: m.uom, unitCost: m.cost, supplierId: sup.id,
        leadTimeDays: sup.leadTimeDays, moq: roundTo(R.range(1, 20) * (m.cost > 1e7 ? 10 : 1000), 10), safetyStockDays: R.pick([10, 15, 20, 30])
      };
      out.materials.push(rec);
      matByName[m.name] = rec;
      return rec;
    }
    var shared = tpl.sharedMaterials.map(material);

    /* ---------- خانواده، محصول، خط تولید ---------- */
    var products = [];
    tpl.families.forEach(function (f, fi) {
      var plant = out.plants[fi % out.plants.length];
      var fam = { id: nid('fm'), code: f.code, name: f.name, color: COLORS[fi % COLORS.length], description: 'خانواده ' + f.name };
      out.families.push(fam);
      var lines = f.lines.map(function (ln, li) {
        var res = {
          id: nid('rs'), code: plant.code + '-' + f.code + (li + 1), name: ln, plantId: plant.id,
          type: /بسته‌بندی/.test(ln) ? 'بسته‌بندی' : 'خط تولید', shifts: R.pick([2, 2, 3]), hoursPerShift: 8,
          efficiency: Math.round(R.range(0.72, 0.9) * 100) / 100, costPerHour: roundTo(R.range(8, 40) * 1e6, 1e5),
          _target: R.pick([0.62, 0.74, 0.82, 0.9, 0.97, 1.06])
        };
        out.resources.push(res);
        return res;
      });
      var famMats = f.materials.map(material);
      var season = f.season.slice();
      var avg = season.reduce(function (a, b) { return a + b; }, 0) / 12;
      season = season.map(function (x) { return x / avg; });

      f.items.forEach(function (item, ii) {
        var price = roundTo(R.range(f.price[0], f.price[1]), f.price[1] > 1e8 ? 1e6 : 1e4);
        var lifeR = R();
        var lifecycle = lifeR < 0.06 ? 'معرفی' : lifeR < 0.14 ? 'افول' : lifeR < 0.38 ? 'رشد' : 'بلوغ';
        var growth = lifecycle === 'رشد' ? R.range(0.12, 0.3) : lifecycle === 'افول' ? R.range(-0.3, -0.12) : lifecycle === 'معرفی' ? 0.35 : R.range(-0.05, 0.1);
        var volR = R();
        var p = {
          id: nid('pr'), code: f.code + '-' + (101 + ii), name: item, familyId: fam.id, plantId: plant.id, uom: f.uom,
          unitPrice: price, unitCost: roundTo(price * R.range(f.cost[0], f.cost[1]), 1000), lifecycle: lifecycle,
          safetyStockDays: R.pick([7, 10, 15, 20, 30]),
          batchSize: roundTo(R.range(0.05, 0.25) * f.volume[1], 10), shelfLifeDays: f.shelfLife || null,
          active: true,
          _base: f.volume[0] + (f.volume[1] - f.volume[0]) * volR * volR,
          _growth: growth, _noise: R.pick([0.05, 0.06, 0.1, 0.12, 0.14, 0.25]), _season: season,
          _bias: R.range(-0.04, 0.12), _launch: lifecycle === 'معرفی' ? H - R.int(6, 10) : -999,
          _uph: R.range(f.uph[0], f.uph[1])
        };
        if (lifecycle === 'معرفی') p.launchDate = dayIso(histPeriods[p._launch], 1);
        else p.launchDate = dayIso(J.addMonths(cycle, -R.int(30, 120)), R.int(1, 28));
        out.products.push(p);
        products.push(p);

        // مسیر تولید: نیمی از محصولات روی خط دوم (در صورت وجود)
        var primary = lines.length > 1 && ii % 2 === 1 ? lines[1] : lines[0];
        out.routings.push({ id: nid('rt'), productId: p.id, resourceId: primary.id, unitsPerHour: 0, setupHours: R.pick([0.5, 1, 1.5, 2]), priority: 1, _p: p });
        if (lines.length > 1) {
          var alt = primary === lines[0] ? lines[1] : lines[0];
          out.routings.push({ id: nid('rt'), productId: p.id, resourceId: alt.id, unitsPerHour: 0, setupHours: 2, priority: 2, _p: p, _alt: true });
        }

        // BOM: مواد خانواده + مواد مشترک بسته‌بندی
        var picks = R.shuffle(famMats).slice(0, Math.min(famMats.length, R.int(2, 3)));
        var lines2 = picks.concat(shared).map(function (m) {
          var q = m.uom === 'عدد' || m.uom === 'ست' ? R.int(1, m.type === 'بسته‌بندی' ? 12 : 2) : R.range(0.2, 3);
          return { m: m, q: q };
        });
        var raw = lines2.reduce(function (a, l) { return a + l.q * l.m.unitCost; }, 0);
        var target = p.unitCost * R.range(0.55, 0.7);
        var k = raw > 0 ? target / raw : 1;
        lines2.forEach(function (l) {
          var q = l.m.uom === 'عدد' || l.m.uom === 'ست' ? Math.max(1, Math.round(l.q * k)) : Math.round(l.q * k * 10000) / 10000;
          out.bom.push({ id: nid('bm'), productId: p.id, materialId: l.m.id, qtyPer: q, scrap: R.pick([0.01, 0.02, 0.03, 0.05]) });
        });
      });
    });

    /* ---------- تقاضای «واقعی» زیربنایی ---------- */
    function expected(p, offset) { // offset: فاصله ماه از ابتدای تاریخچه
      if (offset < p._launch) return 0;
      var ramp = p._launch > -999 ? Math.min(1, (offset - p._launch + 1) / 4) : 1;
      var t = (offset - H) / 12; // سال نسبت به ماه چرخه
      var per = J.addMonths(histPeriods[0], offset);
      return p._base * Math.pow(1 + p._growth, t) * p._season[J.month(per) - 1] * ramp;
    }
    function priceAt(p, per) { return p.unitPrice * Math.pow(1 + inflation, J.diff(cycle, per)); }

    /* ---------- فروش واقعی (محصول × مشتری × ماه) ---------- */
    var actualQty = {}; // productId → [qty per hist period]
    products.forEach(function (p) {
      var custs = R.shuffle(out.customers).slice(0, R.int(4, 12));
      var ws = custs.map(function (c) { return c._w * R.range(0.5, 1.5); });
      var wsum = ws.reduce(function (a, b) { return a + b; }, 0);
      actualQty[p.id] = [];
      histPeriods.forEach(function (per, t) {
        var e = expected(p, t);
        var q = Math.max(0, Math.round(e * (1 + p._noise * R.normal())));
        actualQty[p.id].push(q);
        if (!q) return;
        var price = priceAt(p, per);
        custs.forEach(function (c, ci) {
          var cq = Math.round(q * ws[ci] / wsum);
          if (cq <= 0) return;
          out.salesActuals.push({
            id: nid('sa'), period: per, productId: p.id, customerId: c.id, qty: cq,
            revenue: roundTo(cq * price * (1 - c._disc), 1000)
          });
        });
      });
    });

    /* ---------- پیش‌بینی ---------- */
    var consensusNext = {};
    products.forEach(function (p) {
      // سوابق پیش‌بینی اجماعی (lag-1) برای ۱۲ ماه گذشته جهت سنجش دقت
      for (var t = H - 12; t < H; t++) {
        var per = histPeriods[t];
        var e = expected(p, t);
        if (e <= 0) continue;
        var fq = Math.max(0, Math.round(e * (1 + p._bias + (0.06 + p._noise * 0.6) * R.normal())));
        out.forecasts.push({ id: nid('fc'), version: 'اجماعی', cycle: J.addMonths(per, -1), period: per, productId: p.id, qty: fq });
      }
      // پیش‌بینی آماری و اجماعی چرخه جاری
      var adj = R.range(-0.03, 0.08);
      consensusNext[p.id] = [];
      futPeriods.forEach(function (per, i) {
        var e = expected(p, H + i);
        var stat = Math.max(0, Math.round(e * (1 + 0.04 * R.normal())));
        var cons = Math.max(0, Math.round(stat * (1 + adj + 0.03 * R.normal())));
        consensusNext[p.id].push(cons);
        out.forecasts.push({ id: nid('fc'), version: 'آماری', cycle: cycle, period: per, productId: p.id, qty: stat });
        out.forecasts.push({ id: nid('fc'), version: 'اجماعی', cycle: cycle, period: per, productId: p.id, qty: cons });
      });
    });

    /* ---------- بودجه سال مالی ---------- */
    var fsm = opts.fiscalStartMonth || 1;
    var fy = J.fiscalYear(cycle, fsm);
    J.fiscalYearPeriods(fy, fsm).forEach(function (per) {
      var off = J.diff(histPeriods[0], per);
      products.forEach(function (p) {
        if (!p._budgetK) p._budgetK = R.range(1.03, 1.12);
        var q = Math.round(expected(p, off) * p._budgetK);
        if (q <= 0) return;
        out.budgets.push({
          id: nid('bg'), period: per, productId: p.id, qty: q,
          revenue: roundTo(q * p.unitPrice * Math.pow(1 + inflation * 0.8, J.diff(cycle, per)) * 0.94, 1000)
        });
      });
    });

    /* ---------- تنظیم ظرفیت خطوط ---------- */
    out.resources.forEach(function (res) {
      var plant = out.plants.filter(function (pl) { return pl.id === res.plantId; })[0];
      var hours = res.shifts * res.hoursPerShift * plant.workingDays * res.efficiency;
      var prim = out.routings.filter(function (r) { return r.resourceId === res.id && !r._alt; });
      var load = 0;
      prim.forEach(function (r) {
        var avg12 = consensusNext[r.productId].slice(0, 12).reduce(function (a, b) { return a + b; }, 0) / 12;
        load += avg12 / r._p._uph;
      });
      var k = load > 0 ? load / (res._target * hours) : 1;
      prim.forEach(function (r) { r.unitsPerHour = Math.max(1, Math.round(r._p._uph * k * 10) / 10); });
    });
    out.routings.forEach(function (r) {
      if (r._alt) {
        var main = out.routings.filter(function (x) { return x.productId === r.productId && !x._alt; })[0];
        r.unitsPerHour = Math.max(1, Math.round(main.unitsPerHour * R.range(0.7, 0.95) * 10) / 10);
      }
    });

    /* ---------- موجودی ---------- */
    var asOf = lastDayIso(J.addMonths(cycle, -1));
    products.forEach(function (p) {
      var next = consensusNext[p.id][0] || 0;
      var r = R();
      var cover = r < 0.12 ? R.range(0, 0.25) : r < 0.75 ? R.range(0.5, 1.6) : r < 0.9 ? R.range(1.6, 3) : R.range(3, 5.5);
      var qty = Math.round(next * cover);
      var wh = plantWh[p.plantId].fg;
      var toDc = p.plantId === out.plants[0].id ? 0 : 0.3;
      var q1 = Math.round(qty * (1 - toDc)), q2 = qty - q1;
      out.inventory.push({ id: nid('iv'), productId: p.id, warehouseId: wh.id, qty: q1, asOf: asOf });
      if (q2 > 0) out.inventory.push({ id: nid('iv'), productId: p.id, warehouseId: dc.id, qty: q2, asOf: asOf });
    });
    out.materials.forEach(function (m) {
      var need = 0, plantId = null;
      out.bom.forEach(function (b) {
        if (b.materialId !== m.id) return;
        var p = products.filter(function (x) { return x.id === b.productId; })[0];
        need += (consensusNext[p.id][0] || 0) * b.qtyPer * (1 + b.scrap);
        plantId = plantId || p.plantId;
      });
      plantId = plantId || out.plants[0].id;
      out.materialInventory.push({
        id: nid('mi'), materialId: m.id, warehouseId: plantWh[plantId].rm.id,
        qty: Math.round(need * R.range(0.2, 2.4)), onOrder: R() < 0.5 ? Math.round(need * R.range(0.3, 1)) : 0, asOf: asOf
      });
    });

    /* ---------- چرخه IBP ---------- */
    out.cycleSteps = cycleSteps(cycle).map(function (s) { s.id = nid('cs'); return s; });

    /* ---------- پاک‌سازی فیلدهای کمکی ---------- */
    Object.keys(out).forEach(function (k) {
      out[k].forEach(function (r) { Object.keys(r).forEach(function (f) { if (f.charAt(0) === '_') delete r[f]; }); });
    });

    // کلاس‌بندی ABC / XYZ از روی فروش واقعی
    classify(out.products, out.salesActuals, histPeriods.slice(-12));

    return {
      data: out,
      settings: { companyName: tpl.company, industry: tpl.name, templateId: tpl.id, cyclePeriod: cycle, historyMonths: H, horizonMonths: F, priceInflation: inflation }
    };
  }

  var STEPS = [
    { name: 'جمع‌آوری داده و بستن ماه', owner: 'کارشناس برنامه‌ریزی', day: 3 },
    { name: 'بازنگری پورتفوی محصول', owner: 'مدیر محصول', day: 6 },
    { name: 'بازنگری تقاضا', owner: 'مدیر فروش و بازاریابی', day: 10 },
    { name: 'بازنگری تأمین', owner: 'مدیر زنجیره تأمین', day: 15 },
    { name: 'تطبیق یکپارچه و مالی', owner: 'مدیر مالی', day: 20 },
    { name: 'جلسه بازنگری مدیریت (MBR)', owner: 'مدیرعامل', day: 25 }
  ];

  function cycleSteps(cycle) {
    var today = J.today(), cur = J.period(today.jy, today.jm);
    return STEPS.map(function (s, i) {
      var status = 'انجام نشده';
      if (cycle < cur) status = 'تکمیل';
      else if (cycle === cur) {
        if (s.day < today.jd - 1) status = i === 2 && today.jd < 20 ? 'تأخیر' : 'تکمیل';
        else if (s.day <= today.jd + 3) status = 'در حال انجام';
      }
      return { cycle: cycle, order: i + 1, name: s.name, owner: s.owner, dueDate: dayIso(cycle, s.day), status: status, notes: '' };
    });
  }

  /** کلاس‌بندی ABC (سهم تجمعی فروش ریالی) و XYZ (ضریب تغییرات تقاضا) */
  function classify(products, sales, periods) {
    var set = new Set(periods), rev = {}, q = {};
    sales.forEach(function (s) {
      if (!set.has(s.period)) return;
      rev[s.productId] = (rev[s.productId] || 0) + s.revenue;
      var m = q[s.productId] = q[s.productId] || {};
      m[s.period] = (m[s.period] || 0) + s.qty;
    });
    var total = Object.keys(rev).reduce(function (a, k) { return a + rev[k]; }, 0) || 1;
    var sorted = products.slice().sort(function (a, b) { return (rev[b.id] || 0) - (rev[a.id] || 0); });
    var cum = 0;
    sorted.forEach(function (p) {
      cum += (rev[p.id] || 0) / total;
      p.abc = cum <= 0.8 ? 'A' : cum <= 0.95 ? 'B' : 'C';
      var vals = periods.map(function (per) { return (q[p.id] || {})[per] || 0; });
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / vals.length);
      var cv = mean > 0 ? sd / mean : 9;
      p.xyz = cv <= 0.15 ? 'X' : cv <= 0.35 ? 'Y' : 'Z';
    });
  }

  /** تولید و ذخیره در store */
  function load(opts) {
    var S = IBP.store;
    var prev = Object.assign({}, S.settings());
    var res = generate(opts);
    S.clearAll();
    Object.keys(res.data).forEach(function (k) { S.replaceAll(k, res.data[k], { silent: true }); });
    // تنظیمات کاربر (مقیاس نمایش، آستانه‌ها و…) حفظ می‌شود؛ فقط مشخصات شرکت و چرخه از الگو می‌آید
    S.saveSettings(Object.assign(prev, res.settings, { fiscalStartMonth: opts.fiscalStartMonth || prev.fiscalStartMonth || 1 }));
    S.setMeta('seeded', { at: new Date().toISOString(), templateId: res.settings.templateId });
    S.touch();
    return S.flush().then(function () { return res; });
  }

  IBP.seed = { generate: generate, load: load, classify: classify, cycleSteps: cycleSteps, rng: rng };
})(window.IBP = window.IBP || {});
