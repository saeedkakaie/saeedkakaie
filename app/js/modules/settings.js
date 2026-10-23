/*
 * تنظیمات: مشخصات شرکت، پارامترهای برنامه‌ریزی، داده تستی و پشتیبان‌گیری.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store;

  function field(label, control, hint) {
    return h('div.field', h('label', label), control, hint ? h('div.hint', hint) : null);
  }
  function numInput(v) { return h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', value: v === null || v === undefined ? '' : String(v) }); }
  function pctInput(v) { return h('div.input-suffix', h('input', { type: 'text', inputmode: 'decimal', dir: 'ltr', value: v === null || v === undefined ? '' : String(Math.round(v * 10000) / 100) }), h('span', '٪')); }
  function readPct(el) { var n = F.parseNumber(el.querySelector('input').value); return n === null ? null : n / 100; }
  function section(title, sub, body, iconName) {
    return h('section.card', { style: { marginBottom: '16px' } },
      h('div.card-head', h('div.roadmap-icon', { style: { width: '36px', height: '36px', borderRadius: '10px' }, html: icon(iconName, 18) }), h('div', h('h3.card-title', title), sub ? h('div.card-sub', sub) : null)),
      h('div.card-body', body));
  }

  function render(root) {
    var st = S.settings();

    /* ---------------- مشخصات شرکت ---------------- */
    var company = h('input', { type: 'text', value: st.companyName || '' });
    var industry = h('input', { type: 'text', value: st.industry || '' });
    var currency = h('select');
    ['ریال', 'تومان', 'دلار', 'یورو', 'درهم'].forEach(function (c) { currency.appendChild(h('option', { value: c }, c)); });
    currency.value = st.currency || 'ریال';
    var scale = h('select');
    [[1, 'واحد کامل'], [1e3, 'هزار'], [1e6, 'میلیون'], [1e9, 'میلیارد']].forEach(function (s) { scale.appendChild(h('option', { value: s[0] }, s[1])); });
    scale.value = String(st.displayScale || 1e9);

    /* ---------------- پارامترهای برنامه‌ریزی ---------------- */
    var cycle = IBP.form.periodInput(st.cyclePeriod);
    var fiscal = h('select');
    J.MONTHS.forEach(function (m, i) { fiscal.appendChild(h('option', { value: i + 1 }, m)); });
    fiscal.value = st.fiscalStartMonth || 1;
    var history = numInput(st.historyMonths), horizon = numInput(st.horizonMonths), frozen = numInput(st.frozenMonths);
    var inflation = pctInput(st.priceInflation !== undefined ? st.priceInflation : 0.025);
    var service = pctInput(st.serviceLevelTarget), accT = pctInput(st.forecastAccuracyTarget);
    var uWarn = pctInput(st.utilizationWarn), uMax = pctInput(st.utilizationMax), excess = numInput(st.excessMonths);
    var abcA = pctInput(st.abcA || 0.8), abcB = pctInput(st.abcB || 0.95), xyzX = numInput(st.xyzX || 0.2), xyzY = numInput(st.xyzY || 0.5);
    var ssMethod = h('select', h('option', { value: 'statistical' }, 'آماری (سطح خدمت × خطای پیش‌بینی)'), h('option', { value: 'days' }, 'روز ثابت هر محصول'));
    ssMethod.value = st.ssMethod || 'statistical';
    var overtime = pctInput(st.overtimePct !== undefined ? st.overtimePct : 0.1), prebuild = numInput(st.prebuildMonths !== undefined ? st.prebuildMonths : 3), prodLead = numInput(st.productionLeadDays || 7);
    var costInfl = pctInput(st.costInflation !== undefined ? st.costInflation : 0.02), holdR = pctInput(st.holdingRate !== undefined ? st.holdingRate : 0.015), otPrem = pctInput(st.overtimePremium !== undefined ? st.overtimePremium : 0.5), dpo = numInput(st.dpoDays !== undefined ? st.dpoDays : 45);
    var fcOrigins = numInput(st.fcOrigins || 12), fcLead = numInput(st.fcLead || 3);
    var fcMetric = h('select');
    Object.keys(IBP.forecast.METRICS).forEach(function (k) { fcMetric.appendChild(h('option', { value: k }, IBP.forecast.METRICS[k])); });
    fcMetric.value = st.fcMetric || 'wmape';
    var engineUrl = h('input', { type: 'url', dir: 'ltr', value: st.engineUrl || 'http://127.0.0.1:8765' });

    var saveBtn = h('button.btn.btn-primary', { type: 'button', html: icon('check', 16) + '<span>ذخیره تنظیمات</span>', onclick: save });
    function save() {
      var patch = {
        companyName: company.value.trim() || 'شرکت نمونه', industry: industry.value.trim(), currency: currency.value, displayScale: +scale.value,
        cyclePeriod: cycle.getValue(), fiscalStartMonth: +fiscal.value,
        historyMonths: F.parseNumber(history.value) || 24, horizonMonths: F.parseNumber(horizon.value) || 18, frozenMonths: F.parseNumber(frozen.value) || 0,
        priceInflation: readPct(inflation) || 0, serviceLevelTarget: readPct(service) || 0.95, forecastAccuracyTarget: readPct(accT) || 0.8,
        utilizationWarn: readPct(uWarn) || 0.85, utilizationMax: readPct(uMax) || 1, excessMonths: F.parseNumber(excess.value) || 3,
        abcA: readPct(abcA) || 0.8, abcB: readPct(abcB) || 0.95, xyzX: F.parseNumber(xyzX.value) || 0.2, xyzY: F.parseNumber(xyzY.value) || 0.5,
        engineUrl: engineUrl.value.trim() || 'http://127.0.0.1:8765',
        ssMethod: ssMethod.value, overtimePct: readPct(overtime) || 0, prebuildMonths: Math.max(0, F.parseNumber(prebuild.value) || 0), productionLeadDays: F.parseNumber(prodLead.value) || 7,
        costInflation: readPct(costInfl) || 0, holdingRate: readPct(holdR) || 0, overtimePremium: readPct(otPrem) || 0, dpoDays: F.parseNumber(dpo.value) || 0,
        fcOrigins: Math.max(3, Math.min(24, F.parseNumber(fcOrigins.value) || 12)), fcLead: Math.max(1, Math.min(12, F.parseNumber(fcLead.value) || 3)), fcMetric: fcMetric.value
      };
      if (IBP.supply) IBP.supply.clearOptimized();
      var cycleChanged = patch.cyclePeriod !== st.cyclePeriod;
      S.saveSettings(patch);
      var co = IBP.holding.current();
      if (co && co.name !== patch.companyName) IBP.holding.update(co.id, { name: patch.companyName });
      IBP.ui.toast('تنظیمات ذخیره شد', 'success');
      if (cycleChanged) IBP.ui.toast('چرخه برنامه‌ریزی تغییر کرد. برای داشتن پیش‌بینی این چرخه، داده تستی را دوباره بسازید یا پیش‌بینی وارد کنید.', 'info');
      IBP.app.refresh();
    }

    root.appendChild(section('مشخصات شرکت', 'نام و واحد پول نمایش داده‌شده در گزارش‌ها',
      h('div.settings-grid',
        field('نام شرکت', company), field('صنعت', industry),
        field('واحد پول', currency), field('مقیاس نمایش مبالغ', scale, 'مثلاً «میلیارد ریال» در داشبورد')), 'factory'));

    root.appendChild(section('پارامترهای برنامه‌ریزی', 'افق، دوره و آستانه‌های هشدار',
      h('div',
        h('div.settings-grid',
          field('ماه جاری چرخه برنامه‌ریزی', cycle, 'ماهی که برنامه‌ریزی برای آن انجام می‌شود'),
          field('ماه شروع سال مالی', fiscal),
          field('تاریخچه مورد استفاده (ماه)', history),
          field('افق برنامه‌ریزی (ماه)', horizon),
          field('افق منجمد (ماه)', frozen, 'ماه‌هایی که برنامه آن‌ها دیگر تغییر نمی‌کند'),
          field('افزایش ماهانه قیمت فروش', inflation, 'برای تبدیل پیش‌بینی تعدادی به مبلغ'),
          field('هدف سطح خدمت', service),
          field('هدف دقت پیش‌بینی', accT),
          field('موجودی مازاد بیش از (ماه پوشش)', excess),
          field('آستانه هشدار ظرفیت', uWarn),
          field('حداکثر ظرفیت مجاز', uMax),
          field('مرز کلاس A (سهم تجمعی فروش)', abcA),
          field('مرز کلاس B (سهم تجمعی فروش)', abcB),
          field('مرز کلاس X (ضریب تغییرات)', xyzX, 'مثلاً ۰٫۲'),
          field('مرز کلاس Y (ضریب تغییرات)', xyzY, 'مثلاً ۰٫۵'),
          field('مبدأهای بک‌تست پیش‌بینی (ماه)', fcOrigins, 'تعداد ماه‌های اخیر که هر روش از آن‌ها آزموده می‌شود'),
          field('افق ارزیابی بک‌تست (ماه)', fcLead),
          field('معیار انتخاب روش پیش‌بینی', fcMetric),
          field('روش ذخیره اطمینان', ssMethod),
          field('سقف اضافه‌کاری', overtime, 'نسبت به ظرفیت عادی هر خط'),
          field('حداکثر پیش‌ساخت (ماه)', prebuild, 'تولید زودتر از ماه تقاضا با رعایت ماندگاری'),
          field('زمان تولید و آزادسازی (روز)', prodLead, 'برای محاسبه ذخیره اطمینان'),
          field('تورم ماهانه هزینه‌ها', costInfl, 'بهای مواد و تبدیل در سود و زیان برنامه'),
          field('هزینه نگهداری ماهانه موجودی', holdR, 'نسبت به ارزش موجودی'),
          field('صرف اضافه‌کاری', otPrem, 'نسبت به هزینه ساعت عادی'),
          field('دوره پرداخت به تأمین‌کنندگان (روز)', dpo)),
        h('div', { style: { marginTop: '16px' } }, saveBtn)), 'gear'));

    /* ---------------- موتور تحلیل پایتون ---------------- */
    var statusEl = h('div');
    function drawStatus() {
      var e = IBP.engine.state();
      statusEl.innerHTML = e.status === 'online'
        ? IBP.ui.statusBadge('good', 'متصل') + ' <span class="cell-sub">نسخه ' + F.escape((e.info && e.info.version) || '') + ' · پایتون ' + F.escape((e.info && e.info.python) || '') + ' · ' + F.escape(Object.keys((e.info && e.info.libraries) || {}).map(function (k) { return k + ' ' + e.info.libraries[k]; }).join('، ')) + '</span>'
        : IBP.ui.statusBadge('neutral', e.status === 'unknown' ? 'در حال بررسی' : 'متصل نیست');
    }
    drawStatus();
    root.appendChild(section('موتور تحلیل پایتون', '',
      h('div',
        h('div.settings-grid', field('نشانی موتور', engineUrl, 'پیش‌فرض: http://127.0.0.1:8765'), field('وضعیت اتصال', statusEl)),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } },
          h('button.btn', { type: 'button', html: icon('refresh', 16) + '<span>آزمایش اتصال</span>', onclick: function () {
            S.saveSettings({ engineUrl: engineUrl.value.trim() || 'http://127.0.0.1:8765' });
            IBP.engine.check().then(function (ok) { drawStatus(); IBP.ui.toast(ok ? 'موتور پایتون متصل است' : 'موتور پایتون پاسخ نمی‌دهد', ok ? 'success' : 'warning'); });
          } })),
        window.ibpDesktop || IBP.server.active() ? null : h('div.engine-panel', { style: { marginTop: '14px' } },
          h('div.ep-icon', { html: icon('python', 22) }),
          h('div', { style: { flex: 1, minWidth: '240px' } },
            h('div.ep-d', { html: 'اجرا: <code>engine/start_engine.bat</code>' })))), 'python'));

    /* ---------------- نسخه رومیزی ویندوز (فقط داخل برنامه نصبی) ---------------- */
    if (window.ibpDesktop) root.appendChild(desktopSection());

    /* ---------------- پشتیبان‌گیری ---------------- */
    var counts = IBP.schema.keys().map(function (k) { return S.count(k); }).reduce(function (a, b) { return a + b; }, 0);
    root.appendChild(section('پشتیبان‌گیری و بازیابی', F.num(counts) + ' رکورد در ' + (S.adapterKind() === 'memory' ? 'حافظه موقت' : 'پایگاه داده محلی'),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button.btn', { type: 'button', html: icon('download', 16) + '<span>دریافت فایل پشتیبان</span>', onclick: function () {
          var t = J.today();
          IBP.ui.download('IBP-backup-' + t.jy + '-' + String(t.jm).padStart(2, '0') + '-' + String(t.jd).padStart(2, '0') + '.json', JSON.stringify(S.exportAll()), 'application/json');
        } }),
        h('button.btn', { type: 'button', html: icon('upload', 16) + '<span>بازیابی از فایل پشتیبان</span>', onclick: function () {
          IBP.ui.pickFile('.json').then(function (f) {
            if (!f) return;
            var obj;
            try { obj = JSON.parse(f.text); } catch (e) { IBP.ui.toast('فایل پشتیبان قابل خواندن نیست', 'error'); return; }
            if (obj && obj.kind === 'holding') { IBP.ui.toast('این فایل پشتیبان کامل هلدینگ است؛ از دکمه «بازیابی پشتیبان هلدینگ» استفاده کنید.', 'warning'); return; }
            IBP.ui.confirm('همه داده‌های فعلی با محتوای فایل «' + f.name + '» جایگزین می‌شود. ادامه می‌دهید؟', { danger: true, ok: 'بازیابی' }).then(function (ok) {
              if (!ok) return;
              try { S.importAll(obj).then(function () { IBP.ui.toast('بازیابی انجام شد', 'success'); IBP.app.refresh(); }); }
              catch (e) { IBP.ui.toast(e.message, 'error'); }
            });
          });
        } }),
        h('button.btn', { type: 'button', title: 'همه شرکت‌های هلدینگ در یک فایل؛ برای انتقال به نسخه رومیزی یا رایانه دیگر', html: icon('layers', 16) + '<span>پشتیبان کامل هلدینگ</span>', onclick: function () { IBP.holdingBackup.backup(); } }),
        h('button.btn', { type: 'button', html: icon('upload', 16) + '<span>بازیابی پشتیبان هلدینگ</span>', onclick: function () { IBP.holdingBackup.restore().then(function (n) { if (n) IBP.app.refresh(); }); } }),
        h('button.btn.btn-danger-ghost', { type: 'button', html: icon('trash', 16) + '<span>حذف همه داده‌ها</span>', onclick: function () {
          IBP.ui.confirm('همه داده‌ها برای همیشه حذف می‌شوند. پیش از این کار از داده‌ها پشتیبان بگیرید.', { danger: true, ok: 'حذف همه', title: 'حذف همه داده‌ها' }).then(function (ok) {
            if (!ok) return;
            S.clearAll(); S.setMeta('seeded', { at: new Date().toISOString(), cleared: true });
            IBP.ui.toast('همه داده‌ها حذف شد', 'success');
            IBP.app.refresh();
          });
        } })), 'database'));

    /* ---------------- درباره ---------------- */
    root.appendChild(section('درباره نرم‌افزار', 'Integrated Business Planning · نسخه ' + IBP.APP.version,
      h('div', { style: { fontSize: '13px', color: 'var(--text-2)' } }, 'محل ذخیره داده: ' + (IBP.server.active() ? 'سرور مرکزی ' + IBP.server.base() : S.adapterKind() === 'memory' ? 'حافظه موقت' : 'همین رایانه')), 'info'));
  }

  /** بخش نسخه رومیزی: موتور همراه، کلید Claude (ذخیره رمزنگاری‌شده در پوسته)، به‌روزرسانی و پوشه داده‌ها */
  function desktopSection() {
    var D = window.ibpDesktop, body = h('div', h('div.muted', 'در حال خواندن وضعیت…'));
    var sec = section('نسخه رومیزی ویندوز', 'موتور تحلیل همراه، کلید Claude، به‌روزرسانی و پوشه داده‌ها', body, 'cpu');
    var ENG = { online: ['good', 'فعال'], starting: ['warning', 'در حال اجرا'], stopping: ['neutral', 'در حال توقف'], stopped: ['neutral', 'متوقف'], error: ['critical', 'خطا'] };
    function draw(info) {
      body.textContent = '';
      var e = info.engine || {}, eb = ENG[e.status] || ['neutral', e.status || '—'];
      var keyIn = h('input', { type: 'password', dir: 'ltr', autocomplete: 'off', placeholder: info.claudeConfigured ? '•••••••• (تنظیم شده؛ برای تغییر کلید جدید وارد کنید)' : 'sk-ant-…' });
      var urlIn = h('input', { type: 'url', dir: 'ltr', value: info.updateUrl || '', placeholder: 'http://server/ibp-updates' });
      var auto = h('input', { type: 'checkbox' }); auto.checked = info.autoCheckUpdates !== false;
      var act = function (fn, ok) { return function () { var b = this; b.disabled = true; Promise.resolve().then(fn).then(function (r) { if (ok) IBP.ui.toast(ok, 'success'); return D.info().then(draw); }, function (err) { IBP.ui.toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error'); }).then(function () { b.disabled = false; }); }; };
      body.appendChild(h('div.settings-grid',
        field('نسخه برنامه', h('div', { html: '<b>' + F.escape(info.version) + '</b> <span class="cell-sub">Electron ' + F.escape(info.electron) + '</span>' })),
        field('موتور تحلیل همراه', h('div', { html: IBP.ui.statusBadge(eb[0], eb[1]) + (e.external ? ' <span class="cell-sub">موتور جداگانه روی همین رایانه</span>' : '') + (e.error ? '<div class="hint">' + F.escape(e.error) + '</div>' : '') })),
        field('پوشه داده‌ها', h('div', { dir: 'ltr', style: { fontSize: '12px', wordBreak: 'break-all' } }, info.dataDir))));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' } },
        h('button.btn', { type: 'button', html: icon('refresh', 16) + '<span>اجرای دوباره موتور</span>', onclick: act(function () { return D.restartEngine().then(function () { return IBP.engine.check(); }); }, 'موتور دوباره اجرا شد') }),
        h('button.btn', { type: 'button', html: icon('report', 16) + '<span>گزارش موتور</span>', onclick: function () { D.openEngineLog(); } }),
        h('button.btn', { type: 'button', html: icon('database', 16) + '<span>باز کردن پوشه داده‌ها</span>', onclick: function () { D.openDataFolder(); } })));
      body.appendChild(h('h4', { style: { margin: '18px 0 6px' } }, 'کلید Claude برای دستیار هوشمند'));
      body.appendChild(h('div.hint', info.claudeConfigured ? 'تنظیم شده' : 'تنظیم نشده'));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
        h('div', { style: { flex: '1', minWidth: '260px' } }, keyIn),
        h('button.btn.btn-primary', { type: 'button', html: icon('check', 16) + '<span>ذخیره کلید</span>', onclick: act(function () { if (!keyIn.value.trim()) throw new Error('کلید را وارد کنید'); var k = keyIn.value; keyIn.value = ''; return D.setClaudeKey(k).then(function () { return IBP.engine.check(); }); }, 'کلید ذخیره شد و موتور دوباره اجرا شد') }),
        info.claudeConfigured ? h('button.btn.btn-danger-ghost', { type: 'button', html: icon('trash', 16) + '<span>حذف کلید</span>', onclick: act(function () { return D.setClaudeKey('').then(function () { return IBP.engine.check(); }); }, 'کلید حذف شد') }) : null));
      body.appendChild(h('h4', { style: { margin: '18px 0 6px' } }, 'به‌روزرسانی'));
      body.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' } },
        h('div', { style: { flex: '1', minWidth: '260px' } }, urlIn),
        h('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '13px' } }, auto, 'بررسی خودکار هنگام اجرا'),
        h('button.btn', { type: 'button', html: icon('check', 16) + '<span>ذخیره</span>', onclick: act(function () { return D.setUpdateConfig({ updateUrl: urlIn.value, autoCheckUpdates: auto.checked }); }, 'تنظیمات به‌روزرسانی ذخیره شد') }),
        h('button.btn', { type: 'button', html: icon('refresh', 16) + '<span>بررسی اکنون</span>', onclick: act(function () { return D.setUpdateConfig({ updateUrl: urlIn.value, autoCheckUpdates: auto.checked }).then(function () { return D.checkUpdates(); }); }) })));
    }
    D.info().then(draw, function (e) { body.textContent = 'خطا: ' + e.message; });
    return sec;
  }

  IBP.register('settings', { title: 'تنظیمات', render: render });
})(window.IBP = window.IBP || {});
