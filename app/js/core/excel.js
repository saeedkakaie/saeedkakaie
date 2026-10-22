/*
 * خروجی و ورودی Excel (xlsx) با ExcelJS.
 * همه خروجی‌ها راست‌به‌چپ، با سرستون رنگی، قالب عددی، فیلتر خودکار و ردیف ثابت ساخته می‌شوند.
 */
(function (IBP) {
  'use strict';

  var F = IBP.fmt, J = IBP.jalali;

  var STYLE = {
    font: 'Tahoma',
    headerFill: 'FF1E3A8A',
    headerFont: 'FFFFFFFF',
    titleColor: 'FF0B1220',
    subColor: 'FF667085',
    zebra: 'FFF5F7FB',
    border: 'FFE4E8F0',
    requiredFill: 'FF0E7490'
  };
  var NUMFMT = {
    int: '#,##0', num: '#,##0', money: '#,##0', dec: '#,##0.00', dec4: '#,##0.0000', pct: '0.0%', pct0: '0%'
  };

  function available() { return !!window.ExcelJS; }
  function ensure() {
    if (!available()) throw new Error('کتابخانه Excel بارگذاری نشده است');
  }
  function newWorkbook() {
    ensure();
    var wb = new window.ExcelJS.Workbook();
    wb.creator = 'Integrated Business Planning';
    wb.created = new Date();
    return wb;
  }
  /** نام برگه مجاز Excel (حداکثر ۳۱ نویسه، بدون نویسه‌های غیرمجاز، یکتا) */
  function sheetName(wb, name) {
    var base = String(name || 'Sheet').replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31) || 'Sheet';
    var n = base, i = 2;
    while (wb.getWorksheet(n)) { var suf = ' (' + i++ + ')'; n = base.slice(0, 31 - suf.length) + suf; }
    return n;
  }
  function stamp() {
    var t = J.today();
    return t.jy + '-' + String(t.jm).padStart(2, '0') + '-' + String(t.jd).padStart(2, '0');
  }
  function save(wb, filename) {
    return wb.xlsx.writeBuffer().then(function (buf) {
      var name = /\.xlsx$/i.test(filename) ? filename : filename + ' ' + stamp() + '.xlsx';
      IBP.ui.download(name, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      return name;
    });
  }
  function borderAll(color) {
    var b = { style: 'thin', color: { argb: color || STYLE.border } };
    return { top: b, left: b, bottom: b, right: b };
  }
  function styleHeaderCell(cell, required) {
    cell.font = { name: STYLE.font, bold: true, color: { argb: STYLE.headerFont }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: required ? STYLE.requiredFill : STYLE.headerFill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true, readingOrder: 'rtl' };
    cell.border = borderAll('FF1E3A8A');
  }
  function colLetter(n) { var s = ''; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  /**
   * افزودن یک جدول تحلیلی به کتاب کار.
   * spec: { name, title, subtitle, columns:[{header, key, value(row), type, width, digits}], rows,
   *         cellStyle(row, col, value) → {fill: 'FFxxxxxx', color: 'FFxxxxxx', bold}, totals: [colKeys] }
   */
  function addTableSheet(wb, spec) {
    var ws = wb.addWorksheet(sheetName(wb, spec.name), { properties: { defaultRowHeight: 20 } });
    var cols = spec.columns;
    var r = 1;
    var settings = IBP.store ? IBP.store.settings() : {};
    ws.mergeCells(1, 1, 1, Math.max(cols.length, 2));
    var tc = ws.getCell(1, 1);
    tc.value = spec.title || spec.name;
    tc.font = { name: STYLE.font, bold: true, size: 14, color: { argb: STYLE.titleColor } };
    tc.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
    ws.getRow(1).height = 28;
    r = 2;
    var sub = [settings.companyName, spec.subtitle, 'تاریخ تهیه: ' + J.isoToJalaliStr(new Date().toISOString().slice(0, 10))].filter(Boolean).join('  •  ');
    ws.mergeCells(2, 1, 2, Math.max(cols.length, 2));
    var sc = ws.getCell(2, 1);
    sc.value = sub;
    sc.font = { name: STYLE.font, size: 9, color: { argb: STYLE.subColor } };
    sc.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    var headerRow = 4;
    var hr = ws.getRow(headerRow);
    cols.forEach(function (c, i) {
      var cell = hr.getCell(i + 1);
      cell.value = c.header;
      styleHeaderCell(cell, c.required);
    });
    hr.height = 30;
    var widths = cols.map(function (c) { return Math.max(8, String(c.header).length + 2); });
    spec.rows.forEach(function (row, ri) {
      var xr = ws.getRow(headerRow + 1 + ri);
      cols.forEach(function (c, ci) {
        var v = c.value ? c.value(row) : row[c.key];
        if (v === undefined || (typeof v === 'number' && !isFinite(v))) v = null;
        var cell = xr.getCell(ci + 1);
        cell.value = v;
        cell.font = { name: STYLE.font, size: 10 };
        cell.border = borderAll();
        cell.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'left' : 'right', readingOrder: 'rtl' };
        if (NUMFMT[c.type]) cell.numFmt = c.digits === 1 && c.type === 'num' ? '#,##0.0' : NUMFMT[c.type];
        if (c.type === 'text' || c.type === 'code') cell.numFmt = '@';
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STYLE.zebra } };
        if (spec.cellStyle) {
          var st = spec.cellStyle(row, c, v);
          if (st) {
            if (st.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
            if (st.color || st.bold) cell.font = { name: STYLE.font, size: 10, color: st.color ? { argb: st.color } : undefined, bold: !!st.bold };
          }
        }
        var len = v === null ? 0 : (typeof v === 'number' ? F.num(v).length + 2 : String(v).length);
        if (len > widths[ci]) widths[ci] = len;
      });
    });
    var last = headerRow + spec.rows.length;
    if (spec.totals && spec.rows.length) {
      var tr = ws.getRow(last + 1);
      tr.getCell(1).value = 'جمع';
      cols.forEach(function (c, ci) {
        var cell = tr.getCell(ci + 1);
        if (spec.totals.indexOf(c.key) >= 0) {
          var L = colLetter(ci + 1);
          cell.value = { formula: 'SUM(' + L + (headerRow + 1) + ':' + L + last + ')' };
          cell.numFmt = NUMFMT[c.type] || '#,##0';
        }
        cell.font = { name: STYLE.font, bold: true, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3EEFC' } };
        cell.border = borderAll();
      });
    }
    ws.columns.forEach(function (col, i) { if (i < cols.length) col.width = Math.min(60, (cols[i].width || widths[i]) + 2); });
    ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: headerRow, xSplit: spec.freezeCols || 0, showGridLines: false }];
    if (spec.rows.length) ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: last, column: cols.length } };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    return ws;
  }

  /** برگه «خلاصه» با جفت عنوان/مقدار */
  function addSummarySheet(wb, name, title, pairs) {
    return addTableSheet(wb, {
      name: name, title: title,
      columns: [{ header: 'شاخص', key: 'k', width: 38 }, { header: 'مقدار', key: 'v', width: 24 }, { header: 'توضیح', key: 'd', width: 48 }],
      rows: pairs.map(function (p) { return { k: p[0], v: p[1], d: p[2] || '' }; })
    });
  }

  /** تبدیل مشخصات جدول به داده ساده برای موتور پایتون */
  function toEnginePayload(spec) {
    var settings = IBP.store ? IBP.store.settings() : {};
    var sheets = [];
    if (spec.summary) {
      sheets.push({ name: spec.summary.name || 'خلاصه', title: spec.summary.title, columns: [{ header: 'شاخص' }, { header: 'مقدار' }, { header: 'توضیح' }],
        rows: spec.summary.pairs.map(function (p) { return [p[0], p[1], p[2] || '']; }) });
    }
    spec.sheets.forEach(function (s) {
      sheets.push({
        name: s.name, title: s.title,
        columns: s.columns.map(function (c) { return { header: c.header, type: c.type || 'text' }; }),
        rows: s.rows.map(function (row) {
          return s.columns.map(function (c) { var v = c.value ? c.value(row) : row[c.key]; return v === undefined || (typeof v === 'number' && !isFinite(v)) ? null : v; });
        }),
        charts: s.charts || []
      });
    });
    return { company: settings.companyName, subtitle: spec.subtitle || '', date: 'تاریخ تهیه: ' + J.isoToJalaliStr(new Date().toISOString().slice(0, 10)), sheets: sheets };
  }

  /**
   * خروجی Excel: spec = { filename, sheets:[tableSpec + charts], summary:{title, pairs} }
   * اگر موتور پایتون متصل باشد و برگه‌ها نمودار داشته باشند، فایل با نمودارهای بومی Excel ساخته می‌شود.
   */
  function exportTables(spec) {
    var wantsCharts = spec.sheets.some(function (s) { return s.charts && s.charts.length; });
    if (wantsCharts && IBP.engine && IBP.engine.online() && !spec.noEngine) {
      return IBP.engine.blob('/reports/xlsx', toEnginePayload(spec)).then(function (blob) {
        var name = spec.filename + ' ' + stamp() + '.xlsx';
        IBP.ui.download(name, blob);
        IBP.ui.toast('فایل Excel همراه با نمودار (موتور پایتون) ساخته شد', 'success');
        return name;
      }, function () { return exportTables(Object.assign({}, spec, { noEngine: true })); });
    }
    try {
      var wb = newWorkbook();
      if (spec.summary) addSummarySheet(wb, spec.summary.name || 'خلاصه', spec.summary.title, spec.summary.pairs);
      spec.sheets.forEach(function (s) { addTableSheet(wb, s); });
      return save(wb, spec.filename).then(function (name) { IBP.ui.toast('فایل Excel «' + name + '» ساخته شد', 'success'); return name; });
    } catch (e) {
      IBP.ui.toast(e.message, 'error');
      return Promise.reject(e);
    }
  }

  /* ---------------- خواندن ---------------- */
  function cellValue(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(function (t) { return t.text; }).join('');
      if (v.result !== undefined) return cellValue(v.result);
      if (v.text !== undefined) return v.text;
      if (v.error) return null;
      return null;
    }
    return v;
  }
  /** خواندن فایل xlsx یا csv → { name, sheets: [{ name, rows: [[...]] }] } */
  function readFile(file) {
    var isCsv = /\.(csv|txt)$/i.test(file.name);
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onerror = function () { reject(new Error('خواندن فایل ممکن نشد')); };
      rd.onload = function () {
        if (isCsv) {
          resolve({ name: file.name, sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows: IBP.csv.parse(rd.result) }] });
          return;
        }
        try { ensure(); } catch (e) { reject(e); return; }
        var wb = new window.ExcelJS.Workbook();
        wb.xlsx.load(rd.result).then(function () {
          var sheets = [];
          wb.eachSheet(function (ws) {
            if (ws.state === 'hidden' || ws.state === 'veryHidden') return;
            var rows = [];
            ws.eachRow({ includeEmpty: false }, function (row, rn) {
              var arr = [];
              for (var c = 1; c <= ws.columnCount; c++) arr.push(cellValue(row.getCell(c).value));
              rows[rn - 1] = arr;
            });
            for (var i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
            sheets.push({ name: ws.name, rows: rows });
          });
          resolve({ name: file.name, sheets: sheets });
        }).catch(function (e) { reject(new Error('فایل Excel معتبر نیست: ' + e.message)); });
      };
      if (isCsv) rd.readAsText(file, 'utf-8'); else rd.readAsArrayBuffer(file);
    });
  }

  IBP.excel = {
    STYLE: STYLE, NUMFMT: NUMFMT,
    available: available, newWorkbook: newWorkbook, sheetName: sheetName, save: save, stamp: stamp,
    addTableSheet: addTableSheet, addSummarySheet: addSummarySheet, exportTables: exportTables,
    styleHeaderCell: styleHeaderCell, borderAll: borderAll, colLetter: colLetter,
    readFile: readFile, cellValue: cellValue
  };
})(window.IBP = window.IBP || {});
