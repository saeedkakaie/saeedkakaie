/*
 * جدول داده: جستجو، فیلتر، مرتب‌سازی، صفحه‌بندی، انتخاب گروهی و عملیات سطری.
 */
(function (IBP) {
  'use strict';

  var h = IBP.ui.h, icon = IBP.ui.icon, F = IBP.fmt;

  /**
   * opts: {
   *   columns: [{ key, label, render(row) → html, value(row) → sortable, align, width, text(row) → string برای جستجو }],
   *   rows: () → array, pageSize, onRowClick(row), actions: [{icon, label, onClick(row), danger}],
   *   filters: [{ label, options:[{value,label}], test(row, value) }], toolbar: [elements],
   *   selectable, bulkActions: [{label, icon, danger, onClick(rows)}], empty, sortKey, sortDir
   * }
   */
  function grid(container, opts) {
    var state = { q: '', page: 0, size: opts.pageSize || 25, sort: opts.sortKey || null, dir: opts.sortDir || 1, filters: {}, selected: new Set() };
    var root = h('div.grid');
    var search = h('input.search-input', { type: 'search', placeholder: 'جستجو…', 'aria-label': 'جستجو' });
    var filterEls = (opts.filters || []).map(function (f, i) {
      var sel = h('select', { 'aria-label': f.label });
      sel.appendChild(h('option', { value: '' }, f.label + ': همه'));
      f.options.forEach(function (o) { sel.appendChild(h('option', { value: o.value }, o.label)); });
      sel.addEventListener('change', function () { state.filters[i] = sel.value; state.page = 0; render(); });
      return sel;
    });
    var bulkBar = h('div.bulk-bar');
    var toolbar = h('div.grid-toolbar',
      h('div.search-box', { html: icon('search', 16) }, search),
      filterEls,
      h('div.spacer'),
      bulkBar,
      opts.toolbar || []
    );
    var tableWrap = h('div.table-wrap');
    var footer = h('div.grid-footer');
    root.appendChild(toolbar); root.appendChild(tableWrap); root.appendChild(footer);
    container.appendChild(root);

    search.addEventListener('input', IBP.ui.debounce(function () { state.q = F.toLatinDigits(search.value.trim()).toLowerCase(); state.page = 0; render(); }, 180));

    function cellText(col, row) {
      if (col.text) return col.text(row);
      var v = col.value ? col.value(row) : row[col.key];
      return v === null || v === undefined ? '' : String(v);
    }
    function filtered() {
      var rows = opts.rows();
      (opts.filters || []).forEach(function (f, i) {
        var v = state.filters[i];
        if (v) rows = rows.filter(function (r) { return f.test(r, v); });
      });
      if (state.q) {
        var q = state.q;
        rows = rows.filter(function (r) {
          return opts.columns.some(function (c) { return F.toLatinDigits(cellText(c, r)).toLowerCase().indexOf(q) >= 0; });
        });
      }
      if (state.sort) {
        var col = opts.columns.filter(function (c) { return c.key === state.sort; })[0];
        if (col) {
          var val = col.value || function (r) { return r[col.key]; };
          rows = rows.slice().sort(function (a, b) {
            var x = val(a), y = val(b);
            if (x === y) return 0;
            if (x === null || x === undefined || x === '') return 1;
            if (y === null || y === undefined || y === '') return -1;
            if (typeof x === 'number' && typeof y === 'number') return (x - y) * state.dir;
            return String(x).localeCompare(String(y), 'fa') * state.dir;
          });
        }
      }
      return rows;
    }

    function renderBulk() {
      bulkBar.textContent = '';
      if (!opts.selectable || !state.selected.size) return;
      bulkBar.appendChild(h('span.muted', F.num(state.selected.size) + ' مورد انتخاب شده'));
      (opts.bulkActions || []).forEach(function (a) {
        bulkBar.appendChild(h('button.btn.btn-sm' + (a.danger ? '.btn-danger-ghost' : ''), {
          type: 'button', html: icon(a.icon || 'check', 15) + '<span>' + a.label + '</span>',
          onclick: function () {
            var all = opts.rows(), set = state.selected;
            Promise.resolve(a.onClick(all.filter(function (r) { return set.has(r.id); }))).then(function (done) {
              if (done !== false) { state.selected = new Set(); render(); }
            });
          }
        }));
      });
    }

    function render() {
      var rows = filtered();
      var pages = Math.max(1, Math.ceil(rows.length / state.size));
      if (state.page >= pages) state.page = pages - 1;
      var slice = rows.slice(state.page * state.size, (state.page + 1) * state.size);
      var table = h('table.data-table');
      var thead = h('thead'), tr = h('tr');
      if (opts.selectable) {
        var allCb = h('input', { type: 'checkbox', 'aria-label': 'انتخاب همه' });
        allCb.checked = slice.length > 0 && slice.every(function (r) { return state.selected.has(r.id); });
        allCb.addEventListener('change', function () { slice.forEach(function (r) { if (allCb.checked) state.selected.add(r.id); else state.selected.delete(r.id); }); render(); });
        tr.appendChild(h('th.cb', allCb));
      }
      opts.columns.forEach(function (c) {
        var sortable = c.sortable !== false;
        var th = h('th' + (c.align === 'num' ? '.num' : ''), { style: c.width ? { width: c.width + 'px' } : null, 'aria-sort': state.sort === c.key ? (state.dir > 0 ? 'ascending' : 'descending') : null });
        if (sortable) {
          th.appendChild(h('button.th-sort', {
            type: 'button', onclick: function () {
              if (state.sort === c.key) state.dir = -state.dir; else { state.sort = c.key; state.dir = c.align === 'num' ? -1 : 1; }
              render();
            }
          }, c.label, h('span.sort-ind', state.sort === c.key ? (state.dir > 0 ? '▲' : '▼') : '')));
        } else th.textContent = c.label;
        tr.appendChild(th);
      });
      if (opts.actions && opts.actions.length) tr.appendChild(h('th.actions-col', ''));
      thead.appendChild(tr); table.appendChild(thead);
      var tbody = h('tbody');
      if (!slice.length) {
        tbody.appendChild(h('tr', h('td.empty', { colspan: opts.columns.length + 2 }, opts.empty || 'رکوردی یافت نشد')));
      }
      slice.forEach(function (r) {
        var row = h('tr' + (opts.onRowClick ? '.clickable' : ''));
        if (opts.selectable) {
          var cb = h('input', { type: 'checkbox', 'aria-label': 'انتخاب' });
          cb.checked = state.selected.has(r.id);
          cb.addEventListener('click', function (e) { e.stopPropagation(); });
          cb.addEventListener('change', function () { if (cb.checked) state.selected.add(r.id); else state.selected.delete(r.id); renderBulk(); });
          row.appendChild(h('td.cb', cb));
        }
        opts.columns.forEach(function (c) {
          var td = h('td' + (c.align === 'num' ? '.num' : '') + (c.cls ? '.' + c.cls : ''));
          if (c.render) td.innerHTML = c.render(r); else td.textContent = cellText(c, r);
          row.appendChild(td);
        });
        if (opts.actions && opts.actions.length) {
          var td = h('td.actions-col');
          opts.actions.forEach(function (a) {
            td.appendChild(h('button.icon-btn' + (a.danger ? '.danger' : ''), {
              type: 'button', title: a.label, 'aria-label': a.label, html: icon(a.icon, 16),
              onclick: function (e) { e.stopPropagation(); a.onClick(r); }
            }));
          });
          row.appendChild(td);
        }
        if (opts.onRowClick) row.addEventListener('click', function () { opts.onRowClick(r); });
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      tableWrap.textContent = '';
      tableWrap.appendChild(table);

      // پاورقی و صفحه‌بندی
      footer.textContent = '';
      var from = rows.length ? state.page * state.size + 1 : 0, to = Math.min(rows.length, (state.page + 1) * state.size);
      footer.appendChild(h('span.muted', F.num(from) + '–' + F.num(to) + ' از ' + F.num(rows.length) + ' رکورد'));
      var sizeSel = h('select.page-size', { 'aria-label': 'تعداد در صفحه' });
      [10, 25, 50, 100].forEach(function (n) { sizeSel.appendChild(h('option', { value: n }, n + ' در صفحه')); });
      sizeSel.value = state.size;
      sizeSel.addEventListener('change', function () { state.size = +sizeSel.value; state.page = 0; render(); });
      var pager = h('div.pager',
        h('button.icon-btn', { type: 'button', 'aria-label': 'صفحه قبل', disabled: state.page === 0 ? true : null, html: icon('chevronRight', 16), onclick: function () { state.page--; render(); } }),
        h('span', F.num(state.page + 1) + ' / ' + F.num(pages)),
        h('button.icon-btn', { type: 'button', 'aria-label': 'صفحه بعد', disabled: state.page >= pages - 1 ? true : null, html: icon('chevronLeft', 16), onclick: function () { state.page++; render(); } })
      );
      footer.appendChild(h('div.spacer'));
      footer.appendChild(sizeSel);
      footer.appendChild(pager);
      renderBulk();
    }

    render();
    return { refresh: render, state: state, filtered: filtered, el: root };
  }

  IBP.grid = grid;
})(window.IBP = window.IBP || {});
