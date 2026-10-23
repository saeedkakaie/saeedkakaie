/*
 * شرکت‌های تولیدی هلدینگ زر و الگوی داده نمونه هر کدام.
 * هر الگو یک شرکت با منطق خودش است (محصولات، فصلی‌بودن، مناسبت‌ها، کانال‌ها و مواد)؛ کد شرکت همان کد پلنت است.
 *
 * model: B2C (فروش به مصرف‌کننده از راه شعب، زنجیره‌ای و نمایندگان) یا B2B (فروش به مشتریان صنعتی محدود)
 * season: ضریب فصلی ۱۲ ماه شمسی (فروردین تا اسفند)
 * events: اثر واقعی مناسبت‌های قمری بر تقاضای خانواده (برای یک ماه کامل مناسبت)
 * price: بازه قیمت فروش واحد (ریال)، volume: بازه فروش ماهانه هر کالا، kg: وزن هر واحد
 * itemVolume: حجم ماهانه پایه هر کالا (برای کالاهای درون‌گروهی هم‌اندازه نیاز شرکت‌های خریدار)
 * intercompany: خانواده‌ای که فقط به شرکت‌های دیگر هلدینگ فروخته می‌شود؛ خریدار هر کالا از BOM شرکت‌های خریدار تعیین می‌شود
 * materials[].internal: ماده‌ای که از شرکت دیگر هلدینگ تأمین می‌شود { company, product }
 * materials[].ratio: کیلوگرم ماده به ازای هر کیلوگرم محصول؛ perKg: یک واحد بسته‌بندی به ازای این مقدار کیلوگرم
 * bulk: محصول فله (بدون بسته‌بندی)
 *
 * داده‌ها نمونه‌اند و در مرحله کالیبراسیون با داده واقعی هر شرکت جایگزین می‌شوند.
 */
