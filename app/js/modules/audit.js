/*
 * سوابق تغییرات (فاز ۹): چه کسی، چه زمانی، در کدام شرکت و بخش، چه چیزی را تغییر داد.
 * فیلتر بر اساس شرکت، کاربر، بخش و نوع عملیات؛ جزئیات فیلدهای تغییرکرده (قبل ← بعد)؛ خروجی Excel.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt, UI = IBP.ui, SV = IBP.server, S = IBP.store;
  var state = { company: null, username: '', entity: '', items: [], done: false };

  var ACTION = { insert: 'افزودن', update: 'ویرایش', delete: 'حذف', bulk_upsert: 'ثبت گروهی', clear: 'پاک کردن بخش', clear_all: 'پاک کردن همه داده‌ها',
    meta_update: 'تغییر تنظیمات/نتایج', login: 'ورود', user_create: 'ساخت کاربر', user_update: 'تغییر دسترسی کاربر', password_reset: 'بازنشانی رمز',
    password_change: 'تغییر رمز', company_create: 'ساخت شرکت', company_update: 'ویرایش شرکت', company_delete: 'حذف شرکت', holding_update: 'تغییر هلدینگ' };
  var META_LABEL = { settings: 'تنظیمات شرکت', scenarios: 'سناریوها', reports: 'گزارش‌های ذخیره‌شده', mpsOverrides: 'تغییرات دستی برنامه تولید', icRequests: 'درخواست‌های درون‌گروهی', seeded: 'داده نمونه', lastImport: 'ورود داده' };

  function entityLabel(it) {
    if (it.entity === 'meta') return META_LABEL[it.recordId] || it.recordId;
    if (it.entity === 'user') return 'کاربر';
    if (it.entity === 'session') return 'نشست';
    if (it.entity === 'company' || it.entity === 'holding') return 'شرکت‌ها';
    var e = it.entity && IBP.schema.entity(it.entity);
    return e ? e.label : (it.entity || '—');
  }
  function recordLabel(it) {
    if (!it.recordId || it.entity === 'meta') return it.entity === 'user' ? it.recordId || '' : '';
    var cur = IBP.holding.current();
    if (cur && it.company === cur.code && IBP.schema.entity(it.entity) && S.get(it.entity, it.recordId)) return S.name(it.entity, it.recordId);
    return it.recordId;
  }
  function val(v) {
    if (v === null || v === undefined || v === '') return '∅';
    if (typeof v === 'number') return F.num(v, Math.abs(v) < 10 && v !== Math.round(v) ? 2 : 0);
    if (typeof v === 'object') return JSON.stringify(v).slice(0, 60);
    return String(v).slice(0, 60);
  }
  function fieldLabel(entity, k) { var f = IBP.schema.entity(entity) && IBP.schema.field(entity, k); return f ? f.label : k; }
  function detail(it) {
    var d = it.detail;
    if (!d) return '';
    if (d.changed) return Object.keys(d.changed).map(function (k) { return fieldLabel(it.entity, k) + ': ' + val(d.changed[k][0]) + ' ← ' + val(d.changed[k][1]); }).join(' · ');
    if (d.new) return 'رکورد جدید';
    if (d.count !== undefined) return F.num(d.count) + ' رکورد';
    if (d.size !== undefined) return '';
    if (d.role) return SV.roleLabel(d.role) + (d.companies ? ' · ' + d.companies.join('، ') : '');
    if (d.client) return d.client.slice(0, 40);
    return '';
  }

  function load(append) {
    var q = ['limit=200'];
    if (state.company) q.push('company=' + encodeURIComponent(state.company));
    if (state.username) q.push('username=' + encodeURIComponent(state.username));
    if (state.entity) q.push('entity=' + encodeURIComponent(state.entity));
    if (append && state.items.length) q.push('before=' + state.items[state.items.length - 1].id);
    return SV.api('GET', '/api/audit?' + q.join('&')).then(function (r) {
      state.items = append ? state.items.concat(r.items) : r.items;
      state.done = r.items.length < 200;
    });
  }

  function render(root) {
    root.appendChild(UI.pageHead({ title: 'سوابق تغییرات' }));
    if (!SV.active()) {
      root.appendChild(h('div.card', h('div.card-body', 'سوابق تغییرات در حالت سرور مرکزی ثبت می‌شود («کاربران و دسترسی» ← اتصال به سرور).')));
      return;
    }
    if (state.company === null) state.company = IBP.holding.current() ? IBP.holding.current().code : '';
    var mk = function (label, opts, value, onChange) {
      var s = h('select', { 'aria-label': label });
      opts.forEach(function (o) { s.appendChild(h('option', { value: o[0] }, o[1])); });
      s.value = value;
      s.addEventListener('change', function () { onChange(s.value); load(false).then(function () { IBP.app.render(true); }); });
      return h('label.bt-ctl', h('span', label), s);
    };
    var ents = [['', 'همه بخش‌ها']].concat(IBP.schema.keys().map(function (k) { return [k, IBP.schema.entity(k).label]; })).concat([['meta', 'تنظیمات و نتایج']]);
    var cos = [['', 'همه شرکت‌های مجاز']].concat(IBP.holding.list().map(function (c) { return [c.code, c.name]; }));
    var bar = h('div.rep-config.card',
      mk('شرکت', cos, state.company, function (v) { state.company = v; }),
      mk('بخش', ents, state.entity, function (v) { state.entity = v; }),
      h('label.bt-ctl', h('span', 'کاربر'), (function () {
        var i = h('input', { type: 'text', dir: 'ltr', value: state.username, placeholder: 'همه', style: { width: '120px' } });
        i.addEventListener('change', function () { state.username = i.value.trim(); load(false).then(function () { IBP.app.render(true); }); });
        return i;
      })()));
    root.appendChild(bar);
    var card = UI.card({ title: 'تغییرات', icon: 'clock', flush: true, focus: false, exportFn: exportAudit });
    root.appendChild(card.el);
    var box = h('div.plan-wrap'); card.body.appendChild(box);
    var draw = function () {
      box.textContent = '';
      if (!state.items.length) { box.appendChild(h('div.muted', { style: { padding: '16px' } }, 'تغییری ثبت نشده است.')); return; }
      var t = h('table.data-table.audit-table', h('thead', h('tr', ['زمان', 'کاربر', 'شرکت', 'بخش', 'مورد', 'عملیات', 'جزئیات'].map(function (x) { return h('th', x); }))));
      var tb = h('tbody');
      state.items.forEach(function (it) {
        tb.appendChild(h('tr', h('td.nowrap', IBP.usersWhen(it.ts)), h('td', { dir: 'ltr' }, it.username || '—'), h('td', it.company || '—'), h('td', entityLabel(it)), h('td', recordLabel(it)),
          h('td', { html: '<span class="act act-' + F.escape(it.action) + '">' + F.escape(ACTION[it.action] || it.action) + '</span>' }), h('td.audit-detail', detail(it))));
      });
      t.appendChild(tb);
      box.appendChild(t);
      if (!state.done) box.appendChild(h('button.btn.btn-sm', { type: 'button', style: { margin: '10px' }, html: icon('chevronDown', 14) + '<span>موارد قدیمی‌تر</span>', onclick: function () { load(true).then(draw); } }));
    };
    box.appendChild(h('div.muted', { style: { padding: '16px' } }, 'در حال دریافت…'));
    load(false).then(draw, function (e) { box.textContent = e.message; });
  }

  function exportAudit() {
    return IBP.excel.exportTables({ filename: 'سوابق تغییرات', sheets: [{ name: 'سوابق', title: 'سوابق تغییرات', columns: [
      { header: 'زمان', value: function (it) { return IBP.usersWhen(it.ts); }, type: 'text', width: 18 },
      { header: 'کاربر', key: 'username', type: 'text' }, { header: 'شرکت', key: 'company', type: 'text' },
      { header: 'بخش', value: entityLabel, type: 'text', width: 22 }, { header: 'مورد', value: recordLabel, type: 'text', width: 26 },
      { header: 'عملیات', value: function (it) { return ACTION[it.action] || it.action; }, type: 'text' },
      { header: 'جزئیات', value: detail, type: 'text', width: 80 }], rows: state.items }] });
  }

  IBP.register('audit', { title: 'سوابق تغییرات', render: render });
})(window.IBP = window.IBP || {});
