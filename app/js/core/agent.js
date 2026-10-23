/*
 * دستیار هوشمند (فاز ۷) — هسته تحلیل.
 *
 *   ابزارها      پرس‌وجوهای تحلیلی روی داده‌های همین شرکت (مشترک بین مدل داخلی و Claude):
 *                نمای کلی، جدول محوری، روند و فصلی بودن، علت تغییر (حجم/قیمت)، دقت پیش‌بینی،
 *                ظرفیت و تأمین، موجودی، سناریوی «اگر»، هشدارها، نمای هلدینگ و بینش‌های سریع
 *   مدل داخلی   بدون اینترنت: پرسش فارسی را می‌فهمد (نیت، شاخص، بُعد، دوره، موجودیت، درصدها)،
 *                ابزار مناسب را اجرا می‌کند و روایت تحلیلی، نمودار، جدول و پیشنهاد اقدام می‌سازد
 *   بینش سریع    پویش خودکار داده‌ها (مثل Quick Insights در Power BI) برای یافتن مهم‌ترین تغییرها و ریسک‌ها
 *   Claude       حلقه ابزار از طریق موتور پایتون؛ کلید API فقط روی موتور نگه داشته می‌شود
 *
 * هر ابزار خروجی { data, views } می‌دهد: data برای مدل (خلاصه عددی)، views برای نمایش (نمودار/جدول/شاخص).
 */
