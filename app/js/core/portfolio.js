/*
 * تحلیل پورتفوی محصول (محاسبه پایه در برنامه؛ تکمیل‌شده با موتور پایتون در صورت اتصال).
 *  - سهم فروش، رتبه و منحنی پارتو
 *  - کلاس‌بندی ABC (ارزش) و XYZ (نوسان تقاضا)
 *  - الگوی تقاضا (Syntetos–Boylan): هموار، نامنظم، متناوب، کلوخه‌ای
 *  - رشد حجمی سالانه، حاشیه سود، چرخه عمر و توصیه اقدام
 */
(function (IBP) {
  'use strict';

  var S = IBP.store, J = IBP.jalali, A = IBP.analytics;

  var PATTERNS = {
    smooth: { label: 'هموار', desc: 'تقاضای منظم و کم‌نوسان؛ مناسب پیش‌بینی آماری استاندارد' },
    erratic: { label: 'نامنظم', desc: 'تقاضای پیوسته با نوسان زیاد در مقدار؛ ذخیره اطمینان بیشتر لازم است' },
    intermittent: { label: 'متناوب', desc: 'ماه‌های بدون فروش زیاد با مقدار نسبتاً ثابت؛ روش کراستون مناسب است' },
    lumpy: { label: 'کلوخه‌ای', desc: 'هم متناوب و هم پرنوسان؛ دشوارترین الگو برای پیش‌بینی، تولید سفارشی توصیه می‌شود' }
  };
  var RECS = {
    drop: { label: 'خروج از سبد', level: 'critical' },
    candidate: { label: 'کاندید حذف', level: 'critical' },
    invest: { label: 'سرمایه‌گذاری و رشد', level: 'good' },
    price: { label: 'بازبینی قیمت/هزینه', level: 'warning' },
    buffer: { label: 'افزایش ذخیره یا تولید سفارشی', level: 'warning' },
    launch: { label: 'پایش معرفی', level: 'info' },
    phaseout: { label: 'مدیریت حذف تدریجی', level: 'warning' },
    keep: { label: 'نگهداری', level: 'neutral' }
  };

  function thresholds() {
    var st = S.settings();
    return { a: st.abcA || 0.8, b: st.abcB || 0.95, x: st.xyzX || 0.2, y: st.xyzY || 0.5 };
  }

  /**
   * opts: { months: 12, filter(product) }
   */
  function compute(opts) {
    opts = opts || {};
    var ctx = A.ctx(), cycle = ctx.cycle, months = opts.months || 12;
    var cur = J.range(J.addMonths(cycle, -months), months);
    var prev = J.range(J.addMonths(cycle, -2 * months), months);
    var hist = J.range(J.addMonths(cycle, -24), 24);
    var si = A.salesIndex(), th = thresholds();
    var products = S.all('products').filter(function (p) { return !opts.filter || opts.filter(p); });

    var rows = products.map(function (p) {
      var rev = 0, qty = 0, cost = 0, revP = 0, qtyP = 0;
      cur.forEach(function (per) {
        var m = si.get(per), v = m && m.get(p.id);
        if (!v) return;
        rev += v.revenue; qty += v.qty;
        cost += v.qty * p.unitCost * Math.pow(1 + ctx.inflation, J.diff(cycle, per));
      });
      prev.forEach(function (per) { var m = si.get(per), v = m && m.get(p.id); if (v) { revP += v.revenue; qtyP += v.qty; } });
      var series = hist.map(function (per) { var m = si.get(per), v = m && m.get(p.id); return v ? v.qty : 0; });
      var win = series.slice(-months);
      var mean = win.reduce(function (a, b) { return a + b; }, 0) / win.length;
      var sd = Math.sqrt(win.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / win.length);
      var nz = win.filter(function (v) { return v > 0; });
      var adi = nz.length ? win.length / nz.length : null;
      var nzMean = nz.length ? nz.reduce(function (a, b) { return a + b; }, 0) / nz.length : 0;
      var nzSd = nz.length ? Math.sqrt(nz.reduce(function (a, b) { return a + (b - nzMean) * (b - nzMean); }, 0) / nz.length) : 0;
      var cv2 = nzMean ? Math.pow(nzSd / nzMean, 2) : null;
      var pattern = adi === null ? null : (adi < 1.32 ? (cv2 < 0.49 ? 'smooth' : 'erratic') : (cv2 < 0.49 ? 'intermittent' : 'lumpy'));
      var firstSale = series.findIndex(function (v) { return v > 0; });
      return {
        product: p, id: p.id, revenue: rev, qty: qty, cost: cost, revenuePrev: revP, qtyPrev: qtyP,
        margin: rev ? 1 - cost / rev : null,
        growth: qtyP > 0 ? qty / qtyP - 1 : null,
        revenueGrowth: revP > 0 ? rev / revP - 1 : null,
        cv: mean ? sd / mean : null, adi: adi, cv2: cv2, pattern: pattern,
        series: series, monthsSelling: nz.length, isNew: firstSale > 24 - months - 1 && firstSale >= 0
      };
    });

    var total = rows.reduce(function (a, r) { return a + r.revenue; }, 0) || 0;
    rows.sort(function (a, b) { return b.revenue - a.revenue; });
    var cum = 0;
    rows.forEach(function (r, i) {
      r.rank = i + 1;
      r.share = total ? r.revenue / total : 0;
      cum += r.share; r.cumShare = cum;
      r.abc = r.revenue <= 0 ? 'C' : (cum - r.share < th.a ? 'A' : cum - r.share < th.b ? 'B' : 'C');
      r.xyz = r.cv === null ? 'Z' : r.cv <= th.x ? 'X' : r.cv <= th.y ? 'Y' : 'Z';
    });
    var totalCost = rows.reduce(function (a, r) { return a + r.cost; }, 0);
    var avgMargin = total ? 1 - totalCost / total : 0;

    rows.forEach(function (r) {
      var p = r.product, rec = 'keep';
      if (p.lifecycle === 'توقف' || p.active === false) rec = 'drop';
      else if (p.phaseOutDate) rec = 'phaseout';
      else if (p.lifecycle === 'معرفی') rec = 'launch';
      else if (r.abc === 'C' && (r.growth !== null && r.growth < -0.1) && (r.margin === null || r.margin < avgMargin)) rec = 'candidate';
      else if (r.abc !== 'C' && r.growth !== null && r.growth > 0.1 && r.margin !== null && r.margin >= avgMargin * 0.9) rec = 'invest';
      else if (r.abc !== 'C' && r.margin !== null && r.margin < avgMargin * 0.75) rec = 'price';
      else if (r.pattern === 'lumpy' || r.pattern === 'erratic' || r.xyz === 'Z') rec = 'buffer';
      r.rec = rec;
    });

    var matrix = {};
    ['A', 'B', 'C'].forEach(function (a) { ['X', 'Y', 'Z'].forEach(function (x) { matrix[a + x] = { count: 0, revenue: 0, share: 0 }; }); });
    rows.forEach(function (r) { var c = matrix[r.abc + r.xyz]; c.count++; c.revenue += r.revenue; c.share += r.share; });
    var patterns = { smooth: 0, erratic: 0, intermittent: 0, lumpy: 0 };
    rows.forEach(function (r) { if (r.pattern) patterns[r.pattern]++; });
    var lifecycle = {};
    IBP.schema.field('products', 'lifecycle').options.forEach(function (o) { lifecycle[o] = { count: 0, revenue: 0 }; });
    rows.forEach(function (r) { var l = lifecycle[r.product.lifecycle || 'بلوغ']; if (l) { l.count++; l.revenue += r.revenue; } });

    var n = rows.length, top20 = Math.max(1, Math.round(n * 0.2));
    var top20Share = rows.slice(0, top20).reduce(function (a, r) { return a + r.share; }, 0);
    var qtyNow = rows.reduce(function (a, r) { return a + r.qty; }, 0), qtyPrev = rows.reduce(function (a, r) { return a + r.qtyPrev; }, 0);
    var cRows = rows.filter(function (r) { return r.abc === 'C'; });
    return {
      rows: rows, matrix: matrix, patterns: patterns, lifecycle: lifecycle, periods: cur, months: months,
      totals: {
        revenue: total, cost: totalCost, margin: avgMargin, skuCount: n,
        activeCount: rows.filter(function (r) { return r.product.active !== false && r.qty > 0; }).length,
        top20Share: top20Share, top20Count: top20,
        cCount: cRows.length, cShare: cRows.reduce(function (a, r) { return a + r.share; }, 0),
        volumeGrowth: qtyPrev ? qtyNow / qtyPrev - 1 : null,
        revenueGrowth: rows.reduce(function (a, r) { return a + r.revenuePrev; }, 0) ? total / rows.reduce(function (a, r) { return a + r.revenuePrev; }, 0) - 1 : null,
        newCount: rows.filter(function (r) { return r.product.lifecycle === 'معرفی'; }).length,
        decliningCount: rows.filter(function (r) { return r.growth !== null && r.growth < -0.1; }).length,
        phaseOutCount: rows.filter(function (r) { return r.rec === 'drop' || r.rec === 'phaseout' || r.rec === 'candidate'; }).length
      }
    };
  }

  /** داده ارسالی به موتور پایتون */
  function enginePayload(result) {
    var hist = J.range(J.addMonths(A.ctx().cycle, -24), 24);
    return {
      periods: hist,
      products: result.rows.map(function (r) {
        return { id: r.id, code: r.product.code, name: r.product.name, familyId: r.product.familyId, revenue: r.revenue, margin: r.margin, growth: r.growth, cv: r.cv, qty: r.series };
      })
    };
  }

  IBP.portfolio = { compute: compute, enginePayload: enginePayload, PATTERNS: PATTERNS, RECS: RECS, thresholds: thresholds };
})(window.IBP = window.IBP || {});
