/*
 * لایه دسترسی به داده.
 *
 * صفحه‌ها فقط با IBP.store کار می‌کنند و از محل ذخیره خبر ندارند.
 * تمام داده‌ها هنگام شروع در حافظه بارگذاری می‌شوند (خواندن همزمان و سریع)
 * و هر تغییر از طریق یک «آداپتور» ذخیره می‌شود:
 *   - IndexedDBAdapter : ذخیره محلی در مرورگر / Electron (فاز فعلی)
 *   - MemoryAdapter    : بدون ذخیره دائمی (اگر IndexedDB در دسترس نباشد)
 *   - ApiAdapter       : اتصال به سرور / موتور تحلیل پایتون (فاز سرور) — همین رابط را پیاده می‌کند
 *
 * رابط آداپتور:
 *   open() → Promise
 *   loadAll() → Promise<{ records: {entity: [rec]}, meta: {key: value} }>
 *   put(entity, recs[]) → Promise
 *   remove(entity, ids[]) → Promise
 *   clearEntity(entity) → Promise
 *   setMeta(key, value) → Promise
 *   clearAll() → Promise
 */
(function (IBP) {
  'use strict';

  var DB_NAME = 'ibp-integrated-business-planning';
  var DB_VERSION = 1;

  /* ------------------------------ IndexedDB ------------------------------ */
  /** هر شرکت هلدینگ پایگاه داده جداگانه خود را دارد (dbName) */
  function IndexedDBAdapter(dbName) { this.db = null; this.kind = 'indexeddb'; this.name = dbName || DB_NAME; }

  function req2p(req) {
    return new Promise(function (res, rej) {
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { rej(req.error); };
    });
  }
  function tx2p(tx) {
    return new Promise(function (res, rej) {
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error || new Error('تراکنش لغو شد')); };
    });
  }

  IndexedDBAdapter.prototype.open = function () {
    var self = this;
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('IndexedDB در دسترس نیست'));
      var req = window.indexedDB.open(self.name, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          var st = db.createObjectStore('records', { keyPath: 'k' });
          st.createIndex('e', 'e', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = function () { self.db = req.result; res(); };
      req.onerror = function () { rej(req.error); };
      req.onblocked = function () { rej(new Error('پایگاه داده توسط پنجره دیگری قفل شده است')); };
    });
  };
  IndexedDBAdapter.prototype.loadAll = function () {
    var tx = this.db.transaction(['records', 'meta'], 'readonly');
    return Promise.all([req2p(tx.objectStore('records').getAll()), req2p(tx.objectStore('meta').getAll())])
      .then(function (r) {
        var records = {}, meta = {};
        r[0].forEach(function (row) { (records[row.e] = records[row.e] || []).push(row.r); });
        r[1].forEach(function (m) { meta[m.key] = m.value; });
        return { records: records, meta: meta };
      });
  };
  IndexedDBAdapter.prototype.put = function (entity, recs) {
    var tx = this.db.transaction('records', 'readwrite'), st = tx.objectStore('records');
    recs.forEach(function (r) { st.put({ k: entity + ':' + r.id, e: entity, r: r }); });
    return tx2p(tx);
  };
  IndexedDBAdapter.prototype.remove = function (entity, ids) {
    var tx = this.db.transaction('records', 'readwrite'), st = tx.objectStore('records');
    ids.forEach(function (id) { st.delete(entity + ':' + id); });
    return tx2p(tx);
  };
  IndexedDBAdapter.prototype.clearEntity = function (entity) {
    var tx = this.db.transaction('records', 'readwrite');
    tx.objectStore('records').delete(IDBKeyRange.bound(entity + ':', entity + ':￿'));
    return tx2p(tx);
  };
  IndexedDBAdapter.prototype.setMeta = function (key, value) {
    var tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put({ key: key, value: value });
    return tx2p(tx);
  };
  IndexedDBAdapter.prototype.close = function () { if (this.db) { this.db.close(); this.db = null; } };
  IndexedDBAdapter.prototype.clearAll = function () {
    var tx = this.db.transaction(['records', 'meta'], 'readwrite');
    tx.objectStore('records').clear();
    tx.objectStore('meta').clear();
    return tx2p(tx);
  };

  /* ------------------------------ Memory ------------------------------ */
  function MemoryAdapter() { this.kind = 'memory'; }
  MemoryAdapter.prototype.open = function () { return Promise.resolve(); };
  MemoryAdapter.prototype.close = function () {};
  MemoryAdapter.prototype.loadAll = function () { return Promise.resolve({ records: {}, meta: {} }); };
  MemoryAdapter.prototype.put = MemoryAdapter.prototype.remove = MemoryAdapter.prototype.clearEntity =
    MemoryAdapter.prototype.setMeta = MemoryAdapter.prototype.clearAll = function () { return Promise.resolve(); };

  /* ------------------------------ Store ------------------------------ */
  var DEFAULT_SETTINGS = {
    companyName: 'شرکت نمونه',
    industry: '',
    templateId: '',
    businessModel: 'B2C',       // B2C: فروش مصرفی از راه شعب و زنجیره‌ای؛ B2B: فروش صنعتی
    currency: 'ریال',
    displayScale: 1e9,
    cyclePeriod: null,          // ماه جاری چرخه برنامه‌ریزی (yyyymm)
    historyMonths: 36,
    horizonMonths: 18,
    fiscalStartMonth: 1,
    frozenMonths: 1,            // افق منجمد برنامه
    serviceLevelTarget: 0.95,
    forecastAccuracyTarget: 0.8,
    utilizationWarn: 0.85,
    utilizationMax: 1.0,
    excessMonths: 3,            // پوشش بیش از این مقدار = مازاد
    abcA: 0.8, abcB: 0.95,      // مرز سهم تجمعی کلاس‌های A و B
    xyzX: 0.2, xyzY: 0.5,       // مرز ضریب تغییرات کلاس‌های X و Y
    ssMethod: 'statistical',    // روش ذخیره اطمینان: statistical (سطح خدمت × خطای پیش‌بینی) | days
    overtimePct: 0.1,           // سقف اضافه‌کاری نسبت به ظرفیت عادی
    prebuildMonths: 3,          // حداکثر ماه‌های پیش‌ساخت پیش از تقاضا
    productionLeadDays: 7,      // زمان تولید و آزادسازی محصول
    fcOrigins: 12,              // تعداد مبدأهای بک‌تست (ماه‌های آخر)
    fcLead: 3,                  // افق ارزیابی بک‌تست (ماه)
    fcMetric: 'wmape',          // معیار انتخاب روش: wmape | rmse | wmapeBias
    fcEnsemble: true,           // ترکیب سه روش برتر در رقابت روش‌ها
    engineUrl: 'http://127.0.0.1:8765',
    theme: 'auto'
  };

  var data = {};     // entity → [records]
  var index = {};    // entity → Map(id → record)
  var codeIndex = {};
  var meta = {};
  var adapter = null;
  var listeners = [];
  var seq = 0;
  var pending = Promise.resolve();

  function uid() {
    seq = (seq + 1) % 1679616;
    return Date.now().toString(36) + seq.toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 5);
  }

  function ensure(entity) {
    if (!data[entity]) { data[entity] = []; index[entity] = new Map(); codeIndex[entity] = null; }
  }
  function rebuild(entity) {
    ensure(entity);
    var m = new Map();
    data[entity].forEach(function (r) { m.set(r.id, r); });
    index[entity] = m;
    codeIndex[entity] = null;
  }
  function queue(fn) {
    // نوشتن‌ها به ترتیب انجام می‌شوند تا ترتیب تغییرات در پایگاه داده حفظ شود؛
    // آداپتور همان لحظه ثبت می‌شود تا با تعویض شرکت، نوشتن به پایگاه داده شرکت دیگر نرود
    var a = adapter;
    pending = pending.then(function () { return fn(a); }).catch(function (e) {
      console.error(e);
      if (IBP.ui) IBP.ui.toast('خطا در ذخیره داده: ' + (e && e.message ? e.message : e), 'error');
    });
    return pending;
  }
  function emit(evt) {
    S.version++;
    listeners.forEach(function (cb) { try { cb(evt); } catch (e) { console.error(e); } });
  }

  var S = {
    version: 0,
    adapterKind: function () { return adapter ? adapter.kind : null; },

    LEGACY_DB: DB_NAME,
    dbName: function () { return adapter ? adapter.name : null; },
    init: function (customAdapter) {
      if (adapter && adapter.close) { var old = adapter; pending = pending.then(function () { old.close(); }); }
      adapter = customAdapter || new IndexedDBAdapter();
      return adapter.open().catch(function (e) {
        console.warn('IndexedDB unavailable, using memory store', e);
        adapter = new MemoryAdapter();
        return adapter.open();
      }).then(function () { return pending; }).then(function () { return adapter.loadAll(); }).then(function (loaded) {
        data = {}; index = {}; codeIndex = {};
        IBP.schema.keys().forEach(ensure);
        Object.keys(loaded.records).forEach(function (e) { data[e] = loaded.records[e]; rebuild(e); });
        meta = loaded.meta || {};
        meta.settings = Object.assign({}, DEFAULT_SETTINGS, meta.settings || {});
        if (!meta.settings.cyclePeriod) meta.settings.cyclePeriod = IBP.jalali.currentPeriod();
        S.version++;
        return { empty: !meta.seeded && S.count('products') === 0 };
      });
    },
    flush: function () { return pending; },

    /* ----- خواندن ----- */
    all: function (entity) { ensure(entity); return data[entity]; },
    count: function (entity) { ensure(entity); return data[entity].length; },
    get: function (entity, id) { ensure(entity); return index[entity].get(id) || null; },
    byCode: function (entity, code) {
      ensure(entity);
      if (!codeIndex[entity]) {
        var m = new Map();
        data[entity].forEach(function (r) { if (r.code !== undefined) m.set(String(r.code), r); });
        codeIndex[entity] = m;
      }
      return codeIndex[entity].get(String(code)) || null;
    },
    filter: function (entity, fn) { return S.all(entity).filter(fn); },
    /** نام قابل نمایش یک رکورد */
    name: function (entity, id) {
      var r = S.get(entity, id);
      if (!r) return id ? '؟' : '—';
      var def = IBP.schema.entity(entity);
      if (def && def.display) return def.display(r, S);
      return r.name || r.code || r.id;
    },

    /* ----- نوشتن ----- */
    insert: function (entity, rec) {
      ensure(entity);
      rec = Object.assign({}, rec);
      if (!rec.id) rec.id = uid();
      data[entity].push(rec);
      index[entity].set(rec.id, rec);
      codeIndex[entity] = null;
      queue(function (a) { return a.put(entity, [rec]); });
      emit({ type: 'insert', entity: entity, id: rec.id });
      return rec;
    },
    update: function (entity, id, patch) {
      var r = S.get(entity, id);
      if (!r) throw new Error('رکورد یافت نشد');
      Object.assign(r, patch, { id: id });
      codeIndex[entity] = null;
      queue(function (a) { return a.put(entity, [r]); });
      emit({ type: 'update', entity: entity, id: id });
      return r;
    },
    remove: function (entity, ids) {
      ids = Array.isArray(ids) ? ids : [ids];
      var set = new Set(ids);
      data[entity] = data[entity].filter(function (r) { return !set.has(r.id); });
      rebuild(entity);
      queue(function (a) { return a.remove(entity, ids); });
      emit({ type: 'remove', entity: entity, ids: ids });
    },
    /** درج یا جایگزینی گروهی (برای ورود داده و تولید داده تستی) */
    bulkUpsert: function (entity, recs, opts) {
      ensure(entity);
      recs.forEach(function (rec) {
        if (!rec.id) rec.id = uid();
        var cur = index[entity].get(rec.id);
        if (cur) Object.assign(cur, rec); else { data[entity].push(rec); index[entity].set(rec.id, rec); }
      });
      codeIndex[entity] = null;
      var stored = recs.map(function (r) { return index[entity].get(r.id); });
      queue(function (a) { return a.put(entity, stored); });
      if (!opts || !opts.silent) emit({ type: 'bulk', entity: entity });
      return stored;
    },
    replaceAll: function (entity, recs, opts) {
      ensure(entity);
      recs.forEach(function (r) { if (!r.id) r.id = uid(); });
      data[entity] = recs;
      rebuild(entity);
      queue(function (a) { return a.clearEntity(entity).then(function () { return recs.length ? a.put(entity, recs) : null; }); });
      if (!opts || !opts.silent) emit({ type: 'replace', entity: entity });
    },
    clearAll: function () {
      data = {}; index = {}; codeIndex = {};
      IBP.schema.keys().forEach(ensure);
      meta = { settings: Object.assign({}, DEFAULT_SETTINGS, { cyclePeriod: IBP.jalali.currentPeriod() }) };
      queue(function (a) { return a.clearAll(); });
      emit({ type: 'clear' });
    },
    touch: function () { emit({ type: 'bulk' }); },

    /* ----- تنظیمات و متادیتا ----- */
    settings: function () { return meta.settings || DEFAULT_SETTINGS; },
    saveSettings: function (patch) {
      meta.settings = Object.assign({}, S.settings(), patch);
      var v = meta.settings;
      queue(function (a) { return a.setMeta('settings', v); });
      emit({ type: 'settings' });
      return v;
    },
    meta: function (key) { return meta[key]; },
    setMeta: function (key, value) {
      meta[key] = value;
      queue(function (a) { return a.setMeta(key, value); });
    },
    defaultSettings: function () { return Object.assign({}, DEFAULT_SETTINGS); },

    /* ----- پشتیبان‌گیری ----- */
    exportAll: function () {
      var out = { app: 'Integrated Business Planning', format: 1, exportedAt: new Date().toISOString(), meta: meta, data: {} };
      IBP.schema.keys().forEach(function (k) { out.data[k] = data[k] || []; });
      return out;
    },
    importAll: function (obj) {
      if (!obj || !obj.data) throw new Error('فایل پشتیبان معتبر نیست');
      S.clearAll();
      Object.keys(obj.data).forEach(function (k) {
        if (IBP.schema.entity(k)) S.replaceAll(k, obj.data[k], { silent: true });
      });
      if (obj.meta) Object.keys(obj.meta).forEach(function (k) { S.setMeta(k, obj.meta[k]); });
      meta.settings = Object.assign({}, DEFAULT_SETTINGS, (obj.meta && obj.meta.settings) || {});
      emit({ type: 'import' });
      return S.flush();
    },

    on: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
    uid: uid,
    adapters: { IndexedDBAdapter: IndexedDBAdapter, MemoryAdapter: MemoryAdapter }
  };

  IBP.store = S;
})(window.IBP = window.IBP || {});
