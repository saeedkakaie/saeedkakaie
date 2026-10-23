/*
 * بازنگری مدیریت — جلسه MBR (فاز ۶):
 *   pack     بسته خودکار جلسه: کارنامه شاخص‌ها در برابر هدف، تقاضا، تأمین، مالی، سناریوی منتخب، استثناها
 *            (هر استثنا با یک کلیک به اقدام تبدیل می‌شود) و پیگیری اقدامات جلسه قبل
 *   actions  تخته کانبان تصمیم‌ها و اقدامات (کشیدن و رها کردن بین وضعیت‌ها) و جدول کامل
 *   حالت ارائه  اسلایدهای تمام‌صفحه با انیمیشن Motion برای اجرای جلسه (پیمایش با کلیدهای جهت)
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, A = IBP.analytics, C = IBP.charts, UI = IBP.ui;
  var TABS = [['pack', 'بسته جلسه', 'review'], ['actions', 'تصمیم‌ها و اقدامات', 'check']];
  var STATUSES = ['باز', 'در حال انجام', 'انجام شد', 'لغو'];
  var state = { area: 'all' };

  function money(v) { return F.money(v, { digits: 0 }); }
  function todayIso() { var t = J.today(); return J.jalaliStrToIso(t.jy + '/' + t.jm + '/' + t.jd); }
  function overdue(a) { return a.dueDate && a.status !== 'انجام شد' && a.status !== 'لغو' && a.dueDate < todayIso(); }

  /** داده بسته جلسه */
  function model() {
    var st = S.settings(), cyc = A.ctx().cycle;
    var acc3 = A.accuracy(J.range(J.addMonths(cyc, -3), 3));
    var accTrend = A.accuracy(J.range(J.addMonths(cyc, -12), 12)).byPeriod.map(function (x) { return x.accuracy; });
    var sp = IBP.supply.current(), pl = sp.plan, f = IBP.finance.current();
    var cover = A.coverage().filter(function (c) { return isFinite(c.months); });
    var cov = cover.length ? cover.map(function (c) { return c.months; }).sort(function (a, b) { return a - b; })[Math.floor(cover.length / 2)] : null;
    var alerts = A.alerts();
    var tgtAcc = st.forecastAccuracyTarget || 0.8, tgtSl = st.serviceLevelTarget || 0.95;
    var lvl = function (ok, warn) { return ok ? 'good' : warn ? 'warning' : 'critical'; };
    var score = [
      { k: 'acc', label: 'دقت پیش‌بینی (۳ ماه)', v: acc3.accuracy, fmt: function (v) { return F.pct(v, 0); }, target: 'هدف ' + F.pct(tgtAcc, 0), level: lvl(acc3.accuracy >= tgtAcc, acc3.accuracy >= tgtAcc - 0.1), trend: accTrend, link: '#/demand/accuracy' },
      { k: 'bias', label: 'سوگیری پیش‌بینی', v: acc3.bias, fmt: function (v) { return F.signedPct(v); }, target: 'هدف ±۵٪', level: lvl(Math.abs(acc3.bias) <= 0.05, Math.abs(acc3.bias) <= 0.1), link: '#/demand/accuracy' },
      { k: 'fill', label: 'سطح خدمت برنامه', v: pl.kpi.fillRate, fmt: function (v) { return F.pct(v, 1); }, target: 'هدف ' + F.pct(tgtSl, 0), level: lvl(pl.kpi.fillRate >= tgtSl, pl.kpi.fillRate >= tgtSl - 0.03), link: '#/supply/mps' },
      { k: 'util', label: 'بهره‌برداری خطوط', v: pl.kpi.avgUtil, fmt: function (v) { return F.pct(v, 0); }, target: F.num(pl.kpi.bottlenecks) + ' ماه گلوگاه', level: lvl(pl.kpi.bottlenecks === 0, pl.kpi.bottlenecks <= 6), trend: pl.resources.length ? pl.periods.map(function (_, i) { return A.sum(pl.resources, function (r) { return r.util[i] || 0; }) / pl.resources.length; }) : null, link: '#/supply/capacity' },
      { k: 'gm', label: 'حاشیه ناخالص برنامه', v: f.kpi.gm, fmt: function (v) { return F.pct(v, 1); }, target: 'سود ' + money(f.kpi.gross), level: lvl(f.kpi.gm >= 0.2, f.kpi.gm >= 0.12), trend: f.totals.gross.slice(0, 12), link: '#/finance/pnl' },
      { k: 'gap', label: 'شکاف درآمد با بودجه', v: f.kpi.budgetGap, fmt: function (v) { return v === null || v === undefined ? '—' : F.signedPct(v); }, target: F.num(f.kpi.budgetMonths) + ' ماه بودجه', level: f.kpi.budgetGap === null ? 'neutral' : lvl(f.kpi.budgetGap >= -0.02, f.kpi.budgetGap >= -0.08), link: '#/finance/budget' },
      { k: 'cover', label: 'میانه پوشش موجودی', v: cov, fmt: function (v) { return v === null ? '—' : F.num(v, 1) + ' ماه'; }, target: 'مازاد بیش از ' + F.num(st.excessMonths || 3) + ' ماه', level: cov === null ? 'neutral' : lvl(cov >= 0.5 && cov <= (st.excessMonths || 3), cov <= (st.excessMonths || 3) + 1), link: '#/inventory/projection' },
      { k: 'crit', label: 'استثنای بحرانی', v: alerts.filter(function (a) { return a.level === 'critical'; }).length, fmt: function (v) { return F.num(v); }, target: F.num(alerts.length) + ' هشدار کل', level: lvl(alerts.filter(function (a) { return a.level === 'critical'; }).length === 0, alerts.filter(function (a) { return a.level === 'critical'; }).length <= 3) }
    ];
    var next3 = J.range(cyc, 3), cons = A.forecastMap('اجماعی', cyc), stat = A.forecastMap('آماری', cyc);
    var tonsOf = function (map, per) { var t = 0; map.forEach(function (m, pid) { var p = S.get('products', pid); if (p) t += (m.get(per) || 0) * (p.unitWeightKg || 0) / 1000; }); return t; };
    var lyTons = function (per) { var t = 0, m = A.salesIndex().get(J.addMonths(per, -12)); if (m) m.forEach(function (v, pid) { var p = S.get('products', pid); if (p) t += v.qty * (p.unitWeightKg || 0) / 1000; }); return t; };
    var demand = next3.map(function (per) { return { per: per, cons: tonsOf(cons, per), stat: tonsOf(stat, per), ly: lyTons(per) }; });
    var adjustments = S.all('demandAdjustments').filter(function (a) { return a.cycle === cyc; });
    var chosen = IBP.finance.list().filter(function (x) { return x.chosen; })[0] || null;
    var acts = S.all('actions');
    return {
      st: st, cycle: cyc, score: score, plan: pl, mrp: sp.mrp, fin: f, demand: demand, adjustments: adjustments, alerts: alerts, chosen: chosen,
      followUp: acts.filter(function (a) { return a.cycle < cyc && a.status !== 'انجام شد' && a.status !== 'لغو'; }),
      current: acts.filter(function (a) { return a.cycle === cyc; }), all: acts
    };
  }

  function newAction(prefill) {
    IBP.form.editRecord('actions', Object.assign({ cycle: A.ctx().cycle, kind: 'اقدام', status: 'باز', priority: 'متوسط', area: 'عمومی' }, prefill || {}), function () { IBP.app.render(true); });
  }
  function areaOf(alert) { return alert.type === 'ظرفیت' ? 'تأمین' : alert.type === 'موجودی' ? 'تأمین' : alert.type === 'پیش‌بینی' ? 'تقاضا' : 'عمومی'; }

  /* ---------------- بخش‌های مشترک بسته و ارائه ---------------- */
  function scorecard(M) {
    var wrap = h('div.score-grid');
    M.score.forEach(function (s) {
      var tile = h(s.link ? 'a.score-tile.' + s.level : 'div.score-tile.' + s.level, s.link ? { href: s.link } : {},
        h('div.st-top', h('span.st-label', s.label), h('span', { html: UI.statusBadge(s.level, s.level === 'good' ? 'مطلوب' : s.level === 'warning' ? 'توجه' : s.level === 'critical' ? 'بحرانی' : '—') })),
        h('div.st-value', s.v === null || s.v === undefined ? '—' : s.fmt(s.v)),
        h('div.st-foot', h('span', s.target), s.trend ? h('span', { html: C.sparkline(s.trend.map(function (x) { return x || 0; }), { width: 84, height: 22 }) }) : null));
      wrap.appendChild(tile);
    });
    return wrap;
  }
  function demandChart(M, box, height) {
    C.columns(box, { labels: M.demand.map(function (d) { return J.label(d.per); }), height: height || 240,
      series: [{ name: 'سال قبل (واقعی)', values: M.demand.map(function (d) { return d.ly; }), color: 'color-mix(in srgb, var(--text-2) 40%, transparent)' }, { name: 'آماری', values: M.demand.map(function (d) { return d.stat; }), color: 'var(--series-3)' }, { name: 'اجماعی', values: M.demand.map(function (d) { return d.cons; }), color: 'var(--series-1)' }],
      format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' تن'; } });
  }
  function supplyChart(M, box, height) {
    var p = M.plan, per = p.periods.slice(0, 12);
    C.columns(box, { labels: per.map(J.shortLabel), tipTitles: per.map(J.label), height: height || 240,
      series: [{ name: 'تقاضا', values: p.demTons.slice(0, 12), color: 'var(--series-2)' }, { name: 'تولید', values: p.prodTons.slice(0, 12), color: 'var(--series-1)' }],
      lines: [{ name: 'موجودی پایان ماه', values: p.invTons.slice(0, 12), color: 'var(--series-3)' }], format: function (v) { return F.num(v, 0); }, tipFormat: function (v) { return F.num(v, 0) + ' تن'; } });
  }
  function bridgeChart(M, box, height) {
    var br = M.fin.bridge, sc = S.settings().displayScale || 1e9;
    if (!br.months) { box.appendChild(h('div.cell-sub', 'برای افق برنامه بودجه‌ای ثبت نشده است.')); return; }
    C.waterfall(box, { items: [{ label: 'بودجه', value: br.budget / sc, total: true }, { label: 'اثر حجم', value: br.volume / sc }, { label: 'اثر قیمت و ترکیب', value: br.priceMix / sc }, { label: 'برنامه', value: br.plan / sc, total: true }], format: function (v) { return F.num(v, 0); }, height: height || 240 });
  }
  function exceptionList(M, limit, withActions) {
    var ul = h('ul.alerts', { style: { maxHeight: 'none' } });
    if (!M.alerts.length) ul.appendChild(h('li.alert-item', { html: UI.statusBadge('good', 'استثنایی وجود ندارد') }));
    M.alerts.slice(0, limit || 8).forEach(function (a) {
      ul.appendChild(h('li.alert-item',
        h('div.alert-icon.' + a.level, { html: icon(a.level === 'critical' ? 'critical' : 'alert', 16) }),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div.alert-text', a.text), h('div.alert-detail', a.detail)),
        withActions ? h('button.btn.btn-sm', { type: 'button', html: icon('plus', 13) + '<span>اقدام</span>', onclick: function () { newAction({ title: 'رفع: ' + a.text, area: areaOf(a), priority: a.level === 'critical' ? 'بالا' : 'متوسط', note: a.detail }); } }) : h('span.alert-type', a.type)));
    });
    return ul;
  }
  function actionList(list, empty) {
    var ul = h('ul.alerts', { style: { maxHeight: 'none' } });
    if (!list.length) ul.appendChild(h('li.alert-item', { html: UI.statusBadge('good', empty || 'موردی نیست') }));
    list.forEach(function (a) {
      var od = overdue(a);
      ul.appendChild(h('li.alert-item.clickable', { onclick: function () { IBP.form.editRecord('actions', a, function () { IBP.app.render(true); }); } },
        h('div.alert-icon.' + (od ? 'critical' : a.kind === 'ریسک' ? 'warning' : 'good'), { html: icon(a.kind === 'تصمیم' ? 'check' : a.kind === 'ریسک' ? 'alert' : 'flag', 15) }),
        h('div', { style: { flex: 1, minWidth: 0 } }, h('div.alert-text', a.title), h('div.alert-detail', [a.kind, a.area, a.owner, a.dueDate ? 'سررسید ' + J.isoToJalaliStr(a.dueDate) : null].filter(Boolean).join(' · '))),
        h('span', { html: UI.statusBadge(od ? 'critical' : a.status === 'انجام شد' ? 'good' : a.status === 'در حال انجام' ? 'info' : 'neutral', od ? 'سررسید گذشته' : a.status) })));
    });
    return ul;
  }

  /* ======================= بسته جلسه ======================= */
  function renderPack(root, M) {
    root.appendChild(h('div.mbr-agenda', ['کارنامه', 'تقاضا', 'تأمین', 'مالی', 'سناریو و تصمیم', 'استثناها', 'پیگیری اقدامات'].map(function (t, i) { return h('a.mbr-step', { href: '#mbr-' + i, onclick: function (e) { e.preventDefault(); var el = document.getElementById('mbr-' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, h('b', F.num(i + 1)), h('span', t)); })));
    var grid = h('div.dash-grid'); root.appendChild(grid);
    var c0 = UI.card({ title: 'کارنامه شاخص‌ها', sub: 'در برابر هدف · برای جزئیات هر شاخص کلیک کنید', icon: 'target', span: 12 });
    c0.el.id = 'mbr-0'; c0.body.appendChild(scorecard(M)); grid.appendChild(c0.el);
    var c1 = UI.card({ title: 'تقاضای سه ماه آینده', sub: 'تن · اجماعی در برابر آماری و سال قبل · ' + F.num(M.adjustments.length) + ' تغییر ثبت‌شده در این چرخه', icon: 'trend', span: 6 });
    c1.el.id = 'mbr-1'; var b1 = h('div'); c1.body.appendChild(b1); demandChart(M, b1); grid.appendChild(c1.el);
    var c2 = UI.card({ title: 'تأمین: تقاضا، تولید و موجودی', sub: 'تن · سطح خدمت ' + F.pct(M.plan.kpi.fillRate, 1) + ' · پیش‌ساخت ' + F.num(M.plan.kpi.prebuildTons, 0) + ' تن · اضافه‌کاری ' + F.num(M.plan.kpi.overtimeHours, 0) + ' ساعت', icon: 'factory', span: 6 });
    c2.el.id = 'mbr-2'; var b2 = h('div'); c2.body.appendChild(b2); supplyChart(M, b2); grid.appendChild(c2.el);
    var c3 = UI.card({ title: 'مالی: پل درآمد بودجه تا برنامه', sub: F.moneyUnit() + ' · سود ناخالص ۱۲ ماه ' + money(M.fin.kpi.gross) + ' (' + F.pct(M.fin.kpi.gm, 1) + ')', icon: 'coins', span: 6 });
    c3.el.id = 'mbr-3'; var b3 = h('div'); c3.body.appendChild(b3); bridgeChart(M, b3); grid.appendChild(c3.el);
    var c4 = UI.card({ title: 'سناریو و تصمیم‌های این جلسه', sub: M.chosen ? 'سناریوی منتخب: ' + M.chosen.name : 'سناریوی نهایی انتخاب نشده است', icon: 'scenario', span: 6, flush: true,
      tools: [h('button.btn.btn-sm', { type: 'button', html: icon('plus', 14) + '<span>تصمیم جدید</span>', onclick: function () { newAction({ kind: 'تصمیم' }); } })] });
    c4.el.id = 'mbr-4';
    if (M.chosen) c4.body.appendChild(h('div.sc-decision', { style: { margin: '12px 18px 0' }, html: icon('check', 14) + '<span>' + F.escape(M.chosen.name) + (M.chosen.decision && M.chosen.decision.reason ? ' — ' + F.escape(M.chosen.decision.reason) : '') + '</span>' }));
    c4.body.appendChild(actionList(M.current, 'هنوز تصمیم یا اقدامی برای این جلسه ثبت نشده است'));
    grid.appendChild(c4.el);
    var c5 = UI.card({ title: 'استثناها', sub: 'هر مورد را می‌توان مستقیم به اقدام تبدیل کرد', icon: 'alert', span: 6, flush: true });
    c5.el.id = 'mbr-5'; c5.body.appendChild(exceptionList(M, 10, true)); grid.appendChild(c5.el);
    var c6 = UI.card({ title: 'پیگیری اقدامات جلسات قبل', sub: F.num(M.followUp.length) + ' مورد باز · ' + F.num(M.followUp.filter(overdue).length) + ' مورد سررسید گذشته', icon: 'clock', span: 6, flush: true });
    c6.el.id = 'mbr-6'; c6.body.appendChild(actionList(M.followUp, 'همه اقدامات جلسات قبل بسته شده‌اند')); grid.appendChild(c6.el);
  }

  /* ======================= کانبان اقدامات ======================= */
  function renderActions(root, M) {
    var areas = ['all', 'تقاضا', 'تأمین', 'مالی', 'پورتفوی', 'عمومی'];
    root.appendChild(h('div.filter-row', h('div.seg', areas.map(function (a) { return h('button' + (state.area === a ? '.on' : ''), { type: 'button', onclick: function () { state.area = a; IBP.app.render(true); } }, a === 'all' ? 'همه حوزه‌ها' : a); })),
      h('span.scope-note', 'کارت‌ها را بین ستون‌ها بکشید تا وضعیت تغییر کند · کلیک برای ویرایش')));
    var list = M.all.filter(function (a) { return state.area === 'all' || a.area === state.area; });
    var board = h('div.kanban');
    STATUSES.forEach(function (st) {
      var items = list.filter(function (a) { return a.status === st; }).sort(function (a, b) { return String(a.dueDate || '').localeCompare(String(b.dueDate || '')); });
      var col = h('div.kb-col', { 'data-status': st }, h('div.kb-head', h('b', st), h('span.kb-count', F.num(items.length))));
      var body = h('div.kb-body');
      items.forEach(function (a) {
        var od = overdue(a);
        var card = h('div.kb-card' + (od ? '.overdue' : '') + '.pr-' + (a.priority === 'بالا' ? 'high' : a.priority === 'کم' ? 'low' : 'mid'), { draggable: 'true', tabindex: 0, 'data-id': a.id },
          h('div.kb-kind', { html: UI.statusBadge(a.kind === 'تصمیم' ? 'info' : a.kind === 'ریسک' ? 'warning' : 'neutral', a.kind) + ' <span class="cell-sub">' + F.escape(a.area || '') + '</span>' }),
          h('div.kb-title', a.title),
          h('div.kb-meta', h('span', { html: icon('users', 12) + ' ' + F.escape(a.owner || '—') }), h('span', { html: icon('calendar', 12) + ' ' + (a.dueDate ? J.isoToJalaliStr(a.dueDate) : '—') })),
          od ? h('div.kb-od', 'سررسید گذشته') : null);
        card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', a.id); card.classList.add('dragging'); });
        card.addEventListener('dragend', function () { card.classList.remove('dragging'); });
        card.addEventListener('click', function () { IBP.form.editRecord('actions', a, function () { IBP.app.render(true); }); });
        card.addEventListener('keydown', function (e) {
          // جابه‌جایی با صفحه‌کلید: + و − وضعیت را جلو/عقب می‌برد
          var i = STATUSES.indexOf(a.status);
          if (e.key === '+' || e.key === '-') { e.preventDefault(); var ni = Math.max(0, Math.min(STATUSES.length - 1, i + (e.key === '+' ? 1 : -1))); move(a.id, STATUSES[ni]); }
        });
        body.appendChild(card);
      });
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', function () { col.classList.remove('over'); });
      col.addEventListener('drop', function (e) { e.preventDefault(); col.classList.remove('over'); move(e.dataTransfer.getData('text/plain'), st); });
      col.appendChild(body);
      board.appendChild(col);
    });
    function move(id, st) {
      var a = S.get('actions', id); if (!a || a.status === st) return;
      S.update('actions', id, { status: st });
      IBP.app.render(true);
      var el = document.querySelector('.kb-card[data-id="' + id + '"]');
      if (el && IBP.motion) { IBP.motion.pulse(el); el.focus(); }
    }
    var card = UI.card({ title: 'تخته تصمیم‌ها و اقدامات', sub: F.num(list.length) + ' مورد · ' + F.num(list.filter(overdue).length) + ' سررسید گذشته', icon: 'check', span: 12,
      tools: [h('button.btn.btn-sm.btn-primary', { type: 'button', html: icon('plus', 14) + '<span>مورد جدید</span>', onclick: function () { newAction(); } })] });
    card.body.appendChild(board);
    var grid = h('div.dash-grid'); grid.appendChild(card.el); root.appendChild(grid);
    var tc = UI.card({ title: 'فهرست کامل', icon: 'list', span: 12, flush: true, exportFn: function () { return exportPack(M); } });
    IBP.grid(tc.body, { rows: function () { return list; }, pageSize: 15, onRowClick: function (a) { IBP.form.editRecord('actions', a, function () { IBP.app.render(true); }); }, columns: [
      { key: 't', label: 'عنوان', value: function (a) { return a.title; } },
      { key: 'k', label: 'نوع', value: function (a) { return a.kind; } },
      { key: 'ar', label: 'حوزه', value: function (a) { return a.area; } },
      { key: 'o', label: 'مسئول', value: function (a) { return a.owner || ''; } },
      { key: 'c', label: 'جلسه', value: function (a) { return a.cycle; }, render: function (a) { return J.label(a.cycle); } },
      { key: 'd', label: 'سررسید', value: function (a) { return a.dueDate || ''; }, render: function (a) { return a.dueDate ? J.isoToJalaliStr(a.dueDate) : '—'; } },
      { key: 's', label: 'وضعیت', value: function (a) { return a.status; }, render: function (a) { var od = overdue(a); return UI.statusBadge(od ? 'critical' : a.status === 'انجام شد' ? 'good' : a.status === 'در حال انجام' ? 'info' : 'neutral', od ? 'سررسید گذشته' : a.status); } }
    ] });
    grid.appendChild(tc.el);
  }

  function exportPack(M) {
    var sc = M.score;
    return IBP.excel.exportTables({ filename: 'بسته جلسه بازنگری مدیریت ' + J.label(M.cycle), sheets: [
      { name: 'کارنامه', title: 'کارنامه شاخص‌ها — ' + J.label(M.cycle), columns: [{ header: 'شاخص', value: function (s) { return s.label; }, type: 'text' }, { header: 'مقدار', value: function (s) { return s.v === null || s.v === undefined ? '—' : s.fmt(s.v); }, type: 'text' }, { header: 'هدف / توضیح', value: function (s) { return s.target; }, type: 'text' }, { header: 'وضعیت', value: function (s) { return s.level === 'good' ? 'مطلوب' : s.level === 'warning' ? 'توجه' : s.level === 'critical' ? 'بحرانی' : '—'; }, type: 'text' }], rows: sc },
      { name: 'تقاضا', title: 'تقاضای سه ماه آینده (تن)', columns: [{ header: 'ماه', value: function (d) { return J.label(d.per); }, type: 'text' }, { header: 'سال قبل', value: function (d) { return d.ly; }, type: 'num' }, { header: 'آماری', value: function (d) { return d.stat; }, type: 'num' }, { header: 'اجماعی', value: function (d) { return d.cons; }, type: 'num' }], rows: M.demand, charts: [{ type: 'bar', x: 0, y: [1, 2, 3], title: 'تقاضای سه ماه آینده' }] },
      { name: 'استثناها', title: 'استثناها', columns: [{ header: 'سطح', value: function (a) { return a.level === 'critical' ? 'بحرانی' : 'هشدار'; }, type: 'text' }, { header: 'نوع', value: function (a) { return a.type; }, type: 'text' }, { header: 'شرح', value: function (a) { return a.text; }, type: 'text' }, { header: 'جزئیات', value: function (a) { return a.detail; }, type: 'text' }], rows: M.alerts },
      { name: 'تصمیم‌ها و اقدامات', title: 'تصمیم‌ها و اقدامات', columns: [{ header: 'جلسه', value: function (a) { return J.label(a.cycle); }, type: 'text' }, { header: 'نوع', value: function (a) { return a.kind; }, type: 'text' }, { header: 'عنوان', value: function (a) { return a.title; }, type: 'text' }, { header: 'حوزه', value: function (a) { return a.area; }, type: 'text' }, { header: 'مسئول', value: function (a) { return a.owner; }, type: 'text' }, { header: 'سررسید', value: function (a) { return a.dueDate ? J.isoToJalaliStr(a.dueDate) : ''; }, type: 'text' }, { header: 'وضعیت', value: function (a) { return overdue(a) ? 'سررسید گذشته' : a.status; }, type: 'text' }, { header: 'شرح', value: function (a) { return a.note || ''; }, type: 'text' }], rows: M.all }
    ] });
  }

  /* ======================= حالت ارائه ======================= */
  function present() {
    var M = model(), Mo = window.Motion, motionOk = IBP.motion && IBP.motion.ok();
    var slides = [
      { t: 'جلسه بازنگری مدیریت ' + J.label(M.cycle), s: M.st.companyName + ' · ' + IBP.holding.holdingName(), draw: function (el) {
        el.appendChild(h('div.pr-cover', IBP.flag({ width: 180, height: 122 }), h('h1', 'جلسه بازنگری مدیریت'), h('h2', M.st.companyName + ' · چرخه ' + J.label(M.cycle)),
          h('ol.pr-agenda', ['کارنامه شاخص‌ها', 'تقاضا', 'تأمین و ظرفیت', 'مالی و بودجه', 'سناریو و تصمیم‌ها', 'استثناها و اقدامات'].map(function (x) { return h('li', x); }))));
      } },
      { t: 'کارنامه شاخص‌ها', s: 'در برابر هدف', draw: function (el) { el.appendChild(scorecard(M)); } },
      { t: 'تقاضای سه ماه آینده', s: 'تن · اجماعی، آماری و سال قبل', draw: function (el) { var b = h('div'); el.appendChild(b); demandChart(M, b, 420); } },
      { t: 'تأمین: تقاضا، تولید و موجودی', s: 'سطح خدمت ' + F.pct(M.plan.kpi.fillRate, 1) + ' · ' + F.num(M.plan.kpi.bottlenecks) + ' ماه گلوگاه', draw: function (el) { var b = h('div'); el.appendChild(b); supplyChart(M, b, 420); } },
      { t: 'پل درآمد بودجه تا برنامه', s: F.moneyUnit() + ' · سود ناخالص ' + money(M.fin.kpi.gross), draw: function (el) { var b = h('div'); el.appendChild(b); bridgeChart(M, b, 420); } },
      { t: 'سناریو و تصمیم‌ها', s: M.chosen ? 'سناریوی منتخب: ' + M.chosen.name : 'سناریوی نهایی انتخاب نشده است', draw: function (el) { el.appendChild(actionList(M.current.concat(M.followUp), 'تصمیمی ثبت نشده است')); } },
      { t: 'استثناها', s: F.num(M.alerts.length) + ' مورد', draw: function (el) { el.appendChild(exceptionList(M, 12, false)); } }
    ];
    var idx = 0;
    var ov = h('div.present', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'حالت ارائه' });
    var head = h('div.pr-head'), stage = h('div.pr-stage'), foot = h('div.pr-foot');
    var dots = h('div.pr-dots');
    slides.forEach(function (_, i) { dots.appendChild(h('button.pr-dot', { type: 'button', 'aria-label': 'اسلاید ' + (i + 1), onclick: function () { go(i); } })); });
    var prev = h('button.btn', { type: 'button', html: icon('chevronRight', 16) + '<span>قبلی</span>', onclick: function () { go(idx - 1); } });
    var next = h('button.btn.btn-primary', { type: 'button', html: '<span>بعدی</span>' + icon('chevronLeft', 16), onclick: function () { go(idx + 1); } });
    var close = h('button.icon-btn', { type: 'button', 'aria-label': 'خروج از ارائه', html: icon('x', 18), onclick: exit });
    var full = h('button.icon-btn', { type: 'button', 'aria-label': 'تمام‌صفحه', title: 'تمام‌صفحه', html: icon('focus', 18), onclick: function () { if (document.fullscreenElement) document.exitFullscreen(); else if (ov.requestFullscreen) ov.requestFullscreen(); } });
    foot.appendChild(prev); foot.appendChild(dots); foot.appendChild(next);
    ov.appendChild(head); ov.appendChild(stage); ov.appendChild(foot);
    document.body.appendChild(ov);
    document.body.classList.add('focus-open');
    function draw(dir) {
      var s = slides[idx];
      head.textContent = '';
      head.appendChild(h('div', h('div.pr-title', s.t), h('div.pr-sub', s.s)));
      head.appendChild(h('div.pr-tools', h('span.pr-count', F.num(idx + 1) + ' / ' + F.num(slides.length)), full, close));
      var page = h('div.pr-page');
      stage.textContent = '';
      stage.appendChild(page);
      s.draw(page);
      Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('on', i === idx); });
      prev.disabled = idx === 0; next.disabled = idx === slides.length - 1;
      if (motionOk && Mo) {
        Mo.animate(page, { opacity: [0, 1], transform: ['translateX(' + (dir || 0) * -60 + 'px) scale(0.98)', 'translateX(0px) scale(1)'] }, { duration: 0.5, easing: [0.22, 1, 0.36, 1] });
        var kids = page.querySelectorAll('.score-tile, .alert-item, .pr-agenda li');
        if (kids.length) Mo.animate(kids, { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0px)'] }, { delay: Mo.stagger(0.05, { start: 0.15 }), duration: 0.45 });
      }
    }
    function go(i) { if (i < 0 || i >= slides.length || i === idx) return; var dir = i > idx ? 1 : -1; idx = i; draw(dir); }
    function key(e) {
      if (e.key === 'Escape') exit();
      else if (e.key === 'ArrowLeft' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); go(idx + 1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageUp') { e.preventDefault(); go(idx - 1); }
    }
    function exit() {
      document.removeEventListener('keydown', key);
      if (document.fullscreenElement) document.exitFullscreen();
      ov.remove(); document.body.classList.remove('focus-open'); C.hideTip();
    }
    document.addEventListener('keydown', key);
    draw(0);
    if (motionOk && Mo) Mo.animate(ov, { opacity: [0, 1] }, { duration: 0.35 });
    setTimeout(function () { next.focus(); }, 50);
  }

  function render(root, params) {
    if (!S.count('products')) { root.appendChild(UI.pageHead({ title: 'بازنگری مدیریت' })); root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.'))); return; }
    var tab = TABS.some(function (t) { return t[0] === params[0]; }) ? params[0] : 'pack';
    var M = model();
    var tabs = h('div.tabbar', { role: 'tablist' });
    TABS.forEach(function (t) { tabs.appendChild(h('a.tab' + (t[0] === tab ? '.on' : ''), { href: '#/review/' + t[0], role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', html: icon(t[2], 16) + '<span>' + t[1] + '</span>' })); });
    var open = M.all.filter(function (a) { return a.status !== 'انجام شد' && a.status !== 'لغو'; }).length;
    root.appendChild(UI.pageHead({ title: 'بازنگری مدیریت (MBR)', badge: UI.statusBadge(M.followUp.filter(overdue).length ? 'critical' : 'info', F.num(open) + ' اقدام باز'),
      desc: M.st.companyName + ' · جلسه چرخه ' + J.label(M.cycle) + ' · بسته خودکار از برنامه تقاضا، تأمین و مالی',
      actions: [UI.excelButton('بسته Excel جلسه', function () { return exportPack(M); }), h('button.btn.btn-primary', { type: 'button', html: icon('play', 16) + '<span>حالت ارائه</span>', onclick: present })] }));
    root.appendChild(tabs);
    var host = h('div'); root.appendChild(host);
    (tab === 'actions' ? renderActions : renderPack)(host, M);
  }

  IBP.review = { present: present, model: model };
  IBP.register('review', { title: 'بازنگری مدیریت', render: render });
})(window.IBP = window.IBP || {});
