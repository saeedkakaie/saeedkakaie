/*
 * فرم‌ساز بر اساس تعریف موجودیت‌ها + انتخابگر تاریخ شمسی و انتخابگر ماه.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, J = IBP.jalali, F = IBP.fmt, S = IBP.store;

  /* ================= انتخابگر تاریخ شمسی ================= */
  var openPicker = null;
  function closePicker() { if (openPicker) { openPicker.remove(); openPicker = null; document.removeEventListener('mousedown', outside); } }
  function outside(e) { if (openPicker && !openPicker.contains(e.target) && !openPicker._anchor.contains(e.target)) closePicker(); }

  function datePicker(input, anchor) {
    closePicker();
    var cur = J.jalaliStrToIso(input.value) ? input.value.split('/').map(Number) : null;
    var t = J.today();
    var vy = cur ? cur[0] : t.jy, vm = cur ? cur[1] : t.jm;
    var pop = h('div.datepicker', { role: 'dialog', 'aria-label': 'انتخاب تاریخ' });
    pop._anchor = anchor;
    function render() {
      pop.textContent = '';
      var head = h('div.dp-head',
        h('button.icon-btn', { type: 'button', 'aria-label': 'ماه قبل', html: IBP.ui.icon('chevronRight', 16), onclick: function () { vm--; if (vm < 1) { vm = 12; vy--; } render(); } }),
        h('div.dp-title', J.MONTHS[vm - 1] + ' ' + vy),
        h('button.icon-btn', { type: 'button', 'aria-label': 'ماه بعد', html: IBP.ui.icon('chevronLeft', 16), onclick: function () { vm++; if (vm > 12) { vm = 1; vy++; } render(); } })
      );
      var grid = h('div.dp-grid');
      J.WEEKDAYS_SHORT.forEach(function (d) { grid.appendChild(h('div.dp-wd', d)); });
      var first = J.weekday(vy, vm, 1), len = J.monthLength(vy, vm);
      for (var i = 0; i < first; i++) grid.appendChild(h('div.dp-empty'));
      for (var d = 1; d <= len; d++) {
        (function (day) {
          var cls = 'button.dp-day';
          if (vy === t.jy && vm === t.jm && day === t.jd) cls += '.today';
          if (cur && cur[0] === vy && cur[1] === vm && cur[2] === day) cls += '.selected';
          if ((first + day - 1) % 7 === 6) cls += '.friday';
          grid.appendChild(h(cls, {
            type: 'button', onclick: function () {
              input.value = vy + '/' + String(vm).padStart(2, '0') + '/' + String(day).padStart(2, '0');
              input.dispatchEvent(new Event('change'));
              closePicker();
            }
          }, String(day)));
        })(d);
      }
      pop.appendChild(head); pop.appendChild(grid);
      pop.appendChild(h('div.dp-foot',
        h('button.btn.btn-sm', { type: 'button', onclick: function () { vy = t.jy; vm = t.jm; input.value = J.isoToJalaliStr(J.jalaliStrToIso(t.jy + '/' + t.jm + '/' + t.jd)); input.dispatchEvent(new Event('change')); closePicker(); } }, 'امروز'),
        h('button.btn.btn-sm', { type: 'button', onclick: function () { input.value = ''; input.dispatchEvent(new Event('change')); closePicker(); } }, 'پاک کردن')
      ));
    }
    render();
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 4;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = r.top - pop.offsetHeight - 4;
    pop.style.top = Math.max(8, top) + 'px';
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    openPicker = pop;
    setTimeout(function () { document.addEventListener('mousedown', outside); }, 0);
  }

  function dateInput(value, attrs) {
    var inp = h('input', Object.assign({ type: 'text', placeholder: '۱۴۰۵/۰۱/۰۱', value: J.isoToJalaliStr(value), dir: 'ltr', inputmode: 'numeric' }, attrs || {}));
    var wrap = h('div.input-icon');
    var btn = h('button.icon-btn', { type: 'button', 'aria-label': 'تقویم', html: IBP.ui.icon('calendar', 16), onclick: function () { datePicker(inp, wrap); } });
    wrap.appendChild(inp); wrap.appendChild(btn);
    wrap.getValue = function () { return inp.value.trim() ? J.jalaliStrToIso(inp.value.trim()) || '__invalid__' : ''; };
    wrap.input = inp;
    return wrap;
  }

  /* ================= انتخابگر ماه ================= */
  function periodInput(value, opts) {
    opts = opts || {};
    var p = value || S.settings().cyclePeriod || J.currentPeriod();
    var cy = J.year(J.currentPeriod());
    var ys = h('select', { 'aria-label': 'سال' }), ms = h('select', { 'aria-label': 'ماه' });
    for (var y = cy - (opts.yearsBack || 6); y <= cy + (opts.yearsAhead || 3); y++) ys.appendChild(h('option', { value: y }, String(y)));
    J.MONTHS.forEach(function (m, i) { ms.appendChild(h('option', { value: i + 1 }, m)); });
    ys.value = J.year(p); ms.value = J.month(p);
    var wrap = h('div.period-input', ms, ys);
    wrap.getValue = function () { return J.period(+ys.value, +ms.value); };
    wrap.setValue = function (v) { ys.value = J.year(v); ms.value = J.month(v); };
    if (opts.onChange) { ys.addEventListener('change', function () { opts.onChange(wrap.getValue()); }); ms.addEventListener('change', function () { opts.onChange(wrap.getValue()); }); }
    return wrap;
  }

  /* ================= فرم موجودیت ================= */
  function control(f, value) {
    var id = 'f-' + f.key + '-' + Math.random().toString(36).slice(2, 7);
    var el;
    switch (f.type) {
      case 'textarea':
        el = h('textarea', { id: id, rows: 3 }); el.value = value || ''; break;
      case 'number': case 'money':
        el = h('input', { id: id, type: 'text', inputmode: 'decimal', dir: 'ltr', value: value === null || value === undefined ? '' : (f.type === 'money' ? F.num(value) : String(value)) });
        if (f.type === 'money') el.addEventListener('blur', function () { var n = F.parseNumber(el.value); if (n !== null) el.value = F.num(n); });
        break;
      case 'percent':
        el = h('div.input-suffix',
          h('input', { id: id, type: 'text', inputmode: 'decimal', dir: 'ltr', value: value === null || value === undefined ? '' : String(Math.round(value * 10000) / 100) }),
          h('span', '٪'));
        break;
      case 'select':
        el = h('select', { id: id });
        if (!f.required) el.appendChild(h('option', { value: '' }, '—'));
        f.options.forEach(function (o) { el.appendChild(h('option', { value: o }, o)); });
        el.value = value !== undefined && value !== null ? value : (f.required ? f.options[0] : '');
        break;
      case 'ref':
        el = h('select', { id: id });
        if (!f.required) el.appendChild(h('option', { value: '' }, '—'));
        S.all(f.ref).slice().sort(function (a, b) { return String(S.name(f.ref, a.id)).localeCompare(String(S.name(f.ref, b.id)), 'fa'); })
          .forEach(function (r) { el.appendChild(h('option', { value: r.id }, (r.code ? r.code + ' — ' : '') + S.name(f.ref, r.id))); });
        el.value = value || '';
        break;
      case 'bool':
        el = h('label.switch', h('input', { id: id, type: 'checkbox', checked: value === undefined ? !!f.default : !!value }), h('span.slider'));
        break;
      case 'color':
        el = h('input', { id: id, type: 'color', value: value || f.default || '#2a78d6' }); break;
      case 'date':
        el = dateInput(value, { id: id }); break;
      case 'period':
        el = periodInput(value); break;
      default:
        el = h('input', { id: id, type: 'text', value: value || '' });
    }
    el._fieldId = id;
    return el;
  }

  function readControl(f, el) {
    switch (f.type) {
      case 'number': case 'money': return F.parseNumber(el.value);
      case 'percent': { var n = F.parseNumber(el.querySelector('input').value); return n === null ? null : n / 100; }
      case 'bool': return el.querySelector('input').checked;
      case 'date': return el.getValue();
      case 'period': return el.getValue();
      case 'select': case 'ref': return el.value || null;
      default: return el.value.trim();
    }
  }

  /**
   * ساخت فرم برای یک موجودیت. خروجی: { el, read() → {ok, value, errors} }
   */
  function entityForm(entityKey, record) {
    var def = IBP.schema.entity(entityKey);
    record = record || IBP.schema.defaults(entityKey);
    var form = h('form.form-grid', { onsubmit: function (e) { e.preventDefault(); } });
    var ctrls = {};
    def.fields.forEach(function (f) {
      var c = control(f, record[f.key]);
      ctrls[f.key] = c;
      var wide = f.type === 'textarea';
      form.appendChild(h('div.field' + (wide ? '.wide' : ''),
        h('label', { for: c._fieldId }, f.label, f.required ? h('span.req', ' *') : null),
        c,
        f.hint ? h('div.hint', f.hint) : null,
        h('div.err', { 'data-err': f.key })
      ));
    });
    function read() {
      var value = {}, errors = {};
      def.fields.forEach(function (f) {
        var v = readControl(f, ctrls[f.key]);
        if (f.type === 'date' && v === '__invalid__') { errors[f.key] = 'تاریخ نامعتبر است (مثال: ۱۴۰۵/۰۷/۱۵)'; return; }
        if ((f.type === 'number' || f.type === 'money' || f.type === 'percent') && v === null) {
          var raw = f.type === 'percent' ? ctrls[f.key].querySelector('input').value : ctrls[f.key].value;
          if (String(raw).trim() !== '') { errors[f.key] = 'عدد معتبر وارد کنید'; return; }
        }
        if (f.required && (v === null || v === '' || v === undefined)) { errors[f.key] = 'این فیلد الزامی است'; return; }
        if (typeof v === 'number') {
          if (f.min !== undefined && v < f.min) { errors[f.key] = 'حداقل مقدار ' + (f.type === 'percent' ? F.pct(f.min) : F.num(f.min, 2)); return; }
          if (f.max !== undefined && v > f.max) { errors[f.key] = 'حداکثر مقدار ' + (f.type === 'percent' ? F.pct(f.max) : F.num(f.max, 2)); return; }
        }
        if (f.unique && v) {
          var dup = S.all(entityKey).some(function (r) { return String(r[f.key]) === String(v) && r.id !== record.id; });
          if (dup) { errors[f.key] = 'این مقدار تکراری است'; return; }
        }
        value[f.key] = v;
      });
      form.querySelectorAll('.err').forEach(function (e) { e.textContent = errors[e.getAttribute('data-err')] || ''; });
      form.querySelectorAll('.field').forEach(function (fd) {
        var k = fd.querySelector('.err').getAttribute('data-err');
        fd.classList.toggle('invalid', !!errors[k]);
      });
      return { ok: Object.keys(errors).length === 0, value: value, errors: errors };
    }
    return { el: form, read: read, controls: ctrls };
  }

  /** پنجره افزودن/ویرایش رکورد */
  function editRecord(entityKey, record, onSaved) {
    var def = IBP.schema.entity(entityKey);
    var isNew = !record || !record.id;
    var f = entityForm(entityKey, record ? Object.assign({}, record) : null);
    IBP.ui.modal({
      title: (isNew ? 'افزودن ' : 'ویرایش ') + def.single,
      body: f.el,
      size: def.fields.length > 8 ? 'lg' : null,
      actions: [
        { label: 'انصراف' },
        {
          label: 'ذخیره', primary: true, onClick: function () {
            var r = f.read();
            if (!r.ok) { IBP.ui.toast('لطفاً خطاهای فرم را برطرف کنید', 'warning'); return false; }
            var saved = isNew ? S.insert(entityKey, r.value) : S.update(entityKey, record.id, r.value);
            IBP.ui.toast(def.single + (isNew ? ' افزوده شد' : ' ذخیره شد'), 'success');
            if (onSaved) onSaved(saved);
          }
        }
      ]
    });
  }

  IBP.form = { entityForm: entityForm, editRecord: editRecord, dateInput: dateInput, periodInput: periodInput, datePicker: datePicker, closePicker: closePicker };
})(window.IBP = window.IBP || {});
