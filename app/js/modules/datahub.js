/*
 * مرکز داده: شروع از الگوی آماده، دانلود الگوی Excel، بارگذاری و اعتبارسنجی فایل،
 * ادغام یا جایگزینی داده‌ها و سنجش کیفیت داده.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, SC = IBP.schema, UI = IBP.ui, C = IBP.charts;
  var pending = null; // { file, plan, mode }

  /* ======================= کیفیت داده ======================= */
  function quality() {
    var A = IBP.analytics, ctx = A.ctx(), cycle = ctx.cycle;
    var products = S.all('products').filter(function (p) { return p.active !== false; });
    var routed = new Set(S.all('routings').map(function (r) { return r.productId; }));
    var bommed = new Set(S.all('bom').map(function (b) { return b.productId; }));
    var inv = new Set(S.all('inventory').map(function (r) { return r.productId; }));
    var fcNow = A.forecastMap('اجماعی', cycle);
    var months = A.periodsWithSales().filter(function (p) { return p < cycle; });
    var fy = J.fiscalYear(cycle, ctx.settings.fiscalStartMonth || 1);
    var fyPeriods = new Set(J.fiscalYearPeriods(fy, ctx.settings.fiscalStartMonth || 1));
    var budgeted = new Set(S.all('budgets').filter(function (b) { return fyPeriods.has(b.period); }).map(function (b) { return b.productId; }));
    function miss(set) { return products.filter(function (p) { return !set.has(p.id); }); }
    var checks = [
      { key: 'price', title: 'قیمت و بهای تمام‌شده محصولات', weight: 2, entity: 'products', bad: products.filter(function (p) { return !(p.unitPrice > 0) || !(p.unitCost > 0); }) },
      { key: 'margin', title: 'بهای تمام‌شده کمتر از قیمت فروش', weight: 1, entity: 'products', bad: products.filter(function (p) { return p.unitCost >= p.unitPrice; }) },
      { key: 'routing', title: 'مسیر تولید (خط) برای هر محصول', weight: 2, entity: 'routings', bad: miss(routed) },
      { key: 'bom', title: 'فهرست مواد (BOM) برای هر محصول', weight: 1.5, entity: 'bom', bad: miss(bommed) },
      { key: 'history', title: 'سابقه فروش حداقل ۱۲ ماه', weight: 2, entity: 'salesActuals', bad: months.length >= 12 ? [] : [{ name: F.num(months.length) + ' ماه' }], detail: F.num(months.length) + ' ماه سابقه' },
      { key: 'forecast', title: 'پیش‌بینی اجماعی چرخه ' + J.label(cycle), weight: 2, entity: 'forecasts', bad: products.filter(function (p) { return !fcNow.has(p.id) && p.lifecycle !== 'توقف'; }) },
      { key: 'inventory', title: 'موجودی ثبت‌شده محصولات', weight: 1, entity: 'inventory', bad: miss(inv) },
      { key: 'budget', title: 'بودجه سال مالی ' + fy, weight: 1, entity: 'budgets', bad: miss(budgeted) },
      { key: 'capacity', title: 'ظرفیت خطوط تولید', weight: 1, entity: 'resources', bad: S.all('resources').filter(function (r) { return !(A.resourceCapacity(r) > 0); }) },
      { key: 'supplier', title: 'تأمین‌کننده مواد', weight: 0.5, entity: 'materials', bad: S.all('materials').filter(function (m) { return !m.supplierId; }) },
      { key: 'cycle', title: 'مراحل چرخه IBP جاری', weight: 0.5, entity: 'cycleSteps', bad: S.all('cycleSteps').some(function (s) { return s.cycle === cycle; }) ? [] : [{ name: J.label(cycle) }] }
    ];
    var tw = 0, ok = 0;
    checks.forEach(function (c) {
      var base = c.key === 'capacity' ? S.count('resources') : c.key === 'supplier' ? S.count('materials') : (c.key === 'history' || c.key === 'cycle') ? 1 : products.length;
      c.ratio = base ? Math.max(0, 1 - c.bad.length / base) : 0;
      c.status = c.bad.length === 0 ? 'good' : c.ratio >= 0.8 ? 'warning' : 'critical';
      tw += c.weight; ok += c.weight * c.ratio;
    });
    return { score: tw ? ok / tw : 0, checks: checks };
  }
  IBP.quality = quality;

  function exportQuality() {
    var Q = quality(), rows = [];
    Q.checks.forEach(function (c) {
      if (!c.bad.length) rows.push({ check: c.title, status: 'سالم', item: '', code: '' });
      c.bad.slice(0, 500).forEach(function (b) { rows.push({ check: c.title, status: c.status === 'critical' ? 'بحرانی' : 'هشدار', item: b.name || '', code: b.code || '' }); });
    });
    return IBP.excel.exportTables({
      filename: 'گزارش کیفیت داده',
      summary: { title: 'کیفیت داده — امتیاز ' + F.pct(Q.score, 0), pairs: Q.checks.map(function (c) { return [c.title, F.pct(c.ratio, 0), c.bad.length ? F.num(c.bad.length) + ' مورد نیازمند اصلاح' : 'سالم']; }) },
      sheets: [{ name: 'موارد نیازمند اصلاح', title: 'جزئیات بررسی کیفیت داده', columns: [{ header: 'بررسی', key: 'check', type: 'text' }, { header: 'وضعیت', key: 'status', type: 'text' }, { header: 'کد', key: 'code', type: 'code' }, { header: 'مورد', key: 'item', type: 'text' }], rows: rows,
        cellStyle: function (r, c) { return c.header === 'وضعیت' ? (r.status === 'بحرانی' ? { color: 'FFB42323', bold: true } : r.status === 'سالم' ? { color: 'FF067A06', bold: true } : { color: 'FF8A5A00' }) : null; } }]
    });
  }

  /* ======================= بارگذاری ======================= */
  function handleFile(file, host) {
    if (!file) return;
    if (!/\.(xlsx|csv|txt)$/i.test(file.name)) { UI.toast('فقط فایل Excel (xlsx) یا CSV پذیرفته می‌شود', 'warning'); return; }
    host.textContent = '';
    host.appendChild(h('div.engine-panel', h('div.ep-icon', { html: icon('refresh', 22) }), h('div', h('div.ep-t', 'در حال خواندن و اعتبارسنجی «' + file.name + '»…'), h('div.ep-d', 'همه برگه‌ها و ردیف‌ها به ترتیب وابستگی بررسی می‌شوند'))));
    IBP.excel.readFile(file).then(function (wb) {
      var plan = IBP.dataio.plan(wb.sheets);
      pending = { file: file, plan: plan, mode: 'merge' };
      drawPreview(host);
    }).catch(function (e) {
      host.textContent = '';
      host.appendChild(h('div.engine-panel', h('div.ep-icon', { style: { color: 'var(--critical)' }, html: icon('critical', 22) }), h('div', h('div.ep-t', 'فایل قابل خواندن نیست'), h('div.ep-d', e.message))));
    });
  }

  function drawPreview(host) {
    host.textContent = '';
    var P = pending.plan;
    if (!P.items.length) {
      host.appendChild(h('div.engine-panel', h('div.ep-icon', { html: icon('alert', 22) }),
        h('div', h('div.ep-t', 'هیچ برگه قابل شناسایی در فایل نبود'), h('div.ep-d', 'نام برگه‌ها باید با نام بخش‌ها (مثل «محصولات (SKU)» یا «فروش واقعی») یکسان باشد. فایل الگو را دانلود کنید و از همان استفاده کنید.' + (P.unknownSheets.length ? ' برگه‌های ناشناخته: ' + P.unknownSheets.join('، ') : '')))));
      return;
    }
    var valid = P.items.reduce(function (a, it) { return a + it.records.length; }, 0);
    host.appendChild(h('div', { style: { display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' } },
      h('div', { html: C.ring(P.rowsTotal ? valid / P.rowsTotal : 0, { size: 72, label: F.pct(P.rowsTotal ? valid / P.rowsTotal : 0, 0) }) }),
      h('div', h('div', { style: { fontWeight: 700, fontSize: '15px' } }, pending.file.name),
        h('div.cell-sub', F.num(P.items.length) + ' بخش شناسایی شد · ' + F.num(P.rowsTotal) + ' ردیف · ' + F.num(valid) + ' ردیف معتبر · ' + F.num(P.errorsTotal) + ' خطا'),
        P.unknownSheets.length ? h('div.cell-sub', 'برگه‌های نادیده گرفته‌شده: ' + P.unknownSheets.join('، ')) : null)));
    var tbl = h('table.data-table');
    tbl.appendChild(h('thead', h('tr', ['بخش', 'برگه', 'ردیف', 'جدید', 'به‌روزرسانی', 'خطا', 'وضعیت'].map(function (t, i) { return h('th' + (i >= 2 && i <= 5 ? '.num' : ''), { style: { padding: '10px 12px' } }, t); }))));
    var tb = h('tbody');
    P.items.forEach(function (it) {
      var lvl = it.missing.length ? 'critical' : it.errors.length ? 'warning' : 'good';
      tb.appendChild(h('tr',
        h('td', h('span', { html: icon(SC.entity(it.entity).icon, 15), style: { display: 'inline-block', verticalAlign: '-3px', marginInlineEnd: '6px', color: 'var(--muted)' } }), it.label),
        h('td.muted', it.sheet), h('td.num', F.num(it.rows)), h('td.num', F.num(it.inserts)), h('td.num', F.num(it.updates)), h('td.num', F.num(it.errors.length)),
        h('td', { html: UI.statusBadge(lvl, it.missing.length ? 'ستون الزامی ندارد' : it.errors.length ? 'دارای خطا' : 'آماده') })));
    });
    tbl.appendChild(tb);
    host.appendChild(h('div.card', { style: { boxShadow: 'none' } }, h('div.table-wrap', tbl)));
    if (P.errorsTotal) {
      var errs = [];
      P.items.forEach(function (it) { it.errors.forEach(function (e) { errs.push(it.label + ' · ردیف ' + F.num(e.row) + (e.field ? ' · ' + e.field : '') + ': ' + e.msg); }); });
      host.appendChild(h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer', fontWeight: 500 } }, 'نمایش ' + F.num(Math.min(80, errs.length)) + ' خطای نخست'),
        h('ul', { style: { fontSize: '12.5px', lineHeight: '2', color: 'var(--critical-text)' } }, errs.slice(0, 80).map(function (e) { return h('li', e); }))));
    }
    var seg = h('div.seg', { role: 'group', 'aria-label': 'روش اعمال' });
    [['merge', 'ادغام و به‌روزرسانی'], ['replace', 'جایگزینی کامل بخش‌ها']].forEach(function (m, idx) {
      seg.appendChild(h('button' + (pending.mode === m[0] ? '.on' : ''), { type: 'button', onclick: function () { pending.mode = m[0]; seg.querySelectorAll('button').forEach(function (b, i) { b.classList.toggle('on', i === idx); }); modeNote.textContent = NOTE[m[0]]; } }, m[1]));
    });
    var NOTE = {
      merge: 'رکوردهای جدید افزوده و رکوردهای موجود (بر اساس کد یا کلید طبیعی) به‌روزرسانی می‌شوند. سایر داده‌ها دست نمی‌خورند.',
      replace: 'همه رکوردهای بخش‌های موجود در فایل حذف و با ردیف‌های معتبر فایل جایگزین می‌شوند. بخش‌هایی که در فایل نیستند تغییر نمی‌کنند.'
    };
    var modeNote = h('div.cell-sub', NOTE[pending.mode]);
    host.appendChild(h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '16px' } },
      seg,
      h('button.btn.btn-primary', { type: 'button', disabled: valid ? null : true, html: icon('check', 16) + '<span>اعمال ' + F.num(valid) + ' ردیف معتبر</span>', onclick: function () {
        var go = function () {
          IBP.dataio.apply(pending.plan, pending.mode).then(function (done) {
            UI.toast('داده‌ها اعمال شد: ' + done.map(function (k) { return SC.entity(k).label; }).join('، '), 'success');
            pending = null;
            IBP.app.refresh();
          });
        };
        if (pending.mode === 'replace' || P.errorsTotal) {
          UI.confirm((pending.mode === 'replace' ? 'داده‌های فعلی بخش‌های موجود در فایل جایگزین می‌شوند. ' : '') + (P.errorsTotal ? F.num(P.errorsTotal) + ' ردیف دارای خطا نادیده گرفته می‌شود. ' : '') + 'ادامه می‌دهید؟', { ok: 'اعمال', danger: pending.mode === 'replace' }).then(function (ok) { if (ok) go(); });
        } else go();
      } }),
      P.errorsTotal ? UI.excelButton('گزارش خطا', function () { return IBP.dataio.errorReport(pending.plan); }) : null,
      h('button.btn.btn-ghost', { type: 'button', onclick: function () { pending = null; IBP.app.render(true); } }, 'انصراف')));
    host.appendChild(h('div', { style: { marginTop: '8px' } }, modeNote));
  }

  /* ======================= نمایش ======================= */
  function render(root) {
    var st = S.settings();
    root.appendChild(UI.pageHead({
      title: 'مرکز داده',
      desc: 'از یک الگوی آماده صنعت شروع کنید، داده‌های خود را در فایل Excel الگو تکمیل و بارگذاری کنید و پیش از تحلیل، کیفیت داده‌ها را بسنجید.',
      actions: [
        UI.excelButton('دانلود الگوی خالی', function () { return IBP.dataio.downloadTemplate({ filename: 'الگوی ورود داده IBP' }); }),
        UI.excelButton('خروجی همه داده‌ها', function () { return IBP.dataio.downloadTemplate({ data: 'current', filename: 'همه داده‌های IBP — ' + (st.companyName || '') }); }, { primary: true })
      ]
    }));

    var stepper = h('div.stepper');
    [['انتخاب الگو', 'صنعت نزدیک به کسب‌وکار خود را انتخاب کنید'], ['دانلود فایل Excel', 'الگوی خالی یا نمونه پرشده'], ['تکمیل و بارگذاری', 'اعتبارسنجی خودکار پیش از اعمال'], ['تحلیل و خروجی', 'داشبورد، پورتفوی و گزارش‌های Excel']]
      .forEach(function (s, i) { stepper.appendChild(h('div.card.st', h('div.st-n', F.num(i + 1)), h('div', h('div.st-t', s[0]), h('div.st-d', s[1])))); });
    root.appendChild(stepper);

    var grid = h('div.dash-grid');
    root.appendChild(grid);

    /* الگوهای صنعت */
    var tplCard = UI.card({ title: 'الگوهای آماده شرکت‌های غذایی', sub: 'داده نمونه کامل برای همین شرکت (' + (st.companyCode || '') + '): ۲۴ ماه فروش با اثر رمضان و محرم، پیش‌بینی، بودجه، موجودی، BOM، ظرفیت و جریان‌های درون‌گروهی', icon: 'sparkles', span: 12 });
    var tg = h('div.tpl-grid');
    IBP.templates.list.forEach(function (t) {
      var sty = { icon: t.icon, grad: t.grad };
      var nProd = t.families.reduce(function (a, f) { return a + f.items.length; }, 0);
      tg.appendChild(h('div.card.tpl-card.hoverable' + (st.templateId === t.id && S.count('products') ? '.current' : ''),
        h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('div.tpl-icon', { style: { background: sty.grad }, html: icon(sty.icon, 22) }),
          h('div', h('h4', t.name), h('div.cell-sub', t.company))),
        h('p', 'خانواده‌ها: ' + t.families.map(function (f) { return f.name; }).join('، ')),
        h('div.tpl-meta', { html: UI.statusBadge('neutral', F.num(t.plants.length) + ' کارخانه') + UI.statusBadge('neutral', F.num(nProd) + ' محصول') + UI.statusBadge('neutral', F.num(t.channels.length) + ' کانال') + (st.templateId === t.id && S.count('products') ? UI.statusBadge('info', 'فعال') : '') }),
        h('div.tpl-actions',
          h('button.btn.btn-sm.btn-primary', { type: 'button', html: icon('play', 14) + '<span>بارگذاری</span>', onclick: function () {
            UI.confirm('همه داده‌های فعلی شرکت «' + st.companyName + '» حذف و داده نمونه «' + t.name + '» جایگزین می‌شود. داده شرکت‌های دیگر هلدینگ تغییری نمی‌کند. ادامه می‌دهید؟', { danger: true, ok: 'بارگذاری' }).then(function (ok) {
              if (!ok) return;
              IBP.seed.load({ templateId: t.id, cyclePeriod: st.cyclePeriod || J.currentPeriod(), fiscalStartMonth: st.fiscalStartMonth }).then(function () { UI.toast('داده نمونه «' + t.name + '» بارگذاری شد', 'success'); IBP.app.refresh(); });
            });
          } }),
          UI.excelButton('دانلود Excel نمونه', function () {
            var gen = IBP.seed.generate({ templateId: t.id, cyclePeriod: st.cyclePeriod || J.currentPeriod(), fiscalStartMonth: st.fiscalStartMonth });
            return IBP.dataio.downloadTemplate({ data: gen.data, filename: 'نمونه داده ' + t.name, title: 'داده نمونه ' + t.company + ' — برای ویرایش و بارگذاری مجدد' });
          }, { small: true }))));
    });
    tg.appendChild(h('div.card.tpl-card.hoverable',
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, h('div.tpl-icon', { style: { background: 'linear-gradient(135deg,#0ea5e9,#22d3ee)' }, html: icon('database', 22) }),
        h('div', h('h4', 'شروع با داده‌های خودم'), h('div.cell-sub', 'هر صنعت تولیدی'))),
      h('p', 'الگوی خالی را دانلود کنید، برگه‌ها را به ترتیب راهنما تکمیل کنید و فایل را در بخش پایین بارگذاری کنید.'),
      h('div.tpl-actions',
        UI.excelButton('الگوی خالی', function () { return IBP.dataio.downloadTemplate({ filename: 'الگوی ورود داده IBP' }); }, { small: true }),
        h('button.btn.btn-sm.btn-danger-ghost', { type: 'button', html: icon('trash', 14) + '<span>پاک کردن داده‌ها</span>', onclick: function () {
          UI.confirm('همه داده‌ها برای همیشه حذف می‌شوند. پیش از این کار از داده‌ها خروجی بگیرید.', { danger: true, ok: 'حذف همه', title: 'حذف همه داده‌ها' }).then(function (ok) {
            if (!ok) return;
            S.clearAll(); S.setMeta('seeded', { at: new Date().toISOString(), cleared: true });
            UI.toast('همه داده‌ها حذف شد', 'success'); IBP.app.refresh();
          });
        } }))));
    tplCard.body.appendChild(tg);
    grid.appendChild(tplCard.el);

    /* بارگذاری */
    var upCard = UI.card({ title: 'بارگذاری فایل داده', sub: 'فایل Excel الگو (همه برگه‌ها یا بخشی از آن‌ها) یا فایل CSV یک بخش', icon: 'upload', span: 7 });
    var previewHost = h('div', { style: { marginTop: '14px' } });
    var input = h('input', { type: 'file', accept: '.xlsx,.csv,.txt', style: { display: 'none' } });
    var dz = h('div.dropzone', { tabindex: 0, role: 'button', 'aria-label': 'انتخاب فایل' },
      h('div.dz-icon', { html: icon('cloud', 28) }),
      h('div.dz-title', 'فایل را اینجا رها کنید یا برای انتخاب کلیک کنید'),
      h('div.dz-sub', 'Excel (xlsx) با برگه‌های الگو · CSV · پیش از اعمال، همه ردیف‌ها بررسی می‌شوند'), input);
    dz.addEventListener('click', function () { input.click(); });
    dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', function () { handleFile(input.files[0], previewHost); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; handleFile(f, previewHost); });
    upCard.body.appendChild(dz);
    upCard.body.appendChild(previewHost);
    if (pending) drawPreview(previewHost);
    var last = S.meta('lastImport');
    if (last && !pending) previewHost.appendChild(h('div.cell-sub', 'آخرین ورود داده: ' + J.isoToJalaliStr(last.at.slice(0, 10)) + ' · ' + last.entities.map(function (k) { return SC.entity(k) ? SC.entity(k).label : k; }).join('، ')));
    grid.appendChild(upCard.el);

    /* کیفیت داده */
    var Q = quality();
    var qCard = UI.card({ title: 'کیفیت داده', sub: 'آمادگی داده‌ها برای برنامه‌ریزی', icon: 'good', span: 5, exportFn: exportQuality, exportLabel: 'گزارش Excel کیفیت داده' });
    var cl = h('ul.check-list');
    Q.checks.forEach(function (c) {
      var li = h('li', { html: UI.statusBadge(c.status, c.status === 'good' ? 'سالم' : F.num(c.bad.length)) },
        h('span', c.title),
        h('span.cl-detail', c.detail || (c.bad.length ? F.pct(c.ratio, 0) + ' کامل' : '')));
      if (c.bad.length) li.appendChild(h('a.btn.btn-sm.btn-ghost', { href: '#/masterdata/' + c.entity }, 'اصلاح'));
      cl.appendChild(li);
    });
    var issues = Q.checks.filter(function (c) { return c.bad.length; }).length;
    qCard.body.appendChild(h('div.quality',
      h('div.quality-top', { html: C.ring(Q.score, { size: 92, stroke: 10, fontSize: 21 }) },
        h('div', h('div', { style: { fontWeight: 700, fontSize: '15px' } }, Q.score >= 0.95 ? 'داده‌ها آماده برنامه‌ریزی است' : Q.score >= 0.75 ? 'داده‌ها قابل استفاده؛ چند مورد نیاز به تکمیل دارد' : 'داده‌ها ناقص است'),
          h('div.cell-sub', F.num(Q.checks.length) + ' بررسی · ' + (issues ? F.num(issues) + ' مورد نیازمند اصلاح' : 'همه موارد سالم')))),
      cl));
    grid.appendChild(qCard.el);

    /* فهرست بخش‌ها */
    var invCard = UI.card({ title: 'بخش‌های داده', sub: 'تعداد رکورد و خروجی Excel هر بخش (قابل ویرایش و بارگذاری مجدد)', icon: 'database', span: 12, flush: true });
    var rows = SC.order().map(function (k) { return { key: k, def: SC.entity(k) }; });
    IBP.grid(invCard.body, {
      rows: function () { return rows; }, pageSize: 25,
      columns: [
        { key: 'label', label: 'بخش', value: function (r) { return r.def.label; }, render: function (r) { return '<span style="display:inline-flex;gap:8px;align-items:center">' + icon(r.def.icon, 16) + F.escape(r.def.label) + '</span>'; } },
        { key: 'group', label: 'گروه', value: function (r) { return (SC.GROUPS.filter(function (g) { return g.id === r.def.group; })[0] || {}).label; } },
        { key: 'count', label: 'تعداد رکورد', align: 'num', value: function (r) { return S.count(r.key); }, render: function (r) { return F.num(S.count(r.key)); } },
        { key: 'fields', label: 'ستون‌ها', align: 'num', value: function (r) { return r.def.fields.length; } },
        { key: 'req', label: 'ستون‌های الزامی', value: function (r) { return r.def.fields.filter(function (f) { return f.required; }).map(function (f) { return f.label; }).join('، '); }, render: function (r) { return '<span class="cell-sub">' + F.escape(r.def.fields.filter(function (f) { return f.required; }).map(function (f) { return f.label; }).join('، ')) + '</span>'; } }
      ],
      actions: [
        { icon: 'excel', label: 'خروجی Excel', onClick: function (r) { IBP.dataio.exportEntities([r.key]); } },
        { icon: 'edit', label: 'مشاهده و ویرایش', onClick: function (r) { IBP.app.navigate('#/masterdata/' + r.key); } }
      ],
      onRowClick: function (r) { IBP.app.navigate('#/masterdata/' + r.key); }
    });
    grid.appendChild(invCard.el);
  }

  IBP.register('datahub', { title: 'مرکز داده', render: render });
})(window.IBP = window.IBP || {});