(function (IBP) {
  'use strict';

  var S = IBP.store, A = IBP.analytics, J = IBP.jalali, F = IBP.fmt;

  /* =====================================================================
   * متن و واژه‌ها
   * ===================================================================== */
  function norm(s) {
    return ' ' + F.toLatinDigits(String(s === null || s === undefined ? '' : s))
      .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه').replace(/[أإآ]/g, 'ا').replace(/ؤ/g, 'و')
      .replace(/[ً-ْٰـ]/g, '').replace(/[‌‍‎‏]/g, ' ')
      .replace(/[؟?!،,؛;:()[\]«»"'/\\]/g, ' ').toLowerCase().replace(/\s+/g, ' ').trim() + ' ';
  }
  function kw(list) { return list.map(function (w) { return norm(w).trim(); }); }
  /** آیا یکی از واژه‌ها (از ابتدای کلمه) در متن هست؟ واژه‌های کوتاه باید کامل باشند */
  function has(n, words) {
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (w.length <= 2 ? n.indexOf(' ' + w + ' ') >= 0 : n.indexOf(' ' + w) >= 0) return true;
    }
    return false;
  }
  function hits(n, words) { var c = 0; words.forEach(function (w) { if (has(n, [w])) c++; }); return c; }
  function pos(n, words) {
    var best = -1;
    words.forEach(function (w) { var i = w.length <= 2 ? n.indexOf(' ' + w + ' ') : n.indexOf(' ' + w); if (i >= 0 && (best < 0 || i < best)) best = i; });
    return best;
  }

  var WORDNUM = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10, 'یازده': 11, 'دوازده': 12, 'پانزده': 15, 'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50 };
  function numerals(n) {
    return n.replace(/ (یک|دو|سه|چهار|پنج|شش|شیش|هفت|هشت|نه|ده|یازده|دوازده|پانزده|بیست|سی|چهل|پنجاه) (?=(ماه|تا |مورد|درصد|محصول|مشتری|خانواده|کالا|سال))/g, function (_, w) { return ' ' + WORDNUM[w] + ' '; })
      .replace(/(\d)\s*٫\s*(\d)/g, '$1.$2').replace(/٪/g, ' درصد ').replace(/%/g, ' درصد ').replace(/\s+/g, ' ');
  }

  var W = {
    margin: kw(['حاشیه سود', 'حاشیه', 'درصد سود', 'مارجین']),
    gross: kw(['سود ناخالص', 'سودآوری', 'سوددهی', 'سود']),
    tons: kw(['تن', 'تناژ', 'وزن', 'تنی']),
    qty: kw(['تعداد', 'مقدار', 'کارتن', 'بسته', 'عدد']),
    revenue: kw(['فروش', 'درآمد', 'مبلغ', 'گردش']),
    production: kw(['تولید']), shortage: kw(['کمبود', 'فروش از دست رفته', 'کسری']), inventory: kw(['موجودی', 'انبار']),
    dim: {
      family: kw(['خانواده', 'گروه کالا', 'گروه محصول', 'دسته محصول', 'دسته بندی']),
      product: kw(['محصول', 'کالا', 'sku', 'اقلام', 'قلم']),
      customer: kw(['مشتری', 'مشتریان', 'خریدار']),
      channel: kw(['کانال']),
      region: kw(['منطقه', 'مناطق', 'استان', 'ناحیه']),
      month: kw(['ماهانه', 'ماه به ماه', 'هر ماه', 'تفکیک ماه', 'ماه ها']),
      year: kw(['سالانه', 'تفکیک سال', 'سال به سال']),
      abc: kw(['abc', 'کلاس']),
      tier: kw(['سطح مشتری', 'رده مشتری'])
    },
    holding: kw(['هلدینگ', 'شرکت ها', 'شرکتها', 'همه شرکت', 'گروه زر', 'زیرمجموعه', 'مقایسه شرکت', 'تلفیقی', 'سایر شرکت']),
    explain: kw(['چرا', 'علت', 'دلیل', 'چه عاملی', 'عوامل', 'ریشه', 'توضیح بده', 'تحلیل تغییر', 'باعث', 'چی شد', 'چه شد']),
    accuracy: kw(['دقت', 'خطای پیش', 'سوگیری', 'بایاس', 'bias', 'wmape', 'mape', 'انحراف پیش']),
    supply: kw(['ظرفیت', 'گلوگاه', 'اضافه کار', 'برنامه تولید', 'تولید', 'mps', 'rccp', 'خط تولید', 'خطوط', 'بهره برداری', 'بار خط', 'تامین', 'نرخ پاسخ', 'fill rate']),
    inventory: kw(['موجودی', 'انبار', 'پوشش', 'مازاد', 'ذخیره اطمینان', 'راکد', 'دپو']),
    alerts: kw(['هشدار', 'ریسک', 'خطر', 'مشکل', 'استثنا', 'بحران', 'نگرانی']),
    trend: kw(['روند', 'ترند', 'رشد', 'فصلی', 'فصل', 'الگو', 'نوسان', 'پیش بینی', 'اینده', 'اتی', 'ماه بعد', 'ماه های بعد', 'چشم انداز', 'نمودار', 'تغییرات']),
    query: kw(['برتر', 'بیشترین', 'کمترین', 'بدترین', 'بهترین', 'رتبه', 'سهم', 'تفکیک', 'بر اساس', 'براساس', 'کدام', 'کدوم', 'لیست', 'فهرست', 'پرفروش', 'کم فروش', 'top', 'بزرگترین', 'کوچکترین', 'جدول']),
    overview: kw(['وضعیت', 'خلاصه', 'داشبورد', 'شاخص', 'کلی', 'عملکرد', 'kpi', 'چطوره', 'چه خبر', 'گزارش مدیریت']),
    insights: kw(['بینش', 'نکته', 'نکات', 'تحلیل کن', 'تحلیل کلی', 'پیشنهاد', 'چه کار کنیم', 'چکار کنیم', 'فرصت', 'insight', 'هوشمند', 'مهم ترین']),
    scenarioCue: kw(['اگر', 'چه میشود', 'چه می شود', 'فرض', 'سناریو', 'تاثیر', 'اثر', 'چه اثری', 'شبیه سازی']),
    asc: kw(['کمترین', 'بدترین', 'ضعیف ترین', 'پایین ترین', 'کم فروش', 'کوچکترین', 'کم سودترین', 'کم سود']),
    lastYear: kw(['سال قبل', 'سال گذشته', 'پارسال', 'مشابه', 'سال پیش']),
    forecastDs: kw(['پیش بینی']), actions: kw(['اقدام', 'تصمیم', 'مصوبه']), plan: kw(['برنامه'])
  };
  var DRIVER_KW = [
    ['material', kw(['قیمت مواد اولیه', 'بهای مواد', 'قیمت مواد', 'مواد اولیه', 'مواد', 'قیمت گندم', 'قیمت ارد', 'قیمت روغن خام', 'قیمت ذرت'])],
    ['fx', kw(['نرخ ارز', 'ارز', 'دلار', 'یورو'])],
    ['conversion', kw(['هزینه تبدیل', 'دستمزد', 'حقوق', 'انرژی', 'برق', 'گاز', 'سربار'])],
    ['capacity', kw(['ظرفیت', 'خط تولید', 'شیفت'])],
    ['price', kw(['قیمت فروش', 'نرخ فروش', 'قیمت محصول', 'قیمت'])],
    ['demand', kw(['تقاضا', 'حجم فروش', 'فروش'])]
  ];
  var NEG = kw(['کاهش', 'افت', 'کم شود', 'کم بشه', 'پایین', 'ارزان', 'منفی', 'کمتر', 'سقوط']);

  /* =====================================================================
   * ابزارهای کمکی داده
   * ===================================================================== */
  function clamp(v, lo, hi, def) { v = +v; if (!isFinite(v)) v = def; return Math.max(lo, Math.min(hi, v)); }
  function sum(a) { var t = 0; for (var i = 0; i < a.length; i++) t += a[i] || 0; return t; }
  function agg(rows, keyFn, valFn) { var m = new Map(); rows.forEach(function (r) { var k = keyFn(r); m.set(k, (m.get(k) || 0) + valFn(r)); }); return m; }
  function ratio(a, b) { return b ? a / b : null; }
  function growth(a, b) { return b ? a / b - 1 : null; }
  function salesFacts() { return IBP.reports ? IBP.reports.facts('sales') : []; }
  function cyc() { return A.ctx().cycle; }
  var MEAS = { revenue: ['مبلغ فروش', 'money'], qty: ['مقدار', 'int'], tons: ['تن', 'num'], gross: ['سود ناخالص', 'money'] };
  function mlabel(m) { return (MEAS[m] || ['مبلغ فروش'])[0]; }
  function mtype(m) { return (MEAS[m] || [0, 'money'])[1]; }
  function fv(v, type) {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '—';
    if (type === 'money') return F.money(v);
    if (type === 'pct') return F.pct(v, 1);
    if (type === 'num') return F.num(v, Math.abs(v) < 100 ? 1 : 0) + ' تن';
    return F.num(v);
  }
  function fvBare(v, type) { return type === 'num' ? F.num(v, Math.abs(v) < 100 ? 1 : 0) : fv(v, type); }
  function round(v) {
    if (typeof v !== 'number' || !isFinite(v)) return v === undefined ? null : v;
    if (Math.abs(v) >= 1000) return Math.round(v);
    return Math.round(v * 10000) / 10000;
  }
  /** خلاصه عددی گرد‌شده برای ارسال به مدل */
  function compact(o) {
    if (Array.isArray(o)) return o.map(compact);
    if (o && typeof o === 'object') { var r = {}; Object.keys(o).forEach(function (k) { if (o[k] !== undefined) r[k] = compact(o[k]); }); return r; }
    return round(o);
  }
  function plabel(p) { return J.label(+p); }

  /* ---------------- موجودیت‌ها (نام خانواده، محصول، مشتری، کانال، منطقه، شرکت) ---------------- */
  var ecache = { v: -1, list: null };
  var DIMOF = { family: 'family', product: 'product', customer: 'customer', channel: 'channel', region: 'region' };
  var TYPE_LABEL = { family: 'خانواده', product: 'محصول', customer: 'مشتری', channel: 'کانال', region: 'منطقه', company: 'شرکت' };
  function entities() {
    if (ecache.v === S.version && ecache.list) return ecache.list;
    var list = [];
    var add = function (type, id, name, key) {
      var n = norm(key || name).trim();
      if (n.length < 2) return;
      list.push({ type: type, id: id, name: name, n: n, tokens: n.split(' ').filter(function (t) { return t.length > 2; }) });
    };
    S.all('families').forEach(function (f) { add('family', f.id, f.name); });
    S.all('products').forEach(function (p) { add('product', p.id, p.name); if (p.code) add('product', p.id, p.name, p.code); });
    S.all('customers').forEach(function (c) { add('customer', c.id, c.name); });
    S.all('channels').forEach(function (c) { add('channel', c.id, c.name); var short = norm(c.name).replace(/\(.*$/, '').trim(); if (short.length > 3 && short !== norm(c.name).trim()) add('channel', c.id, c.name, short); });
    S.all('regions').forEach(function (r) { add('region', r.id, r.name); });
    if (IBP.holding) IBP.holding.list().forEach(function (c) { add('company', c.code, c.name); });
    ecache = { v: S.version, list: list };
    return list;
  }
  function findEntities(n) {
    var found = [];
    entities().forEach(function (e) {
      var k = e.n;
      if (n.indexOf(' ' + k + ' ') >= 0 || (k.length >= 5 && n.indexOf(' ' + k) >= 0)) { found.push({ e: e, score: 1000 + k.length }); return; }
      if (e.tokens.length >= 2) {
        var hit = e.tokens.filter(function (t) { return n.indexOf(' ' + t) >= 0; }).length;
        if (hit >= 2 && hit / e.tokens.length >= 0.66) found.push({ e: e, score: hit * 10 + k.length / 100 });
      }
    });
    found.sort(function (a, b) { return b.score - a.score; });
    var out = [];
    found.forEach(function (f) {
      if (out.some(function (o) { return o.e.type === f.e.type && o.e.id === f.e.id; })) return;
      if (out.some(function (o) { return o.score >= 1000 && f.score >= 1000 && o.e.n.indexOf(f.e.n) >= 0; })) return; // نام کوتاه‌تر داخل نام بلندتر
      out.push(f);
    });
    return out.map(function (f) { return f.e; });
  }
  /** یافتن موجودیت از نام (برای ورودی ابزارها؛ تطبیق دقیق، سپس شامل‌بودن) */
  function resolveEntity(type, name) {
    if (!type || type === 'all' || !name) return null;
    var n = norm(name).trim(), list = entities().filter(function (e) { return e.type === type; });
    var e = list.filter(function (x) { return x.n === n; })[0] || list.filter(function (x) { return x.n.indexOf(n) >= 0 || n.indexOf(x.n) >= 0; })[0];
    if (!e) { var f = findEntities(' ' + n + ' ').filter(function (x) { return x.type === type; }); e = f[0]; }
    if (!e) return { error: 'هیچ ' + (TYPE_LABEL[type] || type) + ' با نام «' + name + '» پیدا نشد.' };
    var dim = DIMOF[type];
    return { type: type, id: e.id, name: e.name, dim: dim, row: function (r) { return r[dim] === e.name; },
      product: type === 'family' ? function (p) { return p.familyId === e.id; } : type === 'product' ? function (p) { return p.id === e.id; } : null };
  }

  /* =====================================================================
   * تعریف ابزارها (قالب Messages API؛ همه فیلدها اجباری برای strict)
   * ===================================================================== */
  var DIMS_ALL = ['month', 'year', 'family', 'product', 'customer', 'channel', 'region', 'tier', 'abc', 'version', 'area', 'status', 'kind', 'owner', 'cycle', 'title'];
  var MEASURES_ALL = ['revenue', 'qty', 'tons', 'gross', 'margin', 'demand', 'production', 'inventory', 'shortage', 'prodTons', 'invValue', 'cogs', 'lost', 'count'];
  var ENT_TYPES = ['all', 'family', 'product', 'customer', 'channel', 'region'];
  function obj(props, desc) { return { type: 'object', description: desc, properties: props, required: Object.keys(props), additionalProperties: false }; }
  var TOOLS = [
    { name: 'company_overview', description: 'Headline KPIs of the current company: last-12-month actual sales (revenue, tons, gross margin, growth vs the previous 12 months), the 12-month plan (revenue, gross profit, fill rate, capacity utilisation, gap to budget, lost sales), forecast accuracy of the last 3 months, inventory value and alert counts. Use first for broad "how are we doing" questions.', input_schema: obj({}) },
    { name: 'query_data', description: 'Pivot query over a dataset, like a BI report. Datasets: sales (actual sales, last 24 months; dims month, year, family, product, customer, channel, region, tier, abc; measures revenue, qty, tons, gross, margin), forecast (current-cycle forecasts; dims version, month, family, product, abc; measures qty, tons, revenue), plan (12-month production plan; dims month, family, product, abc; measures demand, production, inventory, shortage, prodTons, invValue), profit (12-month plan profitability; dims family, product, abc; measures revenue, cogs, gross, margin, lost), actions (management decisions; dims area, status, kind, owner, cycle, title; measure count). Returns ranked rows with shares and an optional column breakdown.',
      input_schema: obj({
        dataset: { type: 'string', enum: ['sales', 'forecast', 'plan', 'profit', 'actions'] },
        rows: { type: 'string', enum: DIMS_ALL, description: 'Dimension for rows.' },
        columns: { type: 'string', enum: [''].concat(DIMS_ALL), description: 'Optional second dimension for columns; empty string for none.' },
        measure: { type: 'string', enum: MEASURES_ALL },
        filters: { type: 'array', description: 'Equality filters, e.g. {"dim":"family","value":"ماکارونی و پاستا"}. Values are matched loosely by name.', items: obj({ dim: { type: 'string', enum: DIMS_ALL }, value: { type: 'string' } }) },
        top: { type: 'integer', description: 'Max rows (1-50).' },
        order: { type: 'string', enum: ['desc', 'asc'], description: 'desc = largest first, asc = smallest first.' },
        last_months: { type: 'integer', description: 'For sales: only the last N months (1-24). For forecast/plan: only the next N months. 0 = all.' }
      }) },
    { name: 'trend_analysis', description: 'Monthly trend of actual sales for the whole company or one family/product/customer/channel/region: last 24 months, growth (last 12 vs previous 12, last 3 months vs same months last year), trend slope, seasonality peak/trough months, unusual months and the consensus forecast for the coming months.',
      input_schema: obj({ measure: { type: 'string', enum: ['revenue', 'tons', 'qty', 'gross'] }, entity_type: { type: 'string', enum: ENT_TYPES }, entity_name: { type: 'string', description: 'Name of the entity; empty when entity_type is all.' } }) },
    { name: 'explain_change', description: 'Explains why a sales measure changed: compares the latest period (last month, last 3 or last 12 months) with the previous period or the same period last year, ranks the members (families, products, customers, channels or regions) that drove the change and, for revenue, splits it into volume effect and price effect. Optionally restricted to one entity.',
      input_schema: obj({ measure: { type: 'string', enum: ['revenue', 'tons', 'qty', 'gross'] }, period: { type: 'string', enum: ['last_month', 'last_3_months', 'last_12_months'] }, compare_to: { type: 'string', enum: ['previous', 'last_year'] }, by: { type: 'string', enum: ['family', 'product', 'customer', 'channel', 'region'] }, entity_type: { type: 'string', enum: ENT_TYPES }, entity_name: { type: 'string' } }) },
    { name: 'forecast_accuracy', description: 'Lag-1 consensus forecast accuracy (1-WMAPE) and bias over the last N months, by month, with the products or families that contribute most to forecast error.',
      input_schema: obj({ months: { type: 'integer', description: '1-12' }, by: { type: 'string', enum: ['product', 'family'] } }) },
    { name: 'supply_status', description: 'Current 12-month supply plan (MPS/RCCP): fill rate, shortages and lost sales value, capacity utilisation and overload months per production line, overtime hours, prebuild and products below safety stock.', input_schema: obj({}) },
    { name: 'inventory_status', description: 'Finished-goods inventory: months of cover per product versus safety stock, products at risk of stock-out, excess stock and inventory value.', input_schema: obj({}) },
    { name: 'run_scenario', description: 'What-if simulation on the 12-month plan: percentage changes in demand, selling price, material cost, FX (imported materials), conversion cost and line capacity. Re-plans supply and returns plan revenue, gross and operating profit, margin, fill rate, utilisation and lost sales versus the base plan. Use 0 for drivers that do not change.',
      input_schema: obj({ demand: { type: 'number', description: '% change, -40..40' }, price: { type: 'number', description: '% change, -20..40' }, material: { type: 'number', description: '% change, -20..60' }, fx: { type: 'number', description: '% change, -20..80' }, conversion: { type: 'number', description: '% change, -20..60' }, capacity: { type: 'number', description: '% change, -30..40' } }) },
    { name: 'get_alerts', description: 'Current exceptions: stock-out and excess risks, capacity overloads and persistent forecast bias, with severity.', input_schema: obj({}) },
    { name: 'holding_overview', description: 'Compare the companies of the holding (from their last refreshed summaries): last-12-month revenue and growth, plan revenue, gross margin, fill rate, utilisation, forecast accuracy and critical alerts.', input_schema: obj({}) },
    { name: 'quick_insights', description: 'Automatic scan of the data that returns the most important findings: growth and momentum shifts, concentration, margin outliers, seasonality, unusual months, forecast bias, capacity, inventory and budget risks.', input_schema: obj({}) }
  ];

  /* =====================================================================
   * اجرای ابزارها
   * ===================================================================== */
  function kpiItem(label, value, sub, tone) { return { label: label, value: value, sub: sub || '', tone: tone || '' }; }

  function tOverview() {
    var c = cyc(), facts = salesFacts();
    var f12 = J.addMonths(c, -12), f24 = J.addMonths(c, -24);
    var cur = { revenue: 0, tons: 0, gross: 0 }, prev = { revenue: 0, tons: 0, gross: 0 };
    var famRev = new Map();
    facts.forEach(function (r) {
      var o = r.month >= f12 ? cur : r.month >= f24 ? prev : null;
      if (!o) return;
      o.revenue += r.revenue; o.tons += r.tons; o.gross += r.gross;
      if (o === cur) famRev.set(r.family, (famRev.get(r.family) || 0) + r.revenue);
    });
    var topFam = Array.from(famRev.entries()).sort(function (a, b) { return b[1] - a[1]; })[0];
    var fin = null; try { fin = IBP.finance.current(); } catch (e) { fin = null; }
    var k = fin ? fin.kpi : {};
    var acc = A.accuracy(J.range(J.addMonths(c, -3), 3));
    var al = A.alerts(), iv = A.inventoryValue();
    var data = {
      company: S.settings().companyName, businessModel: S.settings().businessModel, cycle: J.label(c), lastActualMonth: J.label(J.addMonths(c, -1)),
      actualLast12: { revenue: cur.revenue, tons: cur.tons, grossProfit: cur.gross, grossMargin: ratio(cur.gross, cur.revenue), revenueGrowthVsPrev12: growth(cur.revenue, prev.revenue), tonsGrowthVsPrev12: growth(cur.tons, prev.tons) },
      topFamily: topFam ? { name: topFam[0], revenue: topFam[1], share: ratio(topFam[1], cur.revenue) } : null,
      plan12: fin ? { revenue: k.revenue, grossProfit: k.gross, grossMargin: k.gm, operatingProfit: k.operating, fillRate: k.fillRate, avgUtilisation: k.util, lostSales: k.lost, gapToBudget: k.budgetGap, tons: k.tons } : null,
      forecastAccuracy3m: acc.accuracy, forecastBias3m: acc.bias,
      inventoryValue: iv.total, alerts: { critical: al.filter(function (a) { return a.level === 'critical'; }).length, warning: al.filter(function (a) { return a.level !== 'critical'; }).length }
    };
    var ltm = J.range(f12, 12);
    var mrev = agg(facts.filter(function (r) { return r.month >= f24; }), function (r) { return r.month; }, function (r) { return r.revenue; });
    var views = [
      { type: 'kpis', title: 'شاخص‌های کلیدی', items: [
        kpiItem('فروش ۱۲ ماه اخیر', F.money(cur.revenue), 'رشد ' + F.signedPct(data.actualLast12.revenueGrowthVsPrev12), data.actualLast12.revenueGrowthVsPrev12 >= 0 ? 'good' : 'bad'),
        kpiItem('فروش وزنی', F.num(cur.tons) + ' تن', 'رشد ' + F.signedPct(data.actualLast12.tonsGrowthVsPrev12), data.actualLast12.tonsGrowthVsPrev12 >= 0 ? 'good' : 'bad'),
        kpiItem('حاشیه ناخالص واقعی', F.pct(data.actualLast12.grossMargin, 1)),
        fin ? kpiItem('سود ناخالص برنامه ۱۲ ماه', F.money(k.gross), 'حاشیه ' + F.pct(k.gm, 1)) : null,
        fin ? kpiItem('نرخ پاسخ‌گویی به تقاضا', F.pct(k.fillRate, 1), 'فروش ازدست‌رفته ' + F.money(k.lost), k.fillRate >= 0.97 ? 'good' : k.fillRate >= 0.93 ? 'warn' : 'bad') : null,
        fin && k.budgetGap !== null ? kpiItem('فاصله تا بودجه', F.signedPct(k.budgetGap), '', k.budgetGap >= 0 ? 'good' : k.budgetGap > -0.05 ? 'warn' : 'bad') : null,
        kpiItem('دقت پیش‌بینی ۳ ماه', F.pct(acc.accuracy, 1), 'سوگیری ' + F.signedPct(acc.bias), acc.accuracy >= 0.8 ? 'good' : acc.accuracy >= 0.7 ? 'warn' : 'bad'),
        kpiItem('هشدارهای بحرانی', F.num(data.alerts.critical), F.num(data.alerts.warning) + ' هشدار دیگر', data.alerts.critical ? 'bad' : 'good')
      ].filter(Boolean) },
      { type: 'line', title: 'فروش ماهانه: ۱۲ ماه اخیر در برابر سال قبل', valueType: 'money', labels: ltm.map(function (p) { return J.shortLabel(p); }), tipLabels: ltm.map(plabel),
        series: [{ name: '۱۲ ماه اخیر', values: ltm.map(function (p) { return mrev.get(p) || 0; }) }, { name: 'سال قبل', values: ltm.map(function (p) { return mrev.get(J.addMonths(p, -12)) || 0; }), dash: true }] }
    ];
    return { data: data, views: views };
  }

  function tQuery(inp) {
    var R = IBP.reports, ds = R && R.DATASETS[inp.dataset];
    if (!ds) return { error: 'مجموعه‌داده نامعتبر است. مقادیر مجاز: sales, forecast, plan, profit, actions' };
    if (ds.dims.indexOf(inp.rows) < 0) return { error: 'بُعد «' + inp.rows + '» در مجموعه‌داده ' + inp.dataset + ' نیست. ابعاد مجاز: ' + ds.dims.join(', ') };
    var measure = ds.measures[inp.measure] ? inp.measure : null;
    if (!measure) return { error: 'شاخص «' + inp.measure + '» در مجموعه‌داده ' + inp.dataset + ' نیست. شاخص‌های مجاز: ' + Object.keys(ds.measures).join(', ') };
    var cols = inp.columns && inp.columns !== inp.rows && ds.dims.indexOf(inp.columns) >= 0 ? inp.columns : '';
    var facts = R.facts(inp.dataset), filters = [], sets = [], notes = [];
    (inp.filters || []).forEach(function (f) {
      if (!f || ds.dims.indexOf(f.dim) < 0 || !f.value) return;
      var vals = {}; facts.forEach(function (x) { vals[x[f.dim]] = 1; });
      var want = norm(f.value).trim(), keys = Object.keys(vals);
      var hit = keys.filter(function (k) { return norm(k).trim() === want; });
      if (!hit.length) hit = keys.filter(function (k) { var nk = norm(k).trim(); return nk.indexOf(want) >= 0 || want.indexOf(nk) >= 0; });
      if (!hit.length) { notes.push('مقدار «' + f.value + '» برای ' + (R.DIM_LABEL[f.dim] || f.dim) + ' پیدا نشد و فیلتر اعمال نشد.'); return; }
      var set = {}; hit.forEach(function (k) { set[k] = 1; });
      sets.push({ dim: f.dim, set: set });
      filters.push({ dim: f.dim, value: hit.length === 1 ? hit[0] : hit.join('، ') });
    });
    // پیش‌بینی: اگر نسخه انتخاب نشده باشد فقط نسخه اجماعی (جمع نسخه‌ها معنا ندارد)
    if (inp.dataset === 'forecast' && inp.rows !== 'version' && cols !== 'version' && !sets.some(function (x) { return x.dim === 'version'; })) {
      sets.push({ dim: 'version', set: { 'اجماعی': 1 } }); filters.push({ dim: 'version', value: 'اجماعی' });
    }
    var lm = clamp(inp.last_months || 0, 0, 24, 0), c = cyc(), when = null;
    if (lm && ds.dims.indexOf('month') >= 0) {
      if (inp.dataset === 'sales') { var from = J.addMonths(c, -lm); when = function (x) { return x.month >= from; }; }
      else { var to = J.addMonths(c, lm); when = function (x) { return x.month < to; }; }
    }
    var where = sets.length || when ? function (x) { return (!when || when(x)) && sets.every(function (s) { return s.set[x[s.dim]]; }); } : null;
    var top = clamp(inp.top || 15, 1, 50, 15);
    var cfg = { ds: inp.dataset, rows: inp.rows, cols: cols, measure: measure, filters: [], where: where, top: top, order: inp.order === 'asc' ? 'asc' : 'desc' };
    var P = R.pivot(cfg);
    var type = P.type === 'pct' ? 'pct' : P.type;
    var lab = function (dim, k) { return dim === 'month' || dim === 'cycle' ? plabel(k) : dim === 'year' ? F.num(+k) : k; };
    var rows = P.rowKeys.map(function (k) { var v = P.rowTotal(k); return { name: lab(inp.rows, k), value: v, share: type !== 'pct' && P.total ? v / P.total : null }; });
    var data = { dataset: ds.label, measure: P.mlabel, unit: type === 'money' ? 'rial' : type === 'num' ? 'ton' : type === 'pct' ? 'ratio' : 'count', rowsDim: inp.rows, columnsDim: cols || null, filters: filters, lastMonths: lm || null, records: P.facts, total: P.total, rows: rows, notes: notes };
    if (cols) data.matrix = P.rowKeys.slice(0, 15).map(function (rk) { var o = { row: lab(inp.rows, rk) }; P.colKeys.slice(0, 14).forEach(function (ck) { o[lab(cols, ck)] = P.cell(rk, ck); }); return o; });
    var views = [], title = ds.label + ' — ' + P.mlabel + ' به تفکیک ' + (R.DIM_LABEL[inp.rows] || inp.rows) + (cols ? ' و ' + (R.DIM_LABEL[cols] || cols) : '');
    var sub = filters.map(function (f) { return (R.DIM_LABEL[f.dim] || f.dim) + ': ' + lab(f.dim, f.value); }).concat(lm ? [(inp.dataset === 'sales' ? lm + ' ماه اخیر' : lm + ' ماه آینده')] : []).join(' · ');
    if (cols === 'month' || inp.rows === 'month') {
      var tk = cols === 'month' ? P.colKeys : P.rowKeys, sk = cols === 'month' ? P.rowKeys.slice(0, 8) : (cols ? P.colKeys.slice(0, 8) : ['__all']);
      views.push({ type: 'line', title: title, sub: sub, valueType: type, labels: tk.map(function (k) { return J.shortLabel(+k); }), tipLabels: tk.map(plabel),
        series: sk.map(function (s) { return { name: s === '__all' ? P.mlabel : lab(cols === 'month' ? inp.rows : cols, s), values: tk.map(function (t) { return cols === 'month' ? P.cell(s, t) : P.cell(t, s); }) }; }) });
    } else if (cols) {
      var rk = P.rowKeys.slice(0, 12);
      views.push({ type: 'columns', title: title, sub: sub, valueType: type, stacked: type !== 'pct', labels: rk.map(function (k) { return lab(inp.rows, k); }),
        series: P.colKeys.slice(0, 8).map(function (ck) { return { name: lab(cols, ck), values: rk.map(function (r) { return P.cell(r, ck) || 0; }) }; }) });
    } else {
      views.push({ type: 'hbars', title: title, sub: sub, valueType: type, drill: DIMOF[inp.rows] && inp.dataset === 'sales' ? inp.rows : null, items: rows.slice(0, 15).map(function (r) { return { label: r.name, value: r.value || 0, share: r.share }; }) });
    }
    var tcols = [{ key: 'name', label: R.DIM_LABEL[inp.rows] || inp.rows, type: 'text' }];
    var trows;
    if (cols) {
      P.colKeys.slice(0, 14).forEach(function (ck, i) { tcols.push({ key: 'c' + i, label: lab(cols, ck), type: type }); });
      tcols.push({ key: 'total', label: 'جمع', type: type });
      trows = P.rowKeys.map(function (rk) { var o = { name: lab(inp.rows, rk), total: P.rowTotal(rk) }; P.colKeys.slice(0, 14).forEach(function (ck, i) { o['c' + i] = P.cell(rk, ck); }); return o; });
    } else {
      tcols.push({ key: 'value', label: P.mlabel, type: type });
      if (type !== 'pct') tcols.push({ key: 'share', label: 'سهم از کل', type: 'pct' });
      trows = rows;
    }
    views.push({ type: 'table', title: 'جدول ' + P.mlabel, columns: tcols, rows: trows, total: type !== 'pct' ? P.total : null });
    return { data: data, views: views };
  }

  function entityRows(ent) { var f = salesFacts(); return ent ? f.filter(ent.row) : f; }

  function tTrend(inp) {
    var measure = MEAS[inp.measure] ? inp.measure : 'revenue', type = mtype(measure);
    var ent = resolveEntity(inp.entity_type, inp.entity_name);
    if (ent && ent.error) return { error: ent.error };
    var c = cyc(), per = J.range(J.addMonths(c, -24), 24);
    var m = agg(entityRows(ent), function (r) { return r.month; }, function (r) { return r[measure]; });
    var vals = per.map(function (p) { return m.get(p) || 0; });
    var last12 = vals.slice(12), prev12 = vals.slice(0, 12);
    var l3 = sum(vals.slice(21)), ly3 = sum(vals.slice(9, 12));
    var mean12 = sum(last12) / 12;
    // شیب خطی ۱۲ ماه اخیر (درصد میانگین در ماه)
    var xm = 5.5, sxy = 0, sxx = 0;
    last12.forEach(function (v, i) { sxy += (i - xm) * (v - mean12); sxx += (i - xm) * (i - xm); });
    var slope = sxx && mean12 ? (sxy / sxx) / mean12 : null;
    // فصلی بودن: میانگین هر ماه سال نسبت به میانگین کل (کل تاریخچه موجود)
    var idx = A.salesIndex(), allPer = A.periodsWithSales(), byM = {}, tot = 0, cnt = 0;
    if (!ent) {
      allPer.forEach(function (p) { var v = 0; idx.get(p).forEach(function (x) { v += measure === 'revenue' ? x.revenue : x.qty; }); if (measure === 'revenue' || measure === 'qty') { (byM[J.month(p)] = byM[J.month(p)] || []).push(v); tot += v; cnt++; } });
    }
    if (!cnt) per.forEach(function (p, i) { (byM[J.month(p)] = byM[J.month(p)] || []).push(vals[i]); tot += vals[i]; cnt++; });
    var avg = cnt ? tot / cnt : 0, season = [];
    for (var mo = 1; mo <= 12; mo++) { var a = byM[mo] || []; season.push({ month: J.MONTHS[mo - 1], index: avg && a.length ? (sum(a) / a.length) / avg : null }); }
    var ranked = season.filter(function (s) { return s.index !== null; }).sort(function (a, b) { return b.index - a.index; });
    // ماه‌های غیرعادی: انحراف از میانگین متحرک مرکزی ۳ ماهه
    var unusual = [];
    for (var i = 13; i < 23; i++) {
      var ma = (vals[i - 1] + vals[i + 1]) / 2;
      if (ma > 0 && Math.abs(vals[i] / ma - 1) > 0.22) unusual.push({ month: plabel(per[i]), value: vals[i], deviation: vals[i] / ma - 1 });
    }
    unusual.sort(function (a, b) { return Math.abs(b.deviation) - Math.abs(a.deviation); });
    // چشم‌انداز: پیش‌بینی اجماعی ۶ ماه آینده
    var fut = J.range(c, 6), outlook = null;
    if (!ent || ent.product) {
      var pf = ent ? ent.product : null, disc = A.avgDiscount(), fm = A.forecastMap('اجماعی', c);
      var ov = fut.map(function (p) {
        var t = 0;
        fm.forEach(function (mm, pid) {
          var q = mm.get(p); if (!q) return;
          var pr = S.get('products', pid); if (!pr || (pf && !pf(pr))) return;
          var price = A.priceAt(pr, p) * (1 - disc);
          t += measure === 'qty' ? q : measure === 'tons' ? q * (pr.unitWeightKg || 0) / 1000 : measure === 'gross' ? q * (price - (pr.unitCost || 0)) : q * price;
        });
        return t;
      });
      if (sum(ov) > 0) outlook = { months: fut.map(plabel), values: ov, vsSameMonthsLastYear: growth(sum(ov), sum(fut.map(function (p) { return m.get(J.addMonths(p, -12)) || 0; }))) };
    }
    var data = {
      measure: mlabel(measure), entity: ent ? { type: TYPE_LABEL[ent.type], name: ent.name } : 'کل شرکت',
      monthly: per.map(function (p, i) { return { month: plabel(p), value: vals[i] }; }).slice(12),
      last12: sum(last12), previous12: sum(prev12), growth12: growth(sum(last12), sum(prev12)),
      last3: l3, sameMonthsLastYear: ly3, growth3VsLastYear: growth(l3, ly3), trendSlopePerMonth: slope,
      seasonality: { peak: ranked.slice(0, 2), trough: ranked.slice(-2).reverse() }, unusualMonths: unusual.slice(0, 3), outlook: outlook
    };
    var labels = per.slice(12).concat(fut), lv = vals.slice(12);
    var views = [
      { type: 'kpis', title: 'خلاصه روند', items: [
        kpiItem(mlabel(measure) + ' ۱۲ ماه اخیر', fv(data.last12, type), 'رشد ' + F.signedPct(data.growth12), data.growth12 >= 0 ? 'good' : 'bad'),
        kpiItem('۳ ماه اخیر در برابر پارسال', F.signedPct(data.growth3VsLastYear), fv(l3, type), data.growth3VsLastYear >= 0 ? 'good' : 'bad'),
        kpiItem('شیب روند', slope === null ? '—' : F.signedPct(slope) + ' در ماه', '', slope === null ? '' : slope >= 0 ? 'good' : 'bad'),
        ranked.length ? kpiItem('اوج فصلی', ranked[0].month, 'شاخص ' + F.num(ranked[0].index, 2)) : null,
        outlook ? kpiItem('پیش‌بینی ۶ ماه آینده', fv(sum(outlook.values), type), 'در برابر پارسال ' + F.signedPct(outlook.vsSameMonthsLastYear), outlook.vsSameMonthsLastYear >= 0 ? 'good' : 'bad') : null
      ].filter(Boolean) },
      { type: 'line', title: mlabel(measure) + ' ماهانه — ' + (ent ? ent.name : 'کل شرکت'), valueType: type, labels: labels.map(function (p) { return J.shortLabel(p); }), tipLabels: labels.map(plabel),
        series: [{ name: 'واقعی', values: lv.concat(fut.map(function () { return null; })) },
          { name: 'سال قبل', values: vals.slice(0, 12).concat(fut.map(function (p) { return m.get(J.addMonths(p, -12)) || null; })), dash: true },
          outlook ? { name: 'پیش‌بینی اجماعی', values: lv.map(function (v, i) { return i === lv.length - 1 ? v : null; }).concat(outlook.values) } : null].filter(Boolean) },
      { type: 'columns', title: 'شاخص فصلی ماه‌های سال', valueType: 'ratio', labels: season.map(function (s) { return s.month; }), series: [{ name: 'شاخص فصلی (۱ = میانگین)', values: season.map(function (s) { return s.index; }) }] }
    ];
    return { data: data, views: views };
  }

  function tExplain(inp) {
    var measure = MEAS[inp.measure] ? inp.measure : 'revenue', type = mtype(measure);
    var n = inp.period === 'last_month' ? 1 : inp.period === 'last_12_months' ? 12 : 3;
    var by = DIMOF[inp.by] ? inp.by : 'family';
    var ent = resolveEntity(inp.entity_type, inp.entity_name);
    if (ent && ent.error) return { error: ent.error };
    if (ent && ent.dim === by) by = by === 'family' ? 'product' : 'family';
    var last = J.addMonths(cyc(), -1), curP = J.range(J.addMonths(last, -(n - 1)), n);
    var lastYear = inp.compare_to === 'last_year' || n === 12;
    var baseP = lastYear ? curP.map(function (p) { return J.addMonths(p, -12); }) : J.range(J.addMonths(last, -(2 * n - 1)), n);
    var inCur = {}, inBase = {};
    curP.forEach(function (p) { inCur[p] = 1; }); baseP.forEach(function (p) { inBase[p] = 1; });
    var mem = new Map(), prod = new Map(), totC = 0, totB = 0;
    entityRows(ent).forEach(function (r) {
      var side = inCur[r.month] ? 'c' : inBase[r.month] ? 'b' : null;
      if (!side) return;
      var k = r[by], o = mem.get(k) || { c: 0, b: 0 };
      o[side] += r[measure]; mem.set(k, o);
      if (side === 'c') totC += r[measure]; else totB += r[measure];
      var pp = prod.get(r.product) || { qc: 0, qb: 0, rc: 0, rb: 0 };
      if (side === 'c') { pp.qc += r.qty; pp.rc += r.revenue; } else { pp.qb += r.qty; pp.rb += r.revenue; }
      prod.set(r.product, pp);
    });
    var price = 0, volume = 0;
    if (measure === 'revenue') prod.forEach(function (x) {
      if (x.qc > 0 && x.qb > 0) { var pc = x.rc / x.qc, pb = x.rb / x.qb; price += (pc - pb) * x.qc; volume += (x.qc - x.qb) * pb; }
      else volume += x.rc - x.rb;
    });
    var movers = Array.from(mem.entries()).map(function (e) { return { name: e[0], current: e[1].c, base: e[1].b, change: e[1].c - e[1].b, changePct: growth(e[1].c, e[1].b) }; })
      .sort(function (a, b) { return Math.abs(b.change) - Math.abs(a.change); });
    var delta = totC - totB, topM = movers.slice(0, 6), rest = delta - sum(topM.map(function (x) { return x.change; }));
    var lbl = function (ps) { return ps.length === 1 ? plabel(ps[0]) : plabel(ps[0]) + ' تا ' + plabel(ps[ps.length - 1]); };
    var data = {
      measure: mlabel(measure), entity: ent ? { type: TYPE_LABEL[ent.type], name: ent.name } : 'کل شرکت', by: IBP.reports.DIM_LABEL[by],
      currentPeriod: lbl(curP), basePeriod: lbl(baseP), comparison: lastYear ? 'same period last year' : 'previous period',
      current: totC, base: totB, change: delta, changePct: growth(totC, totB),
      priceEffect: measure === 'revenue' ? price : null, volumeEffect: measure === 'revenue' ? volume : null,
      topDrivers: movers.slice(0, 8),
      weakest: movers.filter(function (x) { return x.base > 0; }).sort(function (a, b) { return a.changePct - b.changePct; }).slice(0, 5),
      increasing: movers.filter(function (x) { return x.change > 0; }).length, decreasing: movers.filter(function (x) { return x.change < 0; }).length
    };
    var wf = [{ label: 'دوره پایه', value: totB, total: true }].concat(topM.map(function (x) { return { label: x.name, value: x.change }; }));
    if (Math.abs(rest) > Math.abs(delta) * 0.005) wf.push({ label: 'سایر', value: rest });
    wf.push({ label: 'دوره جاری', value: totC, total: true });
    var views = [
      { type: 'kpis', title: 'تغییر ' + mlabel(measure), items: [
        kpiItem('دوره پایه', fv(totB, type), data.basePeriod), kpiItem('دوره جاری', fv(totC, type), data.currentPeriod),
        kpiItem('تغییر', F.signedPct(data.changePct), fv(delta, type), delta >= 0 ? 'good' : 'bad'),
        measure === 'revenue' ? kpiItem('اثر حجم', F.money(volume), 'سهم ' + F.pct(delta ? volume / delta : null, 0) + ' از تغییر', volume >= 0 ? 'good' : 'bad') : null,
        measure === 'revenue' ? kpiItem('اثر قیمت', F.money(price), 'سهم ' + F.pct(delta ? price / delta : null, 0) + ' از تغییر', price >= 0 ? 'good' : 'bad') : null
      ].filter(Boolean) },
      { type: 'waterfall', title: 'پل تغییر ' + mlabel(measure) + ' به تفکیک ' + data.by, valueType: type, items: wf },
      { type: 'table', title: 'عوامل تغییر', columns: [{ key: 'name', label: data.by, type: 'text' }, { key: 'base', label: 'دوره پایه', type: type }, { key: 'current', label: 'دوره جاری', type: type }, { key: 'change', label: 'تغییر', type: type }, { key: 'changePct', label: 'درصد تغییر', type: 'pct' }], rows: movers.slice(0, 25) }
    ];
    return { data: data, views: views };
  }

  function tAccuracy(inp) {
    var months = clamp(inp.months || 6, 1, 12, 6), c = cyc(), per = J.range(J.addMonths(c, -months), months);
    var acc = A.accuracy(per), byFam = inp.by === 'family';
    var items = acc.byProduct.map(function (r) { var p = S.get('products', r.productId) || {}; return { key: byFam ? p.familyId : r.productId, name: byFam ? S.name('families', p.familyId) : p.name, abs: r.abs, err: r.err, act: r.act }; });
    if (byFam) {
      var g = new Map();
      items.forEach(function (x) { var o = g.get(x.key) || { name: x.name, abs: 0, err: 0, act: 0 }; o.abs += x.abs; o.err += x.err; o.act += x.act; g.set(x.key, o); });
      items = Array.from(g.values());
    }
    var totAbs = sum(items.map(function (x) { return x.abs; }));
    items.forEach(function (x) { x.accuracy = x.act ? Math.max(0, 1 - x.abs / x.act) : null; x.bias = x.act ? x.err / x.act : null; x.errorShare = totAbs ? x.abs / totAbs : null; });
    items.sort(function (a, b) { return b.abs - a.abs; });
    var data = { months: months, period: plabel(per[0]) + ' تا ' + plabel(per[per.length - 1]), accuracy: acc.accuracy, wmape: acc.wmape, bias: acc.bias,
      byMonth: acc.byPeriod.map(function (b) { return { month: plabel(b.period), accuracy: b.accuracy, bias: b.bias }; }),
      worst: items.slice(0, 10).map(function (x) { return { name: x.name, accuracy: x.accuracy, bias: x.bias, shareOfTotalError: x.errorShare }; }) };
    var views = [
      { type: 'kpis', title: 'دقت پیش‌بینی', items: [kpiItem('دقت (۱−WMAPE)', F.pct(acc.accuracy, 1), data.period, acc.accuracy >= 0.8 ? 'good' : acc.accuracy >= 0.7 ? 'warn' : 'bad'), kpiItem('سوگیری', F.signedPct(acc.bias), acc.bias > 0 ? 'بیش‌برآورد' : 'کم‌برآورد', Math.abs(acc.bias || 0) < 0.05 ? 'good' : 'warn'), kpiItem('سهم ۳ مورد اول از خطا', F.pct(sum(items.slice(0, 3).map(function (x) { return x.errorShare || 0; })), 0))] },
      { type: 'line', title: 'دقت و سوگیری ماهانه', valueType: 'pct', labels: acc.byPeriod.map(function (b) { return J.shortLabel(b.period); }), tipLabels: acc.byPeriod.map(function (b) { return plabel(b.period); }),
        series: [{ name: 'دقت', values: acc.byPeriod.map(function (b) { return b.accuracy; }) }, { name: 'سوگیری', values: acc.byPeriod.map(function (b) { return b.bias; }), dash: true }] },
      { type: 'hbars', title: 'بیشترین سهم از خطای پیش‌بینی (' + (byFam ? 'خانواده' : 'محصول') + ')', valueType: 'pct', items: items.slice(0, 10).map(function (x) { return { label: x.name, value: x.errorShare || 0, note: 'دقت ' + F.pct(x.accuracy, 0) + ' · سوگیری ' + F.signedPct(x.bias) }; }) },
      { type: 'table', title: 'دقت به تفکیک ' + (byFam ? 'خانواده' : 'محصول'), columns: [{ key: 'name', label: byFam ? 'خانواده' : 'محصول', type: 'text' }, { key: 'accuracy', label: 'دقت', type: 'pct' }, { key: 'bias', label: 'سوگیری', type: 'pct' }, { key: 'errorShare', label: 'سهم از خطا', type: 'pct' }, { key: 'act', label: 'فروش واقعی (مقدار)', type: 'int' }], rows: items.slice(0, 40) }
    ];
    return { data: data, views: views };
  }

  function tSupply() {
    var pl = IBP.supply.current().plan, k = pl.kpi, n = Math.min(12, pl.periods.length);
    var res = pl.resources.map(function (r) {
      var u = r.util.slice(0, n);
      return { name: r.resource.name, avgUtil: r.avg, peakUtil: r.peak, overloadMonths: u.filter(function (x) { return x > 1.0001; }).map(function (x, i) { return i; }).length, overloadList: pl.periods.slice(0, n).filter(function (_, i) { return u[i] > 1.0001; }).map(plabel), overtimeHours: sum(r.overtime.slice(0, n)) };
    }).sort(function (a, b) { return b.peakUtil - a.peakUtil; });
    var short = pl.rows.map(function (r) { var q = sum(r.shortage.slice(0, n)); return { name: r.product.name, shortageQty: q, shortageValue: q * (r.product.unitPrice || 0), fillRate: r.fillRate, belowSafetyMonths: r.belowSS }; })
      .filter(function (x) { return x.shortageQty > 0.5; }).sort(function (a, b) { return b.shortageValue - a.shortageValue; });
    var data = { engine: pl.engine, horizon: plabel(pl.periods[0]) + ' تا ' + plabel(pl.periods[n - 1]), fillRate: k.fillRate, fillRateValue: k.fillRateValue, shortageValue: k.shortageValue, avgUtilisation: k.avgUtil, overloadedResourceMonths: k.bottlenecks, overtimeHours: k.overtimeHours, prebuildTons: k.prebuildTons, productsBelowSafetyStock: k.belowSS, resources: res, shortages: short.slice(0, 10) };
    var views = [
      { type: 'kpis', title: 'برنامه تأمین ۱۲ ماه', items: [kpiItem('نرخ پاسخ‌گویی', F.pct(k.fillRate, 1), 'ارزشی ' + F.pct(k.fillRateValue, 1), k.fillRate >= 0.97 ? 'good' : k.fillRate >= 0.93 ? 'warn' : 'bad'), kpiItem('فروش ازدست‌رفته', F.money(k.shortageValue), '', k.shortageValue > 0 ? 'bad' : 'good'), kpiItem('میانگین بهره‌برداری', F.pct(k.avgUtil, 0)), kpiItem('ماه‌های گلوگاه', F.num(k.bottlenecks), 'منبع×ماه بالای ۱۰۰٪', k.bottlenecks ? 'bad' : 'good'), kpiItem('اضافه‌کار', F.num(k.overtimeHours) + ' ساعت'), kpiItem('پیش‌تولید', F.num(k.prebuildTons, 1) + ' تن')] },
      { type: 'columns', title: 'بهره‌برداری خطوط تولید', valueType: 'pct', labels: res.map(function (r) { return r.name; }), series: [{ name: 'میانگین', values: res.map(function (r) { return r.avgUtil; }) }, { name: 'اوج', values: res.map(function (r) { return r.peakUtil; }) }] },
      { type: 'table', title: 'خطوط تولید', columns: [{ key: 'name', label: 'خط / منبع', type: 'text' }, { key: 'avgUtil', label: 'میانگین بهره‌برداری', type: 'pct' }, { key: 'peakUtil', label: 'اوج', type: 'pct' }, { key: 'overloadMonths', label: 'ماه‌های اضافه‌بار', type: 'int' }, { key: 'overtimeHours', label: 'اضافه‌کار (ساعت)', type: 'int' }], rows: res }
    ];
    if (short.length) views.push({ type: 'hbars', title: 'بیشترین کمبود (ارزش فروش ازدست‌رفته)', valueType: 'money', items: short.slice(0, 10).map(function (x) { return { label: x.name, value: x.shortageValue, note: F.num(x.shortageQty) + ' واحد · پاسخ‌گویی ' + F.pct(x.fillRate, 0) }; }) });
    return { data: data, views: views };
  }

  function tInventory() {
    var cov = A.coverage(), iv = A.inventoryValue();
    var risk = cov.filter(function (c) { return c.status === 'critical' || c.status === 'warning'; }).sort(function (a, b) { return a.months - b.months; });
    var excess = cov.filter(function (c) { return c.status === 'excess'; }).sort(function (a, b) { return b.value - a.value; });
    var row = function (c) { return { name: c.product.name, family: S.name('families', c.product.familyId), qty: c.qty, monthlyDemand: c.demand, monthsOfCover: isFinite(c.months) ? c.months : null, safetyMonths: c.ssMonths, status: { critical: 'خطر کمبود', warning: 'نزدیک ذخیره اطمینان', excess: 'مازاد', ok: 'مناسب' }[c.status], value: c.value }; };
    var data = { finishedGoodsValue: iv.finished, materialsValue: iv.materials, products: cov.length, critical: cov.filter(function (c) { return c.status === 'critical'; }).length, warning: cov.filter(function (c) { return c.status === 'warning'; }).length, excess: excess.length, excessValue: sum(excess.map(function (c) { return c.value; })), atRisk: risk.slice(0, 10).map(row), largestExcess: excess.slice(0, 8).map(row) };
    var views = [
      { type: 'kpis', title: 'موجودی', items: [kpiItem('ارزش موجودی محصول', F.money(iv.finished)), kpiItem('ارزش موجودی مواد', F.money(iv.materials)), kpiItem('خطر کمبود', F.num(data.critical) + ' محصول', F.num(data.warning) + ' نزدیک ذخیره اطمینان', data.critical ? 'bad' : 'good'), kpiItem('موجودی مازاد', F.money(data.excessValue), F.num(data.excess) + ' محصول', data.excess ? 'warn' : 'good')] }
    ];
    if (risk.length) views.push({ type: 'hbars', title: 'محصولات در خطر کمبود (ماه پوشش)', valueType: 'ratio', items: risk.slice(0, 12).map(function (c) { return { label: c.product.name, value: isFinite(c.months) ? c.months : 0, note: 'ذخیره اطمینان ' + F.num(c.ssMonths, 1) + ' ماه' }; }) });
    if (excess.length) views.push({ type: 'hbars', title: 'بیشترین موجودی مازاد (ارزش)', valueType: 'money', items: excess.slice(0, 10).map(function (c) { return { label: c.product.name, value: c.value, note: isFinite(c.months) ? F.num(c.months, 1) + ' ماه پوشش' : 'بدون تقاضا' }; }) });
    views.push({ type: 'table', title: 'پوشش موجودی محصولات', columns: [{ key: 'name', label: 'محصول', type: 'text' }, { key: 'family', label: 'خانواده', type: 'text' }, { key: 'qty', label: 'موجودی', type: 'int' }, { key: 'monthlyDemand', label: 'تقاضای ماهانه', type: 'int' }, { key: 'monthsOfCover', label: 'ماه پوشش', type: 'num' }, { key: 'safetyMonths', label: 'ذخیره اطمینان (ماه)', type: 'num' }, { key: 'status', label: 'وضعیت', type: 'text' }, { key: 'value', label: 'ارزش', type: 'money' }], rows: risk.concat(excess).map(row) });
    return { data: data, views: views };
  }

  function tScenario(inp) {
    var d = {}, applied = [];
    IBP.finance.DRIVERS.forEach(function (dr) {
      var v = clamp(inp[dr.key] || 0, dr.min, dr.max, 0);
      if (v) { d[dr.key] = v; applied.push(dr.label + ' ' + (v > 0 ? '+' : '') + F.num(v) + '٪'); }
    });
    var base = IBP.finance.current().kpi, sc = IBP.finance.runScenario({ drivers: d }).kpi;
    var keys = [['revenue', 'درآمد', 'money'], ['gross', 'سود ناخالص', 'money'], ['gm', 'حاشیه ناخالص', 'pct'], ['operating', 'سود عملیاتی', 'money'], ['fillRate', 'نرخ پاسخ‌گویی', 'pct'], ['util', 'بهره‌برداری', 'pct'], ['lost', 'فروش ازدست‌رفته', 'money'], ['nwcEnd', 'سرمایه در گردش پایان دوره', 'money'], ['budgetGap', 'فاصله تا بودجه', 'pct']];
    var rows = keys.map(function (k) { var a = base[k[0]], b = sc[k[0]]; return { metric: k[1], key: k[0], type: k[2], base: a, scenario: b, change: b - a, changePct: k[2] === 'money' ? growth(b, a) : null }; });
    var data = { drivers: d, applied: applied, results: rows.map(function (r) { return { metric: r.key, label: r.metric, base: r.base, scenario: r.scenario, change: r.change, changePct: r.changePct }; }) };
    var get = function (k) { return rows.filter(function (r) { return r.key === k; })[0]; };
    var views = [
      { type: 'kpis', title: 'نتیجه سناریو' + (applied.length ? ': ' + applied.join('، ') : ''), items: ['revenue', 'gross', 'gm', 'operating', 'fillRate', 'lost'].map(function (k) {
        var r = get(k), good = k === 'lost' ? r.change <= 0 : r.change >= 0;
        return kpiItem(r.metric, r.type === 'pct' ? F.pct(r.scenario, 1) : F.money(r.scenario), r.type === 'pct' ? 'تغییر ' + F.num(r.change * 100, 1) + ' واحد درصد' : 'تغییر ' + F.signedPct(r.changePct) + ' (' + F.money(r.change) + ')', Math.abs(r.change) < 1e-9 ? '' : good ? 'good' : 'bad');
      }) },
      { type: 'columns', title: 'برنامه پایه در برابر سناریو', valueType: 'money', labels: ['درآمد', 'سود ناخالص', 'سود عملیاتی', 'فروش ازدست‌رفته'], series: [{ name: 'پایه', values: [base.revenue, base.gross, base.operating, base.lost] }, { name: 'سناریو', values: [sc.revenue, sc.gross, sc.operating, sc.lost] }] },
      { type: 'table', title: 'مقایسه شاخص‌ها', columns: [{ key: 'metric', label: 'شاخص', type: 'text' }, { key: 'base', label: 'پایه', type: 'text' }, { key: 'scenario', label: 'سناریو', type: 'text' }, { key: 'change', label: 'تغییر', type: 'text' }],
        rows: rows.map(function (r) { var f = function (v) { return r.type === 'pct' ? F.pct(v, 1) : F.money(v); }; return { metric: r.metric, base: f(r.base), scenario: f(r.scenario), change: r.type === 'pct' ? F.num((r.change || 0) * 100, 1) + ' واحد درصد' : F.money(r.change) + ' (' + F.signedPct(r.changePct) + ')' }; }) }
    ];
    return { data: data, views: views };
  }

  function tAlerts() {
    var al = A.alerts();
    var data = { total: al.length, critical: al.filter(function (a) { return a.level === 'critical'; }).length, items: al.slice(0, 25).map(function (a) { return { level: a.level, type: a.type, text: a.text, detail: a.detail }; }) };
    var byType = agg(al, function (a) { return a.type; }, function () { return 1; });
    return { data: data, views: [
      { type: 'donut', title: 'هشدارها به تفکیک نوع', valueType: 'int', items: Array.from(byType.entries()).map(function (e) { return { label: e[0], value: e[1] }; }) },
      { type: 'table', title: 'فهرست هشدارها', columns: [{ key: 'level', label: 'سطح', type: 'text' }, { key: 'type', label: 'نوع', type: 'text' }, { key: 'text', label: 'شرح', type: 'text' }, { key: 'detail', label: 'جزئیات', type: 'text' }], rows: al.slice(0, 40).map(function (a) { return { level: a.level === 'critical' ? 'بحرانی' : 'هشدار', type: a.type, text: a.text, detail: a.detail }; }) }
    ] };
  }

  function tHolding() {
    var list = IBP.holding ? IBP.holding.list() : [];
    var rows = list.filter(function (c) { return c.summary && c.summary.products; }).map(function (c) {
      var s = c.summary, p = s.plan || {};
      return { code: c.code, name: c.name, model: c.model || '', revenueLast12: s.revenue, externalRevenueLast12: s.revenueExternal, growth: growth(s.revenue, s.revenuePrev), tons: s.tons, planRevenue: p.revenue, planGross: p.gross, grossMargin: p.gm, fillRate: p.fillRate, utilisation: p.util, gapToBudget: p.budgetGap, forecastAccuracy: s.accuracy, criticalAlerts: s.critical, updatedAt: s.updatedAt };
    }).sort(function (a, b) { return (b.revenueLast12 || 0) - (a.revenueLast12 || 0); });
    var data = { holding: (IBP.holding.state().holding || {}).name, companies: rows, missing: list.length - rows.length, totalRevenueLast12: sum(rows.map(function (r) { return r.revenueLast12; })), totalExternalRevenueLast12: sum(rows.map(function (r) { return r.externalRevenueLast12; })), note: 'Figures come from each company summary as of its last refresh (holding view → refresh).' };
    if (!rows.length) return { data: data, views: [] };
    return { data: data, views: [
      { type: 'hbars', title: 'فروش ۱۲ ماه اخیر شرکت‌ها', valueType: 'money', items: rows.map(function (r) { return { label: r.name, value: r.revenueLast12 || 0, note: 'رشد ' + F.signedPct(r.growth) + ' · حاشیه برنامه ' + F.pct(r.grossMargin, 1) }; }) },
      { type: 'columns', title: 'حاشیه ناخالص، پاسخ‌گویی و دقت', valueType: 'pct', labels: rows.map(function (r) { return r.name; }), series: [{ name: 'حاشیه ناخالص برنامه', values: rows.map(function (r) { return r.grossMargin; }) }, { name: 'نرخ پاسخ‌گویی', values: rows.map(function (r) { return r.fillRate; }) }, { name: 'دقت پیش‌بینی', values: rows.map(function (r) { return r.forecastAccuracy; }) }] },
      { type: 'table', title: 'مقایسه شرکت‌ها', columns: [{ key: 'name', label: 'شرکت', type: 'text' }, { key: 'model', label: 'مدل', type: 'text' }, { key: 'revenueLast12', label: 'فروش ۱۲ ماه', type: 'money' }, { key: 'growth', label: 'رشد', type: 'pct' }, { key: 'planGross', label: 'سود ناخالص برنامه', type: 'money' }, { key: 'grossMargin', label: 'حاشیه', type: 'pct' }, { key: 'fillRate', label: 'پاسخ‌گویی', type: 'pct' }, { key: 'utilisation', label: 'بهره‌برداری', type: 'pct' }, { key: 'forecastAccuracy', label: 'دقت', type: 'pct' }, { key: 'criticalAlerts', label: 'هشدار بحرانی', type: 'int' }], rows: rows }
    ] };
  }

  /* ---------------- بینش‌های سریع ---------------- */
  function insightList() {
    var out = [], c = cyc(), facts = salesFacts();
    if (!facts.length) return out;
    var f12 = J.addMonths(c, -12), f24 = J.addMonths(c, -24), f3 = J.addMonths(c, -3), l3a = J.addMonths(c, -15), l3b = J.addMonths(c, -12);
    var cur = facts.filter(function (r) { return r.month >= f12; }), prev = facts.filter(function (r) { return r.month >= f24 && r.month < f12; });
    var tryAdd = function (fn) { try { var x = fn(); if (x) out.push(x); } catch (e) { console.warn('insight', e); } };
    var R = function (rows, k) { return sum(rows.map(function (r) { return r[k]; })); };
    var monthly = function (rows, k) { var m = agg(rows, function (r) { return r.month; }, function (r) { return r[k]; }); return J.range(f12, 12).map(function (p) { return m.get(p) || 0; }); };

    tryAdd(function () { // رشد اسمی در برابر وزنی
      var gr = growth(R(cur, 'revenue'), R(prev, 'revenue')), gt = growth(R(cur, 'tons'), R(prev, 'tons'));
      if (gr === null || gt === null) return null;
      var priceLed = gr - gt > 0.05;
      return { id: 'growth', level: gt >= 0 ? 'good' : 'bad', icon: 'trend', score: Math.abs(gr) * 3 + Math.abs(gr - gt) * 4,
        title: 'رشد فروش ۱۲ ماه: ' + F.signedPct(gr) + ' (وزنی ' + F.signedPct(gt) + ')',
        text: priceLed ? 'رشد ریالی عمدتاً از افزایش قیمت است؛ حجم فروش ' + (gt >= 0 ? 'فقط ' + F.signedPct(gt) + ' رشد داشته' : F.signedPct(gt) + ' کاهش یافته') + '.' : 'فروش ریالی و وزنی هم‌جهت تغییر کرده‌اند؛ تغییر حجم واقعی است.',
        spark: monthly(cur, 'revenue'), ask: 'چرا فروش ۱۲ ماه اخیر نسبت به سال قبل تغییر کرد؟' };
    });
    tryAdd(function () { // تحرک خانواده‌ها: ۳ ماه اخیر در برابر پارسال
      var a = agg(facts.filter(function (r) { return r.month >= f3; }), function (r) { return r.family; }, function (r) { return r.revenue; });
      var b = agg(facts.filter(function (r) { return r.month >= l3a && r.month < l3b; }), function (r) { return r.family; }, function (r) { return r.revenue; });
      var ch = Array.from(new Set(Array.from(a.keys()).concat(Array.from(b.keys())))).map(function (k) { return { name: k, d: (a.get(k) || 0) - (b.get(k) || 0), g: growth(a.get(k) || 0, b.get(k) || 0) }; }).sort(function (x, y) { return x.d - y.d; });
      if (ch.length < 2) return null;
      var down = ch[0], up = ch[ch.length - 1], totB = sum(Array.from(b.values())) || 1;
      var big = Math.abs(down.d) > Math.abs(up.d) ? down : up;
      return { id: 'momentum', level: big.d >= 0 ? 'good' : 'bad', icon: big.d >= 0 ? 'trend' : 'alert', score: Math.abs(big.d) / totB * 8,
        title: (big.d >= 0 ? 'شتاب رشد در «' : 'افت در «') + big.name + '»: ' + F.signedPct(big.g),
        text: '۳ ماه اخیر در برابر همین ماه‌ها در پارسال: بیشترین رشد «' + up.name + '» (' + F.money(up.d) + ') و بیشترین افت «' + down.name + '» (' + F.money(down.d) + ').',
        bars: [{ label: up.name, value: up.d }, { label: down.name, value: down.d }], ask: 'چرا فروش ' + big.name + ' در ۳ ماه اخیر نسبت به سال قبل تغییر کرد؟' };
    });
    tryAdd(function () { // تمرکز مشتری
      var m = agg(cur, function (r) { return r.customer; }, function (r) { return r.revenue; });
      var v = Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1]; }), tot = sum(v.map(function (x) { return x[1]; }));
      if (v.length < 5 || !tot) return null;
      var n20 = Math.max(1, Math.round(v.length * 0.2)), s20 = sum(v.slice(0, n20).map(function (x) { return x[1]; })) / tot, s1 = v[0][1] / tot;
      return { id: 'concentration', level: s1 > 0.15 || s20 > 0.8 ? 'warn' : 'info', icon: 'users', score: s1 > 0.15 ? 3 + s1 * 5 : s20 * 2,
        title: '۲۰٪ مشتریان، ' + F.pct(s20, 0) + ' فروش را می‌سازند',
        text: 'بزرگ‌ترین مشتری «' + v[0][0] + '» با سهم ' + F.pct(s1, 1) + (s1 > 0.15 ? '؛ وابستگی بالا — ریسک اعتباری و قدرت چانه‌زنی را پایش کنید.' : '.') + ' ' + F.num(v.length) + ' مشتری فعال در ۱۲ ماه اخیر.',
        bars: v.slice(0, 5).map(function (x) { return { label: x[0], value: x[1] }; }), ask: '۱۰ مشتری برتر بر اساس فروش ۱۲ ماه اخیر' };
    });
    tryAdd(function () { // حاشیه خانواده‌ها
      var r = agg(cur, function (x) { return x.family; }, function (x) { return x.revenue; }), g = agg(cur, function (x) { return x.family; }, function (x) { return x.gross; });
      var v = Array.from(r.keys()).filter(function (k) { return r.get(k) > 0; }).map(function (k) { return { name: k, gm: g.get(k) / r.get(k), rev: r.get(k) }; }).sort(function (a, b) { return a.gm - b.gm; });
      if (v.length < 2) return null;
      var lo = v[0], hi = v[v.length - 1], avgGm = R(cur, 'gross') / (R(cur, 'revenue') || 1);
      return { id: 'margin', level: lo.gm < avgGm * 0.6 ? 'warn' : 'info', icon: 'coins', score: (hi.gm - lo.gm) * 6,
        title: 'شکاف حاشیه: «' + hi.name + '» ' + F.pct(hi.gm, 0) + ' در برابر «' + lo.name + '» ' + F.pct(lo.gm, 0),
        text: 'میانگین حاشیه ناخالص ' + F.pct(avgGm, 1) + '. «' + lo.name + '» ' + F.pct(lo.rev / (R(cur, 'revenue') || 1), 0) + ' فروش را دارد؛ بازنگری قیمت، تخفیف یا ترکیب آن اثر مستقیم بر سود دارد.',
        bars: v.slice().reverse().slice(0, 6).map(function (x) { return { label: x.name, value: x.gm, type: 'pct' }; }), ask: 'حاشیه سود خانواده‌ها در ۱۲ ماه اخیر' };
    });
    tryAdd(function () { // فصلی بودن و اوج پیش رو
      var idx = A.salesIndex(), per = A.periodsWithSales(), byM = {}, tot = 0;
      if (per.length < 18) return null;
      per.forEach(function (p) { var v = 0; idx.get(p).forEach(function (x) { v += x.qty; }); (byM[J.month(p)] = byM[J.month(p)] || []).push(v); tot += v; });
      var avg = tot / per.length, si = [];
      for (var mo = 1; mo <= 12; mo++) si.push(byM[mo] ? sum(byM[mo]) / byM[mo].length / avg : 1);
      var peak = si.indexOf(Math.max.apply(null, si)), amp = Math.max.apply(null, si) - Math.min.apply(null, si);
      if (amp < 0.25) return null;
      var ahead = -1; for (var k = 0; k < 4; k++) if (J.month(J.addMonths(c, k)) === peak + 1) ahead = k;
      return { id: 'season', level: ahead >= 0 ? 'warn' : 'info', icon: 'calendar', score: amp * 3 + (ahead >= 0 ? 2 : 0),
        title: 'اوج فصلی: ' + J.MONTHS[peak] + ' (' + F.num(si[peak], 2) + ' برابر میانگین)' + (ahead >= 0 ? (ahead === 0 ? ' — همین ماه' : ' — ' + F.num(ahead) + ' ماه دیگر') : ''),
        text: ahead >= 0 ? 'اوج تقاضا نزدیک است؛ پیش‌تولید، ظرفیت خطوط و تأمین مواد را از هم‌اکنون هماهنگ کنید.' : 'دامنه نوسان فصلی ' + F.pct(amp, 0) + ' است؛ برنامه تولید و موجودی باید فصلی تنظیم شود.',
        season: si, ask: 'روند و فصلی بودن فروش وزنی' };
    });
    tryAdd(function () { // ماه غیرعادی اخیر
      var t = monthly(cur, 'revenue'), last = t[11], base = t.slice(0, 11), mean = sum(base) / 11;
      var sd = Math.sqrt(sum(base.map(function (v) { return (v - mean) * (v - mean); })) / 10);
      if (!sd) return null;
      var z = (last - mean) / sd;
      if (Math.abs(z) < 1.6) return null;
      return { id: 'anomaly', level: z > 0 ? 'good' : 'bad', icon: 'zap', score: Math.abs(z),
        title: 'فروش ' + J.label(J.addMonths(c, -1)) + ' ' + (z > 0 ? 'بالاتر' : 'پایین‌تر') + ' از الگوی معمول',
        text: F.money(last) + ' در برابر میانگین ۱۱ ماه قبل ' + F.money(mean) + ' (' + F.num(Math.abs(z), 1) + ' انحراف معیار). علت را (رویداد، قیمت، کمبود کالا یا خطای داده) بررسی کنید.',
        spark: t, ask: 'چرا فروش ماه گذشته نسبت به ماه قبل تغییر کرد؟' };
    });
    tryAdd(function () { // سوگیری پیش‌بینی
      var acc = A.accuracy(J.range(J.addMonths(c, -3), 3));
      if (acc.accuracy === null) return null;
      var bad = Math.abs(acc.bias) > 0.08 || acc.accuracy < 0.7;
      return { id: 'bias', level: bad ? 'warn' : 'good', icon: 'target', score: Math.abs(acc.bias) * 10 + (1 - acc.accuracy) * 3,
        title: 'دقت پیش‌بینی ۳ ماه: ' + F.pct(acc.accuracy, 0) + ' · سوگیری ' + F.signedPct(acc.bias),
        text: Math.abs(acc.bias) > 0.08 ? (acc.bias > 0 ? 'پیش‌بینی‌ها مداوم بیش از فروش واقعی است؛ موجودی اضافه و سرمایه در گردش بالاتر می‌سازد.' : 'پیش‌بینی‌ها مداوم کمتر از فروش واقعی است؛ ریسک کمبود و فروش ازدست‌رفته.') : 'سوگیری در محدوده قابل قبول است.',
        ask: 'دقت پیش‌بینی ۶ ماه اخیر و محصولات با بیشترین خطا' };
    });
    tryAdd(function () { // ظرفیت
      var pl = IBP.supply.current().plan, over = pl.resources.filter(function (r) { return r.peak > 1.0001; }).sort(function (a, b) { return b.peak - a.peak; });
      if (!over.length) { var hi = pl.resources.slice().sort(function (a, b) { return b.peak - a.peak; })[0]; return hi && hi.peak > 0.9 ? { id: 'capacity', level: 'info', icon: 'factory', score: 1.5, title: 'نزدیک به سقف ظرفیت: ' + hi.resource.name + ' (' + F.pct(hi.peak, 0) + ')', text: 'گلوگاهی در ۱۲ ماه آینده نیست ولی حاشیه ظرفیت کم است.', ask: 'وضعیت ظرفیت خطوط تولید' } : null; }
      var r = over[0], months = r.util.filter(function (u) { return u > 1.0001; }).length;
      return { id: 'capacity', level: 'bad', icon: 'factory', score: 3 + (r.peak - 1) * 10,
        title: 'گلوگاه ظرفیت: ' + r.resource.name + ' (اوج ' + F.pct(r.peak, 0) + ')',
        text: F.num(months) + ' ماه بالای ظرفیت' + (over.length > 1 ? '؛ ' + F.num(over.length - 1) + ' خط دیگر هم اضافه‌بار دارند' : '') + '. اضافه‌کار، مسیر جایگزین یا پیش‌تولید را بررسی کنید (بهینه‌سازی LP در صفحه تأمین).',
        ask: 'وضعیت ظرفیت خطوط تولید و کمبودها' };
    });
    tryAdd(function () { // موجودی
      var cov = A.coverage(), cr = cov.filter(function (x) { return x.status === 'critical'; }), ex = cov.filter(function (x) { return x.status === 'excess'; });
      if (!cr.length && !ex.length) return null;
      var exV = sum(ex.map(function (x) { return x.value; }));
      return { id: 'inventory', level: cr.length ? 'bad' : 'warn', icon: 'box', score: cr.length * 0.6 + (exV / (A.inventoryValue().finished || 1)) * 4,
        title: (cr.length ? F.num(cr.length) + ' محصول در خطر کمبود' : '') + (cr.length && ex.length ? ' · ' : '') + (ex.length ? F.money(exV) + ' موجودی مازاد' : ''),
        text: (cr.length ? 'پوشش کمتر از ذخیره اطمینان: ' + cr.slice(0, 3).map(function (x) { return '«' + x.product.name + '»'; }).join('، ') + '. ' : '') + (ex.length ? 'مازاد در ' + F.num(ex.length) + ' محصول سرمایه در گردش را قفل کرده است.' : ''),
        ask: 'وضعیت موجودی و محصولات در خطر کمبود' };
    });
    tryAdd(function () { // بودجه و فروش ازدست‌رفته
      var k = IBP.finance.current().kpi;
      if (k.budgetGap === null && !(k.lost > 0)) return null;
      var lostR = k.revenue ? k.lost / k.revenue : 0;
      if ((k.budgetGap === null || Math.abs(k.budgetGap) < 0.02) && lostR < 0.01) return null;
      return { id: 'budget', level: (k.budgetGap || 0) < -0.02 || lostR > 0.02 ? 'bad' : 'good', icon: 'coins', score: Math.abs(k.budgetGap || 0) * 8 + lostR * 20,
        title: k.budgetGap !== null ? 'برنامه ' + F.signedPct(k.budgetGap) + ' نسبت به بودجه' : 'فروش ازدست‌رفته ' + F.money(k.lost),
        text: 'درآمد برنامه ۱۲ ماه ' + F.money(k.revenue) + ' با حاشیه ناخالص ' + F.pct(k.gm, 1) + (k.lost > 0 ? '؛ ' + F.money(k.lost) + ' فروش به‌دلیل کمبود از دست می‌رود.' : '.'),
        ask: 'اگر ظرفیت ۱۰ درصد افزایش یابد سود چه تغییری می‌کند؟' };
    });
    tryAdd(function () { // تغییر سهم کانال‌ها
      var a = agg(cur, function (r) { return r.channel; }, function (r) { return r.revenue; }), b = agg(prev, function (r) { return r.channel; }, function (r) { return r.revenue; });
      var ta = sum(Array.from(a.values())), tb = sum(Array.from(b.values()));
      if (!ta || !tb || a.size < 2) return null;
      var v = Array.from(a.keys()).map(function (k) { return { name: k, d: (a.get(k) || 0) / ta - (b.get(k) || 0) / tb, s: (a.get(k) || 0) / ta }; }).sort(function (x, y) { return Math.abs(y.d) - Math.abs(x.d); });
      if (Math.abs(v[0].d) < 0.02) return null;
      return { id: 'channel', level: 'info', icon: 'map', score: Math.abs(v[0].d) * 25,
        title: 'جابه‌جایی سهم کانال: «' + v[0].name + '» ' + (v[0].d > 0 ? '+' : '') + F.num(v[0].d * 100, 1) + ' واحد درصد',
        text: 'سهم «' + v[0].name + '» از فروش ۱۲ ماه اخیر به ' + F.pct(v[0].s, 1) + ' رسیده است. اثر آن بر تخفیف‌ها، حاشیه و برنامه پخش را بررسی کنید.',
        bars: v.slice(0, 5).map(function (x) { return { label: x.name, value: x.d, type: 'pct' }; }), ask: 'فروش به تفکیک کانال ماهانه' };
    });
    return out.sort(function (a, b) { return b.score - a.score; }).slice(0, 9);
  }
  function tInsights() {
    var list = insightList();
    return { data: { insights: list.map(function (i) { return { level: i.level, title: i.title, text: i.text }; }) }, views: [{ type: 'insights', title: 'بینش‌های سریع', items: list }] };
  }

  var EXEC = { company_overview: tOverview, query_data: tQuery, trend_analysis: tTrend, explain_change: tExplain, forecast_accuracy: tAccuracy, supply_status: tSupply, inventory_status: tInventory, run_scenario: tScenario, get_alerts: tAlerts, holding_overview: tHolding, quick_insights: tInsights };
  var TOOL_LABEL = { company_overview: 'نمای کلی شرکت', query_data: 'پرس‌وجوی داده', trend_analysis: 'تحلیل روند', explain_change: 'تحلیل علت تغییر', forecast_accuracy: 'دقت پیش‌بینی', supply_status: 'وضعیت تأمین و ظرفیت', inventory_status: 'وضعیت موجودی', run_scenario: 'شبیه‌سازی سناریو', get_alerts: 'هشدارها', holding_overview: 'نمای هلدینگ', quick_insights: 'بینش‌های سریع' };

  /** اجرای یک ابزار با ورودی؛ خطاها به‌صورت { error } برمی‌گردند */
  function execute(name, input) {
    var fn = EXEC[name];
    if (!fn) return { error: 'ابزار ناشناخته: ' + name };
    if (!S.count('products')) return { error: 'داده‌ای برای این شرکت بارگذاری نشده است.' };
    try { return fn(input || {}); } catch (e) { console.error(e); return { error: 'خطا در اجرای ' + (TOOL_LABEL[name] || name) + ': ' + (e && e.message || e) }; }
  }

  /* =====================================================================
   * مدل داخلی: فهم پرسش ← برنامه اجرا ← روایت
   * ===================================================================== */
  function detectMonths(n) {
    var m = /(\d{1,2}) ماه/.exec(n);
    if (m && +m[1] > 0 && +m[1] <= 36) return +m[1];
    if (has(n, kw(['ماه گذشته', 'ماه قبل', 'ماه اخیر', 'ماه پیش', 'این ماه']))) return 1;
    if (has(n, kw(['فصل گذشته', 'فصل اخیر', 'سه ماهه']))) return 3;
    if (has(n, kw(['شش ماهه', 'نیم سال', 'نیمسال']))) return 6;
    if (has(n, kw(['سال گذشته', 'یک سال', 'یکسال', 'امسال', 'سالانه']))) return 12;
    if (has(n, kw(['دو سال']))) return 24;
    return 0;
  }
  function detectTop(n) {
    var m = /(\d{1,2}) ?(تا|مورد|محصول|مشتری|خانواده|کالا|برتر|اول|قلم)/.exec(n) || /(برتر|top|اول) ?(\d{1,2})/.exec(n);
    if (!m) return 0;
    var v = +(isNaN(+m[1]) ? m[2] : m[1]);
    return v > 0 && v <= 50 ? v : 0;
  }
  function detectMetric(n) {
    if (has(n, W.margin)) return 'margin';
    if (has(n, W.gross)) return 'gross';
    if (has(n, W.tons)) return 'tons';
    if (has(n, W.qty)) return 'qty';
    return 'revenue';
  }
  function detectDims(n, ents) {
    var found = [];
    Object.keys(W.dim).forEach(function (d) { var p = pos(n, W.dim[d]); if (p >= 0) found.push({ d: d, p: p }); });
    // واژه‌هایی که داخل نام یک موجودیت پیداشده آمده‌اند بُعد حساب نمی‌شوند
    found = found.filter(function (f) { return !ents.some(function (e) { var i = n.indexOf(' ' + e.n); return i >= 0 && f.p >= i && f.p < i + e.n.length; }); });
    return found.sort(function (a, b) { return a.p - b.p; }).map(function (f) { return f.d; });
  }
  function detectDrivers(n) {
    var d = {}, used = [];
    DRIVER_KW.forEach(function (pair) {
      pair[1].forEach(function (w) {
        var re = new RegExp('(^| )' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), m;
        while ((m = re.exec(n))) {
          var at = m.index + m[1].length;
          if (used.some(function (u) { return at >= u[0] && at < u[1]; })) continue;
          used.push([at, at + w.length]);
          if (d[pair[0]] !== undefined) continue;
          var after = n.slice(at + w.length, at + w.length + 45), before = n.slice(Math.max(0, at - 30), at);
          var mm = /(-|\+)?\s?(\d+(?:\.\d+)?) ?درصد/.exec(after) || /(-|\+)?\s?(\d+(?:\.\d+)?) ?درصد/.exec(before);
          if (!mm) continue;
          var v = +mm[2], ctx = (before + ' ' + after);
          if (mm[1] === '-' || has(' ' + ctx + ' ', NEG)) v = -v;
          d[pair[0]] = v;
        }
      });
    });
    return d;
  }

  /** «منطقه تهران»، «کانال صادرات»: واژه پس از نام بُعد اگر بخشی از نام اعضای آن بُعد باشد فیلتر می‌شود */
  var SKIP = { 'ها': 1, 'های': 1, 'هایی': 1, 'ی': 1 };
  function looseFilters(n, ents) {
    var out = [];
    ['region', 'channel', 'customer', 'family', 'product'].forEach(function (d) {
      if (ents.some(function (e) { return e.type === d; }) || out.some(function (o) { return o.dim === d; })) return;
      W.dim[d].forEach(function (w) {
        if (out.some(function (o) { return o.dim === d; })) return;
        var i = n.indexOf(' ' + w);
        if (i < 0) return;
        var rest = n.slice(i + 1 + w.length).trim().split(' ').filter(function (t) { return !SKIP[t]; });
        var word = rest[0];
        if (!word || word.length < 3) return;
        if (ents.some(function (e) { return e.n.indexOf(word) >= 0; })) return;
        var match = entities().filter(function (e) { return e.type === d && e.tokens.some(function (t) { return t === word || (word.length >= 4 && t.indexOf(word) === 0); }); });
        if (match.length) out.push({ dim: d, value: word, count: match.length, entity: match[0] });
      });
    });
    return out;
  }

  /** فهم پرسش: خروجی ساختاریافته برای انتخاب ابزار */
  function understand(q) {
    var n = numerals(norm(q)), ents = findEntities(n);
    var curCo = IBP.holding && IBP.holding.state().current;
    var companies = ents.filter(function (e) { return e.type === 'company'; }), others = companies.filter(function (e) { return !curCo || e.id !== curCo.code; });
    ents = ents.filter(function (e) { return e.type !== 'company'; });
    var P = { q: q, n: n, entities: ents, entity: ents[0] || null, metric: detectMetric(n), dims: detectDims(n, ents), months: detectMonths(n), top: detectTop(n), asc: has(n, W.asc), drivers: detectDrivers(n) };
    P.loose = looseFilters(n, ents);
    P.loose.forEach(function (l) { if (l.count === 1 && !P.entity) { P.entity = l.entity; P.entities = [l.entity]; } });
    P.loose = P.loose.filter(function (l) { return l.count > 1; });
    P.dims = P.dims.filter(function (d) { return !P.loose.some(function (l) { return l.dim === d; }) && !(P.entity && DIMOF[P.entity.type] === d && P.dims.length > 1); });
    P.saysDown = has(n, NEG); P.saysUp = has(n, kw(['افزایش', 'رشد', 'بالا رفت', 'زیاد شد']));
    var score = {
      holding: hits(n, W.holding) * 2 + others.length * 2,
      explain: hits(n, W.explain) * 3,
      accuracy: hits(n, W.accuracy) * 3,
      supply: hits(n, W.supply), inventory: hits(n, W.inventory), alerts: hits(n, W.alerts) * 1.5,
      trend: hits(n, W.trend), query: hits(n, W.query) * 1.5 + P.dims.filter(function (d) { return d !== 'month'; }).length,
      overview: hits(n, W.overview), insights: hits(n, W.insights) * 1.5
    };
    var nDrivers = Object.keys(P.drivers).length;
    if (nDrivers && (has(n, W.scenarioCue) || Object.keys(P.drivers).some(function (k) { return k !== 'demand'; }))) P.intent = 'scenario';
    else if (has(n, kw(['سناریو', 'شبیه سازی', 'چه میشود اگر', 'چه می شود اگر']))) P.intent = 'scenario';
    else if (score.holding >= 2) P.intent = 'holding';
    else if (score.explain) P.intent = 'explain';
    else if (score.accuracy) P.intent = 'accuracy';
    else if (score.query && has(n, kw(['رشد', 'افت', 'کاهش', 'افزایش', 'تغییر'])) && !has(n, W.trend.slice(0, 2))) { P.intent = 'explain'; P.growthRank = true; }
    else if ((has(n, W.production) || has(n, W.shortage) || has(n, kw(['موجودی پایان', 'موجودی ماهانه']))) && P.dims.length) P.intent = 'planQuery';
    else {
      var best = null;
      ['supply', 'inventory', 'alerts', 'query', 'trend', 'insights', 'overview'].forEach(function (k) { if (score[k] > 0 && (!best || score[k] > score[best])) best = k; });
      if ((best === 'supply' || best === 'inventory') && P.dims.length && score.query) best = 'planQuery';
      if (best === 'overview' && score.insights) best = 'insights';
      if (!best && P.entity) best = 'entity';
      if (!best && P.dims.length) best = P.dims.length === 1 && P.dims[0] === 'month' ? 'trend' : 'query';
      if (!best && has(n, kw(['سلام', 'درود', 'وقت بخیر', 'خسته نباشی', 'روز بخیر']))) best = 'greet';
      P.intent = best || 'unknown';
    }
    P.lastYear = has(n, W.lastYear);
    return P;
  }

  function planFor(P) {
    var ent = P.entity, et = ent ? ent.type : 'all', en = ent ? ent.name : '';
    var measure = P.metric === 'margin' ? 'gross' : P.metric;
    var next = { family: 'product', product: 'customer', customer: 'product', channel: 'customer', region: 'customer' };
    var filters = (ent ? [{ dim: DIMOF[ent.type], value: ent.name }] : []).concat((P.loose || []).map(function (l) { return { dim: l.dim, value: l.value }; }));
    switch (P.intent) {
      case 'scenario':
        var d = P.drivers;
        return [['run_scenario', { demand: d.demand || 0, price: d.price || 0, material: d.material || 0, fx: d.fx || 0, conversion: d.conversion || 0, capacity: d.capacity || 0 }]];
      case 'holding': return [['holding_overview', {}]];
      case 'explain':
        var dim = P.dims.filter(function (x) { return DIMOF[x]; })[0] || (ent ? next[ent.type] : 'family');
        var months = P.months || (P.growthRank ? 12 : 3);
        return [['explain_change', { measure: measure, period: months === 1 ? 'last_month' : months >= 12 ? 'last_12_months' : 'last_3_months', compare_to: P.lastYear || P.growthRank ? 'last_year' : 'previous', by: dim, entity_type: et, entity_name: en }]];
      case 'accuracy': return [['forecast_accuracy', { months: P.months && P.months <= 12 ? P.months : 6, by: P.dims.indexOf('family') >= 0 ? 'family' : 'product' }]];
      case 'supply': return [['supply_status', {}]];
      case 'inventory': return [['inventory_status', {}]];
      case 'alerts': return [['get_alerts', {}]];
      case 'planQuery':
        var pm = has(P.n, W.shortage) ? 'shortage' : has(P.n, W.inventory) ? 'inventory' : 'production';
        var pd = P.dims.filter(function (x) { return ['month', 'family', 'product', 'abc'].indexOf(x) >= 0; });
        return [['query_data', { dataset: 'plan', rows: pd[0] || 'product', columns: pd[1] || '', measure: pm, filters: filters.filter(function (f) { return f.dim === 'family' || f.dim === 'product'; }), top: P.top || 15, order: P.asc ? 'asc' : 'desc', last_months: P.months && P.months <= 12 ? P.months : 0 }]];
      case 'query':
        var ds = has(P.n, W.actions) ? 'actions' : has(P.n, W.forecastDs) && !has(P.n, kw(['فروش واقعی'])) ? 'forecast' : (P.metric === 'gross' || P.metric === 'margin') && has(P.n, W.plan) ? 'profit' : 'sales';
        var dims = P.dims.filter(function (x) { return IBP.reports.DATASETS[ds].dims.indexOf(x) >= 0; });
        var rows = dims[0] || (ent ? next[ent.type] : ds === 'actions' ? 'area' : 'family');
        if (IBP.reports.DATASETS[ds].dims.indexOf(rows) < 0) rows = IBP.reports.DATASETS[ds].dims[ds === 'sales' ? 2 : 0];
        var ms = IBP.reports.DATASETS[ds].measures[P.metric] ? P.metric : ds === 'actions' ? 'count' : ds === 'forecast' && P.metric === 'revenue' && !has(P.n, W.revenue) ? 'tons' : Object.keys(IBP.reports.DATASETS[ds].measures)[0];
        return [['query_data', { dataset: ds, rows: rows, columns: dims[1] || '', measure: ms, filters: filters.filter(function (f) { return IBP.reports.DATASETS[ds].dims.indexOf(f.dim) >= 0; }), top: P.top || (rows === 'month' ? 24 : 10), order: P.asc ? 'asc' : 'desc', last_months: ds === 'sales' ? (P.months || 12) : (P.months || 0) }]];
      case 'trend': return [['trend_analysis', { measure: measure, entity_type: et, entity_name: en }]];
      case 'entity':
        return [['trend_analysis', { measure: measure, entity_type: et, entity_name: en }], ['query_data', { dataset: 'sales', rows: next[et] || 'product', columns: '', measure: P.metric, filters: filters, top: 10, order: 'desc', last_months: 12 }]];
      case 'insights': return [['quick_insights', {}], ['company_overview', {}]];
      case 'greet': return [['quick_insights', {}]];
      case 'overview': return [['company_overview', {}], ['quick_insights', {}]];
      default: return [['company_overview', {}], ['quick_insights', {}]];
    }
  }

  /* ---------------- روایت ---------------- */
  function narrate(name, input, res, P) {
    var d = res.data, L = [], R = [];
    if (res.error) return { lines: ['⚠️ ' + res.error], recs: [] };
    switch (name) {
      case 'company_overview':
        var a = d.actualLast12;
        L.push('**' + (d.company || 'شرکت') + '** — آخرین ماه واقعی: ' + d.lastActualMonth + '.');
        L.push('- فروش ۱۲ ماه اخیر **' + F.money(a.revenue) + '** (' + F.signedPct(a.revenueGrowthVsPrev12) + ' نسبت به ۱۲ ماه قبل) و **' + F.num(a.tons) + ' تن** (' + F.signedPct(a.tonsGrowthVsPrev12) + ')؛ حاشیه ناخالص واقعی ' + F.pct(a.grossMargin, 1) + '.');
        if (d.topFamily) L.push('- بزرگ‌ترین خانواده: «' + d.topFamily.name + '» با ' + F.pct(d.topFamily.share, 0) + ' فروش.');
        if (d.plan12) L.push('- برنامه ۱۲ ماه آینده: درآمد ' + F.money(d.plan12.revenue) + '، سود ناخالص ' + F.money(d.plan12.grossProfit) + ' (حاشیه ' + F.pct(d.plan12.grossMargin, 1) + ')، نرخ پاسخ‌گویی ' + F.pct(d.plan12.fillRate, 1) + (d.plan12.gapToBudget !== null ? '، ' + F.signedPct(d.plan12.gapToBudget) + ' نسبت به بودجه' : '') + '.');
        L.push('- دقت پیش‌بینی ۳ ماه اخیر ' + F.pct(d.forecastAccuracy3m, 1) + ' با سوگیری ' + F.signedPct(d.forecastBias3m) + '؛ ' + F.num(d.alerts.critical) + ' هشدار بحرانی و ' + F.num(d.alerts.warning) + ' هشدار دیگر.');
        if (a.revenueGrowthVsPrev12 - a.tonsGrowthVsPrev12 > 0.05) R.push('رشد فروش بیشتر قیمتی است تا حجمی؛ برنامه افزایش حجم (کانال‌ها و مشتریان جدید) را در جلسه S&OP مطرح کنید.');
        if (d.plan12 && d.plan12.fillRate < 0.96) R.push('نرخ پاسخ‌گویی برنامه پایین است؛ گلوگاه‌های ظرفیت و کمبودها را در «تأمین» بررسی کنید.');
        if (d.plan12 && d.plan12.gapToBudget !== null && d.plan12.gapToBudget < -0.03) R.push('برنامه از بودجه عقب است؛ سناریوهای جبران (قیمت، ترکیب، ظرفیت) را بسنجید.');
        if (Math.abs(d.forecastBias3m || 0) > 0.08) R.push('سوگیری پیش‌بینی بالاست؛ تعدیل‌های اجماعی چرخه جاری را بازبینی کنید.');
        break;
      case 'quick_insights':
        if (!d.insights.length) { L.push('بینش برجسته‌ای در داده‌ها پیدا نشد.'); break; }
        L.push('**مهم‌ترین یافته‌ها:**');
        d.insights.slice(0, 6).forEach(function (i) { L.push('- ' + ({ good: '🟢', bad: '🔴', warn: '🟠', info: '🔵' }[i.level] || '•') + ' **' + i.title + '** — ' + i.text); });
        break;
      case 'query_data':
        if (!d.rows.length) { L.push('برای این پرسش رکوردی پیدا نشد.' + (d.notes.length ? ' ' + d.notes.join(' ') : '')); break; }
        var t = d.unit === 'rial' ? 'money' : d.unit === 'ton' ? 'num' : d.unit === 'ratio' ? 'pct' : 'int';
        var dl = IBP.reports.DIM_LABEL[d.rowsDim] || d.rowsDim, first = d.rows[0];
        if (!d.total && t !== 'pct') { L.push(d.measure + ' برای همه موارد صفر است' + (input.dataset === 'plan' && input.measure === 'shortage' ? '؛ برنامه فعلی کمبودی ندارد.' : '.')); break; }
        var ctxTxt = (d.filters.length ? ' در ' + d.filters.map(function (f) { return (f.dim === 'version' ? 'نسخه ' : '') + '«' + f.value + '»'; }).join('، ') : '') + (d.lastMonths ? (input.dataset === 'sales' ? ' طی ' + F.num(d.lastMonths) + ' ماه اخیر' : ' در ' + F.num(d.lastMonths) + ' ماه آینده') : '');
        if (d.rowsDim === 'month') {
          var vals = d.rows.map(function (r) { return r.value || 0; }), mx = d.rows.reduce(function (a, b) { return (b.value || 0) > (a.value || 0) ? b : a; }), mn = d.rows.reduce(function (a, b) { return (b.value || 0) < (a.value || 0) ? b : a; });
          L.push(d.measure + ' ماهانه' + ctxTxt + ': جمع **' + fv(d.total, t) + '**، بیشترین در ' + mx.name + ' (' + fv(mx.value, t) + ') و کمترین در ' + mn.name + ' (' + fv(mn.value, t) + ')؛ میانگین ' + fv(sum(vals) / (vals.length || 1), t) + '.');
        } else {
          L.push((input.order === 'asc' ? 'کمترین ' : 'بیشترین ') + d.measure + ctxTxt + ' به تفکیک ' + dl + ': **«' + first.name + '»** با ' + fv(first.value, t) + (first.share !== null ? ' (' + F.pct(first.share, 1) + ' از کل)' : '') + '.');
          var topL = d.rows.slice(0, Math.min(5, d.rows.length));
          L.push(topL.map(function (r, i) { return (i + 1) + '. ' + r.name + ' — ' + fv(r.value, t) + (r.share !== null ? ' · ' + F.pct(r.share, 1) : ''); }).join('\n'));
          if (t !== 'pct' && d.rows.length >= 3 && input.order !== 'asc') {
            var s3 = sum(d.rows.slice(0, 3).map(function (r) { return r.share || 0; }));
            L.push('سه ' + dl + ' اول ' + F.pct(s3, 0) + ' از کل (' + fv(d.total, t) + ') را می‌سازند' + (s3 > 0.6 ? '؛ تمرکز بالاست.' : '.'));
            if (s3 > 0.6 && (d.rowsDim === 'customer')) R.push('وابستگی به چند مشتری بزرگ زیاد است؛ برنامه توسعه مشتریان میانی و پایش اعتباری را دنبال کنید.');
          }
        }
        if (d.notes.length) L.push('_' + d.notes.join(' ') + '_');
        if (d.columnsDim) L.push('جزئیات به تفکیک ' + (IBP.reports.DIM_LABEL[d.columnsDim] || d.columnsDim) + ' در نمودار و جدول آمده است.');
        break;
      case 'trend_analysis':
        var tt = mtype(input.measure);
        var who = typeof d.entity === 'string' ? d.entity : d.entity.type + ' «' + d.entity.name + '»';
        L.push('روند ' + d.measure + ' — ' + who + ':');
        L.push('- ۱۲ ماه اخیر **' + fv(d.last12, tt) + '**، ' + F.signedPct(d.growth12) + ' نسبت به ۱۲ ماه قبل؛ ۳ ماه اخیر ' + F.signedPct(d.growth3VsLastYear) + ' نسبت به همین ماه‌ها در پارسال' + (d.growth3VsLastYear !== null && d.growth12 !== null && (d.growth3VsLastYear - d.growth12) * (d.growth12 >= 0 ? 1 : -1) < -0.05 ? ' (شتاب کم شده است)' : d.growth3VsLastYear - d.growth12 > 0.05 ? ' (شتاب گرفته است)' : '') + '.');
        if (d.trendSlopePerMonth !== null) L.push('- شیب روند ۱۲ ماه: ' + F.signedPct(d.trendSlopePerMonth) + ' در ماه ' + (Math.abs(d.trendSlopePerMonth) < 0.005 ? '(تقریباً ثابت).' : d.trendSlopePerMonth > 0 ? '(صعودی).' : '(نزولی).'));
        if (d.seasonality.peak.length) L.push('- فصلی بودن: اوج در ' + d.seasonality.peak.map(function (s) { return s.month + ' (' + F.num(s.index, 2) + ')'; }).join(' و ') + '، کف در ' + d.seasonality.trough.map(function (s) { return s.month + ' (' + F.num(s.index, 2) + ')'; }).join(' و ') + '.');
        if (d.unusualMonths.length) L.push('- ماه‌های غیرعادی: ' + d.unusualMonths.map(function (u) { return u.month + ' (' + F.signedPct(u.deviation) + ' نسبت به ماه‌های مجاور)'; }).join('، ') + '.');
        if (d.outlook) L.push('- پیش‌بینی اجماعی ۶ ماه آینده **' + fv(sum(d.outlook.values), tt) + '**، ' + F.signedPct(d.outlook.vsSameMonthsLastYear) + ' نسبت به همین ماه‌ها در پارسال.');
        if (d.growth12 !== null && d.growth12 < 0) R.push('افت ' + who + ' را با «چرا» ریشه‌یابی کنید (تفکیک حجم/قیمت و مشتریان).');
        if (d.outlook && d.growth3VsLastYear !== null && d.outlook.vsSameMonthsLastYear - d.growth3VsLastYear > 0.1) R.push('پیش‌بینی آینده خوش‌بینانه‌تر از روند اخیر است؛ مفروضات اجماعی را بازبینی کنید.');
        if (d.outlook && d.growth3VsLastYear !== null && d.growth3VsLastYear - d.outlook.vsSameMonthsLastYear > 0.1) R.push('پیش‌بینی آینده محافظه‌کارانه‌تر از روند اخیر است؛ ریسک کمبود را بسنجید.');
        if (d.unusualMonths.length) R.push('ماه‌های غیرعادی را با تقویم رویدادها (رمضان، محرم، کمپین‌ها) تطبیق دهید و در صورت نیاز داده را پاک‌سازی کنید.');
        break;
      case 'explain_change':
        var et2 = mtype(input.measure);
        if (P && P.growthRank && P.saysDown && d.weakest.length) L.push('**' + (d.weakest[0].changePct < 0 ? 'بیشترین افت' : 'هیچ ' + d.by + 'ی افت نداشته؛ کمترین رشد') + ' (' + d.by + '):** ' + d.weakest.map(function (x) { return '«' + x.name + '» ' + F.signedPct(x.changePct) + ' (' + fv(x.change, et2) + ')'; }).join('، ') + '.');
        if (P && !P.growthRank && P.saysDown && !P.saysUp && d.change > 0) L.push('برخلاف فرض پرسش، ' + d.measure + ' کاهش نیافته و **افزایش** داشته است.');
        if (P && !P.growthRank && P.saysUp && !P.saysDown && d.change < 0) L.push('برخلاف فرض پرسش، ' + d.measure + ' افزایش نیافته و **کاهش** داشته است.');
        L.push(d.measure + (typeof d.entity === 'string' ? '' : ' ' + d.entity.type + ' «' + d.entity.name + '»') + ' در ' + d.currentPeriod + ' به **' + fv(d.current, et2) + '** رسید؛ ' + F.signedPct(d.changePct) + ' (' + fv(d.change, et2) + ') نسبت به ' + d.basePeriod + '.');
        if (d.priceEffect !== null) {
          var pv = Math.abs(d.priceEffect) > Math.abs(d.volumeEffect) ? 'قیمت' : 'حجم';
          L.push('- **اثر قیمت** ' + F.money(d.priceEffect) + ' و **اثر حجم** ' + F.money(d.volumeEffect) + '؛ عامل اصلی تغییر «' + pv + '» است.');
          if (d.priceEffect > 0 && d.volumeEffect < 0) R.push('افزایش قیمت با کاهش حجم همراه شده؛ کشش قیمتی را بررسی و از دست رفتن سهم بازار را پایش کنید.');
        }
        var ups = d.topDrivers.filter(function (x) { return x.change > 0; }).slice(0, 3), dns = d.topDrivers.filter(function (x) { return x.change < 0; }).slice(0, 3);
        if (ups.length) L.push('- بیشترین افزایش (' + d.by + '): ' + ups.map(function (x) { return '«' + x.name + '» ' + fv(x.change, et2) + (x.changePct !== null ? ' (' + F.signedPct(x.changePct) + ')' : ' (جدید)'); }).join('، ') + '.');
        if (dns.length) L.push('- بیشترین کاهش: ' + dns.map(function (x) { return '«' + x.name + '» ' + fv(x.change, et2) + (x.changePct !== null ? ' (' + F.signedPct(x.changePct) + ')' : ''); }).join('، ') + '.');
        L.push('- ' + F.num(d.increasing) + ' ' + d.by + ' رشد و ' + F.num(d.decreasing) + ' مورد کاهش داشته‌اند.');
        if (dns.length) R.push('برای «' + dns[0].name + '» با تیم فروش علت (کمبود کالا، رقبا، قیمت یا قطع مشتری) را مشخص و اقدام اصلاحی ثبت کنید.');
        if (ups.length) R.push('عوامل رشد «' + ups[0].name + '» را در پیش‌بینی ماه‌های آینده لحاظ کنید تا کمبود رخ ندهد.');
        break;
      case 'forecast_accuracy':
        L.push('دقت پیش‌بینی اجماعی (lag-1) در ' + d.period + ': **' + F.pct(d.accuracy, 1) + '** با سوگیری ' + F.signedPct(d.bias) + (d.bias > 0.03 ? ' (بیش‌برآورد).' : d.bias < -0.03 ? ' (کم‌برآورد).' : ' (متعادل).'));
        if (d.worst.length) L.push('- بیشترین سهم از خطا: ' + d.worst.slice(0, 4).map(function (x) { return '«' + x.name + '» (' + F.pct(x.shareOfTotalError, 0) + ' خطا، دقت ' + F.pct(x.accuracy, 0) + '، سوگیری ' + F.signedPct(x.bias) + ')'; }).join('، ') + '.');
        var bm = d.byMonth.filter(function (b) { return b.accuracy !== null; });
        if (bm.length > 1) L.push('- روند: دقت از ' + F.pct(bm[0].accuracy, 0) + ' در ' + bm[0].month + ' به ' + F.pct(bm[bm.length - 1].accuracy, 0) + ' در ' + bm[bm.length - 1].month + ' رسیده است.');
        if (d.worst[0]) R.push('روش آماری و تعدیل‌های «' + d.worst[0].name + '» را در صفحه «تقاضا» (پیش‌بینی آماری و بک‌تست) بازبینی کنید.');
        if (Math.abs(d.bias) > 0.05) R.push(d.bias > 0 ? 'بیش‌برآورد مداوم موجودی اضافه می‌سازد؛ تعدیل‌های فروش را با شواهد مستند کنید.' : 'کم‌برآورد مداوم ریسک کمبود دارد؛ ذخیره اطمینان یا پیش‌بینی را اصلاح کنید.');
        break;
      case 'supply_status':
        L.push('برنامه تأمین ' + d.horizon + ' (' + (d.engine === 'local' ? 'برنامه‌ریز ابتکاری' : 'بهینه‌ساز LP') + '): نرخ پاسخ‌گویی **' + F.pct(d.fillRate, 1) + '**، فروش ازدست‌رفته ' + F.money(d.shortageValue) + '، میانگین بهره‌برداری ' + F.pct(d.avgUtilisation, 0) + '.');
        var ov = d.resources.filter(function (r) { return r.overloadMonths > 0; });
        if (ov.length) L.push('- گلوگاه‌ها: ' + ov.slice(0, 3).map(function (r) { return '«' + r.name + '» اوج ' + F.pct(r.peakUtil, 0) + ' در ' + F.num(r.overloadMonths) + ' ماه'; }).join('، ') + '.');
        else L.push('- هیچ خطی بالای ظرفیت نیست؛ پرکارترین «' + (d.resources[0] || {}).name + '» با اوج ' + F.pct((d.resources[0] || {}).peakUtil, 0) + '.');
        L.push('- اضافه‌کار ' + F.num(d.overtimeHours) + ' ساعت، پیش‌تولید ' + F.num(d.prebuildTons, 1) + ' تن، ' + F.num(d.productsBelowSafetyStock) + ' محصول زیر ذخیره اطمینان.');
        if (d.shortages.length) L.push('- بیشترین کمبود: ' + d.shortages.slice(0, 3).map(function (x) { return '«' + x.name + '» (' + F.money(x.shortageValue) + ')'; }).join('، ') + '.');
        if (ov.length) R.push('برای «' + ov[0].name + '» اضافه‌کار، شیفت اضافه یا مسیر جایگزین را بسنجید؛ بهینه‌سازی LP صفحه «تأمین» را اجرا کنید.');
        if (d.shortages.length) R.push('کمبود «' + d.shortages[0].name + '» را با پیش‌تولید در ماه‌های کم‌بار یا اولویت تخصیص جبران کنید.');
        if (d.avgUtilisation < 0.6) R.push('بهره‌برداری پایین است؛ تولید قراردادی برای دیگران یا تجمیع شیفت‌ها را بررسی کنید.');
        break;
      case 'inventory_status':
        L.push('ارزش موجودی محصول **' + F.money(d.finishedGoodsValue) + '** و مواد ' + F.money(d.materialsValue) + '.');
        L.push('- ' + F.num(d.critical) + ' محصول در خطر کمبود، ' + F.num(d.warning) + ' محصول نزدیک ذخیره اطمینان و ' + F.num(d.excess) + ' محصول با موجودی مازاد (' + F.money(d.excessValue) + ').');
        if (d.atRisk.length) L.push('- فوری‌ترین: ' + d.atRisk.slice(0, 3).map(function (x) { return '«' + x.name + '» ' + F.num(x.monthsOfCover, 1) + ' ماه پوشش'; }).join('، ') + '.');
        if (d.largestExcess.length) L.push('- بیشترین مازاد: ' + d.largestExcess.slice(0, 3).map(function (x) { return '«' + x.name + '» ' + F.money(x.value); }).join('، ') + '.');
        if (d.atRisk.length) R.push('برای محصولات در خطر کمبود، سفارش تولید فوری یا جابه‌جایی موجودی بین انبارها را در جلسه تأمین تصویب کنید.');
        if (d.excess) R.push('برای موجودی مازاد، کاهش تولید ماه‌های آینده و طرح فروش ویژه را با بازاریابی هماهنگ کنید.');
        break;
      case 'run_scenario':
        var g = function (k) { return d.results.filter(function (r) { return r.metric === k; })[0]; };
        if (!d.applied.length) { L.push('هیچ محرکی تغییر نکرده است؛ نتیجه با برنامه پایه یکسان است. مثال: «اگر قیمت مواد ۲۰ درصد و نرخ ارز ۳۰ درصد افزایش یابد؟»'); break; }
        var gr2 = g('gross'), rv = g('revenue'), fr = g('fillRate'), op = g('operating');
        L.push('سناریو **' + d.applied.join('، ') + '** روی برنامه ۱۲ ماه:');
        L.push('- درآمد ' + F.money(rv.scenario) + ' (' + F.signedPct(rv.changePct) + ')؛ سود ناخالص ' + F.money(gr2.scenario) + ' (' + F.signedPct(gr2.changePct) + '، ' + F.money(gr2.change) + ')؛ سود عملیاتی ' + F.money(op.scenario) + ' (' + F.signedPct(op.changePct) + ').');
        L.push('- حاشیه ناخالص از ' + F.pct(g('gm').base, 1) + ' به ' + F.pct(g('gm').scenario, 1) + '؛ نرخ پاسخ‌گویی ' + F.pct(fr.scenario, 1) + ' و فروش ازدست‌رفته ' + F.money(g('lost').scenario) + '.');
        if (gr2.change < 0 && d.drivers.price === undefined) {
          var need = rv.scenario ? -gr2.change / rv.scenario : null;
          if (need) R.push('برای جبران کامل کاهش سود ناخالص، حدود ' + F.pct(need, 1) + ' افزایش قیمت فروش لازم است (با فرض ثابت ماندن تقاضا).');
        }
        if (fr.change < -0.01) R.push('کاهش نرخ پاسخ‌گویی نشان می‌دهد ظرفیت محدودکننده است؛ سناریو را با افزایش ظرفیت ترکیب کنید.');
        R.push('سناریو را در صفحه «سناریوها» ذخیره و با شبیه‌سازی مونت‌کارلو ریسک آن را بسنجید.');
        break;
      case 'get_alerts':
        L.push(F.num(d.total) + ' هشدار فعال، ' + F.num(d.critical) + ' مورد بحرانی.');
        d.items.slice(0, 6).forEach(function (a) { L.push('- ' + (a.level === 'critical' ? '🔴' : '🟠') + ' ' + a.text + ' — ' + a.detail); });
        if (d.critical) R.push('هشدارهای بحرانی را در دستور جلسه بازنگری مدیریت (MBR) قرار دهید و برای هر کدام مسئول و موعد تعیین کنید.');
        break;
      case 'holding_overview':
        if (!d.companies.length) { L.push('خلاصه شرکت‌ها هنوز تهیه نشده است؛ در «نمای هلدینگ» دکمه به‌روزرسانی را بزنید.'); break; }
        L.push(d.holding + ': فروش ۱۲ ماه اخیر ' + F.num(d.companies.length) + ' شرکت **' + F.money(d.totalRevenueLast12) + '** (برون‌گروهی ' + F.money(d.totalExternalRevenueLast12) + ').');
        d.companies.forEach(function (c) { L.push('- **' + c.name + '** (' + c.model + '): فروش ' + F.money(c.revenueLast12) + ' (' + F.signedPct(c.growth) + ')، حاشیه برنامه ' + F.pct(c.grossMargin, 1) + '، پاسخ‌گویی ' + F.pct(c.fillRate, 0) + '، دقت ' + F.pct(c.forecastAccuracy, 0) + (c.criticalAlerts ? '، ' + F.num(c.criticalAlerts) + ' هشدار بحرانی' : '') + '.'); });
        var lowFill = d.companies.filter(function (c) { return c.fillRate !== null && c.fillRate < 0.95; });
        if (lowFill.length) R.push('پاسخ‌گویی ' + lowFill.map(function (c) { return c.name; }).join('، ') + ' پایین است؛ جریان‌های درون‌گروهی و ظرفیت آن‌ها را بررسی کنید.');
        if (d.missing) L.push('_' + F.num(d.missing) + ' شرکت هنوز خلاصه ندارند._');
        break;
    }
    return { lines: L, recs: R };
  }

  function followups(P, plan) {
    var e = P.entity, nm = e ? e.name : null, out = [];
    var tool = plan[0] && plan[0][0];
    if (e) { out.push('چرا فروش ' + nm + ' در ۳ ماه اخیر تغییر کرد؟'); out.push('روند و فصلی بودن ' + nm); }
    if (tool !== 'explain_change' && !e) out.push('چرا فروش ۳ ماه اخیر نسبت به سال قبل تغییر کرد؟');
    if (tool !== 'run_scenario') out.push('اگر قیمت مواد اولیه ۲۰ درصد افزایش یابد سود چقدر تغییر می‌کند؟');
    if (tool !== 'supply_status') out.push('گلوگاه‌های ظرفیت و کمبودهای برنامه تولید');
    if (tool !== 'forecast_accuracy') out.push('دقت پیش‌بینی و محصولات با بیشترین خطا');
    if (tool !== 'query_data') out.push('۱۰ محصول پرفروش ۱۲ ماه اخیر');
    return out.filter(function (x, i) { return out.indexOf(x) === i; }).slice(0, 4);
  }

  /** پاسخ مدل داخلی */
  function local(q) {
    var t0 = Date.now(), P = understand(q), plan = planFor(P), steps = [], views = [], lines = [], recs = [];
    if (P.intent === 'greet') lines.push('سلام! من دستیار تحلیل «' + (S.settings().companyName || '') + '» هستم. درباره فروش، سود، روند، علت تغییرات، دقت پیش‌بینی، ظرفیت، موجودی یا سناریوهای «اگر…» بپرسید. مهم‌ترین نکات امروز:');
    if (P.intent === 'unknown') lines.push('پرسش را دقیق نشناختم؛ نمای کلی و مهم‌ترین بینش‌های شرکت را آورده‌ام. می‌توانید درباره فروش، سود، روند، علت تغییر، دقت پیش‌بینی، ظرفیت، موجودی یا سناریوی «اگر…» بپرسید.');
    plan.forEach(function (st) {
      var res = execute(st[0], st[1]);
      steps.push({ tool: st[0], label: TOOL_LABEL[st[0]], input: st[1], error: res.error || null });
      var nr = narrate(st[0], st[1], res, P);
      if (lines.length && nr.lines.length) lines.push('');
      lines = lines.concat(nr.lines); recs = recs.concat(nr.recs);
      if (res.views) views = views.concat(res.views);
    });
    recs = recs.filter(function (r, i) { return recs.indexOf(r) === i; }).slice(0, 4);
    if (recs.length) { lines.push(''); lines.push('**پیشنهاد اقدام:**'); recs.forEach(function (r) { lines.push('- ' + r); }); }
    return { mode: 'local', text: lines.join('\n'), views: views, steps: steps, followups: followups(P, plan), understood: { intent: P.intent, metric: P.metric, dims: P.dims, months: P.months, entity: P.entity ? { type: TYPE_LABEL[P.entity.type], name: P.entity.name } : null, drivers: P.drivers }, ms: Date.now() - t0 };
  }

  /* =====================================================================
   * Claude (از طریق موتور): حلقه ابزار در برنامه، تاریخچه فقط افزوده می‌شود
   * ===================================================================== */
  var MAX_STEPS = 8;
  function claudeContext() {
    var st = S.settings(), h = IBP.holding && IBP.holding.state();
    return { holding: (h && h.holding && h.holding.name) || 'هلدینگ گروه زر', company: st.companyName, code: h && h.current ? h.current.code : '', businessModel: st.businessModel, cycle: J.label(cyc()), unit: F.moneyUnit(),
      notes: 'Families: ' + S.all('families').map(function (f) { return f.name; }).join(', ') + '. Channels: ' + S.all('channels').map(function (c) { return c.name; }).join(', ') + '. Regions: ' + S.all('regions').map(function (r) { return r.name; }).join(', ') + '. Products: ' + S.count('products') + ', customers: ' + S.count('customers') + '.' };
  }
  /**
   * یک نوبت گفتگو با Claude. history: آرایه پیام‌های Messages API (درجا افزوده می‌شود).
   * onStep(step) برای نمایش پیشرفت هر فراخوانی ابزار.
   */
  function claude(history, question, opts) {
    opts = opts || {};
    var views = [], steps = [], usage = { input_tokens: 0, output_tokens: 0 }, fallback = false, start = history.length;
    history.push({ role: 'user', content: question });
    var turn = function (i) {
      if (i >= MAX_STEPS) return Promise.resolve({ stop: 'max_steps' });
      return IBP.engine.call('/agent/chat', { messages: history, tools: TOOLS, context: claudeContext(), effort: opts.effort || 'medium' }, { timeout: 180000 }).then(function (r) {
        if (r.error) { var err = new Error(r.error.message || 'خطای Claude'); err.kind = r.error.type; throw err; }
        if (r.usage) { usage.input_tokens += r.usage.input_tokens || 0; usage.output_tokens += r.usage.output_tokens || 0; }
        if (r.fallback) fallback = true;
        if (r.stop_reason === 'refusal') return { stop: 'refusal', details: r.stop_details };
        history.push({ role: 'assistant', content: r.content });
        if (r.stop_reason === 'tool_use') {
          var results = r.content.filter(function (b) { return b.type === 'tool_use'; }).map(function (b) {
            var res = execute(b.name, b.input);
            var st = { tool: b.name, label: TOOL_LABEL[b.name] || b.name, input: b.input, error: res.error || null };
            steps.push(st); if (opts.onStep) opts.onStep(st);
            if (res.views) views = views.concat(res.views);
            var body = res.error ? res.error : JSON.stringify(compact(res.data));
            if (body.length > 24000) body = body.slice(0, 24000) + '…(truncated)';
            return { type: 'tool_result', tool_use_id: b.id, content: body, is_error: !!res.error };
          });
          history.push({ role: 'user', content: results });
          return turn(i + 1);
        }
        if (r.stop_reason === 'pause_turn') return turn(i + 1);
        return { stop: r.stop_reason, model: r.model };
      });
    };
    return turn(0).then(function (end) {
      var last = history[history.length - 1], text = '';
      if (end.stop === 'refusal') {
        text = 'Claude به این پرسش پاسخ نداد' + (end.details && end.details.explanation ? ' (' + end.details.explanation + ')' : '') + '. پرسش را به شکل دیگری مطرح کنید یا از مدل داخلی استفاده کنید.';
        // پرسش ردشده از تاریخچه حذف می‌شود تا گفتگو ادامه‌پذیر بماند
        history.length = start;
      } else if (last && last.role === 'assistant') {
        text = (last.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n\n');
        if (end.stop === 'max_tokens') text += '\n\n_(پاسخ به‌دلیل طول زیاد ناتمام ماند.)_';
      }
      if (end.stop === 'max_steps') text = (text ? text + '\n\n' : '') + '_(تعداد مراحل تحلیل به سقف رسید.)_';
      return { mode: 'claude', text: text || '—', views: views, steps: steps, usage: usage, fallback: fallback, refused: end.stop === 'refusal', model: end.model };
    }, function (e) { history.length = start; throw e; });
  }
  function claudeAvailable() {
    var st = IBP.engine && IBP.engine.state();
    return !!(st && st.status === 'online' && st.info && st.info.agent && st.info.agent.claude);
  }
  function claudeStatus() {
    var st = IBP.engine && IBP.engine.state();
    if (!st || st.status !== 'online') return { ok: false, reason: 'engine', text: 'موتور تحلیل روشن نیست' };
    var a = st.info && st.info.agent;
    if (!a) return { ok: false, reason: 'version', text: 'نسخه موتور قدیمی است' };
    if (!a.claude) return { ok: false, reason: a.reason, text: a.reason === 'sdk' ? 'بسته anthropic روی موتور نصب نیست' : 'کلید ANTHROPIC_API_KEY روی موتور تنظیم نشده' };
    return { ok: true, model: a.model, text: 'آماده' };
  }

  IBP.agent = {
    TOOLS: TOOLS, TOOL_LABEL: TOOL_LABEL, execute: execute, understand: understand, planFor: planFor, local: local, insights: insightList,
    suggest: function (q) { var P = understand(q); return followups(P, planFor(P)); },
    claude: claude, claudeAvailable: claudeAvailable, claudeStatus: claudeStatus, norm: norm, findEntities: findEntities, compact: compact
  };
})(window.IBP = window.IBP || {});