(function (IBP) {
  'use strict';

  var HOLDING = { name: 'هلدینگ گروه زر', short: 'گروه زر' };

  /* مناطق فروش شرکت‌های B2C (شعب پخش) و B2B */
  var BRANCHES = [
    { code: 'B01', name: 'تهران شرق' }, { code: 'B02', name: 'تهران غرب' }, { code: 'B03', name: 'تهران جنوب' },
    { code: 'B04', name: 'البرز' }, { code: 'B05', name: 'خراسان رضوی' }, { code: 'B06', name: 'فارس' },
    { code: 'B07', name: 'گیلان' }, { code: 'B08', name: 'مازندران' }, { code: 'B09', name: 'آذربایجان شرقی' },
    { code: 'B10', name: 'کرمان' }, { code: 'B11', name: 'یزد' }, { code: 'B12', name: 'قم و مرکزی' }
  ];
  var AREAS = [
    { code: 'R1', name: 'تهران و البرز' }, { code: 'R2', name: 'شمال' }, { code: 'R3', name: 'شرق' },
    { code: 'R4', name: 'غرب' }, { code: 'R5', name: 'جنوب' }, { code: 'R6', name: 'مرکز' }
  ];

  /* کانال‌ها (لاین‌های فروش). count: تعداد مشتری نمونه */
  var B2C_CHANNELS = [
    { code: 'DS', name: 'شعبات (پخش مستقیم)', prefix: 'شعبه', perBranch: true, discount: 0.07 },
    { code: 'MT', name: 'زنجیره‌ای', prefix: 'فروشگاه‌های زنجیره‌ای', count: 6, discount: 0.09 },
    { code: 'AG', name: 'نمایندگان', prefix: 'نمایندگی', count: 8, discount: 0.11 },
    { code: 'BB', name: 'B2B', prefix: 'صنایع غذایی', count: 3, discount: 0.05 },
    { code: 'EX', name: 'صادرات', prefix: 'بازرگانی خارجی', count: 4, discount: 0.12, export: true }
  ];
  var PACK_B2C = [{ name: 'کارتن بسته‌بندی', type: 'بسته‌بندی', uom: 'عدد', cost: 95000 }];
  var BAG = { name: 'کیسه پلی‌پروپیلن ۴۰ کیلویی', type: 'بسته‌بندی', uom: 'عدد', cost: 120000, perKg: 40 };
  var JUMBO = { name: 'جامبوبگ یک‌تنی', type: 'بسته‌بندی', uom: 'عدد', cost: 2400000, perKg: 1000 };

  var T = [];

  /* ============================== زرماکارون (B2C) ============================== */
  var SEMOLINA = { name: 'سمولینا دوروم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 330000, ratio: 0.7, internal: { company: 'ARZ', product: 'ICF-101' } };
  var PASTA_FLOUR = { name: 'آرد ستاره ماکارونی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 280000, ratio: 0.3, internal: { company: 'ARZ', product: 'ICF-102' } };
  var CELLO = { name: 'سلفون چاپی ماکارونی', type: 'بسته‌بندی', uom: 'کیلوگرم', cost: 2600000, ratio: 0.012 };
  T.push({
    id: 'zarmacaron', code: 'ZMC', name: 'ماکارونی و پاستا', company: 'زرماکارون', model: 'B2C', icon: 'layers', grad: 'linear-gradient(135deg,#f59e0b,#ea580c)',
    plants: [{ name: 'کارخانه زرماکارون', site: 'زرماکارون' }],
    channels: B2C_CHANNELS, regions: BRANCHES,
    sharedMaterials: PACK_B2C,
    families: [
      {
        code: 'SPG', name: 'اسپاگتی', uom: 'کارتن', kg: [10, 12],
        items: ['اسپاگتی ۱٫۲ میلی‌متر ۵۰۰ گرمی', 'اسپاگتی ۱٫۵ میلی‌متر ۵۰۰ گرمی', 'اسپاگتی ۱٫۵ میلی‌متر ۷۰۰ گرمی', 'اسپاگتی ۱ کیلویی', 'اسپاگتی غنی‌شده ۵۰۰ گرمی'],
        price: [1.0e7, 1.5e7], cost: [0.7, 0.8], volume: [22000, 70000], uph: [700, 1400], shelfLife: 540,
        season: [0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1.1, 1.05, 1.05, 1.05, 1.0, 1.1],
        events: { ramadan: 0.12, muharram: 0.35 },
        lines: ['خط اسپاگتی ۱', 'خط اسپاگتی ۲'],
        materials: [SEMOLINA, PASTA_FLOUR, CELLO]
      },
      {
        code: 'FRM', name: 'فرمی', uom: 'کارتن', kg: [10, 10],
        items: ['پنه ریگاته ۵۰۰ گرمی', 'شاخ‌گاوی ۵۰۰ گرمی', 'پیچی ۵۰۰ گرمی', 'صدفی ۵۰۰ گرمی', 'فرمی سبزیجات ۵۰۰ گرمی'],
        price: [1.0e7, 1.6e7], cost: [0.68, 0.78], volume: [10000, 42000], uph: [400, 900], shelfLife: 540,
        season: [0.95, 0.95, 1.0, 0.95, 0.95, 1.0, 1.1, 1.0, 1.0, 1.0, 1.0, 1.1],
        events: { ramadan: 0.1, muharram: 0.25 },
        lines: ['خط ماکارونی کوتاه'],
        materials: [SEMOLINA, PASTA_FLOUR, CELLO]
      },
      {
        code: 'NST', name: 'آشیانه‌ای و لازانیا', uom: 'کارتن', kg: [6, 8],
        items: ['فتوچینی آشیانه‌ای', 'رشته آشیانه‌ای', 'لازانیا ۵۰۰ گرمی', 'لازانیا فوری'],
        price: [1.4e7, 2.2e7], cost: [0.64, 0.74], volume: [1200, 6000], uph: [120, 260], shelfLife: 365,
        season: [1.05, 0.9, 0.9, 0.85, 0.85, 0.95, 1.1, 1.05, 1.05, 1.05, 1.05, 1.25],
        events: { ramadan: 0.08, muharram: 0 },
        lines: ['خط پاستای ویژه'],
        materials: [SEMOLINA, { name: 'تخم‌مرغ مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1300000, ratio: 0.08 }, CELLO]
      },
      {
        code: 'SUP', name: 'سوپی و جامبو', uom: 'کارتن', kg: [8, 10],
        items: ['رشته سوپی ۵۰۰ گرمی', 'پاستا حروف ۳۰۰ گرمی', 'جامبو صدفی ۵۰۰ گرمی'],
        price: [9e6, 1.4e7], cost: [0.66, 0.76], volume: [1500, 7000], uph: [150, 320], shelfLife: 365,
        season: [1.0, 0.8, 0.75, 0.7, 0.7, 0.85, 1.05, 1.15, 1.25, 1.25, 1.15, 1.2],
        events: { ramadan: 0.45, muharram: 0.3 },
        lines: ['خط پاستای ویژه'],
        materials: [PASTA_FLOUR, CELLO]
      },
      {
        code: 'FCK', name: 'آرد و پودر کیک', uom: 'کارتن', kg: [8, 10],
        items: ['آرد سفید ۱ کیلویی', 'آرد سبوس‌دار ۱ کیلویی', 'پودر کیک وانیلی', 'پودر کیک شکلاتی'],
        price: [6e6, 1.3e7], cost: [0.72, 0.82], volume: [800, 5000], uph: [150, 300], shelfLife: 270,
        season: [1.0, 0.85, 0.85, 0.85, 0.85, 0.9, 1.0, 1.05, 1.1, 1.1, 1.05, 1.45],
        events: { ramadan: 0.3, muharram: 0.35 },
        lines: ['خط بسته‌بندی آرد و پودر'],
        materials: [{ name: 'آرد قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 300000, ratio: 0.85, internal: { company: 'ARZ', product: 'ICF-103' } }, { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000, ratio: 0.12 }]
      }
    ]
  });

  /* ============================== زرکام (B2C کانفکشنری) ============================== */
  var CAKE_FLOUR = { name: 'آرد قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 300000, ratio: 0.38, internal: { company: 'ARZ', product: 'ICF-103' } };
  var GLUCOSE = { name: 'گلوکز مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 620000, ratio: 0.08, internal: { company: 'ZNM', product: 'ICZ-101' } };
  var STARCH = { name: 'نشاسته ذرت', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 560000, ratio: 0.05, internal: { company: 'ZNM', product: 'ICZ-102' } };
  var SHORT = { name: 'روغن قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1700000, ratio: 0.16, internal: { company: 'ROG', product: 'ICO-101' } };
  var SUGAR = { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000, ratio: 0.22 };
  var COCOA = { name: 'پودر کاکائو', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 4800000, ratio: 0.04 };
  var FOIL = { name: 'لفاف متالایز', type: 'بسته‌بندی', uom: 'کیلوگرم', cost: 2300000, ratio: 0.03 };
  T.push({
    id: 'zarkam', code: 'ZKM', name: 'کانفکشنری (کیک، ویفر، بیسکویت، تافی، کراکر)', company: 'زرکام', model: 'B2C', icon: 'sparkles', grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)',
    plants: [{ name: 'کارخانه زرکام', site: 'زرکام' }],
    channels: B2C_CHANNELS.slice(0, 5).concat([{ code: 'OS', name: 'برون‌سپاری (تولید قراردادی)', prefix: 'کارفرمای قراردادی', count: 1, discount: 0.02 }]),
    regions: BRANCHES,
    sharedMaterials: PACK_B2C,
    families: [
      {
        code: 'CAK', name: 'کیک', uom: 'کارتن', kg: [2.5, 4],
        items: ['کیک صبحانه وانیلی', 'کیک کاکائویی مغزدار', 'کیک یزدی', 'رولت', 'کیک لایه‌ای'],
        price: [7e6, 1.4e7], cost: [0.62, 0.74], volume: [6000, 26000], uph: [250, 520], shelfLife: 150,
        season: [1.05, 0.9, 0.85, 0.85, 0.85, 1.0, 1.25, 1.05, 1.0, 1.0, 1.05, 1.25],
        events: { ramadan: 0.12, muharram: 0 },
        lines: ['خط کیک ۱', 'خط کیک ۲'],
        materials: [CAKE_FLOUR, SUGAR, SHORT, GLUCOSE, { name: 'تخم‌مرغ مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1300000, ratio: 0.12 }, FOIL]
      },
      {
        code: 'WAF', name: 'ویفر', uom: 'کارتن', kg: [2, 3],
        items: ['ویفر شکلاتی', 'ویفر فندقی', 'ویفر روکش‌دار', 'ویفر رول'],
        price: [6e6, 1.2e7], cost: [0.6, 0.72], volume: [5000, 22000], uph: [220, 480], shelfLife: 270,
        season: [1.0, 0.9, 0.9, 0.9, 0.9, 1.0, 1.25, 1.05, 1.0, 1.0, 1.0, 1.2],
        events: { ramadan: 0.06, muharram: 0 },
        lines: ['خط ویفر'],
        materials: [CAKE_FLOUR, SUGAR, SHORT, STARCH, COCOA, FOIL]
      },
      {
        code: 'BSC', name: 'بیسکویت', uom: 'کارتن', kg: [4, 6],
        items: ['بیسکویت ساقه‌طلایی', 'بیسکویت پتی‌بور', 'بیسکویت کرمدار', 'بیسکویت دایجستیو'],
        price: [5e6, 1e7], cost: [0.6, 0.72], volume: [7000, 30000], uph: [300, 650], shelfLife: 270,
        season: [1.05, 0.9, 0.9, 0.9, 0.9, 1.0, 1.25, 1.05, 1.0, 1.0, 1.0, 1.2],
        events: { ramadan: 0.06, muharram: 0 },
        lines: ['خط بیسکویت تونلی'],
        materials: [CAKE_FLOUR, SUGAR, SHORT, GLUCOSE, FOIL]
      },
      {
        code: 'TOF', name: 'تافی و آبنبات', uom: 'کارتن', kg: [4, 5],
        items: ['تافی میوه‌ای', 'تافی کاکائویی', 'آبنبات کره‌ای'],
        price: [7e6, 1.3e7], cost: [0.55, 0.68], volume: [2500, 11000], uph: [120, 300], shelfLife: 365,
        season: [1.35, 0.8, 0.8, 0.75, 0.75, 0.85, 1.0, 0.95, 0.95, 1.0, 1.1, 1.8],
        events: { ramadan: 0.2, muharram: -0.1 },
        lines: ['خط تافی'],
        materials: [{ name: 'گلوکز مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 620000, ratio: 0.42, internal: { company: 'ZNM', product: 'ICZ-101' } }, SUGAR, { name: 'روغن قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1700000, ratio: 0.07, internal: { company: 'ROG', product: 'ICO-101' } }, FOIL]
      },
      {
        code: 'CRK', name: 'کراکر', uom: 'کارتن', kg: [3, 4],
        items: ['کراکر نمکی', 'کراکر پنیری', 'چوب‌شور'],
        price: [5e6, 9e6], cost: [0.6, 0.72], volume: [3000, 14000], uph: [200, 420], shelfLife: 270,
        season: [1.0, 0.95, 0.95, 1.0, 1.05, 1.05, 1.1, 1.0, 0.95, 0.95, 0.95, 1.05],
        events: { ramadan: 0.25, muharram: 0 },
        lines: ['خط بیسکویت تونلی'],
        materials: [{ name: 'آرد قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 300000, ratio: 0.62, internal: { company: 'ARZ', product: 'ICF-103' } }, SHORT, FOIL]
      }
    ]
  });

  /* ============================== آرد زر (B2B) ============================== */
  T.push({
    id: 'ardzar', code: 'ARZ', name: 'گندم و آرد', company: 'آرد زر', model: 'B2B', icon: 'stack', grad: 'linear-gradient(135deg,#d6b26b,#a16207)',
    plants: [{ name: 'کارخانه آرد زر', site: 'آرد زر' }],
    channels: [
      { code: 'BK', name: 'نانوایی و اتحادیه‌ها', prefix: 'اتحادیه نانوایان', count: 6, discount: 0.02 },
      { code: 'IN', name: 'صنایع غذایی', prefix: 'صنایع غذایی', count: 5, discount: 0.04 },
      { code: 'LV', name: 'دامداری و خوراک دام', prefix: 'دامداری', count: 4, discount: 0.03 },
      { code: 'IC', name: 'فروش درون‌گروهی', internal: true, discount: 0 }
    ],
    regions: AREAS,
    sharedMaterials: [],
    families: [
      {
        code: 'BAK', name: 'آرد نانوایی', uom: 'کیسه', kg: [40, 40],
        items: ['آرد نان لواش', 'آرد نان بربری', 'آرد نان سنگک', 'آرد نان فانتزی'],
        price: [1.0e7, 1.5e7], cost: [0.8, 0.88], volume: [12000, 40000], uph: [250, 450], shelfLife: 180,
        season: [1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.15],
        events: { ramadan: 0.12, muharram: 0.08 },
        lines: ['آسیاب ۱', 'آسیاب ۲'],
        materials: [{ name: 'گندم نان', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 210000, ratio: 1.28 }, BAG]
      },
      {
        code: 'IND', name: 'آرد صنعتی', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['آرد ستاره صنعتی', 'آرد کیک و شیرینی', 'آرد سبوس‌دار صنعتی'],
        price: [2.6e8, 3.4e8], cost: [0.82, 0.9], volume: [300, 1100], uph: [6, 12], shelfLife: 180,
        season: [1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.1, 1.05, 1.0, 1.0, 1.05, 1.15],
        events: { ramadan: 0.1, muharram: 0.05 },
        lines: ['آسیاب ۲'],
        materials: [{ name: 'گندم نان', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 210000, ratio: 1.3 }]
      },
      {
        code: 'ICF', name: 'آرد درون‌گروهی', uom: 'تن', kg: [1000, 1000], intercompany: true, itemVolume: [2650, 1150, 340], bulk: true,
        items: ['سمولینا دوروم', 'آرد ستاره ماکارونی', 'آرد قنادی'],
        price: [2.9e8, 3.5e8], cost: [0.84, 0.9], volume: [600, 3200], uph: [8, 16], shelfLife: 120,
        season: [0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1.1, 1.05, 1.05, 1.05, 1.0, 1.15],
        events: { ramadan: 0.12, muharram: 0.3 },
        lines: ['آسیاب دوروم', 'آسیاب ۱'],
        materials: [{ name: 'گندم دوروم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 260000, ratio: 1.32 }]
      },
      {
        code: 'BRN', name: 'سبوس و فرآورده‌های جانبی', uom: 'تن', kg: [1000, 1000], bulk: true, byproduct: true,
        items: ['سبوس گندم', 'نخاله و پوسته'],
        price: [1.0e8, 1.4e8], cost: [0.6, 0.7], volume: [250, 900], uph: [5, 10], shelfLife: 120,
        season: [1.05, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1],
        events: {},
        lines: ['آسیاب ۱'],
        materials: [JUMBO]
      },
      {
        code: 'ICB', name: 'سبوس درون‌گروهی', uom: 'تن', kg: [1000, 1000], intercompany: true, itemVolume: [620], bulk: true, byproduct: true,
        items: ['سبوس خوراک دام'],
        price: [1.1e8, 1.3e8], cost: [0.6, 0.7], volume: [400, 900], uph: [5, 10], shelfLife: 120,
        season: [1.1, 1.0, 0.95, 0.95, 0.9, 0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.15],
        events: {},
        lines: ['آسیاب ۲'],
        materials: []
      }
    ]
  });

  /* ============================== زرنام (B2B فرآوری ذرت) ============================== */
  var CORN = { name: 'ذرت دانه‌ای', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 200000 };
  T.push({
    id: 'zarnam', code: 'ZNM', name: 'فرآوری ذرت (نشاسته، گلوکز، فروکتوز)', company: 'زرنام', model: 'B2B', icon: 'flask', grad: 'linear-gradient(135deg,#facc15,#16a34a)',
    plants: [{ name: 'کارخانه زرنام', site: 'زرنام' }],
    channels: [
      { code: 'FD', name: 'صنایع غذایی و قنادی', prefix: 'صنایع غذایی', count: 6, discount: 0.04 },
      { code: 'BV', name: 'صنایع نوشیدنی', prefix: 'نوشابه‌سازی', count: 4, discount: 0.05 },
      { code: 'PI', name: 'صنایع کاغذ، نساجی و دارویی', prefix: 'صنایع', count: 4, discount: 0.03 },
      { code: 'FE', name: 'خوراک دام و طیور', prefix: 'خوراک دام', count: 3, discount: 0.03 },
      { code: 'IC', name: 'فروش درون‌گروهی', internal: true, discount: 0 }
    ],
    regions: AREAS,
    sharedMaterials: [],
    families: [
      {
        code: 'STA', name: 'نشاسته', uom: 'کیسه', kg: [25, 25],
        items: ['نشاسته ذرت خوراکی', 'نشاسته اصلاح‌شده صنعتی', 'نشاسته کاغذسازی'],
        price: [1.3e7, 2.0e7], cost: [0.74, 0.84], volume: [8000, 30000], uph: [180, 360], shelfLife: 540,
        season: [1.0, 0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.0, 1.0, 1.0, 1.0, 1.05],
        events: { ramadan: 0.05, muharram: 0 },
        lines: ['خط نشاسته و خشک‌کن'],
        materials: [Object.assign({ ratio: 1.45 }, CORN), { name: 'کیسه ۲۵ کیلویی', type: 'بسته‌بندی', uom: 'عدد', cost: 90000, perKg: 25 }]
      },
      {
        code: 'GLU', name: 'گلوکز و شربت‌ها', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['گلوکز مایع DE42', 'شربت مالتوز', 'دکستروز'],
        price: [5.2e8, 7.5e8], cost: [0.72, 0.82], volume: [300, 1200], uph: [3, 6], shelfLife: 365,
        season: [1.2, 0.85, 0.85, 0.85, 0.85, 0.95, 1.1, 1.05, 1.0, 1.0, 1.1, 1.3],
        events: { ramadan: 0.25, muharram: 0 },
        lines: ['خط هیدرولیز و تبخیر'],
        materials: [Object.assign({ ratio: 1.6 }, CORN), { name: 'آنزیم آمیلاز', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1.2e7, ratio: 0.002 }]
      },
      {
        code: 'HFS', name: 'فروکتوز (HFCS)', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['فروکتوز HFCS 42', 'فروکتوز HFCS 55'],
        price: [7e8, 9.5e8], cost: [0.72, 0.82], volume: [250, 900], uph: [2, 5], shelfLife: 180,
        season: [0.75, 0.9, 1.15, 1.35, 1.45, 1.4, 1.15, 0.9, 0.8, 0.75, 0.7, 0.8],
        events: { ramadan: 0.15, muharram: 0.1 },
        lines: ['خط ایزومریزاسیون'],
        materials: [Object.assign({ ratio: 1.7 }, CORN), { name: 'آنزیم ایزومراز', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1.6e7, ratio: 0.002 }]
      },
      {
        code: 'BYP', name: 'فرآورده‌های جانبی', uom: 'تن', kg: [1000, 1000], bulk: true, byproduct: true,
        items: ['گلوتن میل ۶۰٪', 'فیبر ذرت'],
        price: [2.2e8, 4.5e8], cost: [0.55, 0.7], volume: [120, 480], uph: [2, 5], shelfLife: 270,
        season: [1.05, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1],
        events: {},
        lines: ['خط جداسازی و خشک‌کن'],
        materials: [JUMBO]
      },
      {
        code: 'ICZ', name: 'فروش درون‌گروهی ذرت', uom: 'تن', kg: [1000, 1000], intercompany: true, itemVolume: [60, 6, 1460, 380], bulk: true,
        items: ['گلوکز مایع (درون‌گروهی)', 'نشاسته ذرت (درون‌گروهی)', 'جوانه ذرت', 'گلوتن فید'],
        price: [2e8, 6.2e8], cost: [0.7, 0.82], volume: [60, 700], uph: [2, 6], shelfLife: 180,
        season: [1.1, 0.9, 0.9, 0.9, 0.9, 1.0, 1.15, 1.05, 1.0, 1.0, 1.05, 1.2],
        events: { ramadan: 0.1, muharram: 0 },
        lines: ['خط هیدرولیز و تبخیر', 'خط جداسازی و خشک‌کن'],
        materials: [Object.assign({ ratio: 1.5 }, CORN)]
      }
    ]
  });

  /* ============================== روغن زر (B2B) ============================== */
  T.push({
    id: 'roghan', code: 'ROG', name: 'روغن خام، جوانه و کنجاله', company: 'روغن زر', model: 'B2B', icon: 'flask', grad: 'linear-gradient(135deg,#fde047,#ca8a04)',
    plants: [{ name: 'کارخانه روغن زر', site: 'روغن زر' }],
    channels: [
      { code: 'RF', name: 'پالایشگاه‌های روغن', prefix: 'پالایش روغن', count: 4, discount: 0.03 },
      { code: 'FD', name: 'صنایع غذایی', prefix: 'صنایع غذایی', count: 3, discount: 0.04 },
      { code: 'LV', name: 'دامداری و مرغداری', prefix: 'دامداری', count: 5, discount: 0.03 },
      { code: 'IC', name: 'فروش درون‌گروهی', internal: true, discount: 0 }
    ],
    regions: AREAS,
    sharedMaterials: [],
    families: [
      {
        code: 'CRD', name: 'روغن خام', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['روغن خام ذرت', 'روغن خام سویا', 'روغن خام کلزا'],
        price: [1.6e9, 2.3e9], cost: [0.8, 0.9], volume: [80, 420], uph: [1, 3], shelfLife: 365,
        season: [1.05, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1],
        events: { ramadan: 0.1, muharram: 0.15 },
        lines: ['خط پرس و استخراج'],
        materials: [{ name: 'جوانه ذرت', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 450000, ratio: 2.2, internal: { company: 'ZNM', product: 'ICZ-103' } }, { name: 'دانه سویا وارداتی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 380000, ratio: 2.4 }]
      },
      {
        code: 'MEL', name: 'کنجاله', uom: 'تن', kg: [1000, 1000], bulk: true, byproduct: true,
        items: ['کنجاله سویا', 'کنجاله جوانه ذرت', 'کنجاله کلزا'],
        price: [2.2e8, 3.4e8], cost: [0.6, 0.72], volume: [200, 900], uph: [3, 7], shelfLife: 180,
        season: [1.1, 1.0, 0.95, 0.9, 0.9, 0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.15],
        events: { ramadan: 0.08, muharram: 0.1 },
        lines: ['خط پرس و استخراج'],
        materials: [JUMBO]
      },
      {
        code: 'ICO', name: 'فروش درون‌گروهی روغن', uom: 'تن', kg: [1000, 1000], intercompany: true, itemVolume: [115, 340], bulk: true,
        items: ['روغن قنادی', 'کنجاله جوانه ذرت (درون‌گروهی)'],
        price: [2.6e8, 1.8e9], cost: [0.75, 0.86], volume: [60, 500], uph: [1, 4], shelfLife: 270,
        season: [1.1, 0.9, 0.9, 0.9, 0.9, 1.0, 1.2, 1.05, 1.0, 1.0, 1.05, 1.2],
        events: { ramadan: 0.15, muharram: 0 },
        lines: ['خط اینتراستریفیکاسیون', 'خط پرس و استخراج'],
        materials: [{ name: 'روغن پالم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1250000, ratio: 1.03 }]
      }
    ]
  });

  /* ============================== مهستان (B2B) ============================== */
  // فرض اولیه: تولید خوراک دام و طیور و مصرف‌کننده فرآورده‌های جانبی گروه — در کالیبراسیون تأیید یا اصلاح می‌شود
  T.push({
    id: 'mahestan', code: 'MHS', name: 'خوراک دام و طیور', company: 'مهستان', model: 'B2B', icon: 'factory', grad: 'linear-gradient(135deg,#34d399,#0f766e)',
    plants: [{ name: 'کارخانه مهستان', site: 'مهستان' }],
    channels: [
      { code: 'PF', name: 'مرغداری‌ها', prefix: 'مرغداری', count: 6, discount: 0.03 },
      { code: 'DF', name: 'دامداری‌های صنعتی', prefix: 'دامداری', count: 5, discount: 0.03 },
      { code: 'CO', name: 'تعاونی‌ها و عاملان', prefix: 'تعاونی', count: 4, discount: 0.05 }
    ],
    regions: AREAS,
    sharedMaterials: [],
    families: [
      {
        code: 'PLT', name: 'خوراک طیور', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['خوراک مرغ گوشتی آغازین', 'خوراک مرغ گوشتی رشد', 'خوراک مرغ تخم‌گذار'],
        price: [2.4e8, 3.2e8], cost: [0.84, 0.9], volume: [600, 2400], uph: [10, 20], shelfLife: 60,
        season: [1.0, 0.95, 0.95, 0.9, 0.9, 0.95, 1.0, 1.05, 1.05, 1.05, 1.05, 1.15],
        events: { ramadan: 0.12, muharram: 0.2 },
        lines: ['خط پلت ۱', 'خط پلت ۲'],
        materials: [
          { name: 'ذرت دانه‌ای', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 200000, ratio: 0.58 },
          { name: 'کنجاله سویا وارداتی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 300000, ratio: 0.2 },
          { name: 'کنجاله جوانه ذرت', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 240000, ratio: 0.08, internal: { company: 'ROG', product: 'ICO-102' } },
          { name: 'گلوتن فید', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 180000, ratio: 0.06, internal: { company: 'ZNM', product: 'ICZ-104' } }
        ]
      },
      {
        code: 'CTL', name: 'خوراک دام', uom: 'تن', kg: [1000, 1000], bulk: true,
        items: ['کنسانتره گاو شیری', 'کنسانتره پرواری', 'خوراک گوسفند'],
        price: [1.9e8, 2.7e8], cost: [0.84, 0.9], volume: [500, 2000], uph: [10, 20], shelfLife: 90,
        season: [1.15, 1.05, 0.9, 0.85, 0.85, 0.9, 0.95, 1.0, 1.05, 1.05, 1.1, 1.15],
        events: { ramadan: 0.05, muharram: 0.15 },
        lines: ['خط پلت ۲', 'خط میکسر'],
        materials: [
          { name: 'سبوس گندم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 120000, ratio: 0.3, internal: { company: 'ARZ', product: 'ICB-101' } },
          { name: 'ذرت دانه‌ای', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 200000, ratio: 0.35 },
          { name: 'جو', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 190000, ratio: 0.25 },
          { name: 'گلوتن فید', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 180000, ratio: 0.06, internal: { company: 'ZNM', product: 'ICZ-104' } }
        ]
      },
      {
        code: 'SUP', name: 'مکمل و پیش‌مخلوط', uom: 'کیسه', kg: [25, 25],
        items: ['مکمل معدنی-ویتامینی دام', 'پیش‌مخلوط طیور'],
        price: [2.5e7, 4.5e7], cost: [0.7, 0.8], volume: [1500, 6000], uph: [60, 140], shelfLife: 180,
        season: [1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.05, 1.1],
        events: {},
        lines: ['خط میکسر'],
        materials: [{ name: 'ویتامین و مواد معدنی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 3.5e6, ratio: 0.2 }, { name: 'کیسه ۲۵ کیلویی', type: 'بسته‌بندی', uom: 'عدد', cost: 90000, perKg: 25 }]
      }
    ]
  });

  /* الگوهای قدیمی (نسخه ۰٫۳) برای شناسایی شرکت‌های نمونه قبلی هنگام ارتقا */
  var LEGACY_DEMO = { PAS: 'ماکارون آوا', FLR: 'آرد آوا', BIS: 'بیسکویت و شیرینی آوا', DAI: 'لبنیات آوا', OIL: 'روغن آوا' };

  function get(idOrCode) { return T.filter(function (t) { return t.id === idOrCode || t.code === idOrCode; })[0] || null; }

  /** خریداران درون‌گروهی هر کالا: شرکت‌هایی که این کالا در فهرست مواد آن‌ها آمده است */
  function buyersOf(companyCode, productCode) {
    var out = [];
    T.forEach(function (t) {
      t.families.forEach(function (f) {
        f.materials.forEach(function (m) {
          if (m.internal && m.internal.company === companyCode && m.internal.product === productCode && out.indexOf(t.code) < 0) out.push(t.code);
        });
      });
    });
    return out;
  }

  IBP.templates = {
    HOLDING: HOLDING,
    LEGACY_HOLDING: 'هلدینگ صنایع غذایی آوا',
    LEGACY_DEMO: LEGACY_DEMO,
    VERSION: 2,
    list: T,
    get: function (x) { return get(x) || T[0]; },
    find: get,
    buyersOf: buyersOf,
    companyName: function (code) { var t = get(code); return t ? t.company : code; },
    MODELS: { B2C: 'B2C — مصرف‌کننده', B2B: 'B2B — صنعتی' }
  };
})(window.IBP = window.IBP || {});
