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

    var saveBtn = h('button.btn.btn-primary', { type: 'button', html: icon('check', 16) + '<span>ذخیره تنظیمات</span>', onclick: save });
    function save() {
      var patch = {
        companyName: company.value.trim() || 'شرکت نمونه', industry: industry.value.trim(), currency: currency.value, displayScale: +scale.value,
        cyclePeriod: cycle.getValue(), fiscalStartMonth: +fiscal.value,
        historyMonths: F.parseNumber(history.value) || 24, horizonMonths: F.parseNumber(horizon.value) || 18, frozenMonths: F.parseNumber(frozen.value) || 0,
        priceInflation: readPct(inflation) || 0, serviceLevelTarget: readPct(service) || 0.95, forecastAccuracyTarget: readPct(accT) || 0.8,
        utilizationWarn: readPct(uWarn) || 0.85, utilizationMax: readPct(uMax) || 1, excessMonths: F.parseNumber(excess.value) || 3
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
          field('حداکثر ظرفیت مجاز', uMax)),
        h('div', { style: { marginTop: '16px' } }, saveBtn)), 'gear'));

    /* ---------------- داده تستی ---------------- */
    var tplSel = h('select');
    IBP.templates.list.forEach(function (t) { tplSel.appendChild(h('option', { value: t.id }, t.name + ' — ' + t.company)); });
    tplSel.value = st.templateId || 'food';
    var seedCycle = IBP.form.periodInput(st.cyclePeriod);
    var tplInfo = h('div.hint');
    function info() {
      var t = IBP.templates.get(tplSel.value);
      var n = t.families.reduce(function (a, f) { return a + f.items.length; }, 0);
      tplInfo.textContent = F.num(t.plants.length) + ' کارخانه، ' + F.num(t.families.length) + ' خانواده، ' + F.num(n) + ' محصول، ' + F.num(t.channels.length) + ' کانال فروش · خانواده‌ها: ' + t.families.map(function (f) { return f.name; }).join('، ');
    }
    tplSel.addEventListener('change', info); info();
    root.appendChild(section('داده تستی', 'یک شرکت تولیدی کامل با ۲۴ ماه فروش، پیش‌بینی ۱۸ ماه، بودجه، موجودی، BOM و ظرفیت خطوط',
      h('div',
        h('div.settings-grid', field('الگوی صنعت', tplSel), field('ماه جاری چرخه', seedCycle)),
        tplInfo,
        h('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          h('button.btn.btn-primary', { type: 'button', html: icon('sparkles', 16) + '<span>ساخت داده تستی</span>', onclick: function () {
            IBP.ui.confirm('همه داده‌های فعلی حذف و داده تستی «' + IBP.templates.get(tplSel.value).name + '» جایگزین می‌شود. ادامه می‌دهید؟', { danger: true, ok: 'ساخت داده' }).then(function (ok) {
              if (!ok) return;
              IBP.seed.load({ templateId: tplSel.value, cyclePeriod: seedCycle.getValue(), fiscalStartMonth: +fiscal.value }).then(function () {
                IBP.ui.toast('داده تستی ساخته شد', 'success');
                IBP.app.navigate('#/dashboard');
                IBP.app.refresh();
              });
            });
          } }))), 'sparkles'));

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
