/*
 * چرخه ماهانه IBP: مراحل، مسئولان، سررسیدها و وضعیت هر مرحله.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store;

  var GUIDE = {
    'جمع‌آوری داده و بستن ماه': 'ثبت فروش واقعی، موجودی پایان ماه و تولید انجام‌شده؛ به‌روزرسانی داده‌های پایه و اجرای پیش‌بینی آماری.',
    'بازنگری پورتفوی محصول': 'بررسی محصولات جدید، محصولات در حال حذف و تغییرات سبد و اثر آن‌ها بر تقاضا و تأمین.',
    'بازنگری تقاضا': 'تحلیل دقت ماه قبل، اعمال نظر فروش و بازاریابی و توافق بر برنامه تقاضای اجماعی بدون محدودیت.',
    'بازنگری تأمین': 'مقایسه تقاضای اجماعی با ظرفیت تولید، مواد و موجودی؛ تهیه برنامه تأمین و گزینه‌های رفع محدودیت.',
    'تطبیق یکپارچه و مالی': 'تبدیل برنامه‌ها به مبالغ مالی، مقایسه با بودجه، حل تعارض‌ها و آماده‌سازی سناریوها برای تصمیم.',
    'جلسه بازنگری مدیریت (MBR)': 'تصمیم‌گیری مدیران ارشد درباره شکاف‌ها و سناریوها و تأیید برنامه نهایی یکپارچه ماه.'
  };
  var STATUSES = ['انجام نشده', 'در حال انجام', 'تکمیل', 'تأخیر'];

  function render(root) {
    var cycle = S.settings().cyclePeriod;
    var steps = S.all('cycleSteps').filter(function (s) { return s.cycle === cycle; }).sort(function (a, b) { return a.order - b.order; });

    root.appendChild(IBP.ui.pageHead({
      title: 'چرخه IBP — ' + J.label(cycle),
      desc: 'فرایند ماهانه برنامه‌ریزی یکپارچه از جمع‌آوری داده تا تصمیم مدیریت. وضعیت، مسئول و سررسید هر مرحله را اینجا به‌روز کنید.',
      actions: steps.length ? [IBP.ui.excelButton('خروجی Excel', function () {
        var cur = S.all('cycleSteps').filter(function (s) { return s.cycle === cycle; }).sort(function (a, b) { return a.order - b.order; });
        return IBP.excel.exportTables({
          filename: 'چرخه IBP ' + J.label(cycle),
          sheets: [{ name: 'مراحل چرخه', title: 'چرخه IBP — ' + J.label(cycle), columns: [
            { header: 'ترتیب', key: 'order', type: 'int' }, { header: 'مرحله', key: 'name', type: 'text' }, { header: 'مسئول', key: 'owner', type: 'text' },
            { header: 'سررسید', value: function (s) { return J.isoToJalaliStr(s.dueDate); }, type: 'text' }, { header: 'وضعیت', key: 'status', type: 'text' },
            { header: 'شرح مرحله', value: function (s) { return GUIDE[s.name] || ''; }, type: 'text', width: 60 }, { header: 'یادداشت', key: 'notes', type: 'text', width: 40 }],
            rows: cur,
            cellStyle: function (r, c) { return c.header === 'وضعیت' ? (r.status === 'تکمیل' ? { color: 'FF067A06', bold: true } : r.status === 'تأخیر' ? { color: 'FFB42323', bold: true } : null) : null; } }]
        });
      })] : []
    }));

    if (!steps.length) {
      root.appendChild(h('div.card', h('div.roadmap-hero',
        h('div.roadmap-icon', { html: icon('cycle', 28) }),
        h('div', h('h2', 'مراحل این چرخه تعریف نشده است'),
          h('p', 'با یک کلیک شش مرحله استاندارد IBP برای ' + J.label(cycle) + ' ساخته می‌شود و می‌توانید آن‌ها را ویرایش کنید.'),
          h('p', h('button.btn.btn-primary', { type: 'button', style: { marginTop: '12px' }, onclick: function () {
            S.bulkUpsert('cycleSteps', IBP.seed.cycleSteps(cycle).map(function (s) { s.status = 'انجام نشده'; return s; }));
            IBP.app.render(true);
          } }, 'ایجاد مراحل استاندارد'))))));
      return;
    }

    var list = h('div.dash-grid');
    steps.forEach(function (s) {
      var status = h('select', { 'aria-label': 'وضعیت' });
      STATUSES.forEach(function (x) { status.appendChild(h('option', { value: x }, x)); });
      status.value = s.status;
      var owner = h('input', { type: 'text', value: s.owner || '', 'aria-label': 'مسئول' });
      var due = IBP.form.dateInput(s.dueDate, { 'aria-label': 'سررسید' });
      var notes = h('textarea', { rows: 2, placeholder: 'یادداشت، تصمیم‌ها یا موانع…', 'aria-label': 'یادداشت' });
      notes.value = s.notes || '';
      function save() {
        var d = due.getValue();
        if (d === '__invalid__') { IBP.ui.toast('تاریخ نامعتبر است', 'warning'); return; }
        S.update('cycleSteps', s.id, { status: status.value, owner: owner.value.trim(), dueDate: d, notes: notes.value });
        IBP.ui.toast('مرحله «' + s.name + '» ذخیره شد', 'success');
        dot.className = 'step-dot ' + cls(status.value);
        dot.innerHTML = status.value === 'تکمیل' ? icon('check', 14) : String(s.order);
      }
      [status, owner, due.input, notes].forEach(function (el) { el.addEventListener('change', save); });
      var dot = h('div.step-dot.' + cls(s.status), { html: s.status === 'تکمیل' ? icon('check', 14) : String(s.order) });
      list.appendChild(h('section.card.span-6',
        h('div.card-head', dot, h('div', h('h3.card-title', s.name), h('div.card-sub', GUIDE[s.name] || ''))),
        h('div.card-body', h('div.form-grid',
          h('div.field', h('label', 'وضعیت'), status),
          h('div.field', h('label', 'سررسید'), due),
          h('div.field.wide', h('label', 'مسئول'), owner),
          h('div.field.wide', h('label', 'یادداشت'), notes)))
      ));
    });
    root.appendChild(list);
  }
  function cls(st) { return st === 'تکمیل' ? 'done' : st === 'در حال انجام' ? 'active' : st === 'تأخیر' ? 'late' : 'todo'; }

  IBP.register('cycle', { title: 'چرخه ماهانه IBP', render: render });
})(window.IBP = window.IBP || {});
