/*
 * اتصال به موتور تحلیل پایتون (سرویس محلی FastAPI در پوشه engine/).
 * برنامه بدون موتور هم کامل کار می‌کند؛ وقتی موتور در دسترس باشد تحلیل‌های پیشرفته
 * (تجزیه روند و فصل، معناداری روند، خوشه‌بندی، همبستگی و...) به نتایج اضافه می‌شود.
 */
(function (IBP) {
  'use strict';

  var listeners = [];
  var state = { status: 'unknown', info: null, checkedAt: null, error: null };
  var timer = null;

  function url() {
    var s = IBP.store ? IBP.store.settings() : {};
    return String(s.engineUrl || 'http://127.0.0.1:8765').replace(/\/+$/, '');
  }
  function setStatus(st, info, err) {
    var changed = st !== state.status;
    state.status = st; state.info = info || null; state.error = err || null; state.checkedAt = Date.now();
    if (changed) listeners.forEach(function (cb) { try { cb(state); } catch (e) { console.error(e); } });
  }
  function request(path, opts) {
    opts = opts || {};
    var ctrl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 30000);
    return fetch(url() + path, {
      method: opts.body ? 'POST' : 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      clearTimeout(to);
      if (!r.ok) return r.text().then(function (t) { throw new Error('خطای موتور (' + r.status + '): ' + t.slice(0, 200)); });
      return r.json();
    }, function (e) {
      clearTimeout(to);
      throw new Error(e && e.name === 'AbortError' ? 'پاسخی از موتور دریافت نشد' : 'اتصال به موتور برقرار نشد');
    });
  }

  var E = {
    url: url,
    state: function () { return state; },
    online: function () { return state.status === 'online'; },
    on: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
    check: function () {
      if (!window.fetch) { setStatus('offline', null, 'fetch'); return Promise.resolve(false); }
      return request('/health', { timeout: 2500 }).then(function (info) {
        setStatus('online', info);
        return true;
      }, function (e) {
        setStatus('offline', null, e.message);
        return false;
      });
    },
    /** فراخوانی یک تحلیل؛ در صورت قطع بودن موتور خطا برمی‌گرداند */
    call: function (path, body, opts) {
      return request(path, Object.assign({ body: body || {} }, opts || {})).catch(function (e) {
        setStatus('offline', null, e.message);
        throw e;
      });
    },
    /** دریافت فایل دودویی (مثل گزارش xlsx) از موتور */
    blob: function (path, body, opts) {
      opts = opts || {};
      var ctrl = window.AbortController ? new AbortController() : null;
      var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, opts.timeout || 60000);
      return fetch(url() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { clearTimeout(to); if (!r.ok) throw new Error('خطای موتور (' + r.status + ')'); return r.blob(); },
          function (e) { clearTimeout(to); setStatus('offline', null, e.message); throw new Error('اتصال به موتور برقرار نشد'); });
    },
    startWatch: function () {
      E.check();
      if (timer) clearInterval(timer);
      timer = setInterval(function () { E.check(); }, 45000);
    }
  };

  // نسخه رومیزی: پوسته پس از آماده شدن موتور همراه خبر می‌دهد تا بی‌درنگ متصل شویم
  if (window.ibpDesktop && window.ibpDesktop.onEngine) window.ibpDesktop.onEngine(function (st) { if (st && st.status === 'online') E.check(); });

  IBP.engine = E;
})(window.IBP = window.IBP || {});
