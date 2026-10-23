/*
 * حالت سرور مرکزی (فاز ۹).
 *
 * اگر برنامه از نشانی سرور باز شود (یا در نسخه رومیزی/اندروید نشانی سرور تنظیم شده باشد)، داده‌ها به‌جای
 * پایگاه داده محلی در سرور مشترک ذخیره می‌شوند و کاربران با نام کاربری وارد می‌شوند:
 *   - ApiAdapter همان رابط آداپتور IBP.store را با فراخوانی API سرور پیاده می‌کند
 *   - نگهبان دسترسی پیش از هر تغییر، نقش و حوزه‌های مجاز کاربر را بررسی می‌کند (سرور هم دوباره بررسی می‌کند)
 *   - هر ۱۵ ثانیه تغییرات کاربران دیگر دریافت و در صفحه اعمال می‌شود
 *   - گفتگوی دستیار هوشمند شخصی است و فقط روی همین دستگاه ذخیره می‌شود
 */
(function (IBP) {
  'use strict';

  var KEY_URL = 'ibp-server-url', KEY_TOKEN = 'ibp-server-token';
  var LOCAL_META = { agentChat: 1, agentMode: 1 };
  var st = { active: false, base: '', token: null, user: null, info: null, error: null, clientId: Math.random().toString(36).slice(2) + Date.now().toString(36), timer: null };

  function ls(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* اختیاری */ }
    return null;
  }

  function api(method, path, body, opts) {
    opts = opts || {};
    var ctrl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 120000);
    var headers = { 'X-Client-Id': st.clientId };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (st.token) headers.Authorization = 'Bearer ' + st.token;
    return fetch((opts.base || st.base) + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        clearTimeout(to);
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (r.status === 401 && st.user && !opts.quiet) onUnauthorized();
          if (!r.ok) { var e = new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : 'خطای سرور (' + r.status + ')'); e.status = r.status; throw e; }
          return j;
        });
      }, function (e) {
        clearTimeout(to);
        var err = new Error(e && e.name === 'AbortError' ? 'سرور پاسخ نداد' : 'اتصال به سرور برقرار نشد');
        err.status = 0;
        throw err;
      });
  }

  function onUnauthorized() {
    st.user = null; st.token = null; ls(KEY_TOKEN + ':' + st.base, null);
    if (IBP.ui) IBP.ui.toast('نشست شما پایان یافته است؛ دوباره وارد شوید', 'warning');
    setTimeout(function () { location.reload(); }, 1200);
  }

  /** تشخیص حالت سرور: نشانی خود صفحه یا نشانی ذخیره‌شده */
  function detect() {
    var saved = ls(KEY_URL);
    var cands = [];
    if (/^https?:$/.test(location.protocol) && !/^appassets\./.test(location.host)) cands.push(location.origin);
    if (saved) cands.push(saved.replace(/\/+$/, ''));
    var tryNext = function (i) {
      if (i >= cands.length) {
        if (saved) st.error = 'سرور ' + saved + ' در دسترس نیست';
        return Promise.resolve(false);
      }
      return api('GET', '/api/server/info', undefined, { base: cands[i], timeout: 4000 }).then(function (info) {
        if (!info || !info.server) return tryNext(i + 1);
        st.active = true; st.base = cands[i]; st.info = info;
        st.token = ls(KEY_TOKEN + ':' + st.base);
        return true;
      }, function () { return tryNext(i + 1); });
    };
    return tryNext(0);
  }

  function session(r) {
    st.token = r.token; st.user = r.user;
    ls(KEY_TOKEN + ':' + st.base, r.token);
    return r.user;
  }

  var SV = {
    state: function () { return st; },
    active: function () { return st.active; },
    base: function () { return st.base; },
    user: function () { return st.user; },
    info: function () { return st.info; },
    error: function () { return st.error; },
    api: api,
    detect: detect,
    savedUrl: function () { return ls(KEY_URL); },
    /** اتصال برنامه رومیزی/اندروید به سرور (یا قطع اتصال با نشانی خالی) */
    setServerUrl: function (url) {
      url = String(url || '').trim().replace(/\/+$/, '');
      if (!url) { ls(KEY_URL, null); return Promise.resolve(true); }
      if (!/^https?:\/\//i.test(url)) return Promise.reject(new Error('نشانی باید با http:// یا https:// شروع شود'));
      return api('GET', '/api/server/info', undefined, { base: url, timeout: 5000 }).then(function (info) {
        if (!info.server) throw new Error('این نشانی سرور IBP نیست');
        ls(KEY_URL, url);
        return true;
      });
    },
    restore: function () {
      if (!st.token) return Promise.resolve(null);
      return api('GET', '/api/auth/me', undefined, { quiet: true }).then(function (u) { st.user = u; return u; }, function () { st.token = null; return null; });
    },
    login: function (username, password) { return api('POST', '/api/auth/login', { username: username, password: password }).then(session); },
    setup: function (d) { return api('POST', '/api/setup', d).then(session); },
    logout: function () {
      return api('POST', '/api/auth/logout', {}, { quiet: true }).catch(function () {}).then(function () {
        ls(KEY_TOKEN + ':' + st.base, null);
        try { sessionStorage.removeItem('ibp-company'); } catch (e) { /* اختیاری */ }
        location.reload();
      });
    },
    changePassword: function (oldPw, newPw) { return api('POST', '/api/auth/password', { old: oldPw, new: newPw }).then(session); },

    /* ---------------- دسترسی ---------------- */
    isAdmin: function () { return !!(st.user && st.user.role === 'admin'); },
    canView: function (code) { var u = st.user; return !st.active || !!(u && (u.role === 'admin' || u.companies.indexOf('*') >= 0 || u.companies.indexOf(String(code).toUpperCase()) >= 0)); },
    canEdit: function (area, code) {
      if (!st.active) return true;
      var u = st.user;
      if (!u) return false;
      if (u.role === 'admin') return true;
      var co = code || (IBP.holding && IBP.holding.current() && IBP.holding.current().code);
      return u.role === 'editor' && SV.canView(co) && u.areas.indexOf(area) >= 0;
    },
    areaOf: function (kind, name) {
      var i = st.info || {};
      if (kind === 'entity') return (i.entityAreas || {})[name] || 'masterdata';
      return (i.metaAreas || {})[name] || 'settings';
    },
    readOnly: function () { var u = st.user; return st.active && u && u.role === 'viewer'; },
    roleLabel: function (r) { return ((st.info && st.info.roles) || {})[r] || r; },
    areas: function () { return (st.info && st.info.areas) || {}; },

    /** نگهبان نوشتن IBP.store: پیام خطا یا null */
    guard: function (kind, name) {
      if (!st.active) return null;
      if (kind === 'meta' && LOCAL_META[name]) return null;
      if (kind === 'clearAll') return Object.keys(SV.areas()).every(function (a) { return SV.canEdit(a); }) ? null : 'پاک کردن همه داده‌ها فقط با اجازه ویرایش همه حوزه‌ها ممکن است';
      var area = SV.areaOf(kind, name);
      if (SV.canEdit(area)) return null;
      return 'اجازه ویرایش «' + (SV.areas()[area] || area) + '» را ندارید';
    },
    isCacheMeta: function (key) { return ((st.info && st.info.cacheMeta) || []).indexOf(key) >= 0; },

    /* ---------------- همگام‌سازی ---------------- */
    startSync: function () {
      if (st.timer || !st.active) return;
      st.timer = setInterval(SV.pull, 15000);
    },
    pull: function () {
      var co = IBP.holding && IBP.holding.current(), ad = IBP.store.adapter();
      if (!co || !ad || ad.kind !== 'server' || ad.code !== co.code || document.hidden) return Promise.resolve();
      return api('GET', '/api/companies/' + encodeURIComponent(co.code) + '/changes?since=' + ad.seq, undefined, { timeout: 30000 }).then(function (r) {
        if (IBP.store.adapter() !== ad) return;
        if (r.reload) { ad.seq = r.seq; return IBP.holding.enter(co.id).then(function () { IBP.app.refresh(); }); }
        ad.seq = r.seq;
        if (!r.records.length && !Object.keys(r.meta).length) return;
        IBP.store.applyRemote(r.records, r.meta);
        IBP.ui.toast('داده‌ها توسط ' + r.by.join('، ') + ' به‌روز شد', 'info');
        var busy = document.querySelector('.modal-overlay, .focus-overlay') || (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
        if (!busy) IBP.app.refresh();
      }, function () { /* قطع موقت شبکه؛ نوبت بعد */ });
    }
  };

  /* ---------------- آداپتور سرور ---------------- */
  function localMetaKey(code) { return 'ibp-local-meta:' + st.base + ':' + (st.user ? st.user.id : 0) + ':' + code; }
  function ApiAdapter(code) { this.kind = 'server'; this.code = String(code).toUpperCase(); this.name = 'server:' + this.code; this.seq = 0; }
  ApiAdapter.prototype.path = function (p) { return '/api/companies/' + encodeURIComponent(this.code) + p; };
  ApiAdapter.prototype.open = function () { return st.active && st.user ? Promise.resolve() : Promise.reject(new Error('ورود به سرور لازم است')); };
  ApiAdapter.prototype.close = function () {};
  ApiAdapter.prototype.loadAll = function () {
    var self = this;
    return api('GET', this.path('/data')).then(function (r) {
      self.seq = r.seq || 0;
      var local = {};
      try { local = JSON.parse(ls(localMetaKey(self.code)) || '{}'); } catch (e) { local = {}; }
      return { records: r.records || {}, meta: Object.assign({}, r.meta || {}, local) };
    });
  };
  ApiAdapter.prototype.put = function (entity, recs) {
    var self = this, chain = Promise.resolve();
    for (var i = 0; i < recs.length; i += 4000) {
      (function (part) { chain = chain.then(function () { return api('POST', self.path('/put'), { entity: entity, records: part }); }); })(recs.slice(i, i + 4000));
    }
    return chain;
  };
  ApiAdapter.prototype.remove = function (entity, ids) { return api('POST', this.path('/remove'), { entity: entity, ids: ids }); };
  ApiAdapter.prototype.clearEntity = function (entity) { return api('POST', this.path('/clear-entity'), { entity: entity }); };
  ApiAdapter.prototype.setMeta = function (key, value) {
    if (LOCAL_META[key]) {
      var all = {};
      try { all = JSON.parse(ls(localMetaKey(this.code)) || '{}'); } catch (e) { all = {}; }
      all[key] = value;
      try { ls(localMetaKey(this.code), JSON.stringify(all)); } catch (e) { /* حجم زیاد */ }
      return Promise.resolve();
    }
    // نتیجه محاسبات برای کاربر فقط‌مشاهده در حافظه می‌ماند
    if (SV.guard('meta', key) && !SV.isCacheMeta(key)) return Promise.resolve();
    return api('PUT', this.path('/meta/' + encodeURIComponent(key)), { value: value });
  };
  ApiAdapter.prototype.clearAll = function () { ls(localMetaKey(this.code), null); return api('POST', this.path('/clear-all'), {}); };

  IBP.store.adapters.ApiAdapter = ApiAdapter;
  IBP.store.setGuard(SV.guard);
  IBP.server = SV;
})(window.IBP = window.IBP || {});
