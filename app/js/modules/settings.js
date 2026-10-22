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
        engineUrl: engineUrl.value.trim() || 'http://127.0.0.1:8765'
      };
      var cycleChanged = patch.cyclePeriod !== st.cyclePeriod;
      S.saveSettings(patch);
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
          field('مرز کلاس Y (ضریب تغییرات)', xyzY, 'مثلاً ۰٫۵')),
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
    root.appendChild(section('موتور تحلیل پایتون', 'تحلیل‌های پیشرفته (تجزیه روند و فصل، آزمون روند، خوشه‌بندی) و خروجی Excel همراه با نمودار',
      h('div',
        h('div.settings-grid', field('نشانی موتور', engineUrl, 'پیش‌فرض: http://127.0.0.1:8765'), field('وضعیت اتصال', statusEl)),
        h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '14px' } },
          h('button.btn', { type: 'button', html: icon('refresh', 16) + '<span>آزمایش اتصال</span>', onclick: function () {
            S.saveSettings({ engineUrl: engineUrl.value.trim() || 'http://127.0.0.1:8765' });
            IBP.engine.check().then(function (ok) { drawStatus(); IBP.ui.toast(ok ? 'موتور پایتون متصل است' : 'موتور پایتون پاسخ نمی‌دهد', ok ? 'success' : 'warning'); });
          } })),
        h('div.engine-panel', { style: { marginTop: '14px' } },
          h('div.ep-icon', { html: icon('python', 22) }),
          h('div', { style: { flex: 1, minWidth: '240px' } },
            h('div.ep-t', 'راه‌اندازی موتور روی ویندوز'),
            h('div.ep-d', { html: '۱. پایتون ۳٫۱۰ یا جدیدتر را نصب کنید. ۲. در پوشه <code>engine</code> فایل <code>start_engine.bat</code> را اجرا کنید (بار اول کتابخانه‌ها نصب می‌شوند). ۳. پنجره را باز بگذارید؛ برنامه به‌طور خودکار متصل می‌شود. در نسخه نصبی ویندوز (فاز ۸) این مرحله خودکار است.' })))), 'python'));

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
            IBP.ui.confirm('همه داده‌های فعلی با محتوای فایل «' + f.name + '» جایگزین می‌شود. ادامه می‌دهید؟', { danger: true, ok: 'بازیابی' }).then(function (ok) {
              if (!ok) return;
              try { S.importAll(obj).then(function () { IBP.ui.toast('بازیابی انجام شد', 'success'); IBP.app.refresh(); }); }
              catch (e) { IBP.ui.toast(e.message, 'error'); }
            });
          });
        } }),
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
      h('div', { style: { lineHeight: '2', fontSize: '13px', color: 'var(--text-2)' } },
        h('div', 'محل ذخیره داده: ' + (S.adapterKind() === 'memory' ? 'حافظه موقت مرورگر (با بستن برنامه پاک می‌شود)' : 'پایگاه داده محلی (IndexedDB) روی همین رایانه')),
        h('div', 'معماری: رابط کاربری HTML/JavaScript بدون وابستگی اینترنتی · لایه داده قابل تعویض با سرور · موتور تحلیل پایتون و دستیار هوشمند در فازهای بعد')), 'info'));
    root.appendChild(IBP.roadmap.phaseTable());
  }

  IBP.register('settings', { title: 'تنظیمات', render: render });
})(window.IBP = window.IBP || {});
