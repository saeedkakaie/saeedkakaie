/*
 * دستیار هوشمند (فاز ۷): گفتگو با داده‌های شرکت به زبان فارسی.
 *   دو موتور: «مدل داخلی» (بدون اینترنت، داخل برنامه) و «Claude» (از طریق موتور پایتون با کلید API روی سرور)
 *   هر پاسخ: روایت تحلیلی + شاخص‌ها، نمودارها و جدول‌های تعاملی (قابل تمرکز) + پیشنهاد اقدام + پرسش‌های بعدی + خروجی Excel
 *   ستون کناری: بینش‌های سریع خودکار (مثل Quick Insights) و نمونه پرسش‌ها
 *   گفتگو برای هر شرکت جداگانه ذخیره می‌شود.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt, S = IBP.store, C = IBP.charts, UI = IBP.ui, AG = IBP.agent;
  var state = { db: null, chat: null, busy: false, els: {} };
  var MAX_ITEMS = 40;

  var EXAMPLES = [
    { g: 'فروش و سود', q: ['۱۰ محصول پرفروش ۱۲ ماه اخیر', 'کمترین حاشیه سود خانواده‌ها', 'فروش به تفکیک کانال ماهانه', '۱۰ مشتری برتر بر اساس فروش وزنی'] },
    { g: 'روند و علت', q: ['روند و فصلی بودن فروش وزنی', 'چرا فروش ۳ ماه اخیر نسبت به سال قبل تغییر کرد؟', 'کدام خانواده بیشترین رشد را داشته؟', 'سود ناخالص ماهانه'] },
    { g: 'برنامه‌ریزی', q: ['دقت پیش‌بینی ۶ ماه اخیر به تفکیک خانواده', 'گلوگاه‌های ظرفیت و کمبودهای برنامه تولید', 'وضعیت موجودی و محصولات در خطر کمبود', 'برنامه تولید ماهانه به تفکیک خانواده'] },
    { g: 'سناریو و هلدینگ', q: ['اگر قیمت مواد اولیه ۲۰ درصد و نرخ ارز ۳۰ درصد افزایش یابد سود چه می‌شود؟', 'اگر تقاضا ۱۰ درصد کاهش یابد؟', 'مقایسه شرکت‌های هلدینگ', 'هشدارهای فعال'] }
  ];

  /* ---------------- ذخیره گفتگو ---------------- */
  function chat() {
    if (state.db !== S.dbName() || !state.chat) {
      state.db = S.dbName();
      var saved = S.meta('agentChat');
      state.chat = saved && saved.items ? { items: saved.items, api: saved.api || [] } : { items: [], api: [] };
    }
    return state.chat;
  }
  function slimView(v) {
    var o = Object.assign({}, v);
    if (o.rows && o.rows.length > 60) o.rows = o.rows.slice(0, 60);
    return o;
  }
  function persist() {
    var c = chat();
    if (c.items.length > MAX_ITEMS) c.items = c.items.slice(-MAX_ITEMS);
    var api = c.api;
    try { if (JSON.stringify(api).length > 400000) { api = []; c.api = []; } } catch (e) { api = []; }
    S.setMeta('agentChat', { items: c.items.map(function (it) { return it.views ? Object.assign({}, it, { views: it.views.map(slimView) }) : it; }), api: api });
  }
  function mode() {
    var m = S.meta('agentMode') || 'local';
    return m === 'claude' && AG.claudeAvailable() ? 'claude' : 'local';
  }

  /* ---------------- متن (Markdown ساده) ---------------- */
  function inline(s) {
    return F.escape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|\s)_(.+?)_(?=\s|$|[.،])/g, '$1<i>$2</i>');
  }
  function md(text) {
    var out = [], list = null, table = null;
    var close = function () { if (list) { out.push('</' + list + '>'); list = null; } if (table) { out.push(tableHtml(table)); table = null; } };
    String(text || '').split('\n').forEach(function (ln) {
      var t = ln.trim();
      if (/^\|.*\|$/.test(t)) {
        if (list) { out.push('</' + list + '>'); list = null; }
        if (/^\|[\s:|-]+\|$/.test(t)) return;
        (table = table || []).push(t.slice(1, -1).split('|').map(function (c) { return c.trim(); }));
        return;
      }
      if (table) { out.push(tableHtml(table)); table = null; }
      var m;
      if (!t) { close(); return; }
      if ((m = /^#{1,4}\s+(.*)$/.exec(t))) { close(); out.push('<h4>' + inline(m[1]) + '</h4>'); return; }
      if ((m = /^[-•*]\s+(.*)$/.exec(t))) { if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = /^[0-9۰-۹]+[.)]\s+(.*)$/.exec(t))) { if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      close();
      out.push('<p>' + inline(t) + '</p>');
    });
    close();
    return out.join('');
  }
  function tableHtml(rows) {
    var head = rows[0], body = rows.slice(1);
    return '<div class="plan-wrap"><table class="data-table md-table"><thead><tr>' + head.map(function (c) { return '<th>' + inline(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      body.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }

  /* ---------------- نمایش نتایج ابزارها ---------------- */
  function scaleOf(type) { return type === 'money' ? (S.settings().displayScale || 1e9) : 1; }
  function fmtOf(type) {
    if (type === 'pct') return function (v) { return F.pct(v, 0); };
    if (type === 'ratio') return function (v) { return F.num(v, 2); };
    if (type === 'num') return function (v) { return F.num(v, Math.abs(v) < 100 ? 1 : 0); };
    return function (v) { return F.num(v, Math.abs(v) < 10 && v !== Math.round(v) ? 1 : 0); };
  }
  function tipOf(type) {
    if (type === 'money') return function (v) { return F.num(v, 1) + ' ' + F.moneyUnit(); };
    if (type === 'pct') return function (v) { return F.pct(v, 1); };
    if (type === 'num') return function (v) { return F.num(v, 1) + ' تن'; };
    return fmtOf(type);
  }
  function unitOf(type) { return type === 'money' ? F.moneyUnit() : type === 'num' ? 'تن' : type === 'pct' ? 'درصد' : ''; }
  function cell(v, type) {
    if (v === null || v === undefined || v === '') return '—';
    if (typeof v !== 'number') return String(v);
    if (type === 'money') return F.num(v / scaleOf('money'), 1);
    if (type === 'pct') return F.pct(v, 1);
    if (type === 'num') return F.num(v, Math.abs(v) < 100 ? 1 : 0);
    return F.num(v);
  }

  function renderView(v, grid, onAsk) {
    if (v.type === 'insights') { grid.appendChild(insightGrid(v.items, onAsk, 'span-12')); return; }
    var wide = v.type === 'kpis' || (v.type === 'table' && v.columns.length > 3) || (v.type === 'line' && v.labels && v.labels.length > 14) || (v.type === 'columns' && v.labels && v.labels.length > 8);
    var unit = unitOf(v.valueType);
    var card = UI.card({ title: v.title, sub: [v.sub, unit && v.type !== 'kpis' && v.type !== 'table' ? 'واحد: ' + unit : (v.type === 'table' && v.columns.some(function (c) { return c.type === 'money'; }) ? 'مبالغ: ' + F.moneyUnit() : '')].filter(Boolean).join(' · '),
      icon: { kpis: 'target', line: 'trend', columns: 'chart', hbars: 'list', donut: 'pie', waterfall: 'stack', table: 'table' }[v.type] || 'chart', span: wide ? 12 : 6, cls: 'agent-view', flush: v.type === 'table',
      exportFn: function () { return exportViews(v.title, [v]); } });
    grid.appendChild(card.el);
    var box = h('div'); card.body.appendChild(box);
    var sc = scaleOf(v.valueType), fmt = fmtOf(v.valueType), tip = tipOf(v.valueType);
    var div = function (x) { return x === null || x === undefined ? null : x / sc; };
    var tipS = function (x) { return tip(x * sc); };
    if (v.type === 'kpis') {
      box.className = 'agent-kpis';
      v.items.forEach(function (k) { box.appendChild(h('div.agent-kpi' + (k.tone ? '.tone-' + k.tone : ''), h('div.ak-label', k.label), h('div.ak-value', k.value), k.sub ? h('div.ak-sub', k.sub) : null)); });
    } else if (v.type === 'line') {
      C.line(box, { labels: v.labels, tipLabels: v.tipLabels, height: 270, dataLabels: 'auto', format: fmt, tipFormat: tipS,
        series: v.series.map(function (s, i) { return { name: s.name, values: s.values.map(div), color: C.seriesColor(i), dash: s.dash }; }) });
    } else if (v.type === 'columns') {
      C.columns(box, { labels: v.labels, height: 270, stacked: !!v.stacked, format: fmt, tipFormat: tipS,
        series: v.series.map(function (s, i) { return { name: s.name, values: s.values.map(function (x) { return div(x) || 0; }), color: C.seriesColor(i) }; }) });
    } else if (v.type === 'hbars') {
      C.hbars(box, { items: v.items.map(function (it, i) { return { label: it.label, value: div(it.value) || 0, color: it.value < 0 ? 'var(--critical)' : C.seriesColor(v.items.length > 8 ? 0 : i), sub: [it.share !== undefined && it.share !== null ? { label: 'سهم از کل', value: F.pct(it.share, 1) } : null, it.note ? { label: 'توضیح', value: it.note } : null].filter(Boolean) }; }),
        format: fmt, valueLabel: unit || 'مقدار',
        onClick: v.drill && onAsk ? function (it) { onAsk('روند و فصلی بودن ' + it.label); } : null });
      if (v.drill) card.body.appendChild(h('div.agent-hint', { html: icon('target', 13) + '<span>روی هر ردیف کلیک کنید تا روند همان مورد تحلیل شود</span>' }));
    } else if (v.type === 'donut') {
      C.donut(box, { items: v.items.map(function (it, i) { return { label: it.label, value: div(it.value), color: C.seriesColor(i) }; }), format: fmt, valueLabel: unit || 'تعداد', size: 170 });
    } else if (v.type === 'waterfall') {
      C.waterfall(box, { items: v.items.map(function (it) { return { label: it.label, value: div(it.value), total: it.total }; }), format: function (x) { return F.num(x, Math.abs(x) < 10 ? 1 : 0); }, height: 290 });
    } else if (v.type === 'table') {
      box.className = 'plan-wrap';
      var t = h('table.data-table.agent-table'), hr = h('tr');
      v.columns.forEach(function (c) { hr.appendChild(h('th' + (c.type !== 'text' ? '.num' : ''), c.label)); });
      t.appendChild(h('thead', hr));
      var tb = h('tbody'), limit = 12;
      v.rows.forEach(function (r, i) {
        var tr = h('tr' + (i >= limit ? '.more' : ''));
        v.columns.forEach(function (c) { tr.appendChild(h('td' + (c.type !== 'text' ? '.num' : ''), cell(r[c.key], c.type))); });
        tb.appendChild(tr);
      });
      t.appendChild(tb);
      box.appendChild(t);
      if (v.rows.length > limit) {
        var more = h('button.btn.btn-sm.agent-more', { type: 'button', html: icon('chevronDown', 14) + '<span>نمایش همه ' + F.num(v.rows.length) + ' ردیف</span>' });
        more.addEventListener('click', function () { t.classList.add('show-all'); more.remove(); });
        card.body.appendChild(more);
      }
    }
  }

  var LEVEL = { good: ['good', 'good'], bad: ['critical', 'critical'], warn: ['warning', 'alert'], info: ['info', 'info'] };
  function insightGrid(items, onAsk, cls) {
    var g = h('div.insight-grid' + (cls ? '.' + cls : ''));
    if (!items.length) g.appendChild(h('div.muted', 'بینش برجسته‌ای پیدا نشد.'));
    items.forEach(function (it) {
      var lv = LEVEL[it.level] || LEVEL.info;
      var viz = null;
      if (it.spark) viz = h('div.ins-viz', { html: C.sparkline(it.spark, { width: 120, height: 30, color: it.level === 'bad' ? 'var(--critical)' : 'var(--spark)' }) });
      else if (it.season) viz = h('div.ins-viz.ins-season', it.season.map(function (v, i) { return h('span', { title: IBP.jalali.MONTHS[i] + ': ' + F.num(v, 2), style: { height: Math.max(8, Math.min(100, v * 55)) + '%' } }); }));
      else if (it.bars) {
        var mx = Math.max.apply(null, it.bars.map(function (b) { return Math.abs(b.value); }).concat([1e-9]));
        viz = h('div.ins-viz.ins-bars', it.bars.slice(0, 5).map(function (b) { return h('div.ib-row', h('span.ib-l', b.label), h('span.ib-t', h('i' + (b.value < 0 ? '.neg' : ''), { style: { width: Math.max(3, Math.abs(b.value) / mx * 100) + '%' } })), h('span.ib-v', b.type === 'pct' ? F.pct(b.value, 0) : F.compact(b.value))); }));
      }
      var card = h('div.insight.lvl-' + it.level, { tabIndex: 0, role: 'button', title: it.ask ? 'بیشتر بپرس: ' + it.ask : '' },
        h('div.ins-head', h('span.ins-icon', { html: icon(it.icon || lv[1], 16) }), h('div.ins-title', it.title)),
        h('div.ins-text', it.text), viz,
        it.ask ? h('div.ins-ask', { html: icon('sparkles', 13) + '<span>' + F.escape(it.ask) + '</span>' }) : null);
      if (it.ask && onAsk) {
        card.addEventListener('click', function () { onAsk(it.ask); });
        card.addEventListener('keydown', function (e) { if (e.key === 'Enter') onAsk(it.ask); });
      }
      g.appendChild(card);
    });
    return g;
  }

  /* ---------------- خروجی Excel ---------------- */
  function viewSheet(v, i) {
    var name = (i + 1) + ' ' + String(v.title || 'جدول').replace(/[\\/*?:[\]]/g, ' ').slice(0, 24);
    var money = function (type) { return type === 'money' ? 'money' : type === 'pct' ? 'pct' : type === 'num' ? 'num' : type === 'ratio' ? 'num' : 'int'; };
    if (v.type === 'table') return { name: name, title: v.title, columns: v.columns.map(function (c) { return { header: c.label, key: c.key, type: c.type === 'text' ? 'text' : money(c.type), width: c.type === 'text' ? 30 : 16 }; }), rows: v.rows };
    if (v.type === 'kpis') return { name: name, title: v.title, columns: [{ header: 'شاخص', key: 'label', type: 'text', width: 30 }, { header: 'مقدار', key: 'value', type: 'text', width: 24 }, { header: 'توضیح', key: 'sub', type: 'text', width: 40 }], rows: v.items };
    if (v.type === 'insights') return { name: name, title: v.title, columns: [{ header: 'یافته', key: 'title', type: 'text', width: 50 }, { header: 'شرح', key: 'text', type: 'text', width: 90 }], rows: v.items };
    if (v.type === 'line' || v.type === 'columns') {
      var rows = v.labels.map(function (l, j) { var o = { label: (v.tipLabels && v.tipLabels[j]) || l }; v.series.forEach(function (s, k) { o['s' + k] = s.values[j]; }); return o; });
      return { name: name, title: v.title, columns: [{ header: '', key: 'label', type: 'text', width: 22 }].concat(v.series.map(function (s, k) { return { header: s.name, key: 's' + k, type: money(v.valueType), width: 18 }; })), rows: rows,
        charts: [{ type: v.type === 'line' ? 'line' : 'bar', x: 0, y: v.series.map(function (_, k) { return k + 1; }), title: v.title, limit: 24 }] };
    }
    return { name: name, title: v.title, columns: [{ header: 'عنوان', key: 'label', type: 'text', width: 34 }, { header: 'مقدار', key: 'value', type: money(v.valueType), width: 18 }, { header: 'توضیح', key: 'note', type: 'text', width: 36 }], rows: v.items };
  }
  function exportViews(title, views, text) {
    var sheets = views.map(viewSheet);
    if (text) sheets.unshift({ name: 'پاسخ', title: title, columns: [{ header: 'متن پاسخ', key: 't', type: 'text', width: 120 }], rows: String(text).replace(/\*\*/g, '').split('\n').filter(function (l) { return l.trim(); }).map(function (l) { return { t: l }; }) });
    return IBP.excel.exportTables({ filename: 'دستیار هوشمند — ' + String(title).slice(0, 40), sheets: sheets });
  }

  /* ---------------- پیام‌ها ---------------- */
  function userMsg(it) { return h('div.msg.msg-user', h('div.bubble', it.text)); }
  function stepsEl(steps) {
    var s = h('div.msg-steps');
    (steps || []).forEach(function (st) { s.appendChild(h('span.step-chip' + (st.error ? '.err' : ''), { title: JSON.stringify(st.input || {}), html: icon(st.error ? 'alert' : 'check', 12) + '<span>' + F.escape(st.label || st.tool) + '</span>' })); });
    return s;
  }
  function botMsg(it, onAsk, animate) {
    var badge = it.mode === 'claude' ? '<span class="ag-mode claude">' + icon('sparkles', 12) + 'Claude' + (it.fallback ? ' · مدل جایگزین' : '') + '</span>' : '<span class="ag-mode local">' + icon('cpu', 12) + 'مدل داخلی</span>';
    var head = h('div.msg-head', h('span.ag-avatar', { html: icon('bot', 16) }), h('span', { html: badge }), stepsEl(it.steps),
      h('div.msg-tools',
        h('button.icon-btn', { type: 'button', title: 'کپی متن', 'aria-label': 'کپی متن', html: icon('list', 15), onclick: function () { if (navigator.clipboard) navigator.clipboard.writeText(it.text).then(function () { UI.toast('متن پاسخ کپی شد', 'success'); }); } }),
        UI.excelIconButton ? UI.excelIconButton(function () { return exportViews(it.q || 'پاسخ', it.views || [], it.text); }, 'خروجی Excel این پاسخ') : null));
    var body = h('div.msg-text', { html: md(it.text) });
    var el = h('div.msg.msg-bot', head, body);
    var grid = h('div.dash-grid.agent-views');
    el.appendChild(grid);
    el._renderViews = function () { (it.views || []).forEach(function (v) { try { renderView(v, grid, onAsk); } catch (e) { console.error(e); } }); };
    if (it.followups && it.followups.length) {
      el.appendChild(h('div.followups', it.followups.map(function (f) { return h('button.chip', { type: 'button', html: icon('sparkles', 12) + '<span>' + F.escape(f) + '</span>', onclick: function () { onAsk(f); } }); })));
    }
    if (it.usage && (it.usage.input_tokens || it.usage.output_tokens)) el.appendChild(h('div.msg-meta', 'توکن ورودی ' + F.num(it.usage.input_tokens) + ' · خروجی ' + F.num(it.usage.output_tokens)));
    if (animate && IBP.motion && IBP.motion.ok()) window.Motion.animate(el, { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] }, { duration: 0.4 });
    return el;
  }

  /* ---------------- صفحه ---------------- */
  function render(root) {
    if (!S.count('products')) {
      root.appendChild(UI.pageHead({ title: 'دستیار هوشمند' }));
      root.appendChild(h('div.card', h('div.card-body', 'ابتدا داده‌های شرکت را از «مرکز داده» بارگذاری کنید.')));
      return;
    }
    var c = chat(), cs = AG.claudeStatus(), m = mode();
    var seg = h('div.seg.agent-mode', { role: 'tablist', 'aria-label': 'موتور پاسخ' },
      h('button' + (m === 'local' ? '.on' : ''), { type: 'button', role: 'tab', html: icon('cpu', 14) + '<span>مدل داخلی</span>', title: 'بدون اینترنت؛ داده از برنامه خارج نمی‌شود', onclick: function () { S.setMeta('agentMode', 'local'); IBP.app.render(true); } }),
      h('button' + (m === 'claude' ? '.on' : '') + (cs.ok ? '' : '.disabled'), { type: 'button', role: 'tab', html: icon('sparkles', 14) + '<span>Claude</span>', title: cs.ok ? 'Claude (' + cs.model + ') از طریق موتور تحلیل' : 'غیرفعال: ' + cs.text,
        onclick: function () { if (!cs.ok) { claudeHelp(cs); return; } S.setMeta('agentMode', 'claude'); IBP.app.render(true); } }));
    var newBtn = h('button.btn.btn-sm', { type: 'button', html: icon('refresh', 14) + '<span>گفتگوی جدید</span>', onclick: function () { state.chat = { items: [], api: [] }; persist(); IBP.app.render(true); } });
    var allBtn = UI.excelButton('خروجی کل گفتگو', function () {
      var bots = c.items.filter(function (x) { return x.role === 'bot'; });
      if (!bots.length) { UI.toast('هنوز پاسخی ثبت نشده است', 'info'); return Promise.resolve(); }
      var views = [], text = [];
      c.items.forEach(function (x) { if (x.role === 'user') text.push('پرسش: ' + x.text); else { text.push(x.text); views = views.concat(x.views || []); } });
      return exportViews('گفتگو ' + S.settings().companyName, views.slice(0, 40), text.join('\n'));
    }, { small: true });
    root.appendChild(UI.pageHead({ title: 'دستیار هوشمند تحلیل', badge: UI.statusBadge(m === 'claude' ? 'good' : 'info', m === 'claude' ? 'Claude' : 'مدل داخلی آفلاین'),
      desc: S.settings().companyName + ' · به فارسی بپرسید؛ دستیار داده‌ها را تحلیل می‌کند و نمودار، جدول، علت‌یابی و پیشنهاد اقدام می‌دهد', actions: [seg, newBtn, allBtn] }));

    var layout = h('div.agent-layout'); root.appendChild(layout);
    var main = h('div.agent-main'), side = h('aside.agent-side');
    layout.appendChild(main); layout.appendChild(side);
    var thread = h('div.agent-thread', { 'aria-live': 'polite' });
    main.appendChild(thread);
    var ta = h('textarea', { rows: 1, placeholder: 'مثلاً: چرا فروش فرمی در ۳ ماه اخیر کم شد؟ یا: اگر قیمت مواد ۱۵ درصد بالا برود سود چه می‌شود؟', 'aria-label': 'پرسش' });
    var send = h('button.btn.btn-primary.agent-send', { type: 'submit', html: icon('play', 16) + '<span>بپرس</span>' });
    var form = h('form.agent-composer', h('div.ac-box', ta, send), h('div.ac-hint', m === 'claude' ? 'Claude نتایج تجمیعی ابزارها را از طریق موتور به سرویس Anthropic می‌فرستد · Enter ارسال، Shift+Enter خط جدید' : 'مدل داخلی بدون اینترنت و درون همین برنامه کار می‌کند · Enter ارسال، Shift+Enter خط جدید'));
    main.appendChild(form);
    state.els = { thread: thread, ta: ta, send: send };

    var ask = function (q) { ta.value = q; submit(); };
    var submit = function () {
      var q = ta.value.trim();
      if (!q || state.busy) return;
      ta.value = ''; autosize();
      var empty = thread.querySelector('.agent-empty'); if (empty) empty.remove();
      var u = { role: 'user', text: q, ts: Date.now() };
      c.items.push(u);
      thread.appendChild(userMsg(u));
      var pend = h('div.msg.msg-bot.pending', h('div.msg-head', h('span.ag-avatar', { html: icon('bot', 16) }), h('span.typing', h('i'), h('i'), h('i')), h('span.pend-text', m === 'claude' ? 'Claude در حال تحلیل…' : 'در حال تحلیل داده‌ها…')), h('div.msg-steps'));
      thread.appendChild(pend);
      pend.scrollIntoView({ block: 'end', behavior: 'smooth' });
      state.busy = true; send.disabled = true;
      var done = function (ans, notice) {
        state.busy = false; send.disabled = false;
        var it = { role: 'bot', q: q, mode: ans.mode, text: (notice ? notice + '\n\n' : '') + ans.text, views: ans.views, steps: ans.steps, followups: ans.followups || [], usage: ans.usage, fallback: ans.fallback, ts: Date.now() };
        c.items.push(it); persist();
        var el = botMsg(it, ask, true);
        pend.replaceWith(el);
        el._renderViews();
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
        ta.focus();
      };
      if (m === 'claude') {
        AG.claude(c.api, q, { onStep: function (st) { pend.querySelector('.msg-steps').appendChild(stepsEl([st]).firstChild); } }).then(function (ans) {
          if (ans.refused) { var loc = AG.local(q); loc.text = ans.text + '\n\n**پاسخ مدل داخلی:**\n' + loc.text; done(loc); return; }
          try { ans.followups = AG.suggest(q); } catch (e) { ans.followups = []; }
          done(ans);
        }, function (e) {
          var loc = AG.local(q);
          done(loc, '⚠️ ' + (e.message || 'خطا در ارتباط با Claude') + ' — پاسخ با مدل داخلی:');
        });
      } else {
        setTimeout(function () { var ans; try { ans = AG.local(q); } catch (e) { console.error(e); ans = { mode: 'local', text: 'خطا در تحلیل: ' + e.message, views: [], steps: [] }; } done(ans); }, 380);
      }
    };
    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    var autosize = function () { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; };
    ta.addEventListener('input', autosize);
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } });

    // گفتگوی ذخیره‌شده یا صفحه آغاز
    if (!c.items.length) {
      var hero = h('div.agent-empty',
        h('div.ae-orb', { html: icon('bot', 34) }),
        h('h3', 'از داده‌های ' + (S.settings().companyName || 'شرکت') + ' بپرسید'),
        h('p', 'فروش، سود، روند و فصلی بودن، علت تغییرات، دقت پیش‌بینی، ظرفیت و کمبود، موجودی، سناریوهای «اگر…» و مقایسه شرکت‌های هلدینگ.'),
        h('div.ae-groups', EXAMPLES.map(function (g) { return h('div.ae-group', h('div.ae-gt', g.g), g.q.map(function (q) { return h('button.chip', { type: 'button', onclick: function () { ask(q); } }, q); })); })));
      thread.appendChild(hero);
    } else {
      c.items.forEach(function (it) {
        if (it.role === 'user') thread.appendChild(userMsg(it));
        else { var el = botMsg(it, ask, false); thread.appendChild(el); el._renderViews(); }
      });
    }

    // ستون کناری: بینش‌های سریع
    var insCard = UI.card({ title: 'بینش‌های سریع', sub: 'پویش خودکار داده‌ها · کلیک = تحلیل بیشتر', icon: 'sparkles', cls: 'agent-insights', focus: false,
      exportFn: function () { return exportViews('بینش‌های سریع', [{ type: 'insights', title: 'بینش‌های سریع', items: ins }]); } });
    var ins = [];
    try { ins = AG.insights(); } catch (e) { console.error(e); }
    insCard.body.appendChild(insightGrid(ins, ask));
    side.appendChild(insCard.el);
    var stCard = UI.card({ title: 'موتور پاسخ', icon: 'cpu', focus: false });
    stCard.body.appendChild(h('div.agent-engines',
      h('div.ae-row', h('span', { html: icon('cpu', 15) }), h('div', h('b', 'مدل داخلی'), h('div.muted', 'فهم پرسش فارسی، ۱۱ ابزار تحلیلی، روایت و پیشنهاد؛ بدون اینترنت')), h('span', { html: UI.statusBadge('good', 'فعال') })),
      h('div.ae-row', h('span', { html: icon('sparkles', 15) }), h('div', h('b', 'Claude'), h('div.muted', cs.ok ? 'مدل ' + cs.model + ' با همان ابزارها؛ تحلیل آزادتر و چندمرحله‌ای' : cs.text)), h('span', { html: UI.statusBadge(cs.ok ? 'good' : 'neutral', cs.ok ? 'آماده' : 'غیرفعال') }))));
    if (!cs.ok) stCard.body.appendChild(h('button.btn.btn-sm', { type: 'button', html: icon('info', 14) + '<span>راه‌اندازی Claude</span>', onclick: function () { claudeHelp(cs); } }));
    side.appendChild(stCard.el);

    if (c.items.length) setTimeout(function () { var last = thread.lastElementChild; if (last) last.scrollIntoView({ block: 'start' }); }, 50);
    setTimeout(function () { ta.focus(); }, 80);
  }

  function claudeHelp(cs) {
    if (window.ibpDesktop) {
      UI.modal({ title: 'راه‌اندازی Claude', body: h('div', h('p', 'وضعیت فعلی: ' + cs.text), h('ol.agent-help',
        h('li', 'در «تنظیمات ← نسخه رومیزی ویندوز» کلید API را وارد و ذخیره کنید؛ موتور همراه خودکار دوباره اجرا می‌شود.'),
        h('li', 'کلید با رمزنگاری ویندوز ذخیره می‌شود و فقط موتور تحلیل از آن استفاده می‌کند؛ برنامه فقط نتایج تجمیعی ابزارها را به Claude می‌فرستد.'))),
        actions: [{ label: 'بستن' }, { label: 'رفتن به تنظیمات', primary: true, onClick: function () { location.hash = '#/settings'; } }] });
      return;
    }
    var steps = cs.reason === 'engine' ? ['موتور تحلیل پایتون را اجرا کنید (پوشه engine، فایل run.py) و در «تنظیمات» آدرس آن را بررسی کنید.'] : [];
    steps.push('بسته anthropic را روی موتور نصب کنید: pip install -r engine/requirements.txt');
    steps.push('کلید API را فقط روی رایانه موتور به‌صورت متغیر محیطی تعریف کنید؛ در ویندوز: setx ANTHROPIC_API_KEY "کلید شما" و سپس موتور را دوباره اجرا کنید.');
    steps.push('کلید هرگز در مرورگر یا فایل‌های برنامه ذخیره نمی‌شود؛ برنامه فقط نتایج تجمیعی ابزارها را از طریق موتور به Claude می‌فرستد.');
    UI.modal({ title: 'راه‌اندازی Claude', body: h('div', h('p', 'وضعیت فعلی: ' + cs.text), h('ol.agent-help', steps.map(function (s) { return h('li', s); }))), actions: [{ label: 'باشه', primary: true }] });
  }

  IBP.register('agent', { title: 'دستیار هوشمند', render: render });
})(window.IBP = window.IBP || {});
