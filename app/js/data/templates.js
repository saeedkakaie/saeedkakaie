/*
 * الگوهای شرکت‌های هلدینگ غذایی برای تولید داده تستی.
 * هر الگو یک شرکت تولیدی با منطق خودش است (محصولات، فصلی‌بودن، مناسبت‌ها، کانال‌ها و مواد)؛
 * کد شرکت همان کد پلنت است.
 *
 * season: ضریب فصلی ۱۲ ماه شمسی (فروردین تا اسفند)
 * events: اثر واقعی مناسبت‌های قمری بر تقاضای خانواده (برای یک ماه کامل مناسبت)
 * price: بازه قیمت فروش واحد (ریال)، volume: بازه فروش ماهانه هر کالا، kg: وزن هر واحد
 * intercompany: خانواده‌ای که فقط به شرکت‌های دیگر هلدینگ فروخته می‌شود (buyers: کد شرکت‌های خریدار)
 * materials[].internal: ماده‌ای که از شرکت دیگر هلدینگ تأمین می‌شود { company, product }
 */
(function (IBP) {
  'use strict';

  var HOLDING = { name: 'هلدینگ صنایع غذایی آوا', short: 'هلدینگ آوا' };

  var COMMON_CHANNELS = [
    { code: 'DS', name: 'پخش مویرگی', prefix: 'پخش', weight: 9, discount: 0.08 },
    { code: 'CH', name: 'فروشگاه زنجیره‌ای', prefix: 'فروشگاه‌های زنجیره‌ای', weight: 5, discount: 0.06 },
    { code: 'WH', name: 'عمده‌فروشی', prefix: 'بازرگانی', weight: 6, discount: 0.1 },
    { code: 'HR', name: 'صنف، رستوران و تالار', prefix: 'تالار پذیرایی', weight: 3, discount: 0.05 },
    { code: 'EX', name: 'صادرات', prefix: 'بازرگانی خارجی', weight: 2, discount: 0.12, export: true }
  ];
  var PACK = [
    { name: 'کارتن بسته‌بندی', type: 'بسته‌بندی', uom: 'عدد', cost: 95000 },
    { name: 'فیلم شیرینگ', type: 'بسته‌بندی', uom: 'کیلوگرم', cost: 1500000 }
  ];

  var T = [];

  /* ============================== ماکارونی ============================== */
  T.push({
    id: 'pasta', code: 'PAS', name: 'ماکارونی و پاستا', company: 'ماکارون آوا', icon: 'layers', grad: 'linear-gradient(135deg,#f59e0b,#ea580c)',
    plants: [{ code: 'PAS', name: 'کارخانه ماکارون قزوین', city: 'قزوین' }],
    channels: COMMON_CHANNELS,
    sharedMaterials: PACK.concat([{ name: 'سلفون چاپی ماکارونی', type: 'بسته‌بندی', uom: 'کیلوگرم', cost: 2600000 }]),
    families: [
      {
        code: 'MAC', name: 'ماکارونی و اسپاگتی', uom: 'کارتن', kg: [10, 14],
        items: ['اسپاگتی ۱٫۲ میلی‌متر ۵۰۰ گرمی', 'اسپاگتی ۱٫۵ میلی‌متر ۷۰۰ گرمی', 'ماکارونی پنه ۵۰۰ گرمی', 'ماکارونی شاخ‌گاوی ۵۰۰ گرمی', 'ماکارونی فرمی پیچی ۵۰۰ گرمی'],
        price: [9.5e6, 1.6e7], cost: [0.7, 0.8], volume: [8000, 42000], uph: [300, 700], shelfLife: 540,
        season: [0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1.1, 1.05, 1.05, 1.05, 1.0, 1.1],
        events: { ramadan: 0.12, muharram: 0.35 },
        lines: ['خط پرس پیوسته اسپاگتی', 'خط ماکارونی کوتاه'],
        materials: [
          { name: 'سمولینا دوروم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 340000, internal: { company: 'FLR', product: 'SEM-101' } },
          { name: 'آرد ستاره صنعتی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 280000, internal: { company: 'FLR', product: 'SEM-102' } }
        ]
      },
      {
        code: 'RES', name: 'رشته و پاستای ویژه', uom: 'کارتن', kg: [8, 10],
        items: ['رشته آشی ۵۰۰ گرمی', 'رشته پلویی ۵۰۰ گرمی', 'لازانیا ۵۰۰ گرمی', 'پاستا سبزیجات ۵۰۰ گرمی'],
        price: [1.1e7, 1.9e7], cost: [0.66, 0.76], volume: [3000, 16000], uph: [200, 450], shelfLife: 365,
        season: [1.05, 0.85, 0.8, 0.75, 0.75, 0.85, 1.0, 1.1, 1.2, 1.15, 1.05, 1.6],
        events: { ramadan: 0.5, muharram: 0.45 },
        lines: ['خط رشته و پاستای ویژه'],
        materials: [
          { name: 'آرد ستاره صنعتی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 280000, internal: { company: 'FLR', product: 'SEM-102' } },
          { name: 'پودر سبزیجات', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 4200000 },
          { name: 'تخم‌مرغ مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1300000 }
        ]
      }
    ]
  });

  /* ============================== آرد ============================== */
  T.push({
    id: 'flour', code: 'FLR', name: 'آرد و غلات', company: 'آرد آوا', icon: 'stack', grad: 'linear-gradient(135deg,#d6b26b,#a16207)',
    plants: [{ code: 'FLR', name: 'کارخانه آرد اصفهان', city: 'اصفهان' }],
    channels: [
      { code: 'BK', name: 'نانوایی و صنف', prefix: 'اتحادیه نانوایان', weight: 8, discount: 0.03 },
      { code: 'IN', name: 'صنایع غذایی خارج از گروه', prefix: 'صنایع غذایی', weight: 5, discount: 0.06 },
      { code: 'DS', name: 'پخش مویرگی', prefix: 'پخش', weight: 6, discount: 0.08 },
      { code: 'CH', name: 'فروشگاه زنجیره‌ای', prefix: 'فروشگاه‌های زنجیره‌ای', weight: 3, discount: 0.06 },
      { code: 'IC', name: 'فروش درون‌گروهی', internal: true, weight: 0, discount: 0 }
    ],
    sharedMaterials: [{ name: 'کیسه پلی‌پروپیلن ۴۰ کیلویی', type: 'بسته‌بندی', uom: 'عدد', cost: 120000 }],
    families: [
      {
        code: 'BAK', name: 'آرد نانوایی و قنادی', uom: 'کیسه', kg: [40, 40],
        items: ['آرد نان لواش', 'آرد نان بربری', 'آرد نان سنگک', 'آرد قنادی'],
        price: [1.6e7, 2.5e7], cost: [0.78, 0.86], volume: [9000, 32000], uph: [180, 320], shelfLife: 180,
        season: [1.0, 0.95, 0.95, 0.95, 0.95, 1.0, 1.0, 1.0, 1.0, 1.0, 1.05, 1.2],
        events: { ramadan: 0.15, muharram: 0.1 },
        lines: ['خط آسیاب ۱', 'خط آسیاب ۲'],
        materials: [{ name: 'گندم نان', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 210000 }]
      },
      {
        code: 'HOM', name: 'آرد خانگی', uom: 'کارتن', kg: [8, 10],
        items: ['آرد سفید ۱ کیلویی', 'آرد سبوس‌دار ۱ کیلویی', 'آرد نخودچی ۵۰۰ گرمی', 'آرد برنج ۵۰۰ گرمی'],
        price: [5.5e6, 1.1e7], cost: [0.7, 0.8], volume: [2500, 12000], uph: [150, 300], shelfLife: 270,
        season: [1.0, 0.85, 0.85, 0.85, 0.85, 0.9, 1.0, 1.05, 1.1, 1.1, 1.05, 1.4],
        events: { ramadan: 0.35, muharram: 0.4 },
        lines: ['خط بسته‌بندی آرد خانگی'],
        materials: [{ name: 'گندم نان', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 210000 }, { name: 'نخود و برنج', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1300000 }]
      },
      {
        code: 'SEM', name: 'آرد صنعتی درون‌گروهی', uom: 'تن', kg: [1000, 1000], intercompany: true, buyers: ['PAS', 'BIS'],
        items: ['سمولینا دوروم', 'آرد ستاره صنعتی'],
        price: [2.9e8, 3.6e8], cost: [0.84, 0.9], volume: [500, 1400], uph: [6, 12], shelfLife: 120,
        season: [0.95, 0.95, 0.95, 0.9, 0.9, 0.95, 1.1, 1.05, 1.05, 1.05, 1.0, 1.15],
        events: { ramadan: 0.15, muharram: 0.3 },
        lines: ['خط آسیاب دوروم'],
        materials: [{ name: 'گندم دوروم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 260000 }]
      }
    ]
  });

  /* ============================== بیسکویت و شیرینی ============================== */
  T.push({
    id: 'biscuit', code: 'BIS', name: 'بیسکویت، کیک و شیرینی', company: 'بیسکویت و شیرینی آوا', icon: 'sparkles', grad: 'linear-gradient(135deg,#ec4899,#8b5cf6)',
    plants: [{ code: 'BIS', name: 'کارخانه بیسکویت تهران', city: 'تهران' }],
    channels: COMMON_CHANNELS,
    sharedMaterials: PACK.concat([{ name: 'لفاف متالایز', type: 'بسته‌بندی', uom: 'کیلوگرم', cost: 2300000 }]),
    families: [
      {
        code: 'BSC', name: 'بیسکویت و کراکر', uom: 'کارتن', kg: [4, 6],
        items: ['بیسکویت ساقه طلایی', 'بیسکویت پتی‌بور', 'کراکر نمکی', 'بیسکویت کرمدار شکلاتی'],
        price: [4.5e6, 9e6], cost: [0.6, 0.72], volume: [6000, 30000], uph: [220, 480], shelfLife: 270,
        season: [1.05, 0.9, 0.9, 0.9, 0.9, 1.0, 1.25, 1.05, 1.0, 1.0, 1.0, 1.2],
        events: { ramadan: 0.06, muharram: 0 },
        lines: ['خط پخت تونلی بیسکویت', 'خط کرم‌زنی و بسته‌بندی'],
        materials: [
          { name: 'آرد قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 520000, internal: { company: 'FLR', product: 'BAK-104' } },
          { name: 'شورتنینگ قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1700000, internal: { company: 'OIL', product: 'IND-101' } },
          { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000 },
          { name: 'پودر کاکائو', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 4800000 }
        ]
      },
      {
        code: 'CAK', name: 'کیک و ویفر', uom: 'کارتن', kg: [3, 5],
        items: ['کیک صبحانه', 'کیک یزدی', 'ویفر شکلاتی', 'رولت'],
        price: [5e6, 1e7], cost: [0.6, 0.72], volume: [4000, 22000], uph: [160, 380], shelfLife: 120,
        season: [1.05, 0.9, 0.85, 0.85, 0.85, 1.0, 1.2, 1.05, 1.0, 1.0, 1.05, 1.25],
        events: { ramadan: 0.1, muharram: 0 },
        lines: ['خط کیک'],
        materials: [
          { name: 'آرد قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 520000, internal: { company: 'FLR', product: 'BAK-104' } },
          { name: 'تخم‌مرغ مایع', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1300000 },
          { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000 }
        ]
      },
      {
        code: 'ZLB', name: 'زولبیا و بامیه', uom: 'کارتن', kg: [5, 5],
        items: ['زولبیا ۵۰۰ گرمی', 'بامیه ۵۰۰ گرمی', 'زولبیا و بامیه مخلوط'],
        price: [9e6, 1.4e7], cost: [0.55, 0.68], volume: [700, 2500], uph: [60, 140], shelfLife: 45,
        season: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        events: { ramadan: 3.0, muharram: 0 },
        lines: ['خط شیرینی سنتی'],
        materials: [
          { name: 'شورتنینگ قنادی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1700000, internal: { company: 'OIL', product: 'IND-101' } },
          { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000 },
          { name: 'نشاسته', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 700000 }
        ]
      },
      {
        code: 'GAZ', name: 'گز و سوهان', uom: 'کارتن', kg: [4, 6],
        items: ['گز آردی ۴۰٪', 'گز لقمه‌ای پسته‌ای', 'سوهان عسلی', 'سوهان لقمه‌ای'],
        price: [1.6e7, 3.2e7], cost: [0.55, 0.68], volume: [800, 4000], uph: [40, 100], shelfLife: 180,
        season: [1.5, 0.6, 0.55, 0.5, 0.5, 0.6, 0.75, 0.8, 0.9, 1.0, 1.2, 2.6],
        events: { ramadan: 0.05, muharram: -0.1 },
        lines: ['خط شیرینی سنتی'],
        materials: [{ name: 'مغز پسته', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1.9e7 }, { name: 'شکر', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 650000 }]
      }
    ]
  });

  /* ============================== لبنیات ============================== */
  T.push({
    id: 'dairy', code: 'DAI', name: 'لبنیات', company: 'لبنیات آوا', icon: 'flask', grad: 'linear-gradient(135deg,#38bdf8,#2563eb)',
    plants: [{ code: 'DAI', name: 'کارخانه لبنیات مشهد', city: 'مشهد' }],
    channels: COMMON_CHANNELS.slice(0, 4),
    sharedMaterials: [{ name: 'کارتن لبنیات', type: 'بسته‌بندی', uom: 'عدد', cost: 70000 }],
    families: [
      {
        code: 'MLK', name: 'شیر و ماست', uom: 'کارتن', kg: [6, 12],
        items: ['شیر کم‌چرب ۱ لیتری', 'شیر پرچرب ۱ لیتری', 'ماست کم‌چرب ۹۰۰ گرمی', 'ماست پرچرب ۲ کیلویی', 'ماست موسیر ۷۵۰ گرمی'],
        price: [3.5e6, 9e6], cost: [0.74, 0.84], volume: [10000, 52000], uph: [450, 950], shelfLife: 21,
        season: [1.0, 1.0, 1.05, 1.1, 1.1, 1.05, 1.0, 0.95, 0.95, 0.95, 0.95, 1.0],
        events: { ramadan: 0.14, muharram: 0.3 },
        lines: ['خط پاستوریزاسیون', 'خط پرکن ماست'],
        materials: [{ name: 'شیر خام', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 260000 }, { name: 'لیوان و درب', type: 'بسته‌بندی', uom: 'عدد', cost: 24000 }]
      },
      {
        code: 'CHS', name: 'پنیر، خامه و کره', uom: 'کارتن', kg: [4, 8],
        items: ['پنیر سفید ۴۰۰ گرمی', 'پنیر لاکتیکی ۳۵۰ گرمی', 'خامه صبحانه ۲۰۰ گرمی', 'کره ۱۰۰ گرمی'],
        price: [7e6, 1.6e7], cost: [0.72, 0.82], volume: [3500, 18000], uph: [180, 400], shelfLife: 60,
        season: [1.05, 0.95, 0.95, 0.9, 0.9, 0.95, 1.05, 1.05, 1.05, 1.05, 1.0, 1.1],
        events: { ramadan: 0.3, muharram: 0.05 },
        lines: ['خط پنیر و خامه'],
        materials: [{ name: 'شیر خام', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 260000 }, { name: 'مایه پنیر', type: 'مواد اولیه', uom: 'گرم', cost: 20000 }]
      },
      {
        code: 'DRK', name: 'دوغ و نوشیدنی لبنی', uom: 'کارتن', kg: [6, 9],
        items: ['دوغ ۱٫۵ لیتری', 'دوغ ۳۰۰ سی‌سی', 'شیر کاکائو ۲۰۰ سی‌سی'],
        price: [2.8e6, 6.5e6], cost: [0.62, 0.74], volume: [6000, 36000], uph: [500, 1100], shelfLife: 30,
        season: [0.9, 1.0, 1.25, 1.5, 1.55, 1.35, 0.95, 0.8, 0.7, 0.65, 0.7, 0.85],
        events: { ramadan: 0.1, muharram: 0.45 },
        lines: ['خط پرکن پت دوغ'],
        materials: [{ name: 'شیر خام', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 260000 }, { name: 'بطری پت', type: 'بسته‌بندی', uom: 'عدد', cost: 32000 }]
      }
    ]
  });

  /* ============================== روغن ============================== */
  T.push({
    id: 'oil', code: 'OIL', name: 'روغن خوراکی', company: 'روغن آوا', icon: 'flask', grad: 'linear-gradient(135deg,#facc15,#16a34a)',
    plants: [{ code: 'OIL', name: 'کارخانه روغن ورامین', city: 'ورامین' }],
    channels: COMMON_CHANNELS.concat([{ code: 'IC', name: 'فروش درون‌گروهی', internal: true, weight: 0, discount: 0 }]),
    sharedMaterials: PACK,
    families: [
      {
        code: 'LIQ', name: 'روغن مایع', uom: 'کارتن', kg: [9, 11],
        items: ['روغن آفتابگردان ۱٫۵ لیتری', 'روغن سرخ‌کردنی ۱٫۸ لیتری', 'روغن کانولا ۹۰۰ گرمی', 'روغن کنجد ۵۰۰ سی‌سی'],
        price: [1.4e7, 3e7], cost: [0.8, 0.88], volume: [6000, 34000], uph: [250, 600], shelfLife: 450,
        season: [1.05, 0.95, 0.95, 0.9, 0.9, 0.95, 1.0, 1.0, 1.05, 1.05, 1.05, 1.25],
        events: { ramadan: 0.2, muharram: 0.45 },
        lines: ['خط پرکن روغن مایع'],
        materials: [{ name: 'روغن خام دانه‌های روغنی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1100000 }, { name: 'بطری پت روغن', type: 'بسته‌بندی', uom: 'عدد', cost: 38000 }]
      },
      {
        code: 'SLD', name: 'روغن جامد و نیمه‌جامد', uom: 'حلب', kg: [4, 5],
        items: ['روغن نیمه‌جامد ۴ کیلویی', 'روغن جامد ۵ کیلویی', 'روغن حیوانی ۱ کیلویی'],
        price: [1.1e7, 2.6e7], cost: [0.8, 0.88], volume: [3000, 16000], uph: [120, 260], shelfLife: 540,
        season: [1.0, 0.85, 0.85, 0.85, 0.85, 0.95, 1.05, 1.1, 1.15, 1.15, 1.05, 1.2],
        events: { ramadan: 0.15, muharram: 0.6 },
        lines: ['خط هیدروژناسیون و حلب‌پرکنی'],
        materials: [{ name: 'روغن خام دانه‌های روغنی', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1100000 }, { name: 'حلب فلزی', type: 'بسته‌بندی', uom: 'عدد', cost: 160000 }]
      },
      {
        code: 'IND', name: 'روغن صنعتی درون‌گروهی', uom: 'تن', kg: [1000, 1000], intercompany: true, buyers: ['BIS'],
        items: ['شورتنینگ قنادی', 'روغن سرخ‌کردنی صنعتی'],
        price: [1.4e9, 1.8e9], cost: [0.84, 0.9], volume: [60, 180], uph: [2, 4], shelfLife: 270,
        season: [1.05, 0.9, 0.9, 0.9, 0.9, 1.0, 1.2, 1.05, 1.0, 1.0, 1.05, 1.2],
        events: { ramadan: 0.3, muharram: 0 },
        lines: ['خط روغن صنعتی'],
        materials: [{ name: 'روغن پالم', type: 'مواد اولیه', uom: 'کیلوگرم', cost: 1250000 }]
      }
    ]
  });

  function get(idOrCode) { return T.filter(function (t) { return t.id === idOrCode || t.code === idOrCode; })[0] || T[0]; }

  IBP.templates = {
    HOLDING: HOLDING,
    list: T,
    get: get,
    companyName: function (code) { var t = T.filter(function (x) { return x.code === code; })[0]; return t ? t.company : code; }
  };
})(window.IBP = window.IBP || {});
