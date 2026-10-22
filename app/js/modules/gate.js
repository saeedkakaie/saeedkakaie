/*
 * صفحه ورود هلدینگ: انتخاب شرکت (کد پلنت) و ورود به فضای کاری IBP همان شرکت.
 * خلاصه تلفیقی هلدینگ (فروش بیرون از گروه، تناژ، دقت پیش‌بینی و استثناها) نیز اینجا نمایش داده می‌شود.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt, J = IBP.jalali, UI = IBP.ui, C = IBP.charts;
  var el = null;

  function tplOf(c) { return c.templateId ? IBP.templates.get(c.templateId) : null; }

  function companyForm(c, onSave) {
    var name = h('input', { type: 'text', value: c ? c.name : '' });
    var code = h('input', { type: 'text', dir: 'ltr', value: c ? c.code : '', placeholder: 'مثلاً PAS' });
    var tpl = h('select');
    tpl.appendChild(h('option', { value: '' }, 'بدون داده (شروع با داده‌های خودم)'));
    IBP.templates.list.forEach(function (t) { tpl.appendChild(h('option', { value: t.id }, 'داده نمونه: ' + t.name)); });
    var body = h('div.form-grid',
      h('div.field.wide', h('label', 'نام شرکت'), name),
      h('div.field', h('label', 'کد شرکت (کد پلنت)'), code, h('div.hint', 'یکتا؛ حروف و عدد لاتین')),
      c ? null : h('div.field', h('label', 'نوع فعالیت و داده اولیه'), tpl));
    UI.modal({
      title: c ? 'ویرایش شرکت' : 'افزودن شرکت به هلدینگ', body: body,
      actions: [{ label: 'انصراف' }, {
        label: c ? 'ذخیره' : 'ایجاد شرکت', primary: true, onClick: function (close) {
          var v = { name: name.value.trim(), code: code.value.trim() };
          if (!v.name || !/^[A-Za-z0-9_-]{2,12}$/.test(v.code)) { UI.toast('نام و کد معتبر (۲ تا ۱۲ نویسه لاتین) وارد کنید', 'warning'); return false; }
          var t = tpl.value ? IBP.templates.get(tpl.value) : null;
          var p = c ? IBP.holding.update(c.id, v) : IBP.holding.create({ name: v.name, code: v.code, templateId: t ? t.id : '', activity: t ? t.name : '' }, { seed: !!t });
          p.then(function () { close(); UI.toast(c ? 'شرکت به‌روزرسانی شد' : 'شرکت «' + v.name + '» ایجاد شد', 'success'); onSave(); }, function (e) { UI.toast(e.message, 'error'); });
          return false;
        }
      }]
    });
  }

  function render() {
    var H = IBP.holding, list = H.list();
    el.textContent = '';
    var tot = { rev: 0, tons: 0, crit: 0, accW: 0, accN: 0, prev: 0 };
    list.forEach(function (c) {
      var s = c.summary || {};
      tot.rev += s.revenueExternal || 0; tot.prev += s.revenuePrev || 0; tot.tons += s.tons || 0; tot.crit += s.critical || 0;
      if (s.accuracy !== null && s.accuracy !== undefined) { tot.accW += s.accuracy * (s.revenue || 1); tot.accN += (s.revenue || 1); }
    });
    var last = H.lastCompany();

    var wrap = h('div.gate-wrap');
    wrap.appendChild(h('header.gate-head',
      h('div.brand-logo', { style: { width: '52px', height: '52px', fontSize: '15px' } }, 'IBP'),
      h('div', h('div.gate-title', H.holdingName()), h('div.gate-sub', 'Integrated Business Planning · برنامه‌ریزی یکپارچه شرکت‌های هلدینگ')),
      h('div.gate-actions',
        h('button.btn', { type: 'button', html: icon('edit', 16) + '<span>نام هلدینگ</span>', onclick: function () {
          var inp = h('input', { type: 'text', value: H.holdingName() });
          UI.modal({ title: 'نام هلدینگ', body: h('div.field', h('label', 'نام'), inp), actions: [{ label: 'انصراف' }, { label: 'ذخیره', primary: true, onClick: function () { H.setHoldingName(inp.value.trim() || H.holdingName()).then(render); } }] });
        } }),
        h('button.btn.btn-primary', { type: 'button', html: icon('plus', 16) + '<span>افزودن شرکت</span>', onclick: function () { companyForm(null, render); } }))));

    wrap.appendChild(h('section.hero', { style: { marginBottom: '22px' } },
      h('div', h('h2', 'نمای تلفیقی هلدینگ'), h('p', F.num(list.length) + ' شرکت تولیدی · هر شرکت IBP و منطق برنامه‌ریزی خودش را دارد · فروش درون‌گروهی از رقم تلفیقی حذف شده است')),
      h('div.hero-stats',
        h('div.hero-stat', h('div.v', F.compact(tot.rev)), h('div.l', 'فروش ۱۲ ماه بیرون از گروه (ریال)')),
        h('div.hero-stat', h('div.v', F.num(tot.tons)), h('div.l', 'تناژ فروش ۱۲ ماه (تن)')),
        h('div.hero-stat', h('div.v', tot.accN ? F.pct(tot.accW / tot.accN, 0) : '—'), h('div.l', 'دقت پیش‌بینی (وزنی)')),
        h('div.hero-stat', h('div.v', F.num(tot.crit)), h('div.l', 'استثنای بحرانی')))));

    var grid = h('div.gate-grid');
    list.forEach(function (c) {
      var s = c.summary || {}, t = tplOf(c);
      var growth = s.revenuePrev ? s.revenue / s.revenuePrev - 1 : null;
      var card = h('article.card.gate-card.hoverable' + (c.id === last ? '.last' : ''), { tabindex: 0 },
        h('div.gc-head',
          h('div.tpl-icon', { style: { background: t ? t.grad : 'linear-gradient(135deg,#64748b,#334155)' }, html: icon(t ? t.icon : 'factory', 22) }),
          h('div', { style: { minWidth: 0 } }, h('div.gc-name', c.name), h('div.gc-sub', (c.industry || (t ? t.name : 'شرکت تولیدی')))),
          h('span.gc-code', c.code)),
        h('div.gc-stats',
          h('div', h('b', s.revenue ? F.compact(s.revenue) : '—'), h('span', 'فروش ۱۲ ماه')),
          h('div', h('b', { html: growth !== null ? '<span class="delta ' + (growth >= 0 ? 'up-good' : 'down-bad') + '">' + F.signedPct(growth) + '</span>' : '—' }), h('span', 'رشد اسمی')),
          h('div', h('b', s.accuracy !== null && s.accuracy !== undefined ? F.pct(s.accuracy, 0) : '—'), h('span', 'دقت پیش‌بینی')),
          h('div', h('b', F.num(s.products || 0)), h('span', 'محصول'))),
        s.spark ? h('div.gc-spark', { html: C.sparkline(s.spark, { width: 300, height: 40 }) }) : null,
        h('div.gc-foot',
          s.critical ? h('span', { html: UI.statusBadge('critical', F.num(s.critical) + ' بحرانی') }) : h('span', { html: UI.statusBadge('good', 'بدون استثنای بحرانی') }),
          s.cycleSteps ? h('span.cell-sub', 'چرخه ' + J.label(s.cycle) + ': ' + F.num(s.cycleDone) + '/' + F.num(s.cycleSteps)) : null,
          h('span.spacer'),
          h('button.icon-btn', { type: 'button', title: 'ویرایش', 'aria-label': 'ویرایش شرکت', html: icon('edit', 16), onclick: function (e) { e.stopPropagation(); companyForm(c, render); } }),
          h('button.icon-btn.danger', { type: 'button', title: 'حذف', 'aria-label': 'حذف شرکت', html: icon('trash', 16), onclick: function (e) {
            e.stopPropagation();
            UI.confirm('شرکت «' + c.name + '» و همه داده‌های آن برای همیشه حذف می‌شود.', { danger: true, ok: 'حذف شرکت', title: 'حذف شرکت' }).then(function (ok) { if (ok) H.remove(c.id).then(render); });
          } }),
          h('button.btn.btn-primary.btn-sm', { type: 'button', html: '<span>ورود</span>' + icon('chevronLeft', 15), onclick: function (e) { e.stopPropagation(); enter(c.id); } })));
      card.addEventListener('click', function () { enter(c.id); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') enter(c.id); });
      grid.appendChild(card);
    });
    grid.appendChild(h('button.card.gate-card.gate-add', { type: 'button', onclick: function () { companyForm(null, render); } },
      h('div.dz-icon', { html: icon('plus', 26) }), h('div.gc-name', 'افزودن شرکت'), h('div.gc-sub', 'با داده نمونه یکی از الگوها یا بدون داده')));
    wrap.appendChild(grid);
    wrap.appendChild(h('div.gate-foot', 'نسخه ' + IBP.APP.version + ' · ' + J.longDate() + ' · داده‌های هر شرکت در پایگاه داده جداگانه روی همین رایانه ذخیره می‌شود'));
    el.appendChild(wrap);
    var first = el.querySelector('.gate-card.last') || el.querySelector('.gate-card');
    if (first) first.focus();
  }

  function enter(id) {
    var c = IBP.holding.get(id);
    el.classList.add('leaving');
    IBP.holding.enter(id).then(function () {
      hide();
      IBP.app.enterCompany(c);
    }, function (e) { el.classList.remove('leaving'); UI.toast(e.message, 'error'); });
  }

  function show() {
    if (!el) { el = h('div.gate', { role: 'main', 'aria-label': 'انتخاب شرکت' }); document.body.appendChild(el); }
    el.classList.remove('leaving', 'hidden');
    document.body.classList.add('gate-open');
    render();
  }
  function hide() {
    if (!el) return;
    el.classList.add('hidden');
    document.body.classList.remove('gate-open');
  }

  IBP.gate = { show: show, hide: hide, render: function () { if (el && !el.classList.contains('hidden')) render(); } };
})(window.IBP = window.IBP || {});
