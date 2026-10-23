/*
 * ابزارهای رابط کاربری: ساخت عنصر، آیکون، پیام، پنجره محاوره، دانلود فایل.
 */
(function (IBP) {
  'use strict';

  /* ---------------- آیکون‌ها (خطی ۲۴×۲۴) ---------------- */
  var ICONS = {
    focus: '<path d="M4 9V5a1 1 0 0 1 1-1h4"/><path d="M15 4h4a1 1 0 0 1 1 1v4"/><path d="M20 15v4a1 1 0 0 1-1 1h-4"/><path d="M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.5"/>',
    dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    cycle: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    layers: '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 17.5 10 5 10-5" opacity=".5"/>',
    box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    factory: '<path d="M2 21h20"/><path d="M4 21V10l5 3V10l5 3V6l6 3v12"/><path d="M8 17h.01M12 17h.01M16 17h.01"/>',
    truck: '<path d="M3 6h11v10H3z"/><path d="M14 9h4l3 3v4h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    stack: '<rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><path d="M7 20h10"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.6-2.4-2.9-5.5-3"/>',
    scenario: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7"/><path d="M8.3 7.2 15.7 11"/><path d="M8.3 16.8 15.7 13"/>',
    review: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="m7 12 3-3 2 2 4-4"/>',
    report: '<path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/><path d="M9 17v-3M12 17v-6M15 17v-4"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="12" cy="3" r="1"/><path d="M9 14h.01M15 14h.01"/><path d="M2 13v3M22 13v3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.7c2 .7 3.2 2.6 3.5 5.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 20V9"/><path d="m7 14 5-5 5 5"/><path d="M4 4h16"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
    critical: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
    good: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    chevronLeft: '<path d="m15 6-6 6 6 6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h8"/>',
    flask: '<path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3"/><path d="M7 15h10"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
    share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    chart: '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="3" height="6" rx=".5"/><rect x="12" y="7" width="3" height="10" rx=".5"/><rect x="17" y="13" width="3" height="4" rx=".5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.9 3"/><path d="M20 20v-4h-4"/>',
    sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z"/>',
    warehouse: '<path d="M3 21V9l9-5 9 5v12"/><path d="M7 21v-8h10v8"/><path d="M7 17h10"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    excel: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6"/><path d="m9 12 5 6M14 12l-5 6"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    command: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z"/>',
    cloud: '<path d="M7 18a5 5 0 0 1-.9-9.9A6 6 0 0 1 17.7 9 4.5 4.5 0 0 1 17.5 18"/><path d="M12 12v8M9 15l3-3 3 3"/>',
    cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    wand: '<path d="m15 4 5 5L9 20l-5-5L15 4Z"/><path d="m13 6 5 5"/><path d="M4 4h.01M7 2v2M2 7h2"/>',
    scatter: '<path d="M4 20V4M4 20h16"/><circle cx="9" cy="14" r="1.8"/><circle cx="14" cy="9" r="2.6"/><circle cx="18" cy="15" r="1.4"/>',
    pie: '<path d="M21 12A9 9 0 1 1 12 3v9h9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15V3.5Z"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    play: '<path d="M7 4v16l13-8L7 4Z"/>',
    python: '<path d="M12 3c-4 0-4 1.8-4 3v2h4.5v1H6c-2 0-3 1.5-3 4s1 4 3 4h1.5v-2.5c0-1.5 1.2-2.5 2.5-2.5h4.5c1.4 0 2.5-1 2.5-2.5V6c0-1.6-1.8-3-5.5-3Z"/><path d="M12 21c4 0 4-1.8 4-3v-2h-4.5v-1H18c2 0 3-1.5 3-4s-1-4-3-4h-1.5"/><path d="M10 5.5h.01M14 18.5h.01"/>'
  };

  function icon(name, size) {
    size = size || 18;
    return '<svg class="ic" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.info) + '</svg>';
  }

  /** ساخت عنصر: h('div.card#id', {attrs}, children...) */
  function h(tag, attrs) {
    var m = tag.match(/^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i) || [];
    var el = document.createElement(m[1] || 'div');
    (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, t, v) { if (t === '.') el.classList.add(v); else el.id = v; });
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    kids.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) return append(el, c);
      el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
  }

  /* ---------------- پیام کوتاه ---------------- */
  function toast(msg, kind) {
    var host = document.getElementById('toasts');
    if (!host) return;
    kind = kind || 'info';
    var ic = { info: 'info', success: 'good', error: 'critical', warning: 'alert' }[kind] || 'info';
    var el = h('div.toast.toast-' + kind, { role: 'status', html: icon(ic, 18) + '<span>' + IBP.fmt.escape(msg) + '</span>' });
    host.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, kind === 'error' ? 6000 : 3200);
  }

  /* ---------------- پنجره محاوره ---------------- */
  function modal(opts) {
    var prevFocus = document.activeElement;
    var overlay = h('div.modal-overlay' + (opts.overlayClass ? '.' + opts.overlayClass : ''));
    var box = h('div.modal' + (opts.size ? '.modal-' + opts.size : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title || '' });
    var close = function () {
      overlay.classList.add('out');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { overlay.remove(); if (prevFocus && prevFocus.focus) prevFocus.focus(); }, 150);
      if (opts.onClose) opts.onClose();
    };
    var onKey = function (e) { if (e.key === 'Escape') close(); };
    var head = h('div.modal-head', h('h3', opts.title || ''), h('button.icon-btn', { type: 'button', 'aria-label': 'بستن', html: icon('x'), onclick: close }));
    var body = h('div.modal-body');
    if (opts.body) body.appendChild(opts.body.nodeType ? opts.body : h('div', { html: opts.body }));
    var foot = h('div.modal-foot');
    (opts.actions || []).forEach(function (a) {
      foot.appendChild(h('button.btn' + (a.primary ? '.btn-primary' : '') + (a.danger ? '.btn-danger' : ''), {
        type: 'button', onclick: function () { var r = a.onClick ? a.onClick(close) : null; if (r !== false && !a.keepOpen) close(); }
      }, a.label));
    });
    box.appendChild(head); box.appendChild(body);
    if (opts.actions && opts.actions.length) box.appendChild(foot);
    overlay.appendChild(box);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    setTimeout(function () {
      var f = box.querySelector('input:not([type=hidden]),select,textarea,button.btn-primary');
      if (f) f.focus();
    }, 30);
    return { close: close, body: body, box: box };
  }

  function confirm(msg, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      modal({
        title: opts.title || 'تأیید',
        body: '<p class="confirm-text">' + IBP.fmt.escape(msg) + '</p>',
        size: 'sm',
        onClose: function () { if (!done) resolve(false); },
        actions: [
          { label: 'انصراف' },
          { label: opts.ok || 'تأیید', primary: !opts.danger, danger: !!opts.danger, onClick: function () { done = true; resolve(true); } }
        ]
      });
    });
  }

  /* ---------------- فایل ---------------- */
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    // نسخه اندروید: پیوند دانلود در WebView کار نمی‌کند؛ فایل از طریق پل برنامه در پوشه Downloads ذخیره می‌شود
    if (window.IBPAndroid && window.IBPAndroid.saveFile) {
      var rd = new FileReader();
      rd.onload = function () { window.IBPAndroid.saveFile(filename, blob.type || mime || 'application/octet-stream', String(rd.result).split(',')[1] || ''); };
      rd.readAsDataURL(blob);
      return;
    }
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function pickFile(accept) {
    return new Promise(function (resolve) {
      var inp = h('input', { type: 'file', accept: accept || '' });
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return resolve(null);
        var rd = new FileReader();
        rd.onload = function () { resolve({ name: f.name, text: rd.result }); };
        rd.readAsText(f, 'utf-8');
      });
      inp.click();
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms || 200); };
  }

  /** نشان وضعیت با آیکون و برچسب (رنگ هرگز تنها حامل معنا نیست) */
  function statusBadge(level, label) {
    var ic = { critical: 'critical', warning: 'alert', good: 'good', ok: 'good', info: 'info', excess: 'stack', neutral: 'clock' }[level] || 'info';
    return '<span class="badge badge-' + level + '">' + icon(ic, 14) + '<span>' + IBP.fmt.escape(label) + '</span></span>';
  }

  /* ---------------- کارت ---------------- */
  /**
   * opts: { title, sub, icon, span, flush, exportFn, exportLabel, tools:[elements], cls }
   * خروجی: { el, body, tools, head }
   */
  function card(opts) {
    opts = opts || {};
    // توضیح بلند زیر عنوان به‌جای متن، در نشانه ⓘ (با نگه داشتن نشانگر) نمایش داده می‌شود
    var longSub = !!(opts.sub && String(opts.sub).length > 48);
    var body = h('div.card-body' + (opts.flush ? '.flush' : ''));
    var tools = h('div.card-tools');
    var head = h('div.card-head',
      opts.icon ? h('div.card-icon', { html: icon(opts.icon, 17) }) : null,
      h('div', h('h3.card-title', opts.title || '', longSub ? h('span.card-info', { title: opts.sub, 'aria-label': opts.sub, html: icon('info', 14) }) : null), opts.sub && !longSub ? h('div.card-sub', opts.sub) : null),
      tools);
    (opts.tools || []).forEach(function (t) { tools.appendChild(t); });
    if (opts.exportFn) tools.appendChild(excelIconButton(opts.exportFn, opts.exportLabel));
    var el = h('section.card' + (opts.span ? '.span-' + opts.span : '') + (opts.cls ? '.' + opts.cls : ''), head, body);
    // دکمه تمرکز: نمایش همین تحلیل در صفحه کامل با انیمیشن
    if (opts.focus !== false && IBP.motion) {
      tools.appendChild(h('button.icon-btn.focus-btn', { type: 'button', title: 'تمرکز روی این تحلیل', 'aria-label': 'تمرکز روی ' + (opts.title || 'تحلیل'), html: icon('focus', 16), onclick: function () { IBP.motion.focus(el); } }));
    }
    return { el: el, body: body, tools: tools, head: head };
  }
  function excelIconButton(fn, label) {
    var b = h('button.icon-btn.excel', { type: 'button', title: label || 'خروجی Excel', 'aria-label': label || 'خروجی Excel', html: icon('excel', 17) });
    b.addEventListener('click', function () { busy(b, fn); });
    return b;
  }
  function excelButton(label, fn, opts) {
    opts = opts || {};
    var b = h('button.btn.btn-excel' + (opts.primary ? '.btn-primary' : '') + (opts.small ? '.btn-sm' : ''), { type: 'button', html: icon('excel', 16) + '<span>' + (label || 'خروجی Excel') + '</span>' });
    b.addEventListener('click', function () { busy(b, fn); });
    return b;
  }
  /** غیرفعال کردن دکمه تا پایان یک عملیات (Promise) */
  function busy(btn, fn) {
    if (btn.disabled) return;
    btn.disabled = true;
    Promise.resolve().then(fn).catch(function (e) { console.error(e); toast(e && e.message ? e.message : String(e), 'error'); })
      .then(function () { btn.disabled = false; });
  }

  /** کارت شاخص با شمارنده متحرک. opts: { icon, label, value(number), format(n), text(string), unit, foot(html), spark(html) } */
  function kpi(opts) {
    var valEl = h('div.kpi-value');
    var el = h('div.card.kpi.hoverable',
      h('div.kpi-top', h('div.kpi-icon', { html: icon(opts.icon || 'chart', 17) }), h('div.kpi-label', opts.label), opts.spark ? h('span', { html: opts.spark, style: { marginInlineStart: 'auto' } }) : null),
      valEl,
      h('div.kpi-foot', { html: opts.foot || '' }));
    var unit = opts.unit ? '<small>' + IBP.fmt.escape(opts.unit) + '</small>' : '';
    if (typeof opts.value === 'number' && isFinite(opts.value) && opts.format) countUp(valEl, opts.value, opts.format, unit);
    else valEl.innerHTML = (opts.text !== undefined ? IBP.fmt.escape(opts.text) : '—') + unit;
    return el;
  }
  function countUp(el, to, fmt, suffixHtml) {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dur = 900, t0 = null;
    suffixHtml = suffixHtml || '';
    if (reduce || !window.requestAnimationFrame) { el.innerHTML = IBP.fmt.escape(fmt(to)) + suffixHtml; return; }
    function step(ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.innerHTML = IBP.fmt.escape(fmt(to * e)) + suffixHtml;
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /** عنوان صفحه. opts: { title, desc, actions:[elements], badge(html) } */
  function pageHead(opts) {
    return h('div.page-head',
      h('div', h('h2', { html: IBP.fmt.escape(opts.title) + (opts.badge ? ' ' + opts.badge : '') })),
      h('div.actions', opts.actions || []));
  }

  /* ---------------- منوی کشویی ---------------- */
  var openPop = null;
  function closePopover() { if (openPop) { openPop.remove(); openPop = null; document.removeEventListener('mousedown', popOutside); document.removeEventListener('keydown', popKey); } }
  function popOutside(e) { if (openPop && !openPop.contains(e.target) && !openPop._anchor.contains(e.target)) closePopover(); }
  function popKey(e) { if (e.key === 'Escape') closePopover(); }
  function popover(anchor, content) {
    if (openPop && openPop._anchor === anchor) { closePopover(); return null; }
    closePopover();
    var p = h('div.popover', { role: 'dialog' }, content);
    p._anchor = anchor;
    document.body.appendChild(p);
    var r = anchor.getBoundingClientRect();
    p.style.top = (r.bottom + 8) + 'px';
    p.style.left = Math.max(12, Math.min(r.left, window.innerWidth - p.offsetWidth - 12)) + 'px';
    openPop = p;
    setTimeout(function () { document.addEventListener('mousedown', popOutside); document.addEventListener('keydown', popKey); }, 0);
    return p;
  }

  /* ---------------- ثبت ماژول‌ها (صفحه‌ها) ---------------- */
  IBP.modules = IBP.modules || {};
  IBP.register = function (name, def) { IBP.modules[name] = def; };

  IBP.ui = {
    h: h, icon: icon, ICONS: ICONS, toast: toast, modal: modal, confirm: confirm, download: download, pickFile: pickFile, debounce: debounce, statusBadge: statusBadge,
    card: card, kpi: kpi, countUp: countUp, pageHead: pageHead, excelButton: excelButton, excelIconButton: excelIconButton, busy: busy,
    popover: popover, closePopover: closePopover
  };
})(window.IBP = window.IBP || {});
