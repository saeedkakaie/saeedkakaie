/*
 * مولد داده تستی برای شرکت‌های هلدینگ غذایی.
 * از روی الگوی یک شرکت (ماکارونی، آرد، بیسکویت، لبنیات، روغن) داده کامل همان شرکت را می‌سازد:
 * داده پایه + ۲۴ ماه فروش واقعی (با اثر واقعی رمضان و محرم) + پیش‌بینی ۱۸ ماه آینده
 * + سوابق پیش‌بینی آماری و اجماعی برای سنجش دقت + بودجه + موجودی + مناسبت‌ها و اثرها
 * + جریان‌های درون‌گروهی (مشتری و تأمین‌کننده شرکت‌های دیگر هلدینگ).
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
  var SUPPLIER_NAMES = ['تأمین‌گستر', 'بسپار', 'فراورده‌های کشاورزی', 'پویا', 'آسیا', 'صنایع بسته‌بندی', 'غله', 'بازرگانی خارجی'];
  var SUPPLIER_CITIES = ['تهران', 'اصفهان', 'تبریز', 'شیراز', 'مشهد', 'قزوین', 'دبی', 'استانبول'];

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
  function hash(s) { var x = 2166136261; for (var i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

  function roundTo(v, step) { return Math.round(v / step) * step; }
  function pad3(n) { return String(n).padStart(3, '0'); }
  function iso(p, day) {
    var jy = J.year(p), jm = J.month(p);
    var g = J.toGregorian(jy, jm, Math.min(day, J.monthLength(jy, jm)));
    return g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0');
  }
  function lastDayIso(p) { return iso(p, 31); }

  /**
   * تولید داده کامل یک شرکت. خروجی: { data: { entity: [records] }, settings }
   * opts: { templateId, cyclePeriod, historyMonths, horizonMonths, seed, fiscalStartMonth, companyName, companyCode, thresholds }
   */
  function generate(opts) {
    opts = opts || {};
    var tpl = IBP.templates.get(opts.templateId || 'pasta');
    var R = rng(opts.seed || hash(tpl.id + '1405'));
    var cycle = opts.cyclePeriod || J.currentPeriod();
    var H = opts.historyMonths || 36, F = opts.horizonMonths || 18;
    var histPeriods = J.range(J.addMonths(cycle, -H), H);
    var futPeriods = J.range(cycle, F);
    var inflation = 0.025; // تورم ماهانه قیمت فروش
    var id = 0;
    function nid(prefix) { id++; return prefix + id.toString(36); }
    var companyCode = opts.companyCode || tpl.code;

    var out = {
      plants: [], warehouses: [], resources: [], families: [], products: [], routings: [],
      suppliers: [], materials: [], bom: [], channels: [], regions: [], customers: [],
      salesActuals: [], forecasts: [], budgets: [], inventory: [], materialInventory: [], cycleSteps: [],
      events: [], eventImpacts: [], demandAdjustments: []
    };

    /* ---------- کارخانه (کد پلنت = کد شرکت) و انبار ---------- */
    var plantWh = {};
    tpl.plants.forEach(function (p, pi) {
      var rec = { id: nid('pl'), code: pi === 0 ? companyCode : p.code, name: p.name, city: p.city, workingDays: 25, active: true };
      out.plants.push(rec);
      var fg = { id: nid('wh'), code: 'FG-' + rec.code, name: 'انبار محصول ' + p.city, plantId: rec.id, type: 'محصول نهایی', capacity: R.int(3, 8) * 1000 };
      var rm = { id: nid('wh'), code: 'RM-' + rec.code, name: 'انبار مواد ' + p.city, plantId: rec.id, type: 'مواد اولیه', capacity: R.int(2, 5) * 1000 };
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
    var buyers = [];
    tpl.families.forEach(function (f) { (f.buyers || []).forEach(function (b) { if (buyers.indexOf(b) < 0) buyers.push(b); }); });

    var names = R.shuffle(NAMES), ni = 0;
    tpl.channels.forEach(function (c) {
      var ch = { id: nid('ch'), code: c.code, name: c.name, discount: c.discount, internal: !!c.internal };
      out.channels.push(ch);
      if (c.internal) {
        // مشتریان درون‌گروهی: شرکت‌های خریدار هلدینگ
        buyers.forEach(function (b) {
          out.customers.push({
            id: nid('cu'), code: 'IC-' + b, name: IBP.templates.companyName(b) + ' (درون‌گروهی)', channelId: ch.id, regionId: domesticRegions[0].id,
            tier: 'کلیدی', creditLimit: 0, paymentDays: 30, _w: 1, _disc: 0, _internal: true, _buyer: b
          });
        });
        return;
      }
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
    var internalCustomers = out.customers.filter(function (c) { return c._internal; });
    var externalCustomers = out.customers.filter(function (c) { return !c._internal; });

    /* ---------- تأمین‌کنندگان و مواد ---------- */
    var supNames = R.shuffle(SUPPLIER_NAMES);
    for (var s = 0; s < 7; s++) {
      var imp = s >= 5;
      out.suppliers.push({
        id: nid('sp'), code: 'S' + pad3(s + 1),
        name: (imp ? 'شرکت ' : 'گروه ') + supNames[s % supNames.length] + ' ' + names[(s + 7) % names.length],
        city: imp ? R.pick(['دبی', 'استانبول']) : R.pick(SUPPLIER_CITIES.slice(0, 6)),
        leadTimeDays: imp ? R.int(45, 90) : R.int(7, 30), reliability: Math.round(R.range(imp ? 0.7 : 0.82, 0.98) * 100) / 100, isImport: imp
      });
    }
    var internalSupplier = {};
    function supplierFor(m) {
      if (!m.internal) return R.pick(out.suppliers.filter(function (x) { return x.code.indexOf('IC-') !== 0; }));
      var c = m.internal.company;
      if (!internalSupplier[c]) {
        internalSupplier[c] = { id: nid('sp'), code: 'IC-' + c, name: IBP.templates.companyName(c) + ' (درون‌گروهی)', city: 'هلدینگ', leadTimeDays: 7, reliability: 0.96, isImport: false };
        out.suppliers.push(internalSupplier[c]);
      }
      return internalSupplier[c];
    }
    var matByName = {};
    function material(m) {
      if (matByName[m.name]) return matByName[m.name];
      var sup = supplierFor(m);
      var rec = {
        id: nid('mt'), code: (m.type === 'بسته‌بندی' ? 'PK-' : 'RM-') + pad3(out.materials.length + 1),
        name: m.name, type: m.type, uom: m.uom, unitCost: m.cost, supplierId: sup.id,
        internalCompany: m.internal ? m.internal.company : '', internalProductCode: m.internal ? m.internal.product : '',
        leadTimeDays: sup.leadTimeDays, moq: roundTo(R.range(1, 20) * (m.cost > 1e7 ? 10 : 1000), 10), safetyStockDays: R.pick([10, 15, 20, 30])
      };
      out.materials.push(rec);
      matByName[m.name] = rec;
      return rec;
    }
    var shared = tpl.sharedMaterials.map(material);

    /* ---------- خانواده، محصول، خط تولید ---------- */
    var products = [];
    var plant = out.plants[0];
    var linesByName = {};
    tpl.families.forEach(function (f, fi) {
      var fam = { id: nid('fm'), code: f.code, name: f.name, color: COLORS[fi % COLORS.length], description: 'خانواده ' + f.name };
      fam._f = f;
      out.families.push(fam);
      var lines = f.lines.map(function (ln) {
        if (linesByName[ln]) return linesByName[ln];
        var res = {
          id: nid('rs'), code: companyCode + '-L' + (Object.keys(linesByName).length + 1), name: ln, plantId: plant.id,
          type: /بسته‌بندی/.test(ln) ? 'بسته‌بندی' : 'خط تولید', shifts: R.pick([2, 3, 3]), hoursPerShift: 8,
          efficiency: Math.round(R.range(0.72, 0.9) * 100) / 100, costPerHour: roundTo(R.range(8, 40) * 1e6, 1e5),
          _target: R.pick([0.62, 0.74, 0.82, 0.9, 0.97, 1.06])
        };
        linesByName[ln] = res;
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
        var lifecycle = f.intercompany ? 'بلوغ' : lifeR < 0.06 ? 'معرفی' : lifeR < 0.14 ? 'افول' : lifeR < 0.38 ? 'رشد' : 'بلوغ';
        var growth = lifecycle === 'رشد' ? R.range(0.1, 0.28) : lifecycle === 'افول' ? R.range(-0.28, -0.1) : lifecycle === 'معرفی' ? 0.35 : R.range(-0.05, 0.1);
        var volR = R();
        var p = {
          id: nid('pr'), code: f.code + '-' + (101 + ii), name: item, familyId: fam.id, plantId: plant.id, uom: f.uom,
          unitWeightKg: Math.round(R.range(f.kg[0], f.kg[1]) * 10) / 10,
          unitPrice: price, unitCost: roundTo(price * R.range(f.cost[0], f.cost[1]), 1000), lifecycle: lifecycle,
          safetyStockDays: R.pick([7, 10, 15, 20]), intercompany: !!f.intercompany,
          batchSize: roundTo(R.range(0.05, 0.25) * f.volume[1], 10), shelfLifeDays: f.shelfLife || null,
          active: true,
          _base: f.volume[0] + (f.volume[1] - f.volume[0]) * volR * volR,
          _growth: growth, _noise: R.pick([0.05, 0.06, 0.08, 0.1, 0.12, 0.2]), _season: season, _ev: f.events || {},
          _bias: R.range(-0.04, 0.12), _launch: lifecycle === 'معرفی' ? H - R.int(6, 10) : -999,
          _uph: R.range(f.uph[0], f.uph[1]),
          _sporadic: !f.intercompany && lifecycle !== 'معرفی' && R() < 0.08
        };
        if (ii === 1 && fi < 2 && lifecycle !== 'معرفی' && !f.intercompany) {
          p._cannibalOf = products[products.length - 1].id; p._sporadic = false;
          products[products.length - 1]._noise = 0.16; products[products.length - 1]._sporadic = false;
        }
        p.launchDate = lifecycle === 'معرفی' ? iso(histPeriods[p._launch], 1) : iso(J.addMonths(cycle, -R.int(30, 120)), R.int(1, 28));
        out.products.push(p);
        products.push(p);

        var primary = lines.length > 1 && ii % 2 === 1 ? lines[1] : lines[0];
        out.routings.push({ id: nid('rt'), productId: p.id, resourceId: primary.id, unitsPerHour: 0, setupHours: R.pick([0.5, 1, 1.5, 2]), priority: 1, _p: p });
        if (lines.length > 1) {
          var alt = primary === lines[0] ? lines[1] : lines[0];
          out.routings.push({ id: nid('rt'), productId: p.id, resourceId: alt.id, unitsPerHour: 0, setupHours: 2, priority: 2, _p: p, _alt: true });
        }

        // BOM: مواد خانواده (بر حسب کیلوگرم وزن محصول) + بسته‌بندی
        var picks = famMats.length <= 2 ? famMats.slice() : R.shuffle(famMats).slice(0, R.int(2, Math.min(3, famMats.length)));
        var nInternal = picks.filter(function (m) { return m.internalCompany; }).length;
        var bomLines = picks.concat(shared.slice(0, 1)).map(function (m) {
          // ماده درون‌گروهی: مجموع نسبت وزنی مواد درون‌گروهی حدود ۰٫۹ تا ۱ کیلوگرم به ازای هر کیلوگرم محصول
          if (m.internalCompany) return { m: m, q: p.unitWeightKg * R.range(0.9, 1.0) / nInternal, fixed: true };
          var q = m.uom === 'عدد' ? 1 : m.uom === 'کیلوگرم' && m.type === 'مواد اولیه' ? p.unitWeightKg * R.range(0.2, 0.5) : R.range(0.05, 0.4);
          return { m: m, q: q };
        });
        var raw = bomLines.reduce(function (a, l) { return a + l.q * l.m.unitCost; }, 0);
        var k = raw > 0 ? (p.unitCost * R.range(0.55, 0.7)) / raw : 1;
        bomLines.forEach(function (l) {
          var q = l.m.uom === 'عدد' ? 1 : Math.round(l.q * (l.fixed ? 1 : Math.min(1.6, Math.max(0.6, k))) * 10000) / 10000;
          out.bom.push({ id: nid('bm'), productId: p.id, materialId: l.m.id, qtyPer: q, scrap: R.pick([0.01, 0.02, 0.03]) });
        });
      });
    });

    /* ---------- تقاضای «واقعی» زیربنایی (با اثر مناسبت‌های قمری) ---------- */
    function lunar(p, per) {
      var E = IBP.events, ev = p._ev;
      return (1 + (ev.ramadan || 0) * E.lunarIntensity(per, 'ramadan')) * (1 + (ev.muharram || 0) * E.lunarIntensity(per, 'muharram'));
    }
    function base(p, offset) { // بدون اثر مناسبت
      if (offset < p._launch) return 0;
      var ramp = p._launch > -999 ? Math.min(1, (offset - p._launch + 1) / 4) : 1;
      var per = J.addMonths(histPeriods[0], offset);
      return p._base * Math.pow(1 + p._growth, (offset - H) / 12) * p._season[J.month(per) - 1] * ramp;
    }
    function expected(p, offset) { return base(p, offset) * lunar(p, J.addMonths(histPeriods[0], offset)); }
    function priceAt(p, per) { return p.unitPrice * Math.pow(1 + inflation, J.diff(cycle, per)); }

    /* ---------- فروش واقعی (محصول × مشتری × ماه) ---------- */
    var epsBy = {};
    products.forEach(function (p) {
      var pool = p.intercompany ? internalCustomers : externalCustomers;
      var custs = p.intercompany ? pool : R.shuffle(pool).slice(0, R.int(4, Math.min(12, pool.length)));
      var ws = custs.map(function (c) { return c._w * R.range(0.5, 1.5); });
      var wsum = ws.reduce(function (a, b) { return a + b; }, 0);
      histPeriods.forEach(function (per, t) {
        var e = expected(p, t);
        var eps = p._cannibalOf && epsBy[p._cannibalOf] ? -0.9 * epsBy[p._cannibalOf][t] + 0.03 * R.normal() : p._noise * R.normal();
        (epsBy[p.id] = epsBy[p.id] || [])[t] = eps;
        var q = p._sporadic
          ? (R() < 0.45 ? 0 : Math.max(0, Math.round(e * 1.9 * Math.exp(0.55 * R.normal() - 0.15))))
          : Math.max(0, Math.round(e * (1 + eps)));
        if (!q) return;
        var price = priceAt(p, per);
        custs.forEach(function (c, ci) {
          var cq = Math.round(q * ws[ci] / wsum);
          if (cq <= 0) return;
          out.salesActuals.push({ id: nid('sa'), period: per, productId: p.id, customerId: c.id, qty: cq, revenue: roundTo(cq * price * (1 - c._disc), 1000) });
        });
      });
    });

    /* ---------- پیش‌بینی ---------- */
    var consensusNext = {};
    products.forEach(function (p) {
      // سوابق ۱۲ ماه گذشته (lag-1): آماری بدون شناخت مناسبت‌ها، اجماعی با شناخت مناسبت و سوگیری فروش
      for (var t = H - 12; t < H; t++) {
        var per = histPeriods[t], e = expected(p, t), b = base(p, t);
        if (e <= 0) continue;
        var cyc = J.addMonths(per, -1);
        out.forecasts.push({ id: nid('fc'), version: 'آماری', cycle: cyc, period: per, productId: p.id, qty: Math.max(0, Math.round(b * (1 + (0.04 + p._noise * 0.5) * R.normal()))), method: 'تاریخی' });
        out.forecasts.push({ id: nid('fc'), version: 'اجماعی', cycle: cyc, period: per, productId: p.id, qty: Math.max(0, Math.round(e * (1 + p._bias + (0.05 + p._noise * 0.6) * R.normal()))) });
      }
      var adj = R.range(-0.03, 0.08), sd = 0.06 + p._noise * 0.6;
      consensusNext[p.id] = [];
      futPeriods.forEach(function (per, i) {
        var e = expected(p, H + i);
        var stat = Math.max(0, Math.round(e * (1 + 0.04 * R.normal())));
        var cons = Math.max(0, Math.round(stat * (1 + adj + 0.03 * R.normal())));
        consensusNext[p.id].push(cons);
        var w = sd * Math.sqrt(1 + i / 6) * 1.2816;
        out.forecasts.push({ id: nid('fc'), version: 'آماری', cycle: cycle, period: per, productId: p.id, qty: stat, lo: Math.max(0, Math.round(stat * (1 - w))), hi: Math.round(stat * (1 + w)), method: 'تاریخی' });
        out.forecasts.push({ id: nid('fc'), version: 'اجماعی', cycle: cycle, period: per, productId: p.id, qty: cons });
      });
    });

    /* ---------- مناسبت‌ها و اثر برآوردشده کارشناسی ---------- */
    var evR = { id: nid('ev'), code: 'E-RAM', name: 'ماه مبارک رمضان', kind: 'رمضان', notes: 'تاریخ از تقویم قمری ام‌القری محاسبه می‌شود' };
    var evM = { id: nid('ev'), code: 'E-MOH', name: 'دهه اول محرم (نذری)', kind: 'محرم', notes: 'روزهای ۱ تا ۱۲ محرم' };
    var evC = { id: nid('ev'), code: 'E-CMP', name: 'جشنواره فروش پاییزه', kind: 'کمپین', startPeriod: J.addMonths(cycle, 2), endPeriod: J.addMonths(cycle, 2), notes: 'تخفیف و تبلیغات سراسری' };
    out.events.push(evR, evM, evC);
    out.families.forEach(function (fam, fi) {
      var ev = fam._f.events || {};
      if (ev.ramadan) out.eventImpacts.push({ id: nid('ei'), eventId: evR.id, familyId: fam.id, uplift: Math.round(ev.ramadan * R.range(0.6, 1.3) * 20) / 20, source: 'کارشناسی' });
      if (ev.muharram) out.eventImpacts.push({ id: nid('ei'), eventId: evM.id, familyId: fam.id, uplift: Math.round(ev.muharram * R.range(0.6, 1.3) * 20) / 20, source: 'کارشناسی' });
      if (fi === 0) out.eventImpacts.push({ id: nid('ei'), eventId: evC.id, familyId: fam.id, uplift: 0.15, source: 'کارشناسی' });
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
        out.budgets.push({ id: nid('bg'), period: per, productId: p.id, qty: q, revenue: roundTo(q * p.unitPrice * Math.pow(1 + inflation * 0.8, J.diff(cycle, per)) * 0.94, 1000) });
      });
    });

    /* ---------- تنظیم ظرفیت خطوط ---------- */
    out.resources.forEach(function (res) {
      var hours = res.shifts * res.hoursPerShift * plant.workingDays * res.efficiency;
      var prim = out.routings.filter(function (r) { return r.resourceId === res.id && !r._alt; });
      var load = 0;
      prim.forEach(function (r) {
        var avg12 = consensusNext[r.productId].slice(0, 12).reduce(function (a, b) { return a + b; }, 0) / 12;
        load += avg12 / r._p._uph;
      });
      var k = load > 0 ? load / (res._target * hours) : 1;
      prim.forEach(function (r) { r.unitsPerHour = Math.max(0.1, Math.round(r._p._uph * k * 10) / 10); });
    });
    out.routings.forEach(function (r) {
      if (r._alt) {
        var main = out.routings.filter(function (x) { return x.productId === r.productId && !x._alt; })[0];
        r.unitsPerHour = Math.max(0.1, Math.round(main.unitsPerHour * R.range(0.7, 0.95) * 10) / 10);
      }
    });

    /* ---------- موجودی ---------- */
    var asOf = lastDayIso(J.addMonths(cycle, -1));
    products.forEach(function (p) {
      var next = consensusNext[p.id][0] || 0;
      var r = R();
      var cover = r < 0.12 ? R.range(0, 0.25) : r < 0.75 ? R.range(0.4, 1.4) : r < 0.9 ? R.range(1.4, 2.6) : R.range(3, 5);
      if (p.shelfLifeDays && p.shelfLifeDays < 60) cover = Math.min(cover, p.shelfLifeDays / 60);
      var qty = Math.round(next * cover);
      var q1 = Math.round(qty * 0.75), q2 = qty - q1;
      out.inventory.push({ id: nid('iv'), productId: p.id, warehouseId: plantWh[p.plantId].fg.id, qty: q1, asOf: asOf });
      if (q2 > 0 && !p.intercompany) out.inventory.push({ id: nid('iv'), productId: p.id, warehouseId: dc.id, qty: q2, asOf: asOf });
    });
    out.materials.forEach(function (m) {
      var need = 0;
      out.bom.forEach(function (b) {
        if (b.materialId !== m.id) return;
        need += (consensusNext[b.productId][0] || 0) * b.qtyPer * (1 + b.scrap);
      });
      out.materialInventory.push({
        id: nid('mi'), materialId: m.id, warehouseId: plantWh[plant.id].rm.id,
        qty: Math.round(need * R.range(0.2, 2.2)), onOrder: R() < 0.5 ? Math.round(need * R.range(0.3, 1)) : 0, asOf: asOf
      });
    });

    /* ---------- چرخه IBP ---------- */
    out.cycleSteps = cycleSteps(cycle).map(function (s) { s.id = nid('cs'); return s; });

    Object.keys(out).forEach(function (k) {
      out[k].forEach(function (r) { Object.keys(r).forEach(function (f) { if (f.charAt(0) === '_') delete r[f]; }); });
    });
    classify(out.products, out.salesActuals, histPeriods.slice(-12), opts.thresholds);

    return {
      data: out,
      settings: { companyName: opts.companyName || tpl.company, companyCode: companyCode, industry: tpl.name, templateId: tpl.id, cyclePeriod: cycle, historyMonths: H, horizonMonths: F, priceInflation: inflation, displayScale: 1e9 }
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
      return { cycle: cycle, order: i + 1, name: s.name, owner: s.owner, dueDate: iso(cycle, s.day), status: status, notes: '' };
    });
  }

  /** کلاس‌بندی ABC (سهم تجمعی فروش ریالی) و XYZ (ضریب تغییرات تقاضا) */
  function classify(products, sales, periods, th) {
    th = th || (IBP.store ? { a: IBP.store.settings().abcA, b: IBP.store.settings().abcB, x: IBP.store.settings().xyzX, y: IBP.store.settings().xyzY } : {});
    var tA = th.a || 0.8, tB = th.b || 0.95, tX = th.x || 0.2, tY = th.y || 0.5;
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
      var before = cum - (rev[p.id] || 0) / total;
      p.abc = !rev[p.id] ? 'C' : before < tA ? 'A' : before < tB ? 'B' : 'C';
      var vals = periods.map(function (per) { return (q[p.id] || {})[per] || 0; });
      var mean = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      var sd = Math.sqrt(vals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / vals.length);
      var cv = mean > 0 ? sd / mean : 9;
      p.xyz = cv <= tX ? 'X' : cv <= tY ? 'Y' : 'Z';
    });
  }

  /** تولید و ذخیره در store (پایگاه داده شرکت جاری) */
  function load(opts) {
    var S = IBP.store;
    var prev = Object.assign({}, S.settings());
    opts = Object.assign({ companyName: prev.companyName, companyCode: prev.companyCode }, opts || {});
    var res = generate(opts);
    S.clearAll();
    Object.keys(res.data).forEach(function (k) { S.replaceAll(k, res.data[k], { silent: true }); });
    S.saveSettings(Object.assign(prev, res.settings, { fiscalStartMonth: opts.fiscalStartMonth || prev.fiscalStartMonth || 1 }));
    S.setMeta('seeded', { at: new Date().toISOString(), templateId: res.settings.templateId });
    S.touch();
    return S.flush().then(function () { return res; });
  }

  IBP.seed = { generate: generate, load: load, classify: classify, cycleSteps: cycleSteps, rng: rng };
})(window.IBP = window.IBP || {});
