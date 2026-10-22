/*
 * پیش‌بینی آماری تقاضا (موتور پایه داخل برنامه؛ بدون نیاز به پایتون).
 *
 * روش‌ها:
 *   snaive   فصلی ساده: مقدار همان ماه سال قبل
 *   ma3      میانگین متحرک ۳ ماهه
 *   ses      هموارسازی نمایی ساده روی سری فصل‌زدایی‌شده
 *   holt     روند میرا (Holt damped) روی سری فصل‌زدایی‌شده
 *   reg      رگرسیون: روند + اثر ماه (یا فوریه) + شدت مناسبت‌های قمری (اثر رمضان/محرم را خودش برآورد می‌کند)
 *   croston  کراستون اصلاح‌شده (SBA) برای تقاضای متناوب
 *
 * برای همه روش‌ها به‌جز reg، سری تاریخی ابتدا بر ضریب مناسبت‌ها تقسیم و پیش‌بینی در ضریب آینده ضرب می‌شود.
 * انتخاب روش با اعتبارسنجی چرخشی (سه مبدأ، افق سه ماه) و کمترین WMAPE انجام می‌شود.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali;

  var METHODS = {
    snaive: 'فصلی ساده', ma3: 'میانگین متحرک', ses: 'هموارسازی نمایی + فصل', holt: 'روند میرا + فصل',
    reg: 'رگرسیون فصل و مناسبت', croston: 'کراستون (SBA)', hw: 'هولت-وینترز', tsb: 'TSB', ensemble: 'ترکیب مدل‌ها'
  };

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
    [0.1, 0.2, 0.3, 0.5, 0.7].forEach(function (a) {
      var l = x[0], sse = 0;
      for (var t = 1; t < x.length; t++) { var e = x[t] - l; sse += e * e; l = l + a * e; }
      if (!best || sse < best.sse) best = { a: a, l: l, sse: sse };
    });
    return best;
  }
  function fitHolt(x) {
    // ETS(A,Ad,N): l = l + φb + αe ، b = φb + βe
    var best = null;
    [0.2, 0.4, 0.6].forEach(function (a) {
      [0.02, 0.06, 0.12].forEach(function (b) {
        [0.8, 0.9, 0.98].forEach(function (phi) {
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

  /**
   * پیش‌بینی با یک روش.
   * ctx: { y, mo (ماه‌های تاریخچه 0..11), moF (ماه‌های آینده), fH, fF (ضریب مناسبت تاریخچه/آینده),
   *        xH, xF (شدت رمضان/محرم/کمپین تاریخچه و آینده: [[r,m,c],...]) }
   */
  function predict(method, ctx, h) {
    var y = ctx.y, n = y.length, out = [];
    var adj = y.map(function (v, i) { return v / (ctx.fH[i] || 1); });
    var moF = ctx.moF.slice(0, h);
    if (method === 'snaive') {
      for (var i = 0; i < h; i++) { var src = n - 12 + (i % 12); out.push(src >= 0 ? adj[src] : adj[n - 1]); }
    } else if (method === 'ma3') {
      var m3 = mean(adj.slice(-3));
      for (var i2 = 0; i2 < h; i2++) out.push(m3);
    } else if (method === 'ses' || method === 'holt') {
      var idx = seasonalIndex(adj, ctx.mo);
      var x = adj.map(function (v, k) { return v / idx[ctx.mo[k]]; });
      if (method === 'ses') { var s = fitSes(x); for (var i3 = 0; i3 < h; i3++) out.push(s.l * idx[moF[i3]]); }
      else {
        var hb = fitHolt(x), damp = 0;
        for (var i4 = 0; i4 < h; i4++) { damp += Math.pow(hb.phi, i4 + 1); out.push(Math.max(0, (hb.l + damp * hb.tr)) * idx[moF[i4]]); }
      }
    } else if (method === 'croston') {
      var a = 0.15, z = null, p = null, q = 1;
      for (var t = 0; t < n; t++) {
        if (adj[t] > 0) {
          if (z === null) { z = adj[t]; p = q; } else { z = z + a * (adj[t] - z); p = p + a * (q - p); }
          q = 1;
        } else q++;
      }
      var f = z === null ? 0 : (1 - a / 2) * z / p;
      for (var i5 = 0; i5 < h; i5++) out.push(f);
    } else if (method === 'reg') {
      var useDummies = n >= 30, rows = [], ly = y.map(function (v) { return Math.log1p(v); });
      var design = function (t, m, ev) {
        var r = [1, t / 12];
        if (useDummies) { for (var d = 1; d < 12; d++) r.push(m === d ? 1 : 0); }
        else { for (var k2 = 1; k2 <= 2; k2++) { r.push(Math.sin(2 * Math.PI * k2 * m / 12)); r.push(Math.cos(2 * Math.PI * k2 * m / 12)); } }
        return r.concat(ev);
      };
      for (var t2 = 0; t2 < n; t2++) rows.push(design(t2, ctx.mo[t2], ctx.xH[t2]));
      var fit = ols(rows, ly, 0.5);
      if (!fit) return predict('holt', ctx, h);
      for (var i6 = 0; i6 < h; i6++) {
        var row = design(n + i6, moF[i6], ctx.xF[i6]), v = 0;
        for (var c = 0; c < row.length; c++) v += row[c] * fit.beta[c];
        out.push(Math.max(0, Math.expm1(v + fit.s2 / 2)));
      }
      return out;
    }
    return out.map(function (v, k) { return Math.max(0, v * (ctx.fF[k] || 1)); });
  }

  function wmape(f, a) {
    var e = 0, s = 0;
    for (var i = 0; i < a.length; i++) { e += Math.abs(f[i] - a[i]); s += a[i]; }
    return s > 0 ? e / s : (e > 0 ? 1 : 0);
  }
  function sliceCtx(ctx, end, h) {
    return {
      y: ctx.y.slice(0, end), mo: ctx.mo.slice(0, end), fH: ctx.fH.slice(0, end), xH: ctx.xH.slice(0, end),
      moF: ctx.mo.slice(end, end + h), fF: ctx.fH.slice(end, end + h), xF: ctx.xH.slice(end, end + h)
    };
  }

  /** اعتبارسنجی چرخشی و انتخاب بهترین روش؛ خروجی: { method, scores, forecast, lo, hi } */
  function auto(ctx, horizon, opts) {
    opts = opts || {};
    var n = ctx.y.length, zeroShare = ctx.y.filter(function (v) { return v === 0; }).length / Math.max(1, n);
    var cands = opts.methods || (zeroShare > 0.3 ? ['croston', 'ma3', 'snaive'] : ['snaive', 'ma3', 'ses', 'holt', 'reg']);
    var origins = [n - 9, n - 6, n - 3].filter(function (o) { return o >= 13; });
    var scores = {}, errs = {};
    cands.forEach(function (m) {
      var F = [], Aa = [], rel = [];
      origins.forEach(function (o) {
        var c = sliceCtx(ctx, o, 3), pr = predict(m, c, 3), act = ctx.y.slice(o, o + 3);
        F = F.concat(pr); Aa = Aa.concat(act);
        pr.forEach(function (v, i) { if (act[i] > 0) rel.push((act[i] - v) / act[i]); });
      });
      scores[m] = origins.length ? wmape(F, Aa) : null;
      errs[m] = rel;
    });
    var best = cands.filter(function (m) { return scores[m] !== null; }).sort(function (a, b) { return scores[a] - scores[b]; })[0] || cands[0];
    var fc = predict(best, ctx, horizon);
    var r = errs[best] || [];
    var rmse = r.length ? Math.sqrt(mean(r.map(function (e) { return Math.min(4, e * e); }))) : 0.25;
    var z = 1.2816;
    return {
      method: best, methodLabel: METHODS[best], scores: scores, zeroShare: zeroShare,
      forecast: fc,
      lo: fc.map(function (v, i) { return Math.max(0, v * (1 - z * rmse * Math.sqrt(1 + i / 6))); }),
      hi: fc.map(function (v, i) { return v * (1 + z * rmse * Math.sqrt(1 + i / 6)); })
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
      cycle: cycle, hist: hist, fut: fut, xH: xH, xF: xF,
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
      out[it.product.id] = auto(it.ctx, inputs.fut.length);
    });
    return out;
  }

  /** بسته ارسالی به موتور پایتون */
  function enginePayload(inputs) {
    return {
      periods: inputs.hist, future: inputs.fut, events: { hist: inputs.xH, future: inputs.xF, names: ['ramadan', 'muharram', 'campaign'] },
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
      Object.keys(r.results).forEach(function (pid) { var x = r.results[pid]; summary[pid] = { method: x.method, label: x.methodLabel || METHODS[x.method] || x.method, score: x.scores ? x.scores[x.method] : null, scores: x.scores || {}, zeroShare: x.zeroShare }; });
      S.setMeta('statRun', { cycle: inputs.cycle, at: new Date().toISOString(), engine: r.engine, products: summary, history: inputs.hist.length });
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

  IBP.forecast = { METHODS: METHODS, seasonalIndex: seasonalIndex, ols: ols, predict: predict, auto: auto, wmape: wmape, buildInputs: buildInputs, runLocal: runLocal, run: run, enginePayload: enginePayload, estimateEvents: estimateEvents, estimateEventsLocal: estimateEventsLocal };
})(window.IBP = window.IBP || {});
