/*
 * موتور محاسبات تحلیلی سمت کاربر.
 * محاسبات سبک و تعاملی (تجمیع، شاخص‌ها، بار ظرفیت، پوشش موجودی) اینجا انجام می‌شود.
 * محاسبات سنگین (پیش‌بینی آماری پیشرفته، بهینه‌سازی، دستیار هوشمند) در فازهای بعد
 * به موتور تحلیل پایتون سپرده می‌شود و از طریق همین توابع در دسترس صفحه‌ها قرار می‌گیرد.
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali, S = IBP.store;
  var cache = { v: -1 };

  function memo(key, fn) {
    if (cache.v !== S.version) cache = { v: S.version };
    if (!(key in cache)) cache[key] = fn();
    return cache[key];
  }
  function sum(arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f ? f(arr[i]) : arr[i]; return t; }

  var A = {
    sum: sum,

    ctx: function () {
      var st = S.settings();
      var cycle = st.cyclePeriod || J.currentPeriod();
      return {
        settings: st,
        cycle: cycle,
        lastActual: J.addMonths(cycle, -1),
        inflation: st.priceInflation !== undefined ? st.priceInflation : 0.025
      };
    },

    /* ---------------- شاخص‌های پایه ---------------- */
    salesIndex: function () {
      return memo('salesIndex', function () {
        var byPeriod = new Map(); // period → Map(productId → {qty, revenue})
        S.all('salesActuals').forEach(function (s) {
          var m = byPeriod.get(s.period);
          if (!m) { m = new Map(); byPeriod.set(s.period, m); }
          var r = m.get(s.productId);
          if (!r) { r = { qty: 0, revenue: 0 }; m.set(s.productId, r); }
          r.qty += s.qty; r.revenue += s.revenue;
        });
        return byPeriod;
      });
    },
    periodsWithSales: function () {
      return memo('periodsWithSales', function () {
        return Array.from(A.salesIndex().keys()).sort(function (a, b) { return a - b; });
      });
    },
    /** {qty, revenue, cost} برای یک دوره (با فیلتر اختیاری محصول) */
    salesTotal: function (period, productFilter) {
      var m = A.salesIndex().get(period), out = { qty: 0, revenue: 0, cost: 0 };
      if (!m) return out;
      var ctx = A.ctx();
      m.forEach(function (v, pid) {
        var p = S.get('products', pid);
        if (productFilter && (!p || !productFilter(p))) return;
        out.qty += v.qty; out.revenue += v.revenue;
        if (p) out.cost += v.qty * p.unitCost * Math.pow(1 + ctx.inflation, J.diff(ctx.cycle, period));
      });
      return out;
    },
    salesSeries: function (periods, productFilter) {
      return periods.map(function (p) { return A.salesTotal(p, productFilter); });
    },
    /** تجمیع فروش بر اساس بُعد: family | product | channel | region | customer | plant */
    salesBy: function (dim, periods) {
      var key = 'salesBy:' + dim + ':' + periods.join(',');
      return memo(key, function () {
        var set = new Set(periods), acc = new Map();
        S.all('salesActuals').forEach(function (s) {
          if (!set.has(s.period)) return;
          var k;
          if (dim === 'product') k = s.productId;
          else if (dim === 'customer') k = s.customerId;
          else if (dim === 'family' || dim === 'plant') { var p = S.get('products', s.productId); k = p ? p[dim + 'Id'] : null; }
          else { var c = S.get('customers', s.customerId); k = c ? c[dim + 'Id'] : null; }
          var r = acc.get(k);
          if (!r) { r = { id: k, qty: 0, revenue: 0 }; acc.set(k, r); }
          r.qty += s.qty; r.revenue += s.revenue;
        });
        var ent = { product: 'products', customer: 'customers', family: 'families', plant: 'plants', channel: 'channels', region: 'regions' }[dim];
        return Array.from(acc.values()).map(function (r) {
          r.name = S.name(ent, r.id);
          r.record = S.get(ent, r.id);
          return r;
        }).sort(function (a, b) { return b.revenue - a.revenue; });
      });
    },

    /* ---------------- پیش‌بینی ---------------- */
    /** Map(productId → Map(period → qty)) برای یک نسخه و چرخه */
    forecastMap: function (version, cycle) {
      return memo('fc:' + version + ':' + cycle, function () {
        var out = new Map();
        S.all('forecasts').forEach(function (f) {
          if (f.version !== version || f.cycle !== cycle) return;
          var m = out.get(f.productId);
          if (!m) { m = new Map(); out.set(f.productId, m); }
          m.set(f.period, (m.get(f.period) || 0) + f.qty);
        });
        return out;
      });
    },
    forecastQty: function (productId, period, version, cycle) {
      var m = A.forecastMap(version || 'اجماعی', cycle || A.ctx().cycle).get(productId);
      return m ? (m.get(period) || 0) : 0;
    },
    priceAt: function (p, period) {
      var ctx = A.ctx();
      return p.unitPrice * Math.pow(1 + ctx.inflation, J.diff(ctx.cycle, period));
    },
    /** درآمد پیش‌بینی‌شده یک دوره (تخفیف میانگین کانال‌ها لحاظ می‌شود) */
    forecastTotal: function (period, version, cycle, productFilter) {
      var ctx = A.ctx(), fm = A.forecastMap(version || 'اجماعی', cycle || ctx.cycle), out = { qty: 0, revenue: 0, cost: 0 };
      var disc = A.avgDiscount();
      fm.forEach(function (m, pid) {
        var q = m.get(period);
        if (!q) return;
        var p = S.get('products', pid);
        if (!p || (productFilter && !productFilter(p))) return;
        out.qty += q;
        out.revenue += q * A.priceAt(p, period) * (1 - disc);
        out.cost += q * p.unitCost * Math.pow(1 + ctx.inflation, J.diff(ctx.cycle, period));
      });
      return out;
    },
    avgDiscount: function () {
      return memo('avgDisc', function () {
        var chs = S.all('channels');
        if (!chs.length) return 0;
        var w = new Map();
        S.all('customers').forEach(function (c) { w.set(c.channelId, (w.get(c.channelId) || 0) + 1); });
        var tw = 0, t = 0;
        chs.forEach(function (c) { var n = w.get(c.id) || 0; tw += n; t += n * (c.discount || 0); });
        return tw ? t / tw : 0;
      });
    },

    /** دقت پیش‌بینی lag-1: WMAPE و Bias روی دوره‌های داده‌شده */
    accuracy: function (periods, productFilter) {
      var key = 'acc:' + periods.join(',') + (productFilter ? ':' + productFilter.key : '');
      return memo(key, function () {
        var si = A.salesIndex(), absErr = 0, err = 0, act = 0, byProduct = new Map(), byPeriod = [];
        periods.forEach(function (per) {
          var fm = A.forecastMap('اجماعی', J.addMonths(per, -1));
          var pe = 0, pa = 0, pErr = 0;
          var actuals = si.get(per) || new Map();
          var pids = new Set(Array.from(fm.keys()).concat(Array.from(actuals.keys())));
          pids.forEach(function (pid) {
            var p = S.get('products', pid);
            if (!p || (productFilter && !productFilter(p))) return;
            var f = fm.get(pid) ? (fm.get(pid).get(per) || 0) : 0;
            var a = actuals.get(pid) ? actuals.get(pid).qty : 0;
            if (!fm.size) return;
            absErr += Math.abs(f - a); err += f - a; act += a;
            pe += Math.abs(f - a); pErr += f - a; pa += a;
            var r = byProduct.get(pid);
            if (!r) { r = { productId: pid, abs: 0, err: 0, act: 0 }; byProduct.set(pid, r); }
            r.abs += Math.abs(f - a); r.err += f - a; r.act += a;
          });
          byPeriod.push({ period: per, accuracy: pa ? Math.max(0, 1 - pe / pa) : null, bias: pa ? pErr / pa : null, hasData: fm.size > 0 });
        });
        var products = Array.from(byProduct.values()).map(function (r) {
          r.wmape = r.act ? r.abs / r.act : null;
          r.accuracy = r.act ? Math.max(0, 1 - r.abs / r.act) : null;
          r.bias = r.act ? r.err / r.act : null;
          return r;
        });
        return {
          wmape: act ? absErr / act : null,
          accuracy: act ? Math.max(0, 1 - absErr / act) : null,
          bias: act ? err / act : null,
          byPeriod: byPeriod,
          byProduct: products
        };
      });
    },

    /* ---------------- موجودی ---------------- */
    inventoryByProduct: function () {
      return memo('invByProduct', function () {
        var m = new Map();
        S.all('inventory').forEach(function (r) { m.set(r.productId, (m.get(r.productId) || 0) + (r.qty || 0)); });
        return m;
      });
    },
    inventoryValue: function () {
      return memo('invValue', function () {
        var v = 0;
        A.inventoryByProduct().forEach(function (q, pid) { var p = S.get('products', pid); if (p) v += q * p.unitCost; });
        var mv = 0;
        S.all('materialInventory').forEach(function (r) { var m = S.get('materials', r.materialId); if (m) mv += (r.qty || 0) * m.unitCost; });
        return { finished: v, materials: mv, total: v + mv };
      });
    },
    /** پوشش موجودی هر محصول بر حسب ماه تقاضای آینده و وضعیت آن */
    coverage: function () {
      return memo('coverage', function () {
        var ctx = A.ctx(), inv = A.inventoryByProduct(), st = ctx.settings;
        var next = J.range(ctx.cycle, 3);
        return S.all('products').filter(function (p) { return p.active !== false; }).map(function (p) {
          var demand = sum(next, function (per) { return A.forecastQty(p.id, per); }) / 3;
          var q = inv.get(p.id) || 0;
          var months = demand > 0 ? q / demand : (q > 0 ? Infinity : 0);
          var ssMonths = (p.safetyStockDays || 0) / 30;
          var status = 'ok';
          if (demand > 0 && months < ssMonths) status = 'critical';
          else if (demand > 0 && months < ssMonths + 0.5) status = 'warning';
          else if (months > (st.excessMonths || 3)) status = 'excess';
          return { product: p, qty: q, demand: demand, months: months, ssMonths: ssMonths, status: status, value: q * p.unitCost };
        });
      });
    },

    /* ---------------- ظرفیت ---------------- */
    resourceCapacity: function (res) {
      var plant = S.get('plants', res.plantId);
      var days = plant && plant.workingDays ? plant.workingDays : 25;
      return (res.shifts || 1) * (res.hoursPerShift || 8) * days * (res.efficiency || 1);
    },
    /** بار هر منبع در دوره‌ها بر اساس پیش‌بینی اجماعی و مسیر تولید اصلی */
    capacityLoad: function (periods) {
      var key = 'cap:' + periods.join(',');
      return memo(key, function () {
        var primary = new Map(); // productId → routing (priority 1)
        S.all('routings').forEach(function (r) {
          var cur = primary.get(r.productId);
          if ((r.priority || 1) === 1 && (!cur || r.unitsPerHour > cur.unitsPerHour)) primary.set(r.productId, r);
        });
        return S.all('resources').map(function (res) {
          var cap = A.resourceCapacity(res);
          var rows = periods.map(function (per) {
            var hours = 0;
            primary.forEach(function (r, pid) {
              if (r.resourceId !== res.id || !r.unitsPerHour) return;
              hours += A.forecastQty(pid, per) / r.unitsPerHour;
            });
            return { period: per, hours: hours, capacity: cap, util: cap ? hours / cap : null };
          });
          return { resource: res, capacity: cap, periods: rows, peak: Math.max.apply(null, rows.map(function (r) { return r.util || 0; })), avg: sum(rows, function (r) { return r.util || 0; }) / rows.length };
        });
      });
    },

    /* ---------------- بودجه ---------------- */
    budgetTotal: function (period, productFilter) {
      var out = { qty: 0, revenue: 0 };
      S.all('budgets').forEach(function (b) {
        if (b.period !== period) return;
        if (productFilter) { var p = S.get('products', b.productId); if (!p || !productFilter(p)) return; }
        out.qty += b.qty; out.revenue += b.revenue;
      });
      return out;
    },

    /* ---------------- هشدارها ---------------- */
    alerts: function () {
      return memo('alerts', function () {
        var ctx = A.ctx(), st = ctx.settings, out = [];
        A.coverage().forEach(function (c) {
          if (c.status === 'critical') out.push({ productId: c.product.id, level: 'critical', type: 'موجودی', text: 'خطر کمبود: ' + c.product.name, detail: 'پوشش ' + IBP.fmt.num(c.months, 1) + ' ماه، کمتر از ذخیره اطمینان', link: '#/masterdata/inventory' });
          else if (c.status === 'excess') out.push({ productId: c.product.id, level: 'warning', type: 'موجودی', text: 'موجودی مازاد: ' + c.product.name, detail: 'پوشش ' + (isFinite(c.months) ? IBP.fmt.num(c.months, 1) + ' ماه' : 'بدون تقاضا') + '، ارزش ' + IBP.fmt.money(c.value), link: '#/masterdata/inventory' });
        });
        A.capacityLoad(J.range(ctx.cycle, 6)).forEach(function (r) {
          var over = r.periods.filter(function (p) { return p.util > (st.utilizationMax || 1); });
          if (over.length) out.push({ resourceId: r.resource.id, level: 'critical', type: 'ظرفیت', text: 'اضافه‌بار ' + r.resource.name, detail: over.length + ' ماه از ۶ ماه آینده بالای ظرفیت؛ اوج ' + IBP.fmt.pct(r.peak, 0), link: '#/masterdata/resources' });
          else if (r.peak > (st.utilizationWarn || 0.85)) out.push({ resourceId: r.resource.id, level: 'warning', type: 'ظرفیت', text: 'نزدیک به سقف ظرفیت: ' + r.resource.name, detail: 'اوج بهره‌برداری ' + IBP.fmt.pct(r.peak, 0), link: '#/masterdata/resources' });
        });
        var acc = A.accuracy(J.range(J.addMonths(ctx.cycle, -3), 3));
        acc.byProduct.forEach(function (r) {
          if (r.bias !== null && Math.abs(r.bias) > 0.2 && r.act > 0) {
            out.push({ productId: r.productId, level: 'warning', type: 'پیش‌بینی', text: (r.bias > 0 ? 'بیش‌برآورد مداوم: ' : 'کم‌برآورد مداوم: ') + S.name('products', r.productId), detail: 'سوگیری ۳ ماه اخیر ' + IBP.fmt.signedPct(r.bias), link: '#/demand' });
          }
        });
        var rank = { critical: 0, warning: 1, info: 2 };
        return out.sort(function (a, b) { return rank[a.level] - rank[b.level]; });
      });
    }
  };

  IBP.analytics = A;
})(window.IBP = window.IBP || {});
