/*
 * هلدینگ: فهرست شرکت‌ها و فضای کاری هر شرکت.
 *
 * هر شرکت (کد شرکت = کد پلنت) پایگاه داده جداگانه خودش را دارد و IBP خودش را اجرا می‌کند.
 * فهرست شرکت‌ها، نام هلدینگ و خلاصه آخرین وضعیت هر شرکت در پایگاه داده «ibp-holding» نگه‌داری می‌شود.
 * ورود به یک شرکت یعنی اتصال IBP.store به پایگاه داده همان شرکت.
 */
(function (IBP) {
  'use strict';

  var REG_DB = 'ibp-holding';
  var state = { holding: { name: '' }, companies: [], current: null };
  var db = null, memoryOnly = false;

  function req2p(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }

  function openReg() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { memoryOnly = true; return resolve(); }
      var r = window.indexedDB.open(REG_DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv', { keyPath: 'key' }); };
      r.onsuccess = function () { db = r.result; resolve(); };
      r.onerror = function () { memoryOnly = true; resolve(); };
    });
  }
  function readKV(key) {
    if (!db) return Promise.resolve(null);
    return req2p(db.transaction('kv', 'readonly').objectStore('kv').get(key)).then(function (x) { return x ? x.value : null; });
  }
  function writeKV(key, value) {
    if (!db) return Promise.resolve();
    var tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put({ key: key, value: value });
    return new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
  }
  function persist() {
    return Promise.all([writeKV('holding', state.holding), writeKV('companies', state.companies)]);
  }
  function dbNameFor(code) { return 'ibp-co-' + String(code).toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }

  function adapterFor(c) {
    return memoryOnly ? new IBP.store.adapters.MemoryAdapter() : new IBP.store.adapters.IndexedDBAdapter(c.dbName);
  }

  /** خلاصه شرکت جاری برای صفحه ورود و نمای هلدینگ */
  function summarize() {
    var S = IBP.store, A = IBP.analytics, J = IBP.jalali;
    if (!S.count('products')) return { products: 0, updatedAt: new Date().toISOString() };
    var ctx = A.ctx(), cyc = ctx.cycle;
    var ltm = J.range(J.addMonths(cyc, -12), 12), prev = J.range(J.addMonths(cyc, -24), 12);
    var ext = function (p) { return !p.intercompany; };
    var rev = A.sum(ltm, function (p) { return A.salesTotal(p).revenue; });
    var revExt = A.sum(ltm, function (p) { return A.salesTotal(p, ext).revenue; });
    var revPrev = A.sum(prev, function (p) { return A.salesTotal(p).revenue; });
    var tons = A.sum(ltm, function (p) { var t = 0, m = A.salesIndex().get(p); if (m) m.forEach(function (v, pid) { var pr = S.get('products', pid); if (pr) t += v.qty * (pr.unitWeightKg || 0) / 1000; }); return t; });
    var acc = A.accuracy(J.range(J.addMonths(cyc, -3), 3));
    var alerts = A.alerts();
    var steps = S.all('cycleSteps').filter(function (s) { return s.cycle === cyc; });
    return {
      products: S.count('products'), revenue: rev, revenueExternal: revExt, revenuePrev: revPrev, tons: tons,
      accuracy: acc.accuracy, bias: acc.bias,
      critical: alerts.filter(function (a) { return a.level === 'critical'; }).length, warnings: alerts.filter(function (a) { return a.level !== 'critical'; }).length,
      cycle: cyc, cycleDone: steps.filter(function (s) { return s.status === 'تکمیل'; }).length, cycleSteps: steps.length,
      spark: ltm.map(function (p) { return A.salesTotal(p).revenue; }),
      updatedAt: new Date().toISOString()
    };
  }

  var H = {
    state: function () { return state; },
    holdingName: function () { return state.holding.name || (IBP.templates.HOLDING && IBP.templates.HOLDING.name) || 'هلدینگ'; },
    list: function () { return state.companies; },
    get: function (id) { return state.companies.filter(function (c) { return c.id === id; })[0] || null; },
    byCode: function (code) { return state.companies.filter(function (c) { return String(c.code).toUpperCase() === String(code).toUpperCase(); })[0] || null; },
    current: function () { return state.current; },

    init: function (progress) {
      return openReg().then(function () { return Promise.all([readKV('holding'), readKV('companies')]); }).then(function (r) {
        state.holding = r[0] || { name: IBP.templates.HOLDING.name, version: IBP.templates.VERSION };
        state.companies = r[1] || [];
        if (state.companies.length) return (state.holding.version || 1) < IBP.templates.VERSION ? H.upgrade(progress) : null;
        // نخستین اجرا: داده نسخه قبلی (در صورت وجود) و شرکت‌های نمونه هلدینگ
        var legacy = new IBP.store.adapters.IndexedDBAdapter(IBP.store.LEGACY_DB);
        return legacy.open().then(function () { return legacy.loadAll(); }).then(function (data) {
          legacy.close();
          var prods = (data.records.products || []).length;
          if (prods) {
            state.companies.push({ id: 'legacy', code: 'OLD', name: ((data.meta.settings || {}).companyName || 'شرکت قبلی') + ' (داده نسخه قبل)', templateId: '', dbName: IBP.store.LEGACY_DB, createdAt: new Date().toISOString() });
          }
        }, function () { /* پایگاه داده قبلی وجود ندارد */ }).then(function () {
          return H.createDemo(progress);
        });
      });
    },

    /**
     * ارتقای هلدینگ نمونه نسخه قبل: شرکت‌های نمونه قدیمی حذف و شرکت‌های هلدینگ زر ساخته می‌شوند.
     * شرکت‌هایی که کاربر خودش ساخته یا نامشان را تغییر داده دست نمی‌خورند.
     */
    upgrade: function (progress) {
      var T = IBP.templates;
      var old = state.companies.filter(function (c) { return T.LEGACY_DEMO[c.code] && T.LEGACY_DEMO[c.code] === c.name; });
      var chain = Promise.resolve();
      old.forEach(function (c) { chain = chain.then(function () { return H.remove(c.id); }); });
      return chain.then(function () {
        if (!state.holding.name || state.holding.name === T.LEGACY_HOLDING) state.holding.name = T.HOLDING.name;
        state.holding.version = T.VERSION;
        return H.createDemo(progress);
      });
    },

    /** ساخت شرکت‌های نمونه هلدینگ (هر کدام با داده الگوی خودش) */
    createDemo: function (progress) {
      var list = IBP.templates.list.slice();
      var chain = Promise.resolve();
      list.forEach(function (t, i) {
        chain = chain.then(function () {
          if (progress) progress('ساخت داده نمونه «' + t.company + '» (' + (i + 1) + ' از ' + list.length + ')');
          if (H.byCode(t.code)) return null;
          return H.create({ code: t.code, name: t.company, templateId: t.id }, { seed: true, keepOpen: false });
        });
      });
      return chain.then(function () { return persist(); });
    },

    /** ایجاد شرکت جدید. opts.seed: ساخت داده نمونه از الگو */
    create: function (info, opts) {
      opts = opts || {};
      var code = String(info.code || '').trim().toUpperCase();
      if (!code) return Promise.reject(new Error('کد شرکت الزامی است'));
      if (H.byCode(code)) return Promise.reject(new Error('کد «' + code + '» تکراری است'));
      var tplInfo = info.templateId ? IBP.templates.find(info.templateId) : null;
      var c = { id: 'co-' + code.toLowerCase() + '-' + Date.now().toString(36), code: code, name: info.name || code, templateId: info.templateId || '', activity: info.activity || '', model: info.businessModel || (tplInfo ? tplInfo.model : '') || 'B2C', dbName: dbNameFor(code), createdAt: new Date().toISOString() };
      state.companies.push(c);
      var S = IBP.store;
      return S.init(adapterFor(c)).then(function () {
        var tpl = info.templateId ? IBP.templates.get(info.templateId) : null;
        S.saveSettings({ companyName: c.name, companyCode: c.code, industry: tpl ? tpl.name : (info.activity || ''), templateId: info.templateId || '', businessModel: info.businessModel || (tpl ? tpl.model : '') || 'B2C' });
        if (opts.seed && tpl) return IBP.seed.load({ templateId: tpl.id, companyName: c.name, companyCode: c.code, cyclePeriod: IBP.jalali.currentPeriod() });
        S.setMeta('seeded', { at: new Date().toISOString(), empty: true });
        return S.flush();
      }).then(function () {
        c.summary = summarize();
        c.industry = S.settings().industry;
        return persist();
      }).then(function () { return c; }, function (err) {
        state.companies = state.companies.filter(function (x) { return x.id !== c.id; });
        return persist().then(function () { throw err; });
      });
    },

    update: function (id, patch) {
      var c = H.get(id);
      if (!c) return Promise.reject(new Error('شرکت یافت نشد'));
      if (patch.code && patch.code.toUpperCase() !== c.code && H.byCode(patch.code)) return Promise.reject(new Error('کد تکراری است'));
      Object.assign(c, patch, patch.code ? { code: patch.code.toUpperCase() } : {});
      if (state.current && state.current.id === id) IBP.store.saveSettings({ companyName: c.name, companyCode: c.code, businessModel: c.model || 'B2C' });
      return persist().then(function () { return c; });
    },
    remove: function (id) {
      var c = H.get(id);
      if (!c) return Promise.resolve();
      state.companies = state.companies.filter(function (x) { return x.id !== id; });
      return persist().then(function () {
        if (window.indexedDB) return new Promise(function (res) { var r = window.indexedDB.deleteDatabase(c.dbName); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; });
      });
    },
    setHoldingName: function (name) { state.holding.name = name; return persist(); },

    /** ورود به فضای کاری یک شرکت */
    enter: function (id) {
      var c = H.get(id);
      if (!c) return Promise.reject(new Error('شرکت یافت نشد'));
      return IBP.store.init(adapterFor(c)).then(function () {
        state.current = c;
        var st = IBP.store.settings();
        if (!c.model) c.model = st.businessModel || 'B2C';
        if (st.companyName !== c.name || st.companyCode !== c.code || st.businessModel !== c.model) IBP.store.saveSettings({ companyName: c.name, companyCode: c.code, businessModel: c.model });
        try { sessionStorage.setItem('ibp-company', c.id); localStorage.setItem('ibp-last-company', c.id); } catch (e) { /* اختیاری */ }
        return c;
      });
    },
    /** ثبت خلاصه شرکت جاری (هنگام خروج یا پس از تغییر داده) */
    saveSummary: function () {
      if (!state.current) return Promise.resolve();
      state.current.summary = summarize();
      state.current.industry = IBP.store.settings().industry;
      state.current.model = IBP.store.settings().businessModel || state.current.model;
      return persist();
    },
    leave: function () {
      var p = H.saveSummary();
      state.current = null;
      try { sessionStorage.removeItem('ibp-company'); } catch (e) { /* اختیاری */ }
      return p;
    },
    sessionCompany: function () { try { return sessionStorage.getItem('ibp-company'); } catch (e) { return null; } },
    lastCompany: function () { try { return localStorage.getItem('ibp-last-company'); } catch (e) { return null; } },

    /** خواندن داده یک شرکت دیگر هلدینگ (فقط خواندنی؛ برای جریان‌های درون‌گروهی) */
    readCompany: function (code) {
      var c = H.byCode(code);
      if (!c) return Promise.resolve(null);
      if (state.current && state.current.id === c.id) {
        var data = {};
        IBP.schema.keys().forEach(function (k) { data[k] = IBP.store.all(k); });
        return Promise.resolve({ company: c, records: data, settings: IBP.store.settings(), meta: { icRequests: IBP.store.meta('icRequests') } });
      }
      if (memoryOnly) return Promise.resolve(null);
      var a = new IBP.store.adapters.IndexedDBAdapter(c.dbName);
      return a.open().then(function () { return a.loadAll(); }).then(function (d) {
        a.close();
        return { company: c, records: d.records, settings: Object.assign(IBP.store.defaultSettings(), d.meta.settings || {}), meta: d.meta || {} };
      });
    },
    summarize: summarize
  };

  IBP.holding = H;
})(window.IBP = window.IBP || {});
