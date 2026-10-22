/*
 * تعریف موجودیت‌های داده.
 * فرم‌ها، جدول‌ها، ورود/خروج CSV و کنترل وابستگی‌ها همه از همین تعریف ساخته می‌شوند؛
 * برای افزودن یک موجودیت یا فیلد جدید کافی است این فایل را تغییر دهید.
 *
 * انواع فیلد: text, textarea, number, money, percent, select, ref, bool, color, date (شمسی), period (ماه شمسی)
 */
(function (IBP) {
  'use strict';

  var UOMS = ['عدد', 'کارتن', 'بسته', 'کیسه', 'حلب', 'کیلوگرم', 'گرم', 'تن', 'لیتر', 'متر', 'متر مربع', 'رول', 'شیت', 'دستگاه', 'ست', 'جفت', 'بطری', 'قوطی'];
  var LIFECYCLE = ['معرفی', 'رشد', 'بلوغ', 'افول', 'توقف'];
  var ABC = ['A', 'B', 'C'];
  var XYZ = ['X', 'Y', 'Z'];

  var ENTITIES = {
    /* ------------------------------ ساختار سازمان ------------------------------ */
    plants: {
      label: 'کارخانه‌ها', single: 'کارخانه', group: 'org', icon: 'factory',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام کارخانه', type: 'text', required: true },
        { key: 'city', label: 'شهر', type: 'text' },
        { key: 'workingDays', label: 'روز کاری در ماه', type: 'number', min: 1, max: 31, default: 25 },
        { key: 'active', label: 'فعال', type: 'bool', default: true }
      ]
    },
    warehouses: {
      label: 'انبارها', single: 'انبار', group: 'org', icon: 'warehouse',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام انبار', type: 'text', required: true },
        { key: 'plantId', label: 'کارخانه', type: 'ref', ref: 'plants', required: true },
        { key: 'type', label: 'نوع', type: 'select', options: ['محصول نهایی', 'مواد اولیه', 'بسته‌بندی', 'توزیع'], required: true },
        { key: 'capacity', label: 'ظرفیت (پالت)', type: 'number', min: 0 }
      ]
    },
    resources: {
      label: 'خطوط و منابع تولید', single: 'منبع تولید', group: 'org', icon: 'gear',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام خط / ماشین', type: 'text', required: true },
        { key: 'plantId', label: 'کارخانه', type: 'ref', ref: 'plants', required: true },
        { key: 'type', label: 'نوع منبع', type: 'select', options: ['خط تولید', 'ماشین', 'نیروی انسانی', 'بسته‌بندی', 'آزمایشگاه'], default: 'خط تولید' },
        { key: 'shifts', label: 'تعداد شیفت', type: 'number', min: 1, max: 3, default: 2 },
        { key: 'hoursPerShift', label: 'ساعت هر شیفت', type: 'number', min: 1, max: 12, default: 8 },
        { key: 'efficiency', label: 'راندمان (OEE)', type: 'percent', min: 0, max: 1, default: 0.85 },
        { key: 'costPerHour', label: 'هزینه هر ساعت', type: 'money', min: 0 }
      ]
    },

    /* ------------------------------ محصول ------------------------------ */
    families: {
      label: 'خانواده‌های محصول', single: 'خانواده محصول', group: 'product', icon: 'layers',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام خانواده', type: 'text', required: true },
        { key: 'color', label: 'رنگ', type: 'color', default: '#2a78d6' },
        { key: 'description', label: 'توضیحات', type: 'textarea' }
      ]
    },
    products: {
      label: 'محصولات (SKU)', single: 'محصول', group: 'product', icon: 'box',
      fields: [
        { key: 'code', label: 'کد کالا', type: 'text', required: true, unique: true, width: 100 },
        { key: 'name', label: 'نام محصول', type: 'text', required: true },
        { key: 'familyId', label: 'خانواده', type: 'ref', ref: 'families', required: true },
        { key: 'plantId', label: 'کارخانه تولیدکننده', type: 'ref', ref: 'plants', required: true },
        { key: 'uom', label: 'واحد', type: 'select', options: UOMS, default: 'عدد' },
        { key: 'unitWeightKg', label: 'وزن خالص هر واحد (کیلوگرم)', type: 'number', min: 0, digits: 3, hint: 'برای محاسبه تناژ برنامه' },
        { key: 'unitPrice', label: 'قیمت فروش واحد', type: 'money', min: 0, required: true },
        { key: 'unitCost', label: 'بهای تمام‌شده واحد', type: 'money', min: 0, required: true },
        { key: 'lifecycle', label: 'چرخه عمر', type: 'select', options: LIFECYCLE, default: 'بلوغ' },
        { key: 'abc', label: 'کلاس ABC', type: 'select', options: ABC, hint: 'بر اساس سهم فروش' },
        { key: 'xyz', label: 'کلاس XYZ', type: 'select', options: XYZ, hint: 'بر اساس نوسان تقاضا' },
        { key: 'safetyStockDays', label: 'ذخیره اطمینان (روز)', type: 'number', min: 0, default: 15 },
        { key: 'batchSize', label: 'اندازه بچ تولید', type: 'number', min: 0 },
        { key: 'shelfLifeDays', label: 'ماندگاری (روز)', type: 'number', min: 0 },
        { key: 'launchDate', label: 'تاریخ معرفی', type: 'date' },
        { key: 'phaseOutDate', label: 'تاریخ توقف برنامه‌ریزی‌شده', type: 'date', hint: 'برای محصولاتی که از سبد خارج می‌شوند' },
        { key: 'successorId', label: 'محصول جایگزین', type: 'ref', ref: 'products', hint: 'تقاضای محصول در حال حذف به این محصول منتقل می‌شود' },
        { key: 'intercompany', label: 'فروش درون‌گروهی', type: 'bool', default: false, hint: 'محصولی که به شرکت‌های دیگر هلدینگ فروخته می‌شود' },
        { key: 'active', label: 'فعال', type: 'bool', default: true }
      ]
    },
    routings: {
      naturalKey: ['productId', 'resourceId'],
      label: 'مسیر تولید (Routing)', single: 'مسیر تولید', group: 'product', icon: 'route',
      display: function (r, S) { return S.name('products', r.productId) + ' ← ' + S.name('resources', r.resourceId); },
      fields: [
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'resourceId', label: 'منبع تولید', type: 'ref', ref: 'resources', required: true },
        { key: 'unitsPerHour', label: 'نرخ تولید (واحد در ساعت)', type: 'number', min: 0, required: true },
        { key: 'setupHours', label: 'زمان راه‌اندازی (ساعت)', type: 'number', min: 0, default: 0 },
        { key: 'priority', label: 'اولویت', type: 'number', min: 1, default: 1, hint: '۱ = خط اصلی' }
      ]
    },

    /* ------------------------------ تأمین ------------------------------ */
    suppliers: {
      label: 'تأمین‌کنندگان', single: 'تأمین‌کننده', group: 'supply', icon: 'truck',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام تأمین‌کننده', type: 'text', required: true },
        { key: 'city', label: 'شهر / کشور', type: 'text' },
        { key: 'leadTimeDays', label: 'زمان تحویل (روز)', type: 'number', min: 0, default: 14 },
        { key: 'reliability', label: 'تحویل به‌موقع', type: 'percent', min: 0, max: 1, default: 0.9 },
        { key: 'isImport', label: 'وارداتی', type: 'bool', default: false }
      ]
    },
    materials: {
      label: 'مواد اولیه و بسته‌بندی', single: 'ماده', group: 'supply', icon: 'flask',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 100 },
        { key: 'name', label: 'نام ماده', type: 'text', required: true },
        { key: 'type', label: 'نوع', type: 'select', options: ['مواد اولیه', 'بسته‌بندی', 'قطعه', 'نیمه‌ساخته', 'مصرفی'], required: true },
        { key: 'uom', label: 'واحد', type: 'select', options: UOMS, default: 'کیلوگرم' },
        { key: 'unitCost', label: 'قیمت خرید واحد', type: 'money', min: 0, required: true },
        { key: 'supplierId', label: 'تأمین‌کننده اصلی', type: 'ref', ref: 'suppliers' },
        { key: 'internalCompany', label: 'کد شرکت تأمین‌کننده درون‌گروهی', type: 'text', hint: 'اگر این ماده از شرکت دیگر هلدینگ تأمین می‌شود' },
        { key: 'internalProductCode', label: 'کد کالا در شرکت تأمین‌کننده', type: 'text' },
        { key: 'leadTimeDays', label: 'زمان تأمین (روز)', type: 'number', min: 0, default: 14 },
        { key: 'moq', label: 'حداقل سفارش (MOQ)', type: 'number', min: 0 },
        { key: 'safetyStockDays', label: 'ذخیره اطمینان (روز)', type: 'number', min: 0, default: 20 }
      ]
    },
    bom: {
      naturalKey: ['productId', 'materialId'],
      label: 'فهرست مواد (BOM)', single: 'ردیف BOM', group: 'supply', icon: 'list',
      display: function (r, S) { return S.name('products', r.productId) + ' ← ' + S.name('materials', r.materialId); },
      fields: [
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'materialId', label: 'ماده / قطعه', type: 'ref', ref: 'materials', required: true },
        { key: 'qtyPer', label: 'مقدار برای یک واحد محصول', type: 'number', min: 0, required: true, digits: 4 },
        { key: 'scrap', label: 'ضایعات', type: 'percent', min: 0, max: 1, default: 0.02 }
      ]
    },

    /* ------------------------------ بازار ------------------------------ */
    channels: {
      label: 'کانال‌های فروش', single: 'کانال فروش', group: 'market', icon: 'share',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام کانال', type: 'text', required: true },
        { key: 'discount', label: 'تخفیف میانگین', type: 'percent', min: 0, max: 1, default: 0 },
        { key: 'internal', label: 'درون‌گروهی', type: 'bool', default: false, hint: 'فروش به شرکت‌های هلدینگ' }
      ]
    },
    regions: {
      label: 'مناطق فروش', single: 'منطقه', group: 'market', icon: 'map',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام منطقه', type: 'text', required: true },
        { key: 'manager', label: 'مدیر منطقه', type: 'text' }
      ]
    },
    customers: {
      label: 'مشتریان', single: 'مشتری', group: 'market', icon: 'users',
      fields: [
        { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
        { key: 'name', label: 'نام مشتری', type: 'text', required: true },
        { key: 'channelId', label: 'کانال', type: 'ref', ref: 'channels', required: true },
        { key: 'regionId', label: 'منطقه', type: 'ref', ref: 'regions', required: true },
        { key: 'tier', label: 'سطح مشتری', type: 'select', options: ['کلیدی', 'مهم', 'عادی'], default: 'عادی' },
        { key: 'creditLimit', label: 'سقف اعتبار', type: 'money', min: 0 },
        { key: 'paymentDays', label: 'مهلت پرداخت (روز)', type: 'number', min: 0, default: 30 }
      ]
    },

    /* ------------------------------ داده‌های عملیاتی ------------------------------ */
    salesActuals: {
      naturalKey: ['period', 'productId', 'customerId'],
      label: 'فروش واقعی', single: 'رکورد فروش', group: 'txn', icon: 'chart', heavy: true,
      display: function (r, S) { return IBP.jalali.label(r.period) + ' / ' + S.name('products', r.productId); },
      fields: [
        { key: 'period', label: 'دوره', type: 'period', required: true, width: 110 },
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'customerId', label: 'مشتری', type: 'ref', ref: 'customers', required: true },
        { key: 'qty', label: 'مقدار', type: 'number', min: 0, required: true },
        { key: 'revenue', label: 'مبلغ فروش', type: 'money', min: 0, required: true }
      ]
    },
    forecasts: {
      naturalKey: ['version', 'cycle', 'period', 'productId'],
      label: 'پیش‌بینی تقاضا', single: 'رکورد پیش‌بینی', group: 'txn', icon: 'trend', heavy: true,
      display: function (r, S) { return IBP.jalali.label(r.period) + ' / ' + S.name('products', r.productId); },
      fields: [
        { key: 'version', label: 'نسخه', type: 'select', options: ['آماری', 'فروش', 'بازاریابی', 'اجماعی', 'تأییدشده'], required: true },
        { key: 'cycle', label: 'چرخه', type: 'period', required: true, hint: 'ماهی که پیش‌بینی در آن ثبت شده' },
        { key: 'period', label: 'دوره', type: 'period', required: true },
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'qty', label: 'مقدار', type: 'number', min: 0, required: true },
        { key: 'lo', label: 'حد پایین (۸۰٪)', type: 'number', min: 0 },
        { key: 'hi', label: 'حد بالا (۸۰٪)', type: 'number', min: 0 },
        { key: 'method', label: 'روش', type: 'text' }
      ]
    },
    budgets: {
      naturalKey: ['period', 'productId'],
      label: 'بودجه فروش', single: 'رکورد بودجه', group: 'txn', icon: 'target', heavy: true,
      display: function (r, S) { return IBP.jalali.label(r.period) + ' / ' + S.name('products', r.productId); },
      fields: [
        { key: 'period', label: 'دوره', type: 'period', required: true },
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'qty', label: 'مقدار', type: 'number', min: 0, required: true },
        { key: 'revenue', label: 'مبلغ', type: 'money', min: 0, required: true }
      ]
    },
    inventory: {
      naturalKey: ['productId', 'warehouseId'],
      label: 'موجودی محصول', single: 'رکورد موجودی', group: 'txn', icon: 'stack',
      display: function (r, S) { return S.name('products', r.productId) + ' / ' + S.name('warehouses', r.warehouseId); },
      fields: [
        { key: 'productId', label: 'محصول', type: 'ref', ref: 'products', required: true },
        { key: 'warehouseId', label: 'انبار', type: 'ref', ref: 'warehouses', required: true },
        { key: 'qty', label: 'موجودی', type: 'number', min: 0, required: true },
        { key: 'asOf', label: 'تاریخ موجودی', type: 'date' }
      ]
    },
    materialInventory: {
      naturalKey: ['materialId', 'warehouseId'],
      label: 'موجودی مواد', single: 'رکورد موجودی مواد', group: 'txn', icon: 'stack',
      display: function (r, S) { return S.name('materials', r.materialId) + ' / ' + S.name('warehouses', r.warehouseId); },
      fields: [
        { key: 'materialId', label: 'ماده', type: 'ref', ref: 'materials', required: true },
        { key: 'warehouseId', label: 'انبار', type: 'ref', ref: 'warehouses', required: true },
        { key: 'qty', label: 'موجودی', type: 'number', min: 0, required: true },
        { key: 'onOrder', label: 'در راه (سفارش باز)', type: 'number', min: 0, default: 0 },
        { key: 'asOf', label: 'تاریخ موجودی', type: 'date' }
      ]
    },

    /* ------------------------------ چرخه IBP ------------------------------ */
    cycleSteps: {
      naturalKey: ['cycle', 'order'],
      label: 'مراحل چرخه IBP', single: 'مرحله چرخه', group: 'process', icon: 'cycle',
      display: function (r) { return IBP.jalali.label(r.cycle) + ' / ' + r.name; },
      fields: [
        { key: 'cycle', label: 'چرخه', type: 'period', required: true },
        { key: 'order', label: 'ترتیب', type: 'number', min: 1, required: true, width: 70 },
        { key: 'name', label: 'مرحله', type: 'text', required: true },
        { key: 'owner', label: 'مسئول', type: 'text' },
        { key: 'dueDate', label: 'سررسید', type: 'date' },
        { key: 'status', label: 'وضعیت', type: 'select', options: ['انجام نشده', 'در حال انجام', 'تکمیل', 'تأخیر'], default: 'انجام نشده' },
        { key: 'notes', label: 'یادداشت', type: 'textarea' }
      ]
    }
  };

  ENTITIES.events = {
    label: 'مناسبت‌ها و رویدادها', single: 'مناسبت', group: 'demand', icon: 'flag',
    fields: [
      { key: 'code', label: 'کد', type: 'text', required: true, unique: true, width: 90 },
      { key: 'name', label: 'نام مناسبت', type: 'text', required: true },
      { key: 'kind', label: 'نوع', type: 'select', options: ['رمضان', 'محرم', 'کمپین', 'سایر'], required: true, hint: 'رمضان و محرم از تقویم قمری خودکار محاسبه می‌شوند' },
      { key: 'startPeriod', label: 'از ماه', type: 'period', hint: 'برای کمپین و سایر' },
      { key: 'endPeriod', label: 'تا ماه', type: 'period' },
      { key: 'notes', label: 'توضیحات', type: 'textarea' }
    ]
  };
  ENTITIES.eventImpacts = {
    label: 'اثر مناسبت‌ها', single: 'اثر مناسبت', group: 'demand', icon: 'trend',
    naturalKey: ['eventId', 'familyId'],
    display: function (r, S) { return S.name('events', r.eventId) + ' ← ' + S.name('families', r.familyId); },
    fields: [
      { key: 'eventId', label: 'مناسبت', type: 'ref', ref: 'events', required: true },
      { key: 'familyId', label: 'خانواده محصول', type: 'ref', ref: 'families', required: true },
      { key: 'uplift', label: 'اثر بر تقاضا', type: 'percent', min: -1, max: 10, required: true, hint: 'برای یک ماه کامل مناسبت؛ منفی یعنی کاهش' },
      { key: 'source', label: 'منبع', type: 'select', options: ['کارشناسی', 'برآورد آماری'], default: 'کارشناسی' }
    ]
  };
  ENTITIES.demandAdjustments = {
    label: 'سوابق تغییر پیش‌بینی', single: 'تغییر پیش‌بینی', group: 'demand', icon: 'edit', heavy: true,
    display: function (r) { return r.target + ' / ' + IBP.jalali.label(r.period); },
    fields: [
      { key: 'cycle', label: 'چرخه', type: 'period', required: true },
      { key: 'period', label: 'ماه', type: 'period', required: true },
      { key: 'level', label: 'سطح', type: 'select', options: ['محصول', 'خانواده', 'شرکت'], required: true },
      { key: 'target', label: 'مورد', type: 'text', required: true },
      { key: 'oldQty', label: 'مقدار قبلی', type: 'number' },
      { key: 'newQty', label: 'مقدار جدید', type: 'number' },
      { key: 'reason', label: 'دلیل', type: 'select', options: ['کمپین و تبلیغات', 'مناسبت', 'قرارداد یا سفارش جدید', 'تقاضای درون‌گروهی', 'محدودیت بازار', 'اصلاح داده', 'ورود از Excel', 'سایر'], default: 'سایر' },
      { key: 'note', label: 'توضیح', type: 'textarea' },
      { key: 'at', label: 'زمان ثبت', type: 'text' }
    ]
  };

  var GROUPS = [
    { id: 'org', label: 'ساختار سازمان' },
    { id: 'product', label: 'محصول' },
    { id: 'supply', label: 'تأمین' },
    { id: 'market', label: 'بازار و مشتری' },
    { id: 'txn', label: 'داده‌های عملیاتی' },
    { id: 'demand', label: 'برنامه‌ریزی تقاضا' },
    { id: 'process', label: 'فرایند' }
  ];

  Object.keys(ENTITIES).forEach(function (k) {
    var e = ENTITIES[k];
    e.key = k;
    // کلید طبیعی برای تشخیص رکورد تکراری هنگام ورود داده (پیش‌فرض: کد)
    if (!e.naturalKey && e.fields.some(function (f) { return f.key === 'code'; })) e.naturalKey = ['code'];
  });

  IBP.schema = {
    ENTITIES: ENTITIES,
    GROUPS: GROUPS,
    UOMS: UOMS,
    entity: function (k) { return ENTITIES[k]; },
    keys: function () { return Object.keys(ENTITIES); },
    field: function (k, f) { return (ENTITIES[k].fields || []).filter(function (x) { return x.key === f; })[0]; },
    /** موجودیت‌ها و فیلدهایی که به موجودیت داده‌شده ارجاع دارند */
    referrers: function (target) {
      var out = [];
      Object.keys(ENTITIES).forEach(function (k) {
        ENTITIES[k].fields.forEach(function (f) {
          if (f.type === 'ref' && f.ref === target) out.push({ entity: k, field: f.key });
        });
      });
      return out;
    },
    /** ترتیب موجودیت‌ها بر اساس وابستگی (ابتدا موجودیت‌هایی که دیگران به آن‌ها ارجاع می‌دهند) */
    order: function () {
      var done = [], seen = {};
      function visit(k) {
        if (seen[k]) return;
        seen[k] = true;
        ENTITIES[k].fields.forEach(function (f) { if (f.type === 'ref' && f.ref !== k) visit(f.ref); });
        done.push(k);
      }
      Object.keys(ENTITIES).forEach(visit);
      return done;
    },
    defaults: function (k) {
      var o = {};
      ENTITIES[k].fields.forEach(function (f) { if (f.default !== undefined) o[f.key] = f.default; });
      return o;
    }
  };
})(window.IBP = window.IBP || {});
