/*
 * داده‌های پایه: مدیریت همه موجودیت‌ها (افزودن، ویرایش، حذف، ورود و خروج CSV)
 * به‌صورت خودکار از روی تعریف موجودیت‌ها در schema.js ساخته می‌شود.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, J = IBP.jalali, F = IBP.fmt, S = IBP.store, SC = IBP.schema;

  function cellRender(f) {
    switch (f.type) {
      case 'ref': return function (r) { return F.escape(r[f.key] ? S.name(f.ref, r[f.key]) : '—'); };
      case 'money': return function (r) { return r[f.key] === null || r[f.key] === undefined ? '—' : F.num(r[f.key]); };
      case 'number': return function (r) { return r[f.key] === null || r[f.key] === undefined ? '—' : F.num(r[f.key], f.digits ? 2 : (Number.isInteger(r[f.key]) ? 0 : 2)); };
      case 'percent': return function (r) { return F.pct(r[f.key]); };
      case 'bool': return function (r) { return r[f.key] ? IBP.ui.statusBadge('good', 'بله') : IBP.ui.statusBadge('neutral', 'خیر'); };
      case 'color': return function (r) { return '<span class="swatch" style="background:' + F.escape(r[f.key] || '#999') + '"></span><span class="code">' + F.escape(r[f.key] || '') + '</span>'; };
      case 'date': return function (r) { return F.escape(J.isoToJalaliStr(r[f.key]) || '—'); };
      case 'period': return function (r) { return r[f.key] ? F.escape(J.label(r[f.key])) : '—'; };
      case 'text': if (f.key === 'code') return function (r) { return '<span class="code">' + F.escape(r.code) + '</span>'; };
      // falls through
      default: return function (r) { var v = r[f.key]; return v === null || v === undefined || v === '' ? '—' : F.escape(v); };
    }
  }
  function sortValue(f) {
    if (f.type === 'ref') return function (r) { return r[f.key] ? S.name(f.ref, r[f.key]) : ''; };
    return function (r) { return r[f.key]; };
  }
  function textValue(f) {
    if (f.type === 'ref') return function (r) { return r[f.key] ? S.name(f.ref, r[f.key]) : ''; };
    if (f.type === 'date') return function (r) { return J.isoToJalaliStr(r[f.key]); };
    if (f.type === 'period') return function (r) { return r[f.key] ? J.label(r[f.key]) : ''; };
    return function (r) { var v = r[f.key]; return v === null || v === undefined ? '' : String(v); };
  }

  /** بررسی وابستگی قبل از حذف */
  function usage(entityKey, ids) {
    var set = new Set(ids), out = [];
    SC.referrers(entityKey).forEach(function (ref) {
      var n = S.all(ref.entity).filter(function (r) { return set.has(r[ref.field]); }).length;
      if (n) out.push(SC.entity(ref.entity).label + ' (' + F.num(n) + ')');
    });
    return out;
  }

  function removeRecords(entityKey, ids) {
    var def = SC.entity(entityKey);
    var used = usage(entityKey, ids);
    if (used.length) {
      IBP.ui.modal({
        title: 'حذف امکان‌پذیر نیست', size: 'sm',
        body: '<p class="confirm-text">' + F.escape(def.single) + ' انتخاب‌شده در این بخش‌ها استفاده شده است:</p><p class="confirm-text"><b>' + F.escape(used.join('، ')) + '</b></p><p class="confirm-text muted">ابتدا رکوردهای وابسته را حذف یا اصلاح کنید.</p>',
        actions: [{ label: 'متوجه شدم', primary: true }]
      });
      return Promise.resolve(false);
    }
    return IBP.ui.confirm(ids.length > 1 ? F.num(ids.length) + ' رکورد حذف شود؟' : 'این ' + def.single + ' حذف شود؟', { danger: true, ok: 'حذف', title: 'حذف' }).then(function (ok) {
      if (!ok) return false;
      S.remove(entityKey, ids);
      IBP.ui.toast('حذف شد', 'success');
      return true;
    });
  }

  function importDialog(entityKey, done) {
    var def = SC.entity(entityKey);
    var body = h('div',
      h('p.confirm-text', 'فایل Excel (xlsx) یا CSV را انتخاب کنید. ردیف اول باید عنوان ستون‌ها باشد؛ ساده‌ترین راه، دریافت فایل الگو و تکمیل آن است.'),
      h('ul.muted', { style: { lineHeight: '2', paddingInlineStart: '18px', fontSize: '12.5px' } },
        h('li', 'ستون‌های الزامی: ' + def.fields.filter(function (f) { return f.required; }).map(function (f) { return f.label; }).join('، ')),
        h('li', 'ارجاع‌ها (مثل خانواده یا کارخانه) با «کد» یا «نام» شناسایی می‌شوند.'),
        def.naturalKey ? h('li', 'رکوردهای موجود (بر اساس ' + def.naturalKey.map(function (k) { return SC.field(entityKey, k).label; }).join(' + ') + ') به‌روزرسانی می‌شوند.') : null,
        h('li', 'تاریخ‌ها شمسی (۱۴۰۵/۰۷/۱۵) و دوره‌ها به‌صورت ۱۴۰۵/۰۷ وارد شوند.'),
        h('li', 'برای ورود چند بخش با هم از «مرکز داده» استفاده کنید.')),
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '12px' } },
        IBP.ui.excelButton('دریافت فایل الگو', function () { return IBP.dataio.downloadTemplate({ entities: [entityKey], filename: 'الگوی ' + def.label }); }))
    );
    IBP.ui.modal({
      title: 'ورود ' + def.label + ' از فایل', body: body,
      actions: [
        { label: 'انصراف' },
        {
          label: 'انتخاب فایل', primary: true, onClick: function (close) {
            var input = h('input', { type: 'file', accept: '.xlsx,.csv,.txt' });
            input.addEventListener('change', function () {
              var file = input.files && input.files[0];
              if (!file) return;
              IBP.excel.readFile(file).then(function (wb) {
                var plan = IBP.dataio.plan(wb.sheets, { entityHint: entityKey });
                plan.items = plan.items.filter(function (it) { return it.entity === entityKey; });
                close();
                var it = plan.items[0];
                if (!it) { IBP.ui.toast('برگه‌ای برای «' + def.label + '» در فایل یافت نشد', 'warning'); return; }
                plan.errorsTotal = it.errors.length; plan.rowsTotal = it.rows;
                IBP.ui.modal({
                  title: 'پیش‌نمایش ورود ' + def.label,
                  body: '<p class="confirm-text">' + F.num(it.rows) + ' ردیف · <b>' + F.num(it.inserts) + '</b> جدید · <b>' + F.num(it.updates) + '</b> به‌روزرسانی · <b>' + F.num(it.errors.length) + '</b> خطا</p>' +
                    (it.errors.length ? '<div style="max-height:260px;overflow:auto;font-size:12.5px;line-height:2;color:var(--critical-text)">' + it.errors.slice(0, 150).map(function (e) { return 'ردیف ' + F.num(e.row) + (e.field ? ' · ' + F.escape(e.field) : '') + ': ' + F.escape(e.msg); }).join('<br>') + '</div>' : ''),
                  actions: [
                    { label: 'انصراف' },
                    it.errors.length ? { label: 'گزارش خطا (Excel)', keepOpen: true, onClick: function () { IBP.dataio.errorReport(plan); } } : null,
                    { label: 'اعمال ' + F.num(it.records.length) + ' ردیف', primary: true, onClick: function () {
                      if (!it.records.length) return;
                      IBP.dataio.apply(plan, 'merge').then(function () { IBP.ui.toast(F.num(it.records.length) + ' ردیف اعمال شد', 'success'); done(); });
                    } }
                  ].filter(Boolean)
                });
              }).catch(function (e) { IBP.ui.toast(e.message, 'error'); });
            });
            input.click();
            return false;
          }
        }
      ]
    });
  }

  function render(root, params) {
    var entityKey = params[0] && SC.entity(params[0]) ? params[0] : 'products';
    var def = SC.entity(entityKey);
    var layout = h('div.md-layout');
    root.appendChild(layout);

    /* ---------------- فهرست موجودیت‌ها ---------------- */
    var nav = h('nav.card.md-nav', { 'aria-label': 'موجودیت‌ها' });
    SC.GROUPS.forEach(function (g) {
      nav.appendChild(h('div.md-nav-group', g.label));
      SC.keys().filter(function (k) { return SC.entity(k).group === g.id; }).forEach(function (k) {
        var e = SC.entity(k);
        nav.appendChild(h('a' + (k === entityKey ? '.active' : ''), { href: '#/masterdata/' + k, html: icon(e.icon, 16) + '<span>' + e.label + '</span><span class="count">' + F.num(S.count(k)) + '</span>' }));
      });
    });
    layout.appendChild(nav);

    /* ---------------- جدول ---------------- */
    var panel = h('section.card');
    layout.appendChild(panel);
    var countEl = h('span.muted');
    var head = h('div.md-head', h('div', h('h2', def.label), countEl), h('div.actions',
      h('button.btn', { type: 'button', html: icon('upload', 16) + '<span>ورود از فایل</span>', onclick: function () { importDialog(entityKey, refresh); } }),
      IBP.ui.excelButton('خروجی Excel', function () { return IBP.dataio.exportEntities([entityKey], { records: g.filtered() }); }),
      h('button.btn.btn-primary', { type: 'button', html: icon('plus', 16) + '<span>افزودن ' + def.single + '</span>', onclick: function () { IBP.form.editRecord(entityKey, null, refresh); } })
    ));
    panel.appendChild(head);
    var gridHost = h('div');
    panel.appendChild(gridHost);

    var shown = def.fields.filter(function (f) { return f.type !== 'textarea'; }).slice(0, def.heavy ? 6 : 9);
    var columns = shown.map(function (f) {
      return {
        key: f.key, label: f.label, width: f.width,
        align: ['number', 'money', 'percent'].indexOf(f.type) >= 0 ? 'num' : null,
        render: cellRender(f), value: sortValue(f), text: textValue(f)
      };
    });
    var filters = def.fields.filter(function (f) {
      return (f.type === 'select' && f.options.length <= 16) || (f.type === 'ref' && S.count(f.ref) <= 80) || f.type === 'period';
    }).slice(0, 3).map(function (f) {
      var options;
      if (f.type === 'select') options = f.options.map(function (o) { return { value: o, label: o }; });
      else if (f.type === 'ref') options = S.all(f.ref).map(function (r) { return { value: r.id, label: S.name(f.ref, r.id) }; });
      else {
        var ps = Array.from(new Set(S.all(entityKey).map(function (r) { return r[f.key]; }))).sort(function (a, b) { return b - a; });
        options = ps.map(function (p) { return { value: String(p), label: J.label(p) }; });
      }
      return { label: f.label, options: options, test: function (r, v) { return String(r[f.key]) === String(v); } };
    });

    var g = IBP.grid(gridHost, {
      rows: function () { return S.all(entityKey); },
      columns: columns,
      filters: filters,
      pageSize: def.heavy ? 50 : 25,
      selectable: true,
      bulkActions: [{ label: 'حذف انتخاب‌شده‌ها', icon: 'trash', danger: true, onClick: function (rows) { return removeRecords(entityKey, rows.map(function (r) { return r.id; })).then(function (ok) { if (ok) refresh(); return ok; }); } }],
      onRowClick: function (r) { IBP.form.editRecord(entityKey, r, refresh); },
      actions: [
        { icon: 'edit', label: 'ویرایش', onClick: function (r) { IBP.form.editRecord(entityKey, r, refresh); } },
        { icon: 'trash', label: 'حذف', danger: true, onClick: function (r) { removeRecords(entityKey, [r.id]).then(function (ok) { if (ok) refresh(); }); } }
      ],
      empty: 'هنوز ' + def.single + 'ی ثبت نشده است'
    });

    function refresh() {
      countEl.textContent = F.num(S.count(entityKey)) + ' رکورد';
      nav.querySelectorAll('a').forEach(function (a) {
        var k = a.getAttribute('href').split('/').pop();
        var c = a.querySelector('.count'); if (c) c.textContent = F.num(S.count(k));
      });
      g.refresh();
    }
    countEl.textContent = F.num(S.count(entityKey)) + ' رکورد';
  }

  IBP.register('masterdata', {
    title: function (params) { var e = SC.entity(params[0] || 'products'); return 'داده‌های پایه' + (e ? ' — ' + e.label : ''); },
    render: render
  });
})(window.IBP = window.IBP || {});
