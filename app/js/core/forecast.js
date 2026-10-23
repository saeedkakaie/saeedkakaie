/*
 * پیش‌بینی آماری تقاضا (موتور پایه داخل برنامه؛ بدون نیاز به پایتون).
 *
 * روش‌ها (همه روی سری تعدیل‌شده از اثر مناسبت‌ها، به‌جز رگرسیون که اثر مناسبت را خودش برآورد می‌کند):
 *   naive      آخرین مقدار                       snaive   همان ماه سال قبل
 *   drift      گام تصادفی با رانش (فصل‌زدایی‌شده)   ma3      میانگین متحرک ۳ ماهه
 *   sma        میانگین متحرک × شاخص فصلی           ses      هموارسازی نمایی ساده + فصل
 *   holt       روند میرا + فصل                     holtLin  روند خطی هولت + فصل
 *   hwAdd/hwMul هولت-وینترز جمعی/ضربی (۲۴ ماه سابقه)
 *   theta      روش تتا (SES با رانش نصف شیب)       lintrend روند خطی + شاخص فصلی
 *   reg        رگرسیون: روند + اثر ماه + شدت رمضان/محرم/کمپین
 *   croston    کراستون اصلاح‌شده (SBA)             tsb      TSB (احتمال وقوع تقاضا)
 *   adida      تجمیع زمانی (ADIDA) برای تقاضای متناوب
 *   ensemble   میانگین سه روش برتر بک‌تست
 *
 * انتخاب روش با بک‌تست چرخشی (rolling origin): از هر یک از K ماه آخر، مدل فقط با داده تا آن ماه برازش
 * و L ماه بعد پیش‌بینی می‌شود؛ روشی که کمترین خطا (WMAPE، RMSE یا WMAPE+|سوگیری|) را دارد انتخاب می‌شود.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali;

  var METHODS = {
    naive: 'ساده (آخرین مقدار)', snaive: 'فصلی ساده', drift: 'رانش (Drift)', ma3: 'میانگین متحرک', sma: 'میانگین متحرک فصلی',
    ses: 'هموارسازی نمایی + فصل', holt: 'روند میرا + فصل', holtLin: 'روند خطی هولت + فصل',
    hwAdd: 'هولت-وینترز جمعی', hwMul: 'هولت-وینترز ضربی', hw: 'هولت-وینترز', theta: 'تتا (Theta)', lintrend: 'روند خطی + فصل',
    reg: 'رگرسیون فصل و مناسبت', croston: 'کراستون (SBA)', tsb: 'TSB', adida: 'تجمیع زمانی (ADIDA)',
    arima: 'ARIMA فصلی', gbm: 'یادگیری ماشین (گرادیان بوستینگ)', ensemble: 'ترکیب مدل‌ها'
  };
  /** گروه‌بندی روش‌ها برای نمایش */
  var FAMILIES = {
    'پایه': ['naive', 'snaive', 'drift', 'ma3', 'sma'],
    'هموارسازی نمایی': ['ses', 'holt', 'holtLin', 'hwAdd', 'hwMul', 'hw', 'theta'],
    'رگرسیون و ARIMA': ['lintrend', 'reg', 'arima'],
    'تقاضای متناوب': ['croston', 'tsb', 'adida'],
    'یادگیری ماشین و ترکیبی': ['gbm', 'ensemble']
  };
  var SMOOTH = ['naive', 'snaive', 'drift', 'ma3', 'sma', 'ses', 'holt', 'holtLin', 'hwAdd', 'hwMul', 'theta', 'lintrend', 'reg'];
  var INTERMITTENT = ['croston', 'tsb', 'adida', 'ma3', 'sma', 'snaive', 'naive'];
  var MIN_TRAIN = { hwAdd: 24, hwMul: 24 };
  var METRICS = { wmape: 'WMAPE', rmse: 'RMSE', wmapeBias: 'WMAPE + |سوگیری|' };

  /* ---------------- ابزار ---------------- */
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function months(periods) { return periods.map(function (p) { return J.month(p) - 1; }); }

  /** شاخص فصلی ۱۲ ماه با نسبت به میانگین متحرک (یا میانگین کل) و کوچک‌سازی به سمت ۱ */
  function seasonalIndex(y, mo) {
    var n = y.length, ratios = [[], [], [], [], [], [], [], [], [], [], [], []];
    if (n >= 24) {
      for (var t = 6; t < n - 6; t++) {
        var s = 0;
        for (var k = -6; k <= 6; k++) s += (k === -6 || k === 6 ? 0.5 : 1) * y[t + k];
        var cma = s / 12;
        if (cma > 0) ratios[mo[t]].push(y[t] / cma);
      }
    }
    var m = mean(y) || 1;
    for (var i = 0; i < n; i++) if (n < 24 || !ratios[mo[i]].length) ratios[mo[i]].push(y[i] / m);
    var idx = ratios.map(function (r) { return r.length ? 1 + (mean(r) - 1) * r.length / (r.length + 1) : 1; });
    var norm = mean(idx) || 1;
    return idx.map(function (v) { return Math.max(0.05, v / norm); });
  }

  /** حل دستگاه معادلات خطی کوچک (حذف گاوسی با محورگیری) */
  function solve(A, b) {
    var n = b.length, M = A.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      var tmp = M[c]; M[c] = M[p]; M[p] = tmp;
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = M[i][n];
      for (var j = i + 1; j < n; j++) s -= M[i][j] * x[j];
      x[i] = s / M[i][i];
    }
    return x;
  }
  /** کمترین مربعات با منظم‌سازی جزئی؛ خروجی: ضرایب، خطای استاندارد و واریانس باقیمانده */
  function ols(X, y, ridge) {
    var p = X[0].length, n = X.length, XtX = [], Xty = [];
    for (var i = 0; i < p; i++) {
      XtX.push(new Array(p).fill(0)); Xty.push(0);
    }
    X.forEach(function (row, r) {
      for (var i2 = 0; i2 < p; i2++) {
        Xty[i2] += row[i2] * y[r];
        for (var j = 0; j < p; j++) XtX[i2][j] += row[i2] * row[j];
      }
    });
    for (var d = 1; d < p; d++) XtX[d][d] += ridge || 1e-6;
    var beta = solve(XtX, Xty);
    if (!beta) return null;
    var sse = 0;
    X.forEach(function (row, r) { var f = 0; for (var i3 = 0; i3 < p; i3++) f += row[i3] * beta[i3]; sse += (y[r] - f) * (y[r] - f); });
    var dof = Math.max(1, n - p), s2 = sse / dof;
    // خطای استاندارد از قطر معکوس XtX
    var se = beta.map(function (_, k) {
      var e = new Array(p).fill(0); e[k] = 1;
      var col = solve(XtX, e);
      return col ? Math.sqrt(Math.max(0, s2 * col[k])) : null;
    });
    return { beta: beta, se: se, s2: s2, dof: dof };
  }

  /* ---------------- روش‌ها ---------------- */
  function fitSes(x) {
    var best = null;
    [0.05, 0.1, 0.2, 0.3, 0.5, 0.7].forEach(function (a) {
      var l = x[0], sse = 0;
      for (var t = 1; t < x.length; t++) { var e = x[t] - l; sse += e * e; l = l + a * e; }
      if (!best || sse < best.sse) best = { a: a, l: l, sse: sse };
    });
    return best;
  }
  function fitHolt(x, phis) {
    // ETS(A,Ad,N): l = l + φb + αe ، b = φb + βe
    var best = null;
    [0.2, 0.4, 0.6].forEach(function (a) {
      [0.02, 0.06, 0.12].forEach(function (b) {
        (phis || [0.8, 0.9, 0.98]).forEach(function (phi) {
          var k = Math.min(3, x.length - 1), l = x[0], tr = k > 0 ? (x[k] - x[0]) / k : 0, sse = 0;
          for (var t = 1; t < x.length; t++) {
            var f = l + phi * tr, e = x[t] - f;
            sse += e * e;
            l = f + a * e;
            tr = phi * tr + b * e;
          }
          if (!best || sse < best.sse) best = { a: a, b: b, phi: phi, l: l, tr: tr, sse: sse };
        });
      });
    });
    return best;
  }
  /** هولت-وینترز (روند جمعی میرا، فصل جمعی یا ضربی) با جستجوی شبکه‌ای پارامترها */
  function fitHW(y, mo, mult) {
    var n = y.length;
    if (n < 24) return null;
    var l0 = mean(y.slice(0, 12)), b0 = (mean(y.slice(12, 24)) - l0) / 12;
    var s0 = new Array(12).fill(mult ? 1 : 0);
    for (var i = 0; i < 12; i++) s0[mo[i]] = mult ? (l0 > 0 ? y[i] / (l0 + b0 * (i - 5.5)) : 1) : y[i] - (l0 + b0 * (i - 5.5));
    if (mult && y.some(function (v) { return v <= 0; })) return null;
    var best = null, phi = 0.98;
    [0.1, 0.3, 0.5].forEach(function (a) {
      [0.01, 0.05].forEach(function (b) {
        [0.05, 0.2, 0.4].forEach(function (g) {
          var l = l0, tr = b0, s = s0.slice(), sse = 0;
          for (var t = 0; t < n; t++) {
            var m = mo[t], f = mult ? (l + phi * tr) * s[m] : l + phi * tr + s[m], e = y[t] - f;
            if (t >= 12) sse += e * e;
            var lPrev = l;
            l = mult ? a * (y[t] / s[m]) + (1 - a) * (l + phi * tr) : a * (y[t] - s[m]) + (1 - a) * (l + phi * tr);
            tr = b * (l - lPrev) + (1 - b) * phi * tr;
            s[m] = mult ? g * (y[t] / Math.max(1e-9, l)) + (1 - g) * s[m] : g * (y[t] - l) + (1 - g) * s[m];
          }
          if (!best || sse < best.sse) best = { l: l, tr: tr, s: s, sse: sse };
        });
      });
    });
    return best;
  }
  function linfit(x) {
    var n = x.length, tm = (n - 1) / 2, xm = mean(x), sxy = 0, sxx = 0;
    for (var t = 0; t < n; t++) { sxy += (t - tm) * (x[t] - xm); sxx += (t - tm) * (t - tm); }
    var b = sxx ? sxy / sxx : 0;
    return { a: xm - b * tm, b: b };
  }

  /**
   * پیش‌بینی با یک روش.
   * ctx: { y, mo (ماه‌های تاریخچه 0..11), moF (ماه‌های آینده), fH, fF (ضریب مناسبت تاریخچه/آینده),
   *        xH, xF (شدت رمضان/محرم/کمپین تاریخچه و آینده: [[r,m,c],...]) }
   */
  function predict(method, ctx, h) {
    var y = ctx.y, n = y.length, out = [];
    var adj = y.map(function (v, i) { return v / (ctx.fH[i] || 1); });
    var moF = ctx.moF.slice(0, h);
    var i;
    var deseason = function () {
      var idx = seasonalIndex(adj, ctx.mo);
      return { idx: idx, x: adj.map(function (v, k) { return v / idx[ctx.mo[k]]; }) };
    };
    if (method === 'naive') {
      for (i = 0; i < h; i++) out.push(adj[n - 1]);
    } else if (method === 'snaive') {
      for (i = 0; i < h; i++) { var src = n - 12 + (i % 12); out.push(src >= 0 ? adj[src] : adj[n - 1]); }
    } else if (method === 'ma3') {
      var m3 = mean(adj.slice(-3));
      for (i = 0; i < h; i++) out.push(m3);
    } else if (method === 'sma' || method === 'drift' || method === 'ses' || method === 'holt' || method === 'holtLin' || method === 'theta' || method === 'lintrend') {
      var d = deseason(), x = d.x, idx = d.idx, base = [];
      if (method === 'sma') { var ms = mean(x.slice(-3)); for (i = 0; i < h; i++) base.push(ms); }
      else if (method === 'drift') { var sl = n > 1 ? (x[n - 1] - x[0]) / (n - 1) : 0; for (i = 0; i < h; i++) base.push(x[n - 1] + (i + 1) * sl); }
      else if (method === 'ses') { var s = fitSes(x); for (i = 0; i < h; i++) base.push(s.l); }
      else if (method === 'holt' || method === 'holtLin') {
        var hb = fitHolt(x, method === 'holtLin' ? [1] : null), damp = 0;
        for (i = 0; i < h; i++) { damp += Math.pow(hb.phi, i + 1); base.push(hb.l + damp * hb.tr); }
      } else if (method === 'theta') {
        // تتا: SES روی سری فصل‌زدایی‌شده + نصف شیب خط روند (Assimakopoulos & Nikolopoulos)
        var st = fitSes(x), lf = linfit(x);
        for (i = 0; i < h; i++) base.push(st.l + (lf.b / 2) * (i + 1 / st.a - Math.pow(1 - st.a, n) / st.a));
      } else {
        var lt = linfit(x);
        for (i = 0; i < h; i++) base.push(lt.a + lt.b * (n + i));
      }
      out = base.map(function (v, k) { return Math.max(0, v) * idx[moF[k]]; });
    } else if (method === 'hwAdd' || method === 'hwMul') {
      var hw = fitHW(adj, ctx.mo, method === 'hwMul');
      if (!hw) return predict('holt', ctx, h);
      var dm = 0;
      for (i = 0; i < h; i++) {
        dm += Math.pow(0.98, i + 1);
        var lv = hw.l + dm * hw.tr;
        out.push(Math.max(0, method === 'hwMul' ? lv * hw.s[moF[i]] : lv + hw.s[moF[i]]));
      }
    } else if (method === 'croston' || method === 'tsb') {
      var a = 0.15, bt = 0.1, z = null, p = null, q = 1, prob = null;
      for (var t = 0; t < n; t++) {
        var occ = adj[t] > 0 ? 1 : 0;
        prob = prob === null ? occ : prob + bt * (occ - prob);
        if (adj[t] > 0) {
          if (z === null) { z = adj[t]; p = q; } else { z = z + a * (adj[t] - z); p = p + a * (q - p); }
          q = 1;
        } else q++;
      }
      var f = z === null ? 0 : method === 'tsb' ? z * prob : (1 - a / 2) * z / p;
      for (i = 0; i < h; i++) out.push(f);
    } else if (method === 'adida') {
      // تجمیع سری در سطل‌های غیرهمپوشان (به اندازه میانگین فاصله تقاضا)، SES روی سطل‌ها و تفکیک یکنواخت
      var nz = adj.filter(function (v) { return v > 0; }).length;
      var bs = Math.max(2, Math.min(6, Math.round(n / Math.max(1, nz))));
      var buckets = [];
      for (var e = n; e - bs >= 0; e -= bs) buckets.unshift(adj.slice(e - bs, e).reduce(function (s2, v) { return s2 + v; }, 0));
      var lvl = buckets.length > 1 ? fitSes(buckets).l : (buckets[0] || 0);
      for (i = 0; i < h; i++) out.push(lvl / bs);
    } else if (method === 'reg') {
      var useDummies = n >= 30, rows = [], ly = y.map(function (v) { return Math.log1p(v); });
      var design = function (tt, m, ev) {
        var r = [1, tt / 12];
        if (useDummies) { for (var dd = 1; dd < 12; dd++) r.push(m === dd ? 1 : 0); }
        else { for (var k2 = 1; k2 <= 2; k2++) { r.push(Math.sin(2 * Math.PI * k2 * m / 12)); r.push(Math.cos(2 * Math.PI * k2 * m / 12)); } }
        return r.concat(ev);
      };
      for (var t2 = 0; t2 < n; t2++) rows.push(design(t2, ctx.mo[t2], ctx.xH[t2]));
      var fit = ols(rows, ly, 0.5);
      if (!fit) return predict('holt', ctx, h);
      for (i = 0; i < h; i++) {
        var row = design(n + i, moF[i], ctx.xF[i]), v = 0;
        for (var c = 0; c < row.length; c++) v += row[c] * fit.beta[c];
        out.push(Math.max(0, Math.expm1(v + fit.s2 / 2)));
      }
      return out;
    } else {
      return predict('ma3', ctx, h);
    }
    return out.map(function (v, k) { return Math.max(0, v * (ctx.fF[k] || 1)); });
  }

  function wmape(f, a) {
    var e = 0, s = 0;
    for (var i = 0; i < a.length; i++) { e += Math.abs(f[i] - a[i]); s += a[i]; }
    return s > 0 ? e / s : (e > 0 ? 1 : 0);
  }
  /** شاخص‌های خطای بک‌تست */
  function metrics(f, a) {
    var e = 0, s = 0, se = 0, b = 0;
    for (var i = 0; i < a.length; i++) { var d = f[i] - a[i]; e += Math.abs(d); se += d * d; b += d; s += a[i]; }
    var n = Math.max(1, a.length), am = s / n || 1;
    var w = s > 0 ? e / s : (e > 0 ? 1 : 0);
    var bias = s > 0 ? b / s : 0;
    return { wmape: w, bias: bias, rmse: Math.sqrt(se / n) / am, wmapeBias: w + Math.abs(bias), n: a.length };
  }
  function sliceCtx(ctx, end, h) {
    return {
      y: ctx.y.slice(0, end), mo: ctx.mo.slice(0, end), fH: ctx.fH.slice(0, end), xH: ctx.xH.slice(0, end),
      moF: ctx.mo.slice(end, end + h), fF: ctx.fH.slice(end, end + h), xF: ctx.xH.slice(end, end + h)
    };
  }

  /** تنظیمات بک‌تست از تنظیمات شرکت */
  function btOptions(opts) {
    var st = IBP.store ? IBP.store.settings() : {};
    opts = opts || {};
    return {
      origins: opts.origins || st.fcOrigins || 12, lead: opts.lead || st.fcLead || 3,
      metric: opts.metric || st.fcMetric || 'wmape', ensemble: opts.ensemble !== undefined ? opts.ensemble : st.fcEnsemble !== false,
      methods: opts.methods || null
    };
  }

  /**
   * بک‌تست چرخشی همه روش‌ها و انتخاب بهترین. خروجی:
   * { method, scores, metrics, backtest: {idx, actual, fc{method: پیش‌بینی lag-1}}, forecast, lo, hi }
   */
  function auto(ctx, horizon, opts) {
    var o = btOptions(opts);
    var n = ctx.y.length, zeroShare = ctx.y.filter(function (v) { return v === 0; }).length / Math.max(1, n);
    var cands = (o.methods || (zeroShare > 0.3 ? INTERMITTENT : SMOOTH)).filter(function (m) { return METHODS[m] && m !== 'ensemble' && m !== 'gbm' && m !== 'arima' && m !== 'hw'; });
    var origins = [];
    for (var k = o.origins; k >= 1; k--) if (n - k >= 13) origins.push(n - k);
    var preds = {}, mets = {}, scores = {};
    cands.forEach(function (m) {
      if (origins.length && origins[0] < (MIN_TRAIN[m] || 13)) { scores[m] = null; return; }
      preds[m] = origins.map(function (or) { return predict(m, sliceCtx(ctx, or, o.lead), Math.min(o.lead, n - or)); });
    });
    var pairs = function (fcByOrigin) {
      var F = [], A = [];
      origins.forEach(function (or, j) { fcByOrigin[j].forEach(function (v, l) { F.push(v); A.push(ctx.y[or + l]); }); });
      return { F: F, A: A };
    };
    Object.keys(preds).forEach(function (m) { var pp = pairs(preds[m]); mets[m] = metrics(pp.F, pp.A); scores[m] = origins.length ? mets[m][o.metric] : null; });
    var ranked = Object.keys(preds).filter(function (m) { return scores[m] !== null; }).sort(function (a, b) { return scores[a] - scores[b]; });
    if (o.ensemble && ranked.length >= 3) {
      var top = ranked.slice(0, 3);
      preds.ensemble = origins.map(function (_, j) { return preds[top[0]][j].map(function (v, l) { return mean(top.map(function (m) { return preds[m][j][l]; })); }); });
      var pe = pairs(preds.ensemble);
      mets.ensemble = metrics(pe.F, pe.A); scores.ensemble = mets.ensemble[o.metric];
      mets.ensemble.members = top;
    }
    var best = Object.keys(scores).filter(function (m) { return scores[m] !== null; }).sort(function (a, b) { return scores[a] - scores[b]; })[0] || cands[0];
    var fc, label = METHODS[best];
    if (best === 'ensemble') {
      var fs = mets.ensemble.members.map(function (m) { return predict(m, ctx, horizon); });
      fc = fs[0].map(function (_, i) { return mean(fs.map(function (f) { return f[i]; })); });
      label = METHODS.ensemble + ' (' + mets.ensemble.members.map(function (m) { return METHODS[m]; }).join(' + ') + ')';
    } else fc = predict(best, ctx, horizon);

    // بازه پیش‌بینی از خطای نسبی بک‌تست روش منتخب به تفکیک افق
    var relByLead = [];
    if (preds[best]) origins.forEach(function (or, j) { preds[best][j].forEach(function (v, l) { var a = ctx.y[or + l]; if (a > 0) (relByLead[l] = relByLead[l] || []).push(Math.min(2, (a - v) / a)); }); });
    var rmseL = relByLead.map(function (r) { return r && r.length ? Math.sqrt(mean(r.map(function (e) { return e * e; }))) : null; }).filter(function (v) { return v !== null; });
    var r1 = rmseL.length ? rmseL[0] : 0.25, rL = rmseL.length ? rmseL[rmseL.length - 1] : r1;
    var z = 1.2816;
    var relSd = function (i) { return i < rmseL.length ? rmseL[i] : rL * Math.sqrt((i + 1) / Math.max(1, rmseL.length)); };

    // سری lag-1 بک‌تست (پیش‌بینی هر ماه از یک ماه قبل) برای نمودار
    var bt = { idx: origins.slice(), actual: origins.map(function (or) { return ctx.y[or]; }), fc: {} };
    Object.keys(preds).forEach(function (m) { bt.fc[m] = preds[m].map(function (f) { return Math.round(f[0] * 10) / 10; }); });
    var round4 = function (v) { return v === null || v === undefined ? null : Math.round(v * 10000) / 10000; };
    var metOut = {};
    Object.keys(mets).forEach(function (m) { metOut[m] = { wmape: round4(mets[m].wmape), bias: round4(mets[m].bias), rmse: round4(mets[m].rmse), wmapeBias: round4(mets[m].wmapeBias), n: mets[m].n, members: mets[m].members }; });
    return {
      method: best, methodLabel: label, scores: scores, metrics: metOut, metric: o.metric, zeroShare: zeroShare,
      origins: origins.length, lead: o.lead, backtest: bt,
      forecast: fc,
      lo: fc.map(function (v, i) { return Math.max(0, v * (1 - z * relSd(i))); }),
      hi: fc.map(function (v, i) { return v * (1 + z * relSd(i)); })
    };
  }

  /* ---------------- داده ورودی از store ---------------- */
  function eventIntensities(period) {
    var E = IBP.events, ld = E.lunarDays(period);
    var camp = 0;
    IBP.store.all('events').forEach(function (ev) { if (ev.kind === 'کمپین' || ev.kind === 'سایر') camp = Math.max(camp, E.intensity(period, ev)); });
    return [ld.ramadan / ld.days, ld.muharram / ld.days, camp];
  }
  /** ساخت ورودی پیش‌بینی برای همه محصولات فعال */
  function buildInputs(opts) {
    opts = opts || {};
    var S = IBP.store, A = IBP.analytics, ctx0 = A.ctx(), cycle = opts.cycle || ctx0.cycle;
    var H = opts.history || S.settings().historyMonths || 36, horizon = opts.horizon || S.settings().horizonMonths || 18;
    var all = A.periodsWithSales().filter(function (p) { return p < cycle; });
    var first = all.length ? all[0] : J.addMonths(cycle, -H);
    var start = Math.max(first, J.addMonths(cycle, -H));
    var hist = J.between(start, J.addMonths(cycle, -1)), fut = J.range(cycle, horizon);
    var si = A.salesIndex();
    var xH = hist.map(eventIntensities), xF = fut.map(eventIntensities);
    var impacts = S.all('eventImpacts');
    var products = S.all('products').filter(function (p) { return p.active !== false && p.lifecycle !== 'توقف' && (!opts.filter || opts.filter(p)); });
    return {
      cycle: cycle, hist: hist, fut: fut, xH: xH, xF: xF, options: opts.backtest || null,
      items: products.map(function (p) {
        var y = hist.map(function (per) { var m = si.get(per), v = m && m.get(p.id); return v ? v.qty : 0; });
        var firstSale = y.findIndex(function (v) { return v > 0; });
        var from = Math.max(0, firstSale);
        return {
          product: p, from: from,
          ctx: {
            y: y.slice(from), mo: months(hist).slice(from), moF: months(fut),
            fH: hist.slice(from).map(function (per) { return IBP.events.factor(per, p.familyId, impacts); }),
            fF: fut.map(function (per) { return IBP.events.factor(per, p.familyId, impacts); }),
            xH: xH.slice(from), xF: xF
          }
        };
      })
    };
  }

  /** اجرای پیش‌بینی در برنامه برای همه محصولات */
  function runLocal(inputs) {
    var out = {};
    inputs.items.forEach(function (it) {
      if (it.ctx.y.length < 6) {
        var m = mean(it.ctx.y.slice(-3));
        out[it.product.id] = { method: 'ma3', methodLabel: METHODS.ma3 + ' (سابقه کوتاه)', scores: {}, forecast: inputs.fut.map(function (_, i) { return m * (it.ctx.fF[i] || 1); }), lo: [], hi: [], short: true };
        return;
      }
      out[it.product.id] = auto(it.ctx, inputs.fut.length, inputs.options);
    });
    return out;
  }

  /** بسته ارسالی به موتور پایتون */
  function enginePayload(inputs) {
    return {
      periods: inputs.hist, future: inputs.fut, events: { hist: inputs.xH, future: inputs.xF, names: ['ramadan', 'muharram', 'campaign'] },
      options: btOptions(inputs.options),
      products: inputs.items.map(function (it) {
        return { id: it.product.id, familyId: it.product.familyId, from: it.from, qty: it.ctx.y, factorHist: it.ctx.fH, factorFuture: it.ctx.fF };
      })
    };
  }

  /**
   * اجرای پیش‌بینی آماری و ذخیره نسخه «آماری» چرخه جاری.
   * opts: { useEngine: true, filter } → Promise<{ engine, results, inputs }>
   */
  function run(opts) {
    opts = opts || {};
    var S = IBP.store, inputs = buildInputs(opts);
    var useEngine = opts.useEngine !== false && IBP.engine.online();
    var p = useEngine
      ? IBP.engine.call('/demand/forecast', enginePayload(inputs), { timeout: 120000 }).then(function (res) { return { engine: 'python', results: res.products }; }, function () { return { engine: 'local', results: runLocal(inputs) }; })
      : Promise.resolve({ engine: 'local', results: runLocal(inputs) });
    return p.then(function (r) {
      var keep = S.all('forecasts').filter(function (f) {
        if (f.version !== 'آماری' || f.cycle !== inputs.cycle) return true;
        return !r.results[f.productId] && !inputs.items.some(function (it) { return it.product.id === f.productId; });
      });
      var recs = [];
      inputs.items.forEach(function (it) {
        var res = r.results[it.product.id];
        if (!res) return;
        inputs.fut.forEach(function (per, i) {
          recs.push({
            version: 'آماری', cycle: inputs.cycle, period: per, productId: it.product.id,
            qty: Math.round(res.forecast[i] || 0),
            lo: res.lo && res.lo[i] !== undefined ? Math.round(res.lo[i]) : null,
            hi: res.hi && res.hi[i] !== undefined ? Math.round(res.hi[i]) : null,
            method: res.methodLabel || METHODS[res.method] || res.method
          });
        });
      });
      S.replaceAll('forecasts', keep.concat(recs.map(function (x) { x.id = S.uid(); return x; })));
      var summary = {};
      var fromOf = {};
      inputs.items.forEach(function (it) { fromOf[it.product.id] = it.from; });
      Object.keys(r.results).forEach(function (pid) {
        var x = r.results[pid], bt = x.backtest;
        summary[pid] = {
          method: x.method, label: x.methodLabel || METHODS[x.method] || x.method, score: x.scores ? x.scores[x.method] : null, scores: x.scores || {},
          metrics: x.metrics || {}, zeroShare: x.zeroShare,
          backtest: bt ? { periods: bt.idx.map(function (i) { return inputs.hist[(fromOf[pid] || 0) + i]; }), actual: bt.actual, fc: bt.fc } : null
        };
      });
      var o = btOptions(inputs.options);
      S.setMeta('statRun', { cycle: inputs.cycle, at: new Date().toISOString(), engine: r.engine, products: summary, history: inputs.hist.length, origins: o.origins, lead: o.lead, metric: o.metric });
      return { engine: r.engine, results: r.results, inputs: inputs };
    });
  }

  /* ---------------- برآورد اثر مناسبت‌ها از داده تاریخی ---------------- */
  function estimateEventsLocal(inputs) {
    var S = IBP.store, out = [];
    S.all('families').forEach(function (fam) {
      var items = inputs.items.filter(function (it) { return it.product.familyId === fam.id; });
      if (!items.length) return;
      var n = inputs.hist.length, y = new Array(n).fill(0);
      items.forEach(function (it) { it.ctx.y.forEach(function (v, i) { y[i + it.from] += v; }); });
      var start = y.findIndex(function (v) { return v > 0; });
      if (start < 0 || n - start < 18) return;
      var mo = months(inputs.hist), rows = [], ly = [];
      for (var t = start; t < n; t++) {
        var r = [1, (t - start) / 12];
        for (var d = 1; d < 12; d++) r.push(mo[t] === d ? 1 : 0);
        rows.push(r.concat(inputs.xH[t].slice(0, 2)));
        ly.push(Math.log1p(y[t]));
      }
      var fit = ols(rows, ly, 0.05);
      if (!fit) return;
      var p = rows[0].length;
      [['ramadan', 'رمضان', p - 2], ['muharram', 'محرم', p - 1]].forEach(function (e) {
        var b = fit.beta[e[2]], se = fit.se[e[2]];
        var exposure = inputs.xH.slice(start).reduce(function (s, x) { return s + x[e[2] - p + 2]; }, 0);
        if (exposure < 0.3) return;
        var zstat = se ? b / se : 0;
        var pval = 2 * (1 - normCdf(Math.abs(zstat)));
        out.push({ familyId: fam.id, event: e[0], kind: e[1], uplift: Math.expm1(b), lo: se ? Math.expm1(b - 1.96 * se) : null, hi: se ? Math.expm1(b + 1.96 * se) : null, p: pval });
      });
    });
    return out;
  }
  function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  function estimateEvents() {
    var inputs = buildInputs({ horizon: 1 });
    if (IBP.engine.online()) {
      return IBP.engine.call('/demand/event-effects', enginePayload(inputs), { timeout: 60000 }).then(function (r) { return { engine: 'python', effects: r.effects }; },
        function () { return { engine: 'local', effects: estimateEventsLocal(inputs) }; });
    }
    return Promise.resolve({ engine: 'local', effects: estimateEventsLocal(inputs) });
  }

  IBP.forecast = { METHODS: METHODS, FAMILIES: FAMILIES, METRICS: METRICS, SMOOTH: SMOOTH, INTERMITTENT: INTERMITTENT, metrics: metrics, btOptions: btOptions, seasonalIndex: seasonalIndex, ols: ols, predict: predict, auto: auto, wmape: wmape, buildInputs: buildInputs, runLocal: runLocal, run: run, enginePayload: enginePayload, estimateEvents: estimateEvents, estimateEventsLocal: estimateEventsLocal };
})(window.IBP = window.IBP || {});
