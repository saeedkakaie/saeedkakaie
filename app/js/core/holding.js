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
  function srv() { return !!(IBP.server && IBP.server.active()); }
  function coPath(code, p) { return '/api/companies/' + encodeURIComponent(String(code).toUpperCase()) + (p || ''); }
  function persist() {
    if (srv()) {
      // در حالت سرور فقط خلاصه‌های تازه شرکت‌ها فرستاده می‌شود (فهرست شرکت‌ها در خود سرور است)
      return Promise.all(state.companies.filter(function (c) { return c.summary && c._sent !== c.summary; }).map(function (c) {
        var sm = c.summary;
        return IBP.server.api('PUT', coPath(c.code, '/summary'), sm).then(function () { c._sent = sm; }, function () { /* بدون دسترسی */ });
      }));
    }
    return Promise.all([writeKV('holding', state.holding), writeKV('companies', state.companies)]);
  }
  function dbNameFor(code) { return 'ibp-co-' + String(code).toLowerCase().replace(/[^a-z0-9_-]/g, '_'); }

  function adapterFor(c) {
    if (srv()) return new IBP.store.adapters.ApiAdapter(c.code);
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
      sparkExt: ltm.map(function (p) { return A.salesTotal(p, ext).revenue; }),
      tonsSeries: ltm.map(function (p) { var t = 0, m = A.salesIndex().get(p); if (m) m.forEach(function (v, pid) { var pr = S.get('products', pid); if (pr) t += v.qty * (pr.unitWeightKg || 0) / 1000; }); return t; }),
      plan: planSummary(),
      updatedAt: new Date().toISOString()
    };
  }

  /** خلاصه برنامه تأمین و مالی شرکت (فاز ۴ و ۵) برای نمای تلفیقی هلدینگ */
  function planSummary() {
    if (!IBP.supply || !IBP.finance) return null;
    try {
      var c = IBP.supply.current(), f = IBP.finance.current(), n = f.months12, per = f.periods.slice(0, n);
      var ext = { revenue: new Array(n).fill(0), gross: new Array(n).fill(0) };
      Object.keys(f.byProduct).forEach(function (pid) {
        var x = f.byProduct[pid];
        if (x.product.intercompany) return;
        var r = c.plan.rows.filter(function (rr) { return rr.product.id === pid; })[0];
        if (!r) return;
        var u = f.unitCosts[pid];
        per.forEach(function (p, t) {
          var sold = Math.max(0, r.demand[t] - r.shortage[t]);
          var price = IBP.analytics.priceAt(x.product, p) * (1 - IBP.analytics.avgDiscount());
          ext.revenue[t] += sold * price;
          ext.gross[t] += sold * price - (x.qty ? x.cogs / x.qty : (u ? u.std : 0)) * sold;
        });
      });
      // درخواست‌های درون‌گروهی این شرکت (تن در ماه) به تفکیک شرکت تأمین‌کننده و کالا
      var ic = {};
      Object.keys(c.mrp.ic).forEach(function (code) {
        var x = c.mrp.ic[code];
        ic[code] = { tons: x.tons.slice(0, n), total: x.tons.slice(0, n).reduce(function (a, b) { return a + b; }, 0), value: x.value, items: x.items.map(function (it) { return it.material.name; }) };
      });
      var k = f.kpi;
      return {
        periods: per, revenue: k.revenue, gross: k.gross, gm: k.gm, operating: k.operating, lost: k.lost, tons: k.tons,
        fillRate: k.fillRate, util: k.util, budgetGap: k.budgetGap, nwcEnd: k.nwcEnd, invEnd: k.invEnd,
        bottlenecks: c.plan.kpi.bottlenecks, overtime: c.plan.kpi.overtimeHours, prebuildTons: c.plan.kpi.prebuildTons,
        revenueExt: ext.revenue.reduce(function (a, b) { return a + b; }, 0), grossExt: ext.gross.reduce(function (a, b) { return a + b; }, 0),
        revenueExtMonthly: ext.revenue, grossMonthly: f.totals.gross.slice(0, n), tonsMonthly: f.totals.tons.slice(0, n),
        ic: ic, scenario: (IBP.finance.list().filter(function (x) { return x.chosen; })[0] || {}).name || null
      };
    } catch (e) { console.error(e); return null; }
  }

  var H = {
    state: function () { return state; },
    holdingName: function () { return state.holding.name || (IBP.templates.HOLDING && IBP.templates.HOLDING.name) || 'هلدینگ'; },
    list: function () { return state.companies; },
    get: function (id) { return state.companies.filter(function (c) { return c.id === id; })[0] || null; },
    byCode: function (code) { return state.companies.filter(function (c) { return String(c.code).toUpperCase() === String(code).toUpperCase(); })[0] || null; },
    current: function () { return state.current; },

    init: function (progress) {
      if (srv()) {
        return IBP.server.api('GET', '/api/holding').then(function (h) {
          state.holding = { name: h.name || IBP.templates.HOLDING.name, version: h.version || IBP.templates.VERSION };
          if (!h.name && IBP.server.isAdmin()) IBP.server.api('PUT', '/api/holding', { name: state.holding.name, version: state.holding.version }).catch(function () {});
          state.companies = (h.companies || []).map(function (c) {
            return { id: 'srv-' + c.code.toLowerCase(), code: c.code, name: c.name || c.code, templateId: c.templateId || '', activity: c.activity || '', model: c.model || '', createdAt: c.createdAt, dbName: 'server:' + c.code, summary: c.summary, _sent: c.summary };
          });
        });
      }
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
      var c = { id: (srv() ? 'srv-' : 'co-') + code.toLowerCase() + (srv() ? '' : '-' + Date.now().toString(36)), code: code, name: info.name || code, templateId: info.templateId || '', activity: info.activity || '', model: info.businessModel || (tplInfo ? tplInfo.model : '') || 'B2C', dbName: srv() ? 'server:' + code : dbNameFor(code), createdAt: new Date().toISOString() };
      var S = IBP.store;
      var reg = srv() ? IBP.server.api('POST', '/api/companies', { code: code, name: c.name, templateId: c.templateId, activity: c.activity, model: c.model, createdAt: c.createdAt }) : Promise.resolve();
      return reg.then(function () { state.companies.push(c); return S.init(adapterFor(c)); }).then(function () {
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
        if (srv() && H.get(c.id)) return c; // شرکت روی سرور ساخته شده؛ خطا در داده نمونه
        state.companies = state.companies.filter(function (x) { return x.id !== c.id; });
        return persist().then(function () { throw err; });
      });
    },

    update: function (id, patch) {
      var c = H.get(id);
      if (!c) return Promise.reject(new Error('شرکت یافت نشد'));
      if (patch.code && patch.code.toUpperCase() !== c.code && H.byCode(patch.code)) return Promise.reject(new Error('کد تکراری است'));
      if (srv()) {
        if (patch.code && patch.code.toUpperCase() !== c.code) return Promise.reject(new Error('کد شرکت روی سرور قابل تغییر نیست'));
        return IBP.server.api('PUT', coPath(c.code), { name: patch.name || c.name, model: patch.model || c.model, activity: patch.activity !== undefined ? patch.activity : c.activity }).then(function () {
          Object.assign(c, patch, { code: c.code });
          if (state.current && state.current.id === id) IBP.store.saveSettings({ companyName: c.name, businessModel: c.model || 'B2C' });
          return c;
        });
      }
      Object.assign(c, patch, patch.code ? { code: patch.code.toUpperCase() } : {});
      if (state.current && state.current.id === id) IBP.store.saveSettings({ companyName: c.name, companyCode: c.code, businessModel: c.model || 'B2C' });
      return persist().then(function () { return c; });
    },
    remove: function (id) {
      var c = H.get(id);
      if (!c) return Promise.resolve();
      if (srv()) return IBP.server.api('DELETE', coPath(c.code)).then(function () { state.companies = state.companies.filter(function (x) { return x.id !== id; }); });
      state.companies = state.companies.filter(function (x) { return x.id !== id; });
      return persist().then(function () {
        if (window.indexedDB) return new Promise(function (res) { var r = window.indexedDB.deleteDatabase(c.dbName); r.onsuccess = r.onerror = r.onblocked = function () { res(); }; });
      });
    },
    setHoldingName: function (name) {
      state.holding.name = name;
      return srv() ? IBP.server.api('PUT', '/api/holding', { name: name }) : persist();
    },

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
      if (srv()) {
        return IBP.server.api('GET', coPath(c.code, '/data')).then(function (d) {
          return { company: c, records: d.records, settings: Object.assign(IBP.store.defaultSettings(), (d.meta || {}).settings || {}), meta: d.meta || {} };
        }, function () { return null; });
      }
      if (memoryOnly) return Promise.resolve(null);
      var a = new IBP.store.adapters.IndexedDBAdapter(c.dbName);
      return a.open().then(function () { return a.loadAll(); }).then(function (d) {
        a.close();
        return { company: c, records: d.records, settings: Object.assign(IBP.store.defaultSettings(), d.meta.settings || {}), meta: d.meta || {} };
      });
    },
    summarize: summarize,

    /** پشتیبان کامل هلدینگ: همه شرکت‌ها با داده، تنظیمات و سوابق (برای انتقال به نسخه رومیزی یا رایانه دیگر) */
    exportHolding: function (progress) {
      var out = { app: 'Integrated Business Planning', format: 2, kind: 'holding', version: IBP.APP && IBP.APP.version, exportedAt: new Date().toISOString(), holding: { name: H.holdingName() }, companies: [] };
      var chain = Promise.resolve(), n = state.companies.length;
      state.companies.forEach(function (c, i) {
        chain = chain.then(function () {
          if (progress) progress(c, i, n);
          if (state.current && state.current.id === c.id) { var e = IBP.store.exportAll(); return { meta: e.meta, data: e.data }; }
          if (srv()) return IBP.server.api('GET', coPath(c.code, '/data')).then(function (d) { return { meta: d.meta, data: d.records }; });
          if (memoryOnly) return null;
          var a = new IBP.store.adapters.IndexedDBAdapter(c.dbName);
          return a.open().then(function () { return a.loadAll(); }).then(function (d) { a.close(); return { meta: d.meta, data: d.records }; });
        }).then(function (x) {
          if (x) out.companies.push({ info: { code: c.code, name: c.name, templateId: c.templateId || '', activity: c.activity || '', model: c.model || '', createdAt: c.createdAt }, meta: x.meta, data: x.data });
        });
      });
      return chain.then(function () { return out; });
    },
    /** بازیابی پشتیبان کامل هلدینگ؛ شرکت‌های هم‌کد جایگزین و بقیه دست‌نخورده می‌مانند */
    importHolding: function (obj, progress) {
      if (!obj || obj.kind !== 'holding' || !Array.isArray(obj.companies)) return Promise.reject(new Error('این فایل پشتیبان کامل هلدینگ نیست'));
      var cur = state.current, chain = Promise.resolve(), S = IBP.store;
      obj.companies.forEach(function (x, i) {
        chain = chain.then(function () {
          var info = x.info || {}, code = String(info.code || '').trim().toUpperCase();
          if (!code || !x.data) return null;
          if (progress) progress(info, i, obj.companies.length);
          var c = H.byCode(code), reg = Promise.resolve();
          var fields = { name: info.name || (c && c.name) || code, templateId: info.templateId || '', activity: info.activity || '', model: info.model || (c && c.model) || 'B2C' };
          if (!c) {
            c = srv() ? { id: 'srv-' + code.toLowerCase(), code: code, dbName: 'server:' + code, createdAt: info.createdAt || new Date().toISOString() }
              : { id: 'co-' + code.toLowerCase() + '-' + Date.now().toString(36), code: code, dbName: dbNameFor(code), createdAt: info.createdAt || new Date().toISOString() };
            if (srv()) reg = IBP.server.api('POST', '/api/companies', Object.assign({ code: code, createdAt: c.createdAt }, fields));
            state.companies.push(c);
          } else if (srv()) reg = IBP.server.api('PUT', coPath(code), fields);
          Object.assign(c, fields);
          return reg.then(function () { return S.init(adapterFor(c)); }).then(function () { return S.importAll({ data: x.data, meta: x.meta }); }).then(function () {
            c.summary = summarize(); c.industry = S.settings().industry;
          });
        });
      });
      return chain.then(function () {
        if (obj.holding && obj.holding.name) { state.holding.name = obj.holding.name; if (srv()) return IBP.server.api('PUT', '/api/holding', { name: obj.holding.name }).then(persist); }
        return persist();
      }).then(function () {
        if (cur && H.get(cur.id)) return H.enter(cur.id);
        state.current = null;
        return null;
      }).then(function () { return obj.companies.length; });
    },

    /** به‌روزرسانی خلاصه همه شرکت‌ها (هر شرکت در فضای کاری خودش محاسبه می‌شود) و بازگشت به شرکت جاری */
    refreshAll: function (progress) {
      var cur = state.current, chain = Promise.resolve();
      state.companies.forEach(function (c, i) {
        chain = chain.then(function () {
          if (progress) progress(c, i, state.companies.length);
          return IBP.store.init(adapterFor(c)).then(function () { c.summary = summarize(); c.industry = IBP.store.settings().industry; c.model = IBP.store.settings().businessModel || c.model; });
        });
      });
      return chain.then(persist).then(function () { return cur ? H.enter(cur.id) : null; });
    }
  };

  IBP.holding = H;
})(window.IBP = window.IBP || {});
