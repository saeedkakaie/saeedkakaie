/*
 * کتابخانه نمودار SVG بدون وابستگی خارجی (برای اجرای آفلاین در نسخه ویندوز).
 * محور زمان نمودارها چپ به راست است (عرف نمودارهای زمانی)، متن‌ها فارسی.
 * رنگ‌ها از متغیرهای CSS خوانده می‌شوند تا حالت روشن و تیره خودکار اعمال شود.
 * انیمیشن‌ها با prefers-reduced-motion غیرفعال می‌شوند (در CSS).
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

  function legend(items) {
    var lg = document.createElement('div');
    lg.className = 'chart-legend';
    items.forEach(function (it) {
      var s = document.createElement('span'); s.className = 'lg-item';
      var k = document.createElement('span'); k.className = 'lg-key ' + (it.shape || 'line') + (it.dash ? ' dash' : '');
      k.style.setProperty('--c', it.color);
      var l = document.createElement('span'); l.textContent = it.label;
      s.appendChild(k); s.appendChild(l); lg.appendChild(s);
    });
    return lg;
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
   * opts: { labels: [], series: [{name, values, color, dash, area, endDot}], format(v), tipFormat, height, markIndex, markLabel }
   */
  function line(container, opts) {
    responsive(container, function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      var series = opts.series.filter(function (s) { return s.values.some(function (v) { return v !== null && v !== undefined; }); });
      if (series.length > 1) container.appendChild(legend(series.map(function (s, i) { return { label: s.name, color: s.color || seriesColor(i), dash: s.dash }; })));
      var W = Math.max(280, container.clientWidth), H = opts.height || 260;
      var m = { t: 14, r: 16, b: 30, l: 58 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b;
      var all = [];
      series.forEach(function (s) { s.values.forEach(function (v) { if (v !== null && v !== undefined) all.push(v); }); });
      var ymin = Math.min(0, Math.min.apply(null, all)), ymax = Math.max.apply(null, all);
      var ticks = niceTicks(ymin, ymax * 1.05, 4);
      var y0 = ticks[0], y1 = ticks[ticks.length - 1];
      var n = opts.labels.length;
      var X = function (i) { return m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1)); };
      var Y = function (v) { return m.t + ih - ((v - y0) / (y1 - y0)) * ih; };
      var fmt = opts.format || IBP.fmt.compact;

      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img', 'aria-label': opts.title || '' });
      var defs = svg('defs'); root.appendChild(defs);
      if (opts.markIndex !== undefined && opts.markIndex !== null) {
        var bx = X(opts.markIndex);
        root.appendChild(svg('rect', { x: bx, y: m.t, width: Math.max(0, W - m.r - bx), height: ih, class: 'mark-band' }));
      }
      ticks.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, fmt(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
      opts.labels.forEach(function (lb, i) {
        if (i % every !== 0) return;
        root.appendChild(text(X(i), H - 8, lb, { class: 'tick', 'text-anchor': 'middle' }));
      });
      if (opts.markIndex !== undefined && opts.markIndex !== null) {
        var mx = X(opts.markIndex);
        root.appendChild(svg('line', { x1: mx, x2: mx, y1: m.t, y2: m.t + ih, class: 'mark-line' }));
        if (opts.markLabel) root.appendChild(text(mx + 6, m.t + 11, opts.markLabel, { class: 'tick mark-text', 'text-anchor': 'start' }));
      }
      var paths = [];
      series.forEach(function (s, si) {
        var col = s.color || seriesColor(si);
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
            lg.appendChild(svg('stop', { offset: '0%', 'stop-color': rc, 'stop-opacity': 0.18 }));
            lg.appendChild(svg('stop', { offset: '100%', 'stop-color': rc, 'stop-opacity': 0 }));
            defs.appendChild(lg);
            root.appendChild(svg('path', { d: d + 'L' + pts[pts.length - 1][0] + ' ' + Y(Math.max(0, y0)) + 'L' + pts[0][0] + ' ' + Y(Math.max(0, y0)) + 'Z', fill: 'url(#' + gid + ')', stroke: 'none', class: animate ? 'fade-in' : null }));
          }
          var p = svg('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? '5 4' : null });
          root.appendChild(p);
          if (!s.dash && animate) paths.push(p);
        });
        var last = -1; s.values.forEach(function (v, i) { if (v !== null && v !== undefined) last = i; });
        if (last >= 0 && s.endDot !== false) root.appendChild(svg('circle', { cx: X(last), cy: Y(s.values[last]), r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2, class: animate ? 'fade-in' : null }));
      });
      var cross = svg('line', { y1: m.t, y2: m.t + ih, class: 'crosshair', visibility: 'hidden' });
      root.appendChild(cross);
      var dots = series.map(function (s, si) { var c = svg('circle', { r: 4.5, fill: s.color || seriesColor(si), stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }); root.appendChild(c); return c; });
      var hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0 });
      root.appendChild(hit);
      function at(i, evt) {
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        var rows = [];
        series.forEach(function (s, si) {
          var v = s.values[i];
          if (v === null || v === undefined) { dots[si].setAttribute('visibility', 'hidden'); return; }
          dots[si].setAttribute('cx', X(i)); dots[si].setAttribute('cy', Y(v)); dots[si].setAttribute('visibility', 'visible');
          rows.push({ label: s.name, value: (opts.tipFormat || fmt)(v), color: s.color || seriesColor(si), dash: s.dash });
        });
        showTip(evt, opts.tipLabels ? opts.tipLabels[i] : opts.labels[i], rows);
      }
      hit.addEventListener('pointermove', function (e) {
        var r = root.getBoundingClientRect();
        var px = (e.clientX - r.left) * (W / r.width);
        var i = Math.round(((px - m.l) / iw) * (n - 1));
        at(Math.max(0, Math.min(n - 1, i)), e);
      });
      hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); hideTip(); });
      container.appendChild(root);
      paths.forEach(animateLine);
    });
  }

  /* ================= میله‌ای افقی (رتبه‌بندی) ================= */
  /** opts: { items: [{label, value, color, sub}], format, max, valueLabel } */
  function hbars(container, opts) {
    container.textContent = '';
    container.classList.add('chart', 'hbars');
    var fmt = opts.format || IBP.fmt.compact;
    var max = opts.max || Math.max.apply(null, opts.items.map(function (i) { return i.value; })) || 1;
    opts.items.forEach(function (it, i) {
      var row = document.createElement('div'); row.className = 'hb-row'; row.tabIndex = 0;
      var lb = document.createElement('div'); lb.className = 'hb-label'; lb.textContent = it.label;
      var track = document.createElement('div'); track.className = 'hb-track';
      var bar = document.createElement('div'); bar.className = 'hb-bar';
      bar.style.width = Math.max(0.5, (it.value / max) * 100) + '%';
      bar.style.background = it.color || opts.color || seriesColor(0);
      bar.style.animationDelay = (i * 0.04) + 's';
      track.appendChild(bar);
      var val = document.createElement('div'); val.className = 'hb-value'; val.textContent = fmt(it.value);
      row.appendChild(lb); row.appendChild(track); row.appendChild(val);
      var rows = [{ label: opts.valueLabel || 'مقدار', value: fmt(it.value), color: it.color || opts.color || seriesColor(0) }];
      (it.sub || []).forEach(function (s) { rows.push(s); });
      row.addEventListener('pointermove', function (e) { showTip(e, it.label, rows); });
      row.addEventListener('pointerleave', hideTip);
      container.appendChild(row);
    });
  }

  /* ================= ستونی (با خطوط هم‌محور اختیاری) ================= */
  /** opts: { labels, series:[{name, values, color, colors}], lines:[{name, values, color}], format, height, refLine:{value,label}, stacked, tipTitles, maxValue } */
  function columns(container, opts) {
    responsive(container, function (animate) {
      container.textContent = '';
      container.classList.add('chart');
      var lgItems = opts.series.map(function (s, i) { return { label: s.name, color: s.color || seriesColor(i), shape: 'rect' }; })
        .concat((opts.lines || []).map(function (l, i) { return { label: l.name, color: l.color || seriesColor(opts.series.length + i) }; }));
      if (lgItems.length > 1) container.appendChild(legend(lgItems));
      var W = Math.max(280, container.clientWidth), H = opts.height || 240;
      var m = { t: 14, r: 12, b: 30, l: 52 };
      var iw = W - m.l - m.r, ih = H - m.t - m.b, n = opts.labels.length, k = opts.series.length;
      var fmt = opts.format || IBP.fmt.compact;
      var maxV = 0;
      for (var i = 0; i < n; i++) {
        var tot = 0;
        opts.series.forEach(function (s) { var v = s.values[i] || 0; if (opts.stacked) tot += v; else tot = Math.max(tot, v); });
        (opts.lines || []).forEach(function (l) { tot = Math.max(tot, l.values[i] || 0); });
        maxV = Math.max(maxV, tot);
      }
      if (opts.refLine) maxV = Math.max(maxV, opts.refLine.value);
      if (opts.maxValue) maxV = Math.max(maxV, opts.maxValue);
      var ticks = niceTicks(0, maxV * 1.04, 4), y1 = ticks[ticks.length - 1];
      var Y = function (v) { return m.t + ih - (v / y1) * ih; };
      var band = iw / n;
      var groupW = Math.min(band * 0.72, opts.stacked ? 24 : 24 * k + 2 * (k - 1));
      var barW = opts.stacked ? groupW : Math.max(1, Math.min(24, (groupW - 2 * (k - 1)) / k));
      var root = svg('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg', role: 'img' });
      ticks.forEach(function (t) {
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'axis' : 'grid' }));
        root.appendChild(text(m.l - 8, Y(t) + 4, fmt(t), { class: 'tick', 'text-anchor': 'end' }));
      });
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
      for (var j = 0; j < n; j++) {
        var cx = m.l + band * j + band / 2;
        if (j % every === 0) root.appendChild(text(cx, H - 8, opts.labels[j], { class: 'tick', 'text-anchor': 'middle' }));
        var acc = 0;
        opts.series.forEach(function (s, si) {
          var v = s.values[j] || 0;
          if (v <= 0) return;
          var x = opts.stacked ? cx - barW / 2 : cx - groupW / 2 + si * (barW + 2);
          var yTop = Y(acc + v), yBot = Y(acc);
          var hgt = Math.max(1, yBot - yTop - (opts.stacked && acc > 0 ? 2 : 0));
          var col = (s.colors && s.colors[j]) || s.color || seriesColor(si);
          var r = Math.min(4, barW / 2, hgt);
          var isTop = !opts.stacked || !opts.series.slice(si + 1).some(function (o) { return (o.values[j] || 0) > 0; });
          var d = isTop
            ? 'M' + x + ' ' + (yTop + hgt) + 'V' + (yTop + r) + 'Q' + x + ' ' + yTop + ' ' + (x + r) + ' ' + yTop + 'H' + (x + barW - r) + 'Q' + (x + barW) + ' ' + yTop + ' ' + (x + barW) + ' ' + (yTop + r) + 'V' + (yTop + hgt) + 'Z'
            : 'M' + x + ' ' + (yTop + hgt) + 'V' + yTop + 'H' + (x + barW) + 'V' + (yTop + hgt) + 'Z';
          var p = svg('path', { d: d, fill: col, class: 'col-bar' + (animate ? ' grow' : ''), tabindex: 0 });
          if (animate) p.style.animationDelay = Math.min(0.5, j * 0.02) + 's';
          (function (jj, vv, nm, cc) {
            p.addEventListener('pointermove', function (e) {
              var rows = [{ label: nm, value: (opts.tipFormat || fmt)(vv), color: cc }];
              (opts.lines || []).forEach(function (l, li) { if (l.values[jj] !== null && l.values[jj] !== undefined) rows.push({ label: l.name, value: (opts.tipFormat || fmt)(l.values[jj]), color: l.color || seriesColor(opts.series.length + li) }); });
              showTip(e, opts.tipTitles ? opts.tipTitles[jj] : opts.labels[jj], rows);
            });
            p.addEventListener('pointerleave', hideTip);
          })(j, v, s.name, col);
          root.appendChild(p);
          if (opts.stacked) acc += v;
        });
      }
      (opts.lines || []).forEach(function (l, li) {
        var col = l.color || seriesColor(opts.series.length + li);
        var pts = l.values.map(function (v, jj) { return v === null || v === undefined ? null : [m.l + band * jj + band / 2, Y(v)]; }).filter(Boolean);
        var d = pts.map(function (p, ii) { return (ii ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('');
        var path = svg('path', { d: d, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round' });
        root.appendChild(path);
        if (animate) setTimeout(function () { animateLine(path); }, 0);
        var lastPt = pts[pts.length - 1];
        if (lastPt) root.appendChild(svg('circle', { cx: lastPt[0], cy: lastPt[1], r: 4, fill: col, stroke: 'var(--surface)', 'stroke-width': 2 }));
      });
      if (opts.refLine) {
        var ry = Y(opts.refLine.value);
        root.appendChild(svg('line', { x1: m.l, x2: W - m.r, y1: ry, y2: ry, class: 'ref-line' }));
        if (opts.refLine.label) root.appendChild(text(W - m.r, ry - 5, opts.refLine.label, { class: 'tick', 'text-anchor': 'end' }));
      }
      container.appendChild(root);
    });
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
      root.appendChild(path);
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
      '<defs><linearGradient id="' + gid + '" x1="0" x2="1" y1="0" y2="1"><stop offset="0%" stop-color="#3b82f6"/><stop offset="100%" stop-color="#06b6d4"/></linearGradient></defs>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--surface-3)" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + (color || 'url(#' + gid + ')') + '" stroke-width="' + sw + '" stroke-linecap="round" stroke-dasharray="' + (c * v).toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
      '</svg><div class="ring-v" style="font-size:' + (opts.fontSize || Math.round(size / 4.4)) + 'px">' + (opts.label || IBP.fmt.pct(v, 0)) + '</div></div>';
  }

  IBP.charts = { line: line, hbars: hbars, columns: columns, scatter: scatter, donut: donut, sparkline: sparkline, ring: ring, showTip: showTip, hideTip: hideTip, niceTicks: niceTicks, seriesColor: seriesColor, resolveColor: resolveColor };
})(window.IBP = window.IBP || {});
