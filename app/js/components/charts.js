/*
 * کتابخانه نمودار SVG بدون وابستگی خارجی (برای اجرای آفلاین در نسخه ویندوز).
 * محور زمان نمودارها چپ به راست است (عرف نمودارهای زمانی)، متن‌ها فارسی.
 * رنگ‌ها از متغیرهای CSS خوانده می‌شوند تا حالت روشن و تیره خودکار اعمال شود.
 * انیمیشن‌ها با prefers-reduced-motion غیرفعال می‌شوند (در CSS).
 * تعامل: راهنمای شناور، کلیک روی راهنما برای پنهان/نمایان کردن سری، برچسب اعداد (دکمه ۱۲۳)،
 * بزرگ‌نمایی با کشیدن روی نمودار خطی، و کلیک روی ستون/میله/حباب برای جزئیات (onClick).
 */
(function (IBP) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var tipEl = null, gradSeq = 0;

  function svg(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    return el;
  }
  function text(x, y, str, attrs) {
    var t = svg('text', Object.assign({ x: x, y: y }, attrs || {}));
    t.textContent = str;
    return t;
  }
  function seriesColor(i) { return 'var(--series-' + ((i % 8) + 1) + ')'; }
  /** رنگ واقعی یک متغیر CSS (برای گرادیان SVG که var را در stop-color همه‌جا نمی‌پذیرد) */
  function resolveColor(c) {
    var m = /^var\((--[\w-]+)\)$/.exec(c || '');
    if (!m) return c;
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#3987e5';
  }
  function animateLine(path) {
    try {
      var len = path.getTotalLength();
      if (len > 0) { path.style.setProperty('--len', len); path.classList.add('line-path'); }
    } catch (e) { /* SVG هنوز در صفحه نیست */ }
  }

  /* ---------------- راهنمای شناور ---------------- */
  function tip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'chart-tip';
      tipEl.setAttribute('role', 'tooltip');
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  /** rows: [{label, value, color, dash}] */
  function showTip(evt, title, rows) {
    var t = tip();
    t.textContent = '';
    if (title) { var hd = document.createElement('div'); hd.className = 'tip-title'; hd.textContent = title; t.appendChild(hd); }
    rows.forEach(function (r) {
      var row = document.createElement('div'); row.className = 'tip-row';
      if (r.color) { var k = document.createElement('span'); k.className = 'tip-key' + (r.dash ? ' dash' : ''); k.style.setProperty('--c', r.color); row.appendChild(k); }
      var v = document.createElement('strong'); v.textContent = r.value; row.appendChild(v);
      var l = document.createElement('span'); l.className = 'tip-label'; l.textContent = r.label; row.appendChild(l);
      t.appendChild(row);
    });
    t.classList.add('show');
    var x = evt.clientX, y = evt.clientY, w = t.offsetWidth, hgt = t.offsetHeight;
    var left = x + 14; if (left + w > window.innerWidth - 8) left = x - w - 14;
    var top = y - hgt - 12; if (top < 8) top = y + 16;
    t.style.left = Math.max(8, left) + 'px'; t.style.top = top + 'px';
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

  /* ---------------- مقیاس ---------------- */
  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / count)));
    var err = (count * step) / span;
    if (err <= 0.15) step *= 10; else if (err <= 0.35) step *= 5; else if (err <= 0.75) step *= 2;
    var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
    for (var v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e9) / 1e9);
    return ticks;
  }

  /* ---------------- برچسب اعداد و نوار ابزار نمودار ---------------- */
  var LABEL_KEY = 'ibp-chart-labels';
  function labelsOn() { try { return localStorage.getItem(LABEL_KEY) !== '0'; } catch (e) { return true; } }
  function setLabels(on) { try { localStorage.setItem(LABEL_KEY, on ? '1' : '0'); } catch (e) { /* اختیاری */ } }
  /** برچسب عددی با هاله (خوانا روی خطوط و میله‌ها) */
  function dataLabel(x, y, str, anchor, cls) {
    return text(x, y, str, { class: 'data-label' + (cls ? ' ' + cls : ''), 'text-anchor': anchor || 'middle' });
  }
  /** جلوگیری از هم‌پوشانی برچسب‌ها (جعبه تقریبی) */
  function placer() {
    var boxes = [];
    return function (x, y, str, anchor) {
      var w = String(str).length * 6.2 + 4, x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      var b = { x0: x0, x1: x0 + w, y0: y - 11, y1: y + 2 };
      if (boxes.some(function (o) { return b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0; })) return false;
      boxes.push(b);
      return true;
    };
  }
  /** نوار ابزار کوچک: نمایش/پنهان برچسب اعداد و بازگشت از بزرگ‌نمایی */
  function toolbar(container, redraw, extra) {
    var tb = document.createElement('div');
    tb.className = 'chart-tools';
    var lb = document.createElement('button');
    lb.type = 'button'; lb.className = 'chart-tool' + (labelsOn() ? ' on' : '');
    lb.title = labelsOn() ? 'پنهان کردن برچسب اعداد' : 'نمایش برچسب اعداد';
    lb.setAttribute('aria-pressed', labelsOn() ? 'true' : 'false');
    lb.textContent = '۱۲۳';
    lb.addEventListener('click', function () { setLabels(!labelsOn()); redraw(); });
    tb.appendChild(lb);
    (extra || []).forEach(function (b) { tb.appendChild(b); });
    container.appendChild(tb);
  }

  /** راهنمای سری‌ها؛ با کلیک هر سری پنهان/نمایان می‌شود */
  function legend(items, onToggle) {
    var lg = document.createElement('div');
    lg.className = 'chart-legend';
    items.forEach(function (it) {
      var s = document.createElement(onToggle ? 'button' : 'span'); s.className = 'lg-item' + (it.off ? ' off' : '');
      if (onToggle) {
        s.type = 'button';
        s.title = it.off ? 'نمایش «' + it.label + '»' : 'پنهان کردن «' + it.label + '»';
        s.setAttribute('aria-pressed', it.off ? 'false' : 'true');
        s.addEventListener('click', function () { onToggle(it.label); });
      }
      var k = document.createElement('span'); k.className = 'lg-key ' + (it.shape || 'line') + (it.dash ? ' dash' : '');
      k.style.setProperty('--c', it.color);
      var l = document.createElement('span'); l.textContent = it.label;
      s.appendChild(k); s.appendChild(l); lg.appendChild(s);
    });
    return lg;
  }
  function hiddenSet(container) { return container._hidden || (container._hidden = {}); }
  function toggler(container, redraw) {
    return function (name) { var hs = hiddenSet(container); hs[name] = !hs[name]; redraw(); };
  }

  /** اجرای مجدد نمودار با تغییر اندازه */
  function responsive(container, draw) {
    draw(true);
    if (container._ro) container._ro.disconnect();
    var lastW = container.clientWidth;
    if (window.ResizeObserver) {
      container._ro = new ResizeObserver(function () {
        if (Math.abs(container.clientWidth - lastW) > 4) { lastW = container.clientWidth; draw(false); }
      });
      container._ro.observe(container);
    }
  }

  /* ================= نمودار خطی ================= */
  /**
   * opts: { labels: [], series: [{name, values, color, dash, area, endDot, noLabels}], format(v), tipFormat, labelFormat, height,
   *         markIndex, markLabel, dataLabels: 'auto'|'all'|'ends'|false, zoom: true, onClick(i) }
   * کشیدن موس روی نمودار یک بازه را بزرگ‌نمایی می‌کند؛ دوبار کلیک یا دکمه «کل دوره» بازمی‌گرداند.
   */
  function line(container, opts) {
    container._zoom = null;
    var draw = function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      var hs = hiddenSet(container);
      var allSeries = opts.series.filter(function (s) { return s.values.some(function (v) { return v !== null && v !== undefined; }); });
      var redraw = function () { draw(false); };
      if (allSeries.length > 1) container.appendChild(legend(allSeries.map(function (s, i) { return { label: s.name, color: s.color || seriesColor(i), dash: s.dash, off: !!hs[s.name] }; }), toggler(container, redraw)));
      var z = container._zoom, zi0 = z ? z[0] : 0, zi1 = z ? z[1] : opts.labels.length - 1;
      var labels = opts.labels.slice(zi0, zi1 + 1), tipLabels = opts.tipLabels ? opts.tipLabels.slice(zi0, zi1 + 1) : null;
      var series = allSeries.map(function (s, si) { return { s: s, si: si }; }).filter(function (x) { return !hs[x.s.name]; })
        .map(function (x) { return Object.assign({}, x.s, { values: x.s.values.slice(zi0, zi1 + 1), _ci: x.si }); });
      var extra = [];
      if (z) {
        var rb = document.createElement('button'); rb.type = 'button'; rb.className = 'chart-tool'; rb.textContent = 'کل دوره';
        rb.addEventListener('click', function () { container._zoom = null; redraw(); });
        extra.push(rb);
      }
      toolbar(container, redraw, extra);
      var W = Math.max(280, container.clientWidth), H = opts.height || 260;
      var m = { t: 18, r: 18, b: 30, l: 58 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var all = [];
      series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
      if (!all.length) all = [0, 1];
      var ymin = Math.min(0, Math.min.apply(null, all)), ymax = Math.max.apply(null, all);
      var ticks = niceTicks(ymin, ymax * 1.08, 4);
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var n = labels.length;
      var X = function (i) { return m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1)); };
      var Y = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };
      var fmt = opts.format || IBP.fmt.compact, lfmt = opts.labelFormat || fmt;
      var markIndex = opts.markIndex !== undefined && opts.markIndex !== null && opts.markIndex >= zi0 && opts.markIndex <= zi1 + 1 ? opts.markIndex - zi0 : null;

      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': opts.title || '' });
      var defs = svg('defs'); root.appendChild(defs);
      if (markIndex !== null) {
        var bx = X(markIndex);
        root.appendChild(svg('rect', { x: bx, y: m.t, width: Math.max(0, W - m.r - bx), height: ih, class: 'mark-band' }));
      }
      ticks.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, fmt(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
      labels.forEach(function (lb, i) {
        if (i % every !== 0) return;
        root.appendChild(text(X(i), H - 8, lb, { class: 'tick', 'text-anchor': 'middle' }));
      });
      if (markIndex !== null) {
        var mx = X(markIndex);
        root.appendChild(svg('line', { x1: mx, x2: mx, y1: m.t, y2: m.t + ih, class: 'mark-line' }));
        if (opts.markLabel) root.appendChild(text(mx + 6, m.t + 11, opts.markLabel, { class: 'tick mark-text', 'text-anchor': 'start' }));
      }
      var paths = [], labelLayer = svg('g', { class: animate ? 'labels-in' : null }), place = placer();
      var mode = opts.dataLabels === undefined ? 'auto' : opts.dataLabels;
      series.forEach(function (s, k) {
        var col = s.color || seriesColor(s._ci);
        var segs = [], cur = [];
        s.values.forEach(function (v, i) {
          if (v === null || v === undefined) { if (cur.length) segs.push(cur); cur = []; } else cur.push([X(i), Y(v)]);
        });
        if (cur.length) segs.push(cur);
        segs.forEach(function (pts) {
          var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
          if (s.area && pts.length > 1) {
            var gid = 'g' + (++gradSeq), rc = resolveColor(col);
            var lg = svg('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 });
            lg.appendChild(svg('stop', { offset: '0%', 'stop-color': rc, 'stop-opacity': 0.2 }));
            lg.appendChild(svg('stop', { offset: '100%', 'stop-color': rc, 'stop-opacity': 0 }));
            defs.appendChild(lg);
            root.appendChild(svg('path', { d: d + 'L' + pts[pts.length - 1][0] + ' ' + Y(Math.max(0, y0)) + 'L' + pts[0][0] + ' ' + Y(Math.max(0, y0)) + 'Z', fill: 'url(#' + gid + ')', stroke: 'none', class: animate ? 'fade-in' : null }));
          }
          var p = svg('path', { d: d, fill: 'none', stroke: col, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? '5 4' : null });
          root.appendChild(p);
          if (!s.dash && animate) paths.push(p);
        });
        var idxs = []; s.values.forEach(function (v, i) { if (v !== null && v !== undefined) idxs.push(i); });
        var last = idxs.length ? idxs[idxs.length - 1] : -1;
        if (last >= 0 && s.endDot !== false) root.appendChild(svg('circle', { cx: X(last), cy: Y(s.values[last]), r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2, class: animate ? 'fade-in' : null }));
        // برچسب اعداد: همه نقاط (سری کوتاه) یا آخرین نقطه و بیشینه/کمینه
        if (!labelsOn() || mode === false || s.noLabels || s.dash || !idxs.length) return;
        var pick;
        if (mode === 'all' || (mode === 'auto' && idxs.length <= 14 && k < 3)) pick = idxs;
        else {
          var vmax = idxs[0], vmin = idxs[0];
          idxs.forEach(function (i) { if (s.values[i] > s.values[vmax]) vmax = i; if (s.values[i] < s.values[vmin]) vmin = i; });
          pick = mode === 'ends' ? [idxs[0], last] : [last, vmax, vmin];
        }
        pick.forEach(function (i) {
          var v = s.values[i], above = k % 2 === 0, x = X(i), y = Y(v) + (above ? -9 : 17);
          var anchor = i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle';
          var str = lfmt(v);
          if (place(x, y, str, anchor)) labelLayer.appendChild(dataLabel(x, y, str, anchor));
        });
      });
      root.appendChild(labelLayer);
      var cross = svg('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
      root.appendChild(cross);
      var sel = svg('rect', { y: m.t, height: ih, class: 'zoom-sel', visibility: 'hidden' });
      root.appendChild(sel);
      var dots = series.map(function (s) { var c = svg('circle', { r: 4.5, fill: s.color || seriesColor(s._ci), stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }); root.appendChild(c); return c; });
      var hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0, class: opts.zoom === false ? null : 'zoomable' });
      root.appendChild(hit);
      function idxAt(e) {
        var r = root.getBoundingClientRect();
        var px = (e.clientX - r.left) * (W / r.width);
        return Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
      }
      function at(i, evt) {
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        var rows = [];
        series.forEach(function (s, si) {
          var v = s.values[i];
          if (v === null || v === undefined) { dots[si].setAttribute('visibility', 'hidden'); return; }
          dots[si].setAttribute('cx', X(i)); dots[si].setAttribute('cy', Y(v)); dots[si].setAttribute('visibility', 'visible');
          rows.push({ label: s.name, value: (opts.tipFormat || fmt)(v), color: s.color || seriesColor(s._ci), dash: s.dash });
        });
        showTip(evt, tipLabels ? tipLabels[i] : labels[i], rows);
      }
      var drag = null;
      hit.addEventListener('pointerdown', function (e) { if (opts.zoom === false || n < 6) return; drag = idxAt(e); try { hit.setPointerCapture(e.pointerId); } catch (er) { /* */ } });
      hit.addEventListener('pointermove', function (e) {
        var i = idxAt(e);
        at(i, e);
        if (drag !== null && i !== drag) {
          var a = Math.min(drag, i), b = Math.max(drag, i);
          sel.setAttribute('x', X(a)); sel.setAttribute('width', Math.max(1, X(b) - X(a))); sel.setAttribute('visibility', 'visible');
        }
      });
      hit.addEventListener('pointerup', function (e) {
        if (drag === null) return;
        var i = idxAt(e), a = Math.min(drag, i), b = Math.max(drag, i);
        drag = null; sel.setAttribute('visibility', 'hidden');
        if (b - a >= 2) { container._zoom = [zi0 + a, zi0 + b]; hideTip(); redraw(); }
        else if (opts.onClick) opts.onClick(zi0 + i);
      });
      hit.addEventListener('dblclick', function () { if (container._zoom) { container._zoom = null; redraw(); } });
      hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); hideTip(); });
      container.appendChild(root);
      paths.forEach(animateLine);
    };
    responsive(container, draw);
  }

  /* ================= میله‌ای افقی (رتبه‌بندی) ================= */
  /** opts: { items: [{label, value, color, sub, id}], format, max, valueLabel, onClick(item), active } */
  function hbars(container, opts) {
    container.textContent = '';
    container.classList.add('chart', 'hbars');
    var fmt = opts.format || IBP.fmt.compact;
    var vals = opts.items.map(function (i) { return Math.abs(i.value); });
    var max = opts.max || Math.max.apply(null, vals.concat([0])) || 1;
    opts.items.forEach(function (it, i) {
      var row = document.createElement('div'); row.className = 'hb-row' + (opts.onClick ? ' clickable' : '') + (opts.active && opts.active === (it.id || it.label) ? ' active' : ''); row.tabIndex = 0;
      var lb = document.createElement('div'); lb.className = 'hb-label'; lb.textContent = it.label; lb.title = it.label;
      var track = document.createElement('div'); track.className = 'hb-track';
      var bar = document.createElement('div'); bar.className = 'hb-bar';
      bar.style.width = Math.max(0.5, (Math.abs(it.value) / max) * 100) + '%';
      bar.style.background = it.color || opts.color || seriesColor(0);
      bar.style.animationDelay = (i * 0.04) + 's';
      track.appendChild(bar);
      var val = document.createElement('div'); val.className = 'hb-value'; val.textContent = fmt(it.value);
      row.appendChild(lb); row.appendChild(track); row.appendChild(val);
      var rows = [{ label: opts.valueLabel || 'مقدار', value: fmt(it.value), color: it.color || opts.color || seriesColor(0) }];
      (it.sub || []).forEach(function (s) { rows.push(s); });
      row.addEventListener('pointermove', function (e) { showTip(e, it.label, rows); });
      row.addEventListener('pointerleave', hideTip);
      if (opts.onClick) {
        row.addEventListener('click', function () { hideTip(); opts.onClick(it); });
        row.addEventListener('keydown', function (e) { if (e.key === 'Enter') opts.onClick(it); });
      }
      container.appendChild(row);
    });
  }

  /* ================= ستونی (با خطوط هم‌محور اختیاری) ================= */
  /**
   * opts: { labels, series:[{name, values, color, colors}], lines:[{name, values, color, dash}], format, labelFormat, height,
   *         refLine:{value,label}, stacked, tipTitles, maxValue, dataLabels (پیش‌فرض true), onClick(index, seriesIndex), active }
   */
  function columns(container, opts) {
    var draw = function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      var hs = hiddenSet(container), redraw = function () { draw(false); };
      var lgItems = opts.series.map(function (s, i) { return { label: s.name, color: s.color || seriesColor(i), shape: 'rect', off: !!hs[s.name] }; })
        .concat((opts.lines || []).map(function (l, i) { return { label: l.name, color: l.color || seriesColor(opts.series.length + i), dash: l.dash, off: !!hs[l.name] }; }));
      if (lgItems.length > 1) container.appendChild(legend(lgItems, toggler(container, redraw)));
      toolbar(container, redraw);
      var series = opts.series.map(function (s, i) { return Object.assign({}, s, { _ci: i }); }).filter(function (s) { return !hs[s.name]; });
      var lines = (opts.lines || []).map(function (l, i) { return Object.assign({}, l, { _ci: opts.series.length + i }); }).filter(function (l) { return !hs[l.name]; });
      var W = Math.max(280, container.clientWidth), H = opts.height || 240;
      var m = { t: 20, r: 12, b: 30, l: 52 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b, n = opts.labels.length, k = Math.max(1, series.length);
      var fmt = opts.format || IBP.fmt.compact, lfmt = opts.labelFormat || fmt;
      var maxV = 0, minV = 0;
      for (var i = 0; i < n; i++) {
        var tot = 0;
        series.forEach(function (s) { var v = s.values[i] || 0; if (opts.stacked) tot += Math.max(0, v); else tot = Math.max(tot, v); minV = Math.min(minV, v); });
        lines.forEach(function (l) { tot = Math.max(tot, l.values[i] || 0); });
        maxV = Math.max(maxV, tot);
      }
      if (opts.refLine) maxV = Math.max(maxV, opts.refLine.value);
      if (opts.maxValue) maxV = Math.max(maxV, opts.maxValue);
      var ticks = niceTicks(minV < 0 ? minV * 1.08 : 0, maxV * 1.1 || 1, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var Y = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };
      var band = iw / n;
      var groupW = Math.min(band * 0.74, opts.stacked ? 26 : 26 * k + 2 * (k - 1));
      var barW = opts.stacked ? groupW : Math.max(1, Math.min(26, (groupW - 2 * (k - 1)) / k));
      var showLabels = labelsOn() && opts.dataLabels !== false && barW >= 9 && n <= 40;
      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
      ticks.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, fmt(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      var labelLayer = svg('g', { class: animate ? 'labels-in' : null }), place = placer();
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
      for (var j = 0; j < n; j++) {
        var cx = m.l + band * j + band / 2;
        if (j % every === 0) root.appendChild(text(cx, H - 8, opts.labels[j], { class: 'tick', 'text-anchor': 'middle' }));
        if (opts.active !== undefined && opts.active === j) root.appendChild(svg('rect', { x: m.l + band * j, y: m.t, width: band, height: ih, class: 'col-active' }));
        var acc = 0;
        series.forEach(function (s, si) {
          var v = s.values[j] || 0;
          if (v === 0) return;
          var x = opts.stacked ? cx - barW / 2 : cx - groupW / 2 + si * (barW + 2);
          var yTop = v >= 0 ? Y(acc + v) : Y(0), yBot = v >= 0 ? Y(acc) : Y(v);
          var hgt = Math.max(1, yBot - yTop - (opts.stacked && acc > 0 ? 2 : 0));
          var col = (s.colors && s.colors[j]) || s.color || seriesColor(s._ci);
          var r = Math.min(4, barW / 2, hgt);
          var isTop = v > 0 && (!opts.stacked || !series.slice(si + 1).some(function (o) { return (o.values[j] || 0) > 0; }));
          var d = isTop
            ? 'M' + x + ' ' + (yTop + hgt) + 'V' + (yTop + r) + 'Q' + x + ' ' + yTop + ' ' + (x + r) + ' ' + yTop + 'H' + (x + barW - r) + 'Q' + (x + barW) + ' ' + yTop + ' ' + (x + barW) + ' ' + (yTop + r) + 'V' + (yTop + hgt) + 'Z'
            : 'M' + x + ' ' + (yTop + hgt) + 'V' + yTop + 'H' + (x + barW) + 'V' + (yTop + hgt) + 'Z';
          var p = svg('path', { d: d, fill: col, class: 'col-bar' + (animate ? ' grow' : '') + (opts.onClick ? ' clickable' : ''), tabindex: 0 });
          if (animate) p.style.animationDelay = Math.min(0.5, j * 0.02) + 's';
          (function (jj, vv, nm, cc, sIdx) {
            p.addEventListener('pointermove', function (e) {
              var rows = [{ label: nm, value: (opts.tipFormat || fmt)(vv), color: cc }];
              lines.forEach(function (l) { if (l.values[jj] !== null && l.values[jj] !== undefined) rows.push({ label: l.name, value: (opts.tipFormat || fmt)(l.values[jj]), color: l.color || seriesColor(l._ci), dash: l.dash }); });
              showTip(e, opts.tipTitles ? opts.tipTitles[jj] : opts.labels[jj], rows);
            });
            p.addEventListener('pointerleave', hideTip);
            if (opts.onClick) p.addEventListener('click', function () { hideTip(); opts.onClick(jj, sIdx); });
          })(j, v, s.name, col, s._ci);
          root.appendChild(p);
          if (showLabels && !opts.stacked && (k <= 2 || barW >= 16)) {
            var ly = v >= 0 ? yTop - 4 : yBot + 12, str = lfmt(v);
            if (place(x + barW / 2, ly, str, 'middle')) labelLayer.appendChild(dataLabel(x + barW / 2, ly, str, 'middle'));
          }
          if (opts.stacked) acc += v;
        });
        if (showLabels && opts.stacked && acc > 0) {
          var sy = Y(acc) - 4, sstr = lfmt(acc);
          if (place(cx, sy, sstr, 'middle')) labelLayer.appendChild(dataLabel(cx, sy, sstr, 'middle'));
        }
      }
      lines.forEach(function (l) {
        var col = l.color || seriesColor(l._ci);
        var pts = l.values.map(function (v, jj) { return v === null || v === undefined ? null : [m.l + band * jj + band / 2, Y(v)]; }).filter(Boolean);
        var d = pts.map(function (p, ii) { return (ii ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
        var path = svg('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': l.dash ? '5 4' : null });
        root.appendChild(path);
        if (animate && !l.dash) setTimeout(function () { animateLine(path); }, 0);
        var lastPt = pts[pts.length - 1];
        if (lastPt) root.appendChild(svg('circle', { cx: lastPt[0], cy: lastPt[1], r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2 }));
      });
      if (opts.refLine) {
        var ry = Y(opts.refLine.value);
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: ry, y2: ry, class: 'ref-line' }));
        if (opts.refLine.label) root.appendChild(text(W - m.r, ry - 5, opts.refLine.label, { class: 'tick', 'text-anchor': 'end' }));
      }
      root.appendChild(labelLayer);
      container.appendChild(root);
    };
    responsive(container, draw);
  }

  /* ================= آبشاری (پل تغییرات) ================= */
  /**
   * opts: { items:[{label, value, total:boolean}], format, height }
   * ستون‌های total از صفر رسم می‌شوند؛ بقیه افزایش (سبز) یا کاهش (قرمز) نسبت به مقدار تجمعی.
   */
  function waterfall(container, opts) {
    var draw = function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      toolbar(container, function () { draw(false); });
      var items = opts.items, n = items.length, fmt = opts.format || IBP.fmt.compact;
      var W = Math.max(280, container.clientWidth), H = opts.height || 260;
      var m = { t: 22, r: 12, b: 44, l: 56 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
      var cum = 0, bars = [], lo = 0, hi = 0;
      items.forEach(function (it) {
        var a, b;
        if (it.total) { a = 0; b = it.value; cum = it.value; } else { a = cum; b = cum + it.value; cum = b; }
        bars.push({ a: a, b: b, it: it });
        lo = Math.min(lo, a, b); hi = Math.max(hi, a, b);
      });
      var ticks = niceTicks(lo, hi * 1.08 || 1, 4), y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var Y = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };
      var band = iw / n, bw = Math.min(46, band * 0.62);
      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
      ticks.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, fmt(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      bars.forEach(function (b, i) {
        var cx = m.l + band * i + band / 2, top = Y(Math.max(b.a, b.b)), hgt = Math.max(1, Math.abs(Y(b.a) - Y(b.b)));
        var col = b.it.total ? 'var(--series-1)' : b.it.value >= 0 ? 'var(--good)' : 'var(--critical)';
        if (b.it.color) col = b.it.color;
        var r = svg('rect', { x: cx - bw / 2, y: top, width: bw, height: hgt, rx: 3, fill: col, class: 'col-bar' + (animate ? ' grow' : ''), tabindex: 0 });
        if (animate) r.style.animationDelay = (i * 0.06) + 's';
        r.addEventListener('pointermove', function (e) { showTip(e, b.it.label, [{ label: b.it.total ? 'مقدار' : 'تغییر', value: (b.it.total ? '' : b.it.value >= 0 ? '+' : '') + fmt(b.it.value), color: col }]); });
        r.addEventListener('pointerleave', hideTip);
        root.appendChild(r);
        if (i < n - 1) {
          var nx = m.l + band * (i + 1) + band / 2;
          root.appendChild(svg('line', { x1: cx + bw / 2, x2: nx - bw / 2, y1: Y(b.b), y2: Y(b.b), class: 'wf-link' }));
        }
        if (labelsOn()) root.appendChild(dataLabel(cx, top - 5, (b.it.total ? '' : b.it.value >= 0 ? '+' : '') + fmt(b.it.value), 'middle'));
        var lb = text(cx, H - 26, b.it.label, { class: 'tick', 'text-anchor': 'middle' });
        root.appendChild(lb);
      });
      container.appendChild(root);
    };
    responsive(container, draw);
  }

  /* ================= نقشه حرارتی ================= */
  /**
   * opts: { rows:[{id,label,sub}], cols:[{id,label}], value(row,col) → number|null, format, color(v,row,col) → css,
   *         title(row,col), onClick(row,col), best(row) → colId (هایلایت بهترین در هر سطر) }
   */
  function heatmap(container, opts) {
    container.textContent = '';
    container.classList.add('heatmap-wrap');
    var fmt = opts.format || IBP.fmt.num;
    var t = document.createElement('table'); t.className = 'heatmap';
    var thead = document.createElement('thead'), hr = document.createElement('tr');
    var th0 = document.createElement('th'); th0.className = 'hm-corner'; th0.textContent = opts.corner || ''; hr.appendChild(th0);
    opts.cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c.label; th.title = c.title || c.label; hr.appendChild(th); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = document.createElement('tbody');
    opts.rows.forEach(function (r, ri) {
      var tr = document.createElement('tr');
      var th = document.createElement('th'); th.innerHTML = IBP.fmt.escape(r.label) + (r.sub ? '<div class="cell-sub">' + IBP.fmt.escape(r.sub) + '</div>' : ''); tr.appendChild(th);
      var best = opts.best ? opts.best(r) : null;
      opts.cols.forEach(function (c, ci) {
        var td = document.createElement('td'), v = opts.value(r, c);
        if (v === null || v === undefined || !isFinite(v)) { td.className = 'hm-empty'; td.textContent = '—'; }
        else {
          td.textContent = fmt(v);
          td.style.background = opts.color ? opts.color(v, r, c) : '';
          td.style.animationDelay = Math.min(0.6, (ri + ci) * 0.012) + 's';
          if (best && best === c.id) td.classList.add('hm-best');
          td.tabIndex = 0;
          td.addEventListener('pointermove', function (e) { showTip(e, opts.title ? opts.title(r, c) : r.label + ' · ' + c.label, [{ label: opts.valueLabel || 'مقدار', value: fmt(v) }]); });
          td.addEventListener('pointerleave', hideTip);
          if (opts.onClick) { td.classList.add('clickable'); td.addEventListener('click', function () { hideTip(); opts.onClick(r, c); }); }
        }
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    container.appendChild(t);
  }
  /** رنگ ترتیبی (سبز → زرد → قرمز) برای مقدار v بین lo و hi؛ invert برای «بیشتر بهتر» */
  function scaleColor(v, lo, hi, invert) {
    var x = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0;
    if (invert) x = 1 - x;
    var hue = 145 - 140 * x;
    return 'hsl(' + hue.toFixed(0) + ' 70% 50% / ' + (0.14 + 0.32 * x).toFixed(2) + ')';
  }

  /* ================= پراکندگی / حبابی ================= */
  /**
   * opts: { points:[{x, y, size, color, label, id, rows:[{label,value}]}], xFormat, yFormat, xTitle, yTitle, height,
   *         quadrants:{x, y, labels:[topRight, topLeft, bottomLeft, bottomRight]}, legend:[{label,color}], onClick(point), highlight(point) }
   */
  function scatter(container, opts) {
    responsive(container, function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      if (opts.legend && opts.legend.length) container.appendChild(legend(opts.legend.map(function (l) { return { label: l.label, color: l.color, shape: 'dot' }; })));
      var W = Math.max(280, container.clientWidth), H = opts.height || 320;
      var m = { t: 16, r: 18, b: 44, l: 58 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var pts = opts.points.filter(function (p) { return isFinite(p.x) && isFinite(p.y) && p.x !== null && p.y !== null; });
      var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
      if (opts.quadrants) { xs.push(opts.quadrants.x); ys.push(opts.quadrants.y); }
      var xr = niceTicks(Math.min.apply(null, xs.concat([0])), Math.max.apply(null, xs.concat([0])), 5);
      var yr = niceTicks(Math.min.apply(null, ys.concat([0])), Math.max.apply(null, ys.concat([0])), 4);
      var x0 = xr[0], x1 = xr[xr.length - 1], y0 = yr[0], y1 = yr[yr.length - 1];
      var X = function (v) { return m.l + ((v - x0) / (x1 - x0)) * iw; };
      var Y = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };
      var maxS = Math.max.apply(null, pts.map(function (p) { return p.size || 0; }).concat([1]));
      var R = function (s) { return 5 + Math.sqrt(Math.max(0, s || 0) / maxS) * 19; };
      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
      yr.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, (opts.yFormat || IBP.fmt.compact)(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      xr.forEach(function (t) {
        root.appendChild(svg('line', { x1: X(t), x2: X(t), y1: m.t, y2: m.t + ih, class: 'grid' }));
        root.appendChild(text(X(t), m.t + ih + 16, (opts.xFormat || IBP.fmt.compact)(t), { class: 'tick', 'text-anchor': 'middle' }));
      });
      if (opts.xTitle) root.appendChild(text(m.l + iw / 2, H - 4, opts.xTitle, { class: 'axis-title', 'text-anchor': 'middle' }));
      if (opts.yTitle) { var yt = text(14, m.t + ih / 2, opts.yTitle, { class: 'axis-title', 'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (m.t + ih / 2) + ')' }); root.appendChild(yt); }
      if (opts.quadrants) {
        var qx = X(opts.quadrants.x), qy = Y(opts.quadrants.y), L = opts.quadrants.labels || [];
        root.appendChild(svg('line', { x1: qx, x2: qx, y1: m.t, y2: m.t + ih, class: 'ref-line' }));
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: qy, y2: qy, class: 'ref-line' }));
        if (L[0]) root.appendChild(text(W - m.r - 6, m.t + 14, L[0], { class: 'quad-text', 'text-anchor': 'end' }));
        if (L[1]) root.appendChild(text(m.l + 6, m.t + 14, L[1], { class: 'quad-text', 'text-anchor': 'start' }));
        if (L[2]) root.appendChild(text(m.l + 6, m.t + ih - 8, L[2], { class: 'quad-text', 'text-anchor': 'start' }));
        if (L[3]) root.appendChild(text(W - m.r - 6, m.t + ih - 8, L[3], { class: 'quad-text', 'text-anchor': 'end' }));
      }
      pts.slice().sort(function (a, b) { return (b.size || 0) - (a.size || 0); }).forEach(function (p, i) {
        var c = svg('circle', {
          cx: X(p.x), cy: Y(p.y), r: R(p.size), fill: p.color || seriesColor(0), 'fill-opacity': 0.72,
          stroke: 'var(--surface)', 'stroke-width': 2, class: 'bubble' + (animate ? ' pop-in' : ''), tabindex: 0
        });
        if (animate) c.style.animationDelay = Math.min(0.6, i * 0.015) + 's';
        c.addEventListener('pointermove', function (e) {
          showTip(e, p.label, [{ label: opts.xLabel || 'محور افقی', value: (opts.xFormat || IBP.fmt.compact)(p.x), color: p.color }, { label: opts.yLabel || 'محور عمودی', value: (opts.yFormat || IBP.fmt.compact)(p.y) }].concat(p.rows || []));
        });
        c.addEventListener('pointerleave', hideTip);
        if (opts.onClick) c.addEventListener('click', function () { opts.onClick(p); });
        root.appendChild(c);
      });
      if (labelsOn() && opts.labelTop) {
        var place = placer();
        pts.slice().sort(function (a, b) { return (b.size || 0) - (a.size || 0); }).slice(0, opts.labelTop).forEach(function (p) {
          var str = p.short || p.label || '', x = X(p.x), y = Y(p.y) - R(p.size) - 4;
          if (str.length > 18) str = str.slice(0, 17) + '…';
          if (place(x, y, str, 'middle')) root.appendChild(dataLabel(x, y, str, 'middle'));
        });
      }
      container.appendChild(root);
    });
  }

  /* ================= دونات ================= */
  /** opts: { items:[{label, value, color}], format, center:{value,label}, size, valueLabel } */
  function donut(container, opts) {
    container.textContent = '';
    container.classList.add('chart', 'donut-wrap');
    var total = opts.items.reduce(function (a, b) { return a + b.value; }, 0) || 1;
    var size = opts.size || 168, r = size / 2 - 4, inner = r - 22, cx = size / 2, cy = size / 2;
    var root = svg('svg', { width: size, height: size, viewBox: '0 0 ' + size + ' ' + size, class: 'chart-svg donut', role: 'img' });
    var a0 = -Math.PI / 2;
    var gap = opts.items.length > 1 ? 0.012 : 0;
    opts.items.forEach(function (it, i) {
      var frac = it.value / total, a1 = a0 + frac * Math.PI * 2;
      var s0 = a0 + gap, s1 = Math.max(s0 + 0.001, a1 - gap);
      var large = s1 - s0 > Math.PI ? 1 : 0;
      var p = function (rad, a) { return (cx + rad * Math.cos(a)).toFixed(2) + ' ' + (cy + rad * Math.sin(a)).toFixed(2); };
      var d = frac >= 0.9999
        ? 'M' + p(r, 0) + 'A' + r + ' ' + r + ' 0 1 1 ' + p(r, Math.PI) + 'A' + r + ' ' + r + ' 0 1 1 ' + p(r, 0) + 'M' + p(inner, 0) + 'A' + inner + ' ' + inner + ' 0 1 0 ' + p(inner, Math.PI) + 'A' + inner + ' ' + inner + ' 0 1 0 ' + p(inner, 0) + 'Z'
        : 'M' + p(r, s0) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p(r, s1) + 'L' + p(inner, s1) + 'A' + inner + ' ' + inner + ' 0 ' + large + ' 0 ' + p(inner, s0) + 'Z';
      var col = it.color || seriesColor(i);
      var path = svg('path', { d: d, fill: col, class: 'donut-seg pop-in', tabindex: 0, 'fill-rule': 'evenodd' });
      path.style.animationDelay = (i * 0.06) + 's';
      path.addEventListener('pointermove', function (e) {
        showTip(e, it.label, [{ label: 'سهم', value: IBP.fmt.pct(frac), color: col }, { label: opts.valueLabel || 'مقدار', value: (opts.format || IBP.fmt.compact)(it.value) }]);
      });
      path.addEventListener('pointerleave', hideTip);
      if (opts.onClick) { path.classList.add('clickable'); path.addEventListener('click', function () { hideTip(); opts.onClick(it); }); }
      root.appendChild(path);
      if (labelsOn() && frac >= 0.07 && !opts.center) {
        var am = (s0 + s1) / 2, rm = (r + inner) / 2;
        root.appendChild(dataLabel(cx + rm * Math.cos(am), cy + rm * Math.sin(am) + 4, IBP.fmt.pct(frac, 0), 'middle', 'on-fill'));
      }
      a0 = a1;
    });
    if (opts.center) {
      root.appendChild(text(cx, cy - 2, opts.center.value, { class: 'donut-value', 'text-anchor': 'middle' }));
      root.appendChild(text(cx, cy + 18, opts.center.label, { class: 'tick', 'text-anchor': 'middle' }));
    }
    container.appendChild(root);
    var lg = document.createElement('div'); lg.className = 'donut-legend';
    opts.items.forEach(function (it, i) {
      var row = document.createElement('div'); row.className = 'dl-row';
      var k = document.createElement('span'); k.className = 'lg-key rect'; k.style.setProperty('--c', it.color || seriesColor(i));
      var l = document.createElement('span'); l.className = 'dl-label'; l.textContent = it.label;
      var v = document.createElement('span'); v.className = 'dl-value'; v.textContent = IBP.fmt.pct(it.value / total, 0);
      row.appendChild(k); row.appendChild(l); row.appendChild(v); lg.appendChild(row);
    });
    container.appendChild(lg);
  }

  /* ================= خط کوچک ================= */
  function sparkline(values, opts) {
    opts = opts || {};
    var w = opts.width || 96, hgt = opts.height || 30, n = values.length;
    var vals = values.map(function (v) { return v || 0; });
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
    if (mx === mn) { mx = mn + 1; }
    var X = function (i) { return 2 + (i * (w - 6)) / Math.max(1, n - 1); };
    var Y = function (v) { return hgt - 4 - ((v - mn) / (mx - mn)) * (hgt - 8); };
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join('');
    var col = opts.color || 'var(--spark)';
    var gid = 'sp' + (++gradSeq);
    return '<svg class="spark" width="' + w + '" height="' + hgt + '" viewBox="0 0 ' + w + ' ' + hgt + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + gid + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="currentColor" stop-opacity=".22"/><stop offset="100%" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>' +
      '<g style="color:' + col + '"><path d="' + d + 'L' + X(n - 1).toFixed(1) + ' ' + hgt + 'L' + X(0).toFixed(1) + ' ' + hgt + 'Z" fill="url(#' + gid + ')"/>' +
      '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></g>' +
      '<circle cx="' + X(n - 1) + '" cy="' + Y(vals[n - 1]) + '" r="2.8" fill="var(--accent)" stroke="var(--surface)" stroke-width="1.5"/></svg>';
  }

  /* ================= حلقه پیشرفت ================= */
  function ring(value, opts) {
    opts = opts || {};
    var size = opts.size || 64, sw = opts.stroke || 7, r = (size - sw) / 2, c = 2 * Math.PI * r;
    var v = Math.max(0, Math.min(1, value || 0));
    var gid = 'rg' + (++gradSeq);
    var color = opts.color || null;
    return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px"><svg width="' + size + '" height="' + size + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="' + (opts.from || '#3b82f6') + '"/><stop offset="100%" stop-color="' + (opts.to || '#06b6d4') + '"/></linearGradient></defs>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (opts.track || 'var(--surface-3)') + '" stroke-width="' + sw + '"/>' +
      '<circle class="ring-arc" style="--c:' + c.toFixed(1) + '" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (color || 'url(#' + gid + ')') + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + (c * v).toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
      '</svg><div class="ring-v" style="font-size:' + (opts.fontSize || Math.round(size / 4.4)) + 'px">' + (opts.label || IBP.fmt.pct(v, 0)) + '</div></div>';
  }

  IBP.charts = { line: line, hbars: hbars, columns: columns, waterfall: waterfall, heatmap: heatmap, scaleColor: scaleColor, labelsOn: labelsOn, scatter: scatter, donut: donut, sparkline: sparkline, ring: ring, showTip: showTip, hideTip: hideTip, niceTicks: niceTicks, seriesColor: seriesColor, resolveColor: resolveColor };
})(window.IBP = window.IBP || {});
