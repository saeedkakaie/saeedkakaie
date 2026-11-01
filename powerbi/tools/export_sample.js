/*
 * خروجی داده نمونه و «نتایج مرجع» از برنامه IBP برای ساخت و آزمون مدل Power BI.
 * اجرا: node powerbi/tools/export_sample.js <پوشه خروجی>   (نیاز: Playwright با Chromium)
 * خروجی: data/*.csv (جدول‌های ورودی همه شرکت‌ها با ستون CompanyCode)، reference/*.csv (خروجی محاسبات برنامه)
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/node-tools/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || 'powerbi-sample');
const APP = 'file://' + path.resolve(__dirname, '../../app/index.html');

function csv(rows, cols) {
  const esc = (v) => {
    if (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) return '';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (typeof v === 'object') v = JSON.stringify(v);
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\r\n') + '\r\n';
}
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'schema_columns.json'), 'utf8'));
function write(dir, name, rows) {
  fs.mkdirSync(dir, { recursive: true });
  // جدول خالی هم با سرستون نوشته می‌شود تا Power Query خطا ندهد
  const cols = rows.length || !SCHEMA[name] ? [] : ['CompanyCode'].concat(SCHEMA[name]);
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (cols.indexOf(k) < 0) cols.push(k); }));
  fs.writeFileSync(path.join(dir, name + '.csv'), csv(rows, cols));
}

(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext()).newPage();
  page.on('pageerror', (e) => console.error('page error', e.message));
  await page.goto(APP);
  await page.waitForSelector('.gate-card', { timeout: 300000 });
  const codes = await page.evaluate(() => IBP.holding.list().map((c) => c.code));
  const all = {};
  const add = (k, rows) => { all[k] = (all[k] || []).concat(rows); };
  for (const code of codes) {
    console.log('شرکت', code);
    const r = await page.evaluate(async (code) => {
      const H = IBP.holding, S = IBP.store, A = IBP.analytics, J = IBP.jalali;
      await H.enter(H.byCode(code).id);
      // پیش‌بینی آماری با بک‌تست (روش داخل برنامه) تا شاخص‌های خطا و ذخیره اطمینان مرجع داشته باشند
      await IBP.forecast.run({ useEngine: false });
      await S.flush();
      const out = { data: {}, ref: {} };
      const C = (o) => Object.assign({ CompanyCode: code }, o);
      IBP.schema.keys().forEach((k) => { out.data[k] = S.all(k).map((x) => C(x)); });
      const st = S.settings();
      out.data.settings = Object.keys(st).filter((k) => typeof st[k] !== 'object').map((k) => C({ key: k, value: st[k] }));
      // نتایج پیش‌بینی آماری (بک‌تست)
      const run = S.meta('statRun') || { products: {} };
      out.ref.forecast_metrics = Object.keys(run.products || {}).map((pid) => {
        const x = run.products[pid], m = (x.metrics || {})[x.method] || {};
        return C({ productId: pid, method: x.method, methodLabel: x.label, wmape: m.wmape, bias: m.bias, rmse: m.rmse, zeroShare: x.zeroShare, origins: run.origins, lead: run.lead, metric: run.metric });
      });
      // برنامه تولید و موجودی (روش ابتکاری داخل برنامه)
      const sp = IBP.supply.compute({});
      const pl = sp.plan;
      out.ref.plan = [];
      pl.rows.forEach((row) => pl.periods.forEach((per, t) => out.ref.plan.push(C({ productId: row.product.id, period: per, demand: row.demand[t], safetyStock: row.ss[t], production: row.production[t], prebuild: row.prebuild[t], overtime: row.overtime[t], alt: row.alt[t], inventoryEnd: row.inventory[t], shortage: row.shortage[t], relError: row.rel, openingInventory: row.open }))));
      out.ref.resource_load = [];
      pl.resources.forEach((x) => pl.periods.forEach((per, t) => out.ref.resource_load.push(C({ resourceId: x.resource.id, period: per, capacityHours: x.cap, hours: x.hours[t], overtimeHours: x.overtime[t], utilization: x.util[t] }))));
      out.ref.mrp = [];
      sp.mrp.rows.forEach((x) => pl.periods.forEach((per, t) => out.ref.mrp.push(C({ materialId: x.material.id, period: per, gross: x.gross[t], net: x.net[t], plannedReceipt: x.receipts[t], plannedRelease: x.releases[t], projected: x.projected[t], safetyStock: x.ss, leadMonths: x.leadMonths, onHand: x.onHand, onOrder: x.onOrder, internalCompany: x.internal }))));
      // هزینه استاندارد و سود و زیان برنامه
      const uc = IBP.finance.unitCosts();
      out.ref.unit_costs = Object.keys(uc).map((pid) => C(Object.assign({ productId: pid }, uc[pid])));
      const f = IBP.finance.compute(sp, {});
      out.ref.pnl_monthly = f.periods.map((per, t) => { const o = { period: per }; Object.keys(f.totals).forEach((k) => { o[k] = f.totals[k][t]; }); o.nwc = f.wc.net[t]; o.receivables = f.wc.receivables[t]; o.payables = f.wc.payables[t]; o.invFinished = f.wc.inventory[t]; o.invMaterials = f.wc.materials[t]; o.budgetRevenue = f.budget.revenue[t]; o.hasBudget = f.budget.has[t]; return C(o); });
      out.ref.budget_bridge = [C({ budget: f.bridge.budget, volumeEffect: f.bridge.volume, priceMixEffect: f.bridge.priceMix, plan: f.bridge.plan, months: f.bridge.months, dsoDays: f.dso, dpoDays: f.dpo, avgChannelDiscount: A.avgDiscount() })];
      // پورتفوی
      const pf = IBP.portfolio.compute({});
      out.ref.portfolio = pf.rows.map((x) => C({ productId: x.id, rank: x.rank, revenue12: x.revenue, share: x.share, cumShare: x.cumShare, abc: x.abc, xyz: x.xyz, cv: x.cv, adi: x.adi, cv2: x.cv2, pattern: x.pattern, growth: x.growth, revenueGrowth: x.revenueGrowth, margin: x.margin, recommendation: x.rec }));
      // دقت پیش‌بینی، پوشش موجودی، RCCP، هشدارها
      const c = A.ctx().cycle;
      const acc = A.accuracy(J.range(J.addMonths(c, -3), 3));
      out.ref.accuracy_3m = acc.byProduct.map((x) => C({ productId: x.productId, absError: x.abs, error: x.err, actual: x.act, accuracy: x.accuracy, bias: x.bias }));
      out.ref.coverage = A.coverage().map((x) => C({ productId: x.product.id, onHand: x.qty, avgDemandNext3: x.demand, monthsOfCover: isFinite(x.months) ? x.months : null, safetyMonths: x.ssMonths, status: x.status, value: x.value }));
      out.ref.rccp = [];
      A.capacityLoad(J.range(c, 6)).forEach((x) => x.periods.forEach((p) => out.ref.rccp.push(C({ resourceId: x.resource.id, period: p.period, requiredHours: p.hours, capacityHours: p.capacity, utilization: p.util }))));
      out.ref.alerts = A.alerts().map((x) => C({ level: x.level, type: x.type, text: x.text, detail: x.detail }));
      // شاخص‌های خلاصه برای مقایسه با Power BI
      const sm = H.summarize();
      const k = f.kpi;
      const kv = { cycle: c, lastActual: J.addMonths(c, -1), revenueLTM: sm.revenue, revenueExternalLTM: sm.revenueExternal, revenuePrevLTM: sm.revenuePrev, tonsLTM: sm.tons, accuracy3m: acc.accuracy, bias3m: acc.bias, wmape3m: acc.wmape,
        planRevenue12: k.revenue, planGross12: k.gross, planGM: k.gm, planOperating12: k.operating, lostSales12: k.lost, planTons12: k.tons, fillRate: k.fillRate, fillRateValue: pl.kpi.fillRateValue, avgUtil: k.util, bottleneckResourceMonths: pl.kpi.bottlenecks, overtimeHours: pl.kpi.overtimeHours, prebuildTons: pl.kpi.prebuildTons, productsBelowSS: pl.kpi.belowSS,
        inventoryValueFinished: A.inventoryValue().finished, inventoryValueMaterials: A.inventoryValue().materials, budgetRevenueComparable: k.budgetRevenue, budgetGap: k.budgetGap, budgetMonths: k.budgetMonths, nwcEnd: k.nwcEnd,
        abcA: pf.rows.filter((x) => x.abc === 'A').length, abcB: pf.rows.filter((x) => x.abc === 'B').length, abcC: pf.rows.filter((x) => x.abc === 'C').length, top20Share: pf.totals.top20Share,
        alertsCritical: A.alerts().filter((x) => x.level === 'critical').length, alertsTotal: A.alerts().length };
      out.ref.kpi_summary = Object.keys(kv).map((key) => C({ kpi: key, value: kv[key] }));
      // تقویم: روزهای رمضان و دهه محرم هر ماه شمسی
      if (!window.__cal) {
        window.__cal = 1;
        out.calendar = [];
        for (let y = 1398; y <= 1420; y++) for (let m = 1; m <= 12; m++) {
          const p = J.period(y, m), ld = IBP.events.lunarDays(p), g = J.toGregorian(y, m, 1);
          out.calendar.push({ PeriodKey: p, JYear: y, JMonth: m, MonthName: J.MONTHS[m - 1], Days: ld.days, RamadanDays: ld.ramadan, MuharramDays: ld.muharram, RamadanIntensity: ld.ramadan / ld.days, MuharramIntensity: ld.muharram / ld.days, GregorianStart: g.gy + '-' + String(g.gm).padStart(2, '0') + '-' + String(g.gd).padStart(2, '0') });
        }
      }
      return out;
    }, code);
    Object.keys(r.data).forEach((k) => add('data/' + k, r.data[k]));
    Object.keys(r.ref).forEach((k) => add('reference/' + k, r.ref[k]));
    if (r.calendar) add('data/calendar_lunar', r.calendar);
  }
  const companies = await page.evaluate(() => IBP.holding.list().map((c) => ({ CompanyCode: c.code, CompanyName: c.name, BusinessModel: c.model, TemplateId: c.templateId })));
  add('data/companies', companies);
  Object.keys(all).forEach((k) => write(path.join(OUT, path.dirname(k)), path.basename(k), all[k]));
  console.log('خروجی در', OUT);
  await b.close();
})();
