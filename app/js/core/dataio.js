/*
 * ورود و خروج داده‌ها بر اساس الگو.
 *
 *  - buildTemplate : ساخت کتاب کار Excel الگو (خالی، با داده فعلی یا با داده نمونه یک صنعت)
 *                    با برگه راهنما، فهرست کشویی برای فیلدهای انتخابی و ارجاع‌ها، و توضیح هر ستون
 *  - plan          : خواندن برگه‌ها، تشخیص موجودیت، اعتبارسنجی همه ردیف‌ها به ترتیب وابستگی
 *                    (بدون تغییر داده؛ برای پیش‌نمایش)
 *  - apply         : اعمال برنامه ورود (ادغام یا جایگزینی)
 */
(function (IBP) {
  'use strict';

  var S = IBP.store, SC = IBP.schema, F = IBP.fmt, J = IBP.jalali, X = IBP.excel;

  var TYPE_LABEL = {
    text: 'متن', textarea: 'متن', number: 'عدد', money: 'مبلغ (عدد)', percent: 'درصد', select: 'انتخابی',
    ref: 'کد ارجاع', bool: 'بله/خیر', color: 'رنگ (مثل #2a78d6)', date: 'تاریخ شمسی ۱۴۰۵/۰۷/۱۵', period: 'ماه شمسی ۱۴۰۵/۰۷'
  };
  var GUIDE_SHEET = 'راهنما';
  var LISTS_SHEET = 'lists';

  function refCode(entity, id) {
    var r = S.get(entity, id);
    return r ? (r.code !== undefined && r.code !== null && r.code !== '' ? String(r.code) : S.name(entity, id)) : '';
  }
  /** مقدار قابل نوشتن در Excel برای یک فیلد */
  function outValue(f, v, lookup) {
    if (v === null || v === undefined || v === '') return null;
    switch (f.type) {
      case 'ref': return lookup ? lookup(f.ref, v) : refCode(f.ref, v);
      case 'date': return J.isoToJalaliStr(v) || null;
      case 'period': return J.year(v) + '/' + String(J.month(v)).padStart(2, '0');
      case 'bool': return v ? 'بله' : 'خیر';
      default: return v;
    }
  }

  /* ======================= الگوی Excel ======================= */
  /**
   * opts: { entities: [keys], data: null | 'current' | {entity: [records]}, title, filename }
   */
  function buildTemplate(opts) {
    opts = opts || {};
    var wb = X.newWorkbook();
    var keys = (opts.entities || SC.order()).filter(function (k) { return SC.entity(k); });
    var data = opts.data === 'current' ? null : opts.data;
    // جستجوی کد ارجاع در داده نمونه (داده‌ای که در store نیست)
    var idCode = null;
    if (data) {
      idCode = {};
      Object.keys(data).forEach(function (k) { (data[k] || []).forEach(function (r) { idCode[k + ':' + r.id] = r.code !== undefined ? String(r.code) : r.name; }); });
    }
    var lookup = idCode ? function (ent, id) { return idCode[ent + ':' + id] || ''; } : null;
    var g = wb.addWorksheet(GUIDE_SHEET);
    var sheetOf = {};
    keys.forEach(function (k) { sheetOf[k] = X.sheetName(wb, SC.entity(k).label); wb.addWorksheet(sheetOf[k]); });

    // برگه فهرست‌ها (مخفی) برای مقادیر انتخابی
    var lists = wb.addWorksheet(LISTS_SHEET, { state: 'hidden' });
    var listCol = 0, listRef = {};
    function listFor(options) {
      var sig = options.join('|');
      if (listRef[sig]) return listRef[sig];
      listCol++;
      options.forEach(function (o, i) { lists.getCell(i + 1, listCol).value = o; });
      var L = X.colLetter(listCol);
      listRef[sig] = LISTS_SHEET + '!$' + L + '$1:$' + L + '$' + options.length;
      return listRef[sig];
    }

    keys.forEach(function (k) {
      var def = SC.entity(k), ws = wb.getWorksheet(sheetOf[k]);
      var fields = def.fields;
      var rows = opts.rowsFor && opts.rowsFor[k] ? opts.rowsFor[k] : (data ? (data[k] || []) : (opts.data === 'current' ? S.all(k) : []));
      var maxRow = Math.max(500, rows.length + 200);
      fields.forEach(function (f, i) {
        var cell = ws.getCell(1, i + 1);
        cell.value = f.label + (f.required ? ' *' : '');
        X.styleHeaderCell(cell, f.required);
        var note = 'نوع: ' + TYPE_LABEL[f.type] + (f.required ? ' — الزامی' : '') + (f.unique ? ' — یکتا' : '');
        if (f.type === 'select') note += '\nمقادیر مجاز: ' + f.options.join('، ');
        if (f.type === 'ref') note += '\nکد یکی از رکوردهای برگه «' + SC.entity(f.ref).label + '»';
        if (f.hint) note += '\n' + f.hint;
        cell.note = note;
        var col = ws.getColumn(i + 1);
        col.width = Math.max(12, Math.min(34, f.label.length + 6));
        if (['text', 'date', 'period', 'ref', 'select', 'color'].indexOf(f.type) >= 0) col.numFmt = '@';
        if (f.type === 'money' || f.type === 'number') col.numFmt = f.digits ? '#,##0.####' : '#,##0.##';
        if (f.type === 'percent') col.numFmt = '0.0%';
        var range = X.colLetter(i + 1) + '2:' + X.colLetter(i + 1) + maxRow;
        if (f.type === 'select') ws.dataValidations.add(range, { type: 'list', allowBlank: !f.required, formulae: [listFor(f.options)], showErrorMessage: true, errorTitle: 'مقدار نامعتبر', error: 'یکی از مقادیر فهرست را انتخاب کنید' });
        else if (f.type === 'bool') ws.dataValidations.add(range, { type: 'list', allowBlank: true, formulae: [listFor(['بله', 'خیر'])] });
        else if (f.type === 'ref' && sheetOf[f.ref]) {
          ws.dataValidations.add(range, { type: 'list', allowBlank: !f.required, formulae: ["'" + sheetOf[f.ref] + "'!$A$2:$A$5000"], showErrorMessage: false });
        }
      });
      rows.forEach(function (r, ri) {
        var xr = ws.getRow(ri + 2);
        fields.forEach(function (f, i) {
          var c = xr.getCell(i + 1);
          c.value = outValue(f, r[f.key], lookup);
          c.font = { name: X.STYLE.font, size: 10 };
        });
      });
      ws.getRow(1).height = 32;
      ws.views = [{ rightToLeft: true, state: 'frozen', ySplit: 1 }];
    });

    // برگه راهنما (نخستین برگه کتاب کار)
    g.views = [{ rightToLeft: true, showGridLines: false }];
    g.getColumn(1).width = 8; g.getColumn(2).width = 30; g.getColumn(3).width = 26; g.getColumn(4).width = 14; g.getColumn(5).width = 70;
    var r = 1;
    function line(text, style) {
      g.mergeCells(r, 1, r, 5);
      var c = g.getCell(r, 1);
      c.value = text;
      c.font = Object.assign({ name: X.STYLE.font, size: 10 }, style || {});
      c.alignment = { horizontal: 'right', wrapText: true, readingOrder: 'rtl', vertical: 'middle' };
      r++;
    }
    line('Integrated Business Planning — الگوی ورود داده', { size: 16, bold: true, color: { argb: 'FF1E3A8A' } });
    line(opts.title || 'این فایل شامل یک برگه برای هر بخش داده است. برگه‌ها را به ترتیب جدول زیر تکمیل کنید.', { color: { argb: 'FF475467' } });
    r++;
    ['۱. هر برگه را با یک ردیف برای هر رکورد تکمیل کنید. ستون‌های ستاره‌دار (*) الزامی هستند.',
      '۲. برای ارجاع‌ها (مثل خانواده یا کارخانه) «کد» همان رکورد را از برگه مربوط بنویسید یا از فهرست کشویی انتخاب کنید.',
      '۳. تاریخ‌ها را شمسی (۱۴۰۵/۰۷/۱۵) و ماه‌ها را به‌صورت ۱۴۰۵/۰۷ وارد کنید. درصدها را با علامت ٪ یا به‌صورت عدد اعشاری بنویسید.',
      '۴. با نگه‌داشتن نشانگر روی سرستون‌ها توضیح هر ستون نمایش داده می‌شود.',
      '۵. فایل را ذخیره کنید و از بخش «مرکز داده» در نرم‌افزار بارگذاری کنید. پیش از اعمال، همه ردیف‌ها بررسی و خطاها گزارش می‌شوند.'
    ].forEach(function (t) { line(t); });
    r++;
    var hdr = ['ترتیب', 'برگه', 'بخش', 'تعداد ستون', 'توضیح ستون‌های الزامی'];
    hdr.forEach(function (h, i) { var c = g.getCell(r, i + 1); c.value = h; X.styleHeaderCell(c); });
    r++;
    keys.forEach(function (k, idx) {
      var def = SC.entity(k);
      var vals = [idx + 1, sheetOf[k], (SC.GROUPS.filter(function (gg) { return gg.id === def.group; })[0] || {}).label || '', def.fields.length,
        def.fields.filter(function (f) { return f.required; }).map(function (f) { return f.label + ' (' + TYPE_LABEL[f.type] + ')'; }).join('، ')];
      vals.forEach(function (v, i) {
        var c = g.getCell(r, i + 1);
        c.value = v;
        c.font = { name: X.STYLE.font, size: 10 };
        c.border = X.borderAll();
        c.alignment = { horizontal: i === 0 || i === 3 ? 'center' : 'right', wrapText: true, readingOrder: 'rtl', vertical: 'middle' };
        if (i === 1) { c.value = { text: v, hyperlink: "#'" + v + "'!A1" }; c.font = { name: X.STYLE.font, size: 10, color: { argb: 'FF2563EB' }, underline: true }; }
      });
      r++;
    });
    return wb;
  }

  function downloadTemplate(opts) {
    try {
      var wb = buildTemplate(opts);
      return X.save(wb, opts.filename || 'الگوی ورود داده IBP').then(function (n) { IBP.ui.toast('فایل «' + n + '» دانلود شد', 'success'); });
    } catch (e) { IBP.ui.toast(e.message, 'error'); return Promise.reject(e); }
  }

  /* ======================= خواندن و اعتبارسنجی ======================= */
  function norm(s) { return String(s || '').replace(/\*/g, '').replace(/[‌\s]+/g, ' ').trim().toLowerCase(); }

  function matchEntity(sheetName, hint) {
    var n = norm(sheetName);
    if (n === norm(GUIDE_SHEET) || n === LISTS_SHEET) return null;
    var keys = SC.keys();
    for (var i = 0; i < keys.length; i++) {
      var d = SC.entity(keys[i]);
      if (n === norm(d.label) || n === norm(keys[i]) || n === norm(d.single)) return keys[i];
    }
    for (var j = 0; j < keys.length; j++) if (n.indexOf(norm(SC.entity(keys[j]).label).split(' (')[0]) === 0) return keys[j];
    return hint || null;
  }

  function jalaliFromDate(d) {
    // Excel رشته «۱۴۰۵/۰۷/۱۵» را گاهی به تاریخ میلادی سال ۱۴۰۵ تبدیل می‌کند
    var y = d.getUTCFullYear(), m = d.getUTCMonth() + 1, day = d.getUTCDate();
    if (y < 1700) return { jy: y, jm: m, jd: day };
    return J.toJalali(y, m, day);
  }
  function parseCell(f, raw) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { v: null };
    var s = typeof raw === 'string' ? raw.trim() : raw;
    switch (f.type) {
      case 'number': case 'money': {
        var n = typeof s === 'number' ? s : F.parseNumber(s);
        return n === null ? { err: 'عدد نامعتبر «' + s + '»' } : { v: n };
      }
      case 'percent': {
        if (typeof s === 'number') return { v: s > 1 ? s / 100 : s };
        var hasPct = /[%٪]/.test(s), p = F.parseNumber(String(s).replace('٪', '%'));
        if (p === null) return { err: 'درصد نامعتبر «' + s + '»' };
        return { v: hasPct || p > 1 ? p / 100 : p };
      }
      case 'bool':
        if (typeof s === 'boolean') return { v: s };
        if (typeof s === 'number') return { v: s !== 0 };
        return { v: /^(بله|آری|1|true|yes|y|فعال|✓|دارد)$/i.test(String(s)) };
      case 'date': {
        if (s instanceof Date) { var jd = jalaliFromDate(s); return { v: J.jalaliStrToIso(jd.jy + '/' + jd.jm + '/' + jd.jd) || null }; }
        var str = F.toLatinDigits(String(s));
        if (/^\d{8}$/.test(str)) str = str.slice(0, 4) + '/' + str.slice(4, 6) + '/' + str.slice(6);
        if (/^(19|20)\d\d-\d\d-\d\d/.test(str)) return { v: str.slice(0, 10) };
        var iso = J.jalaliStrToIso(str);
        return iso ? { v: iso } : { err: 'تاریخ نامعتبر «' + s + '» (نمونه: ۱۴۰۵/۰۷/۱۵)' };
      }
      case 'period': {
        if (s instanceof Date) { var jp = jalaliFromDate(s); return { v: J.period(jp.jy, jp.jm) }; }
        var ps = F.toLatinDigits(String(s)), per = null;
        if (/^\d{6}$/.test(ps)) per = +ps;
        else { var pp = ps.split(/[\/\-.]/); if (pp.length >= 2) per = J.period(+pp[0], +pp[1]); }
        if (!per || J.month(per) < 1 || J.month(per) > 12 || J.year(per) < 1300) return { err: 'ماه نامعتبر «' + s + '» (نمونه: ۱۴۰۵/۰۷)' };
        return { v: per };
      }
      case 'select': {
        var o = String(s);
        if (f.options.indexOf(o) >= 0) return { v: o };
        var alt = f.options.filter(function (x) { return norm(x) === norm(o); })[0];
        return alt ? { v: alt } : { err: 'مقدار «' + o + '» مجاز نیست (مجاز: ' + f.options.join('، ') + ')' };
      }
      case 'ref': return { ref: String(typeof s === 'number' ? s : s).trim() };
      default: return { v: String(s) };
    }
  }

  function keyOf(def, rec) {
    if (!def.naturalKey) return null;
    var parts = def.naturalKey.map(function (k) { return rec[k]; });
    if (parts.some(function (p) { return p === null || p === undefined || p === ''; })) return null;
    return parts.join('¦');
  }

  /**
   * ساخت برنامه ورود از برگه‌های خوانده‌شده.
   * sheets: [{ name, rows }], opts: { entityHint } → { items: [...], errorsTotal, rowsTotal, unknownSheets }
   */
  function plan(sheets, opts) {
    opts = opts || {};
    var byEntity = {}, unknown = [];
    sheets.forEach(function (sh) {
      var k = matchEntity(sh.name, sheets.length === 1 ? opts.entityHint : null);
      if (!k) { if (norm(sh.name) !== norm(GUIDE_SHEET) && sh.name !== LISTS_SHEET) unknown.push(sh.name); return; }
      if (sh.rows.length < 1) return;
      byEntity[k] = sh;
    });

    // نقشه ارجاع: کد/نام → شناسه (داده موجود + رکوردهای در حال ورود)
    var refMap = {};
    function refIndex(ent) {
      if (!refMap[ent]) {
        var m = new Map();
        S.all(ent).forEach(function (r) {
          if (r.code !== undefined && r.code !== null) m.set(norm(r.code), r.id);
          var nm = S.name(ent, r.id); if (nm && !m.has(norm(nm))) m.set(norm(nm), r.id);
        });
        refMap[ent] = m;
      }
      return refMap[ent];
    }

    var items = [];
    SC.order().forEach(function (k) {
      var sh = byEntity[k];
      if (!sh) return;
      var def = SC.entity(k);
      var header = (sh.rows[0] || []).map(function (h) { return norm(h); });
      var map = header.map(function (h) { return def.fields.filter(function (f) { return norm(f.label) === h || norm(f.key) === h; })[0] || null; });
      var item = { entity: k, sheet: sh.name, label: def.label, rows: 0, inserts: 0, updates: 0, errors: [], records: [], missing: [], ignored: [] };
      header.forEach(function (h, i) { if (h && !map[i]) item.ignored.push(sh.rows[0][i]); });
      item.missing = def.fields.filter(function (f) { return f.required && map.indexOf(f) < 0; }).map(function (f) { return f.label; });
      items.push(item);
      if (item.missing.length) { item.errors.push({ row: 1, field: '', msg: 'ستون‌های الزامی یافت نشد: ' + item.missing.join('، ') }); return; }

      var existingByKey = new Map();
      if (def.naturalKey) S.all(k).forEach(function (r) { var kk = keyOf(def, r); if (kk) existingByKey.set(kk, r.id); });
      var seenKeys = new Map();
      // ثبت پیشاپیش کدهای این برگه تا ارجاع درون یک برگه (مثل محصول جایگزین) هم شناخته شود
      var codeCol = map.findIndex ? map.findIndex(function (f) { return f && f.key === 'code'; }) : -1;
      var pendingIds = [];
      for (var pi = 1; pi < sh.rows.length; pi++) {
        var crow = sh.rows[pi] || [];
        var code = codeCol >= 0 && crow[codeCol] !== null && crow[codeCol] !== undefined ? String(crow[codeCol]).trim() : '';
        var exist = code ? (S.byCode(k, code) || null) : null;
        var nid = exist ? exist.id : S.uid();
        pendingIds[pi] = nid;
        if (code) refIndex(k).set(norm(code), nid);
      }

      for (var i = 1; i < sh.rows.length; i++) {
        var row = sh.rows[i] || [];
        if (!row.some(function (c) { return c !== null && c !== undefined && String(c).trim() !== ''; })) continue;
        item.rows++;
        var rec = {}, rowErrs = [];
        map.forEach(function (f, ci) {
          if (!f) return;
          var p = parseCell(f, row[ci]);
          if (p.err) { rowErrs.push({ field: f.label, msg: p.err }); return; }
          if (p.ref !== undefined) {
            var id = refIndex(f.ref).get(norm(p.ref));
            if (!id) { rowErrs.push({ field: f.label, msg: '«' + p.ref + '» در ' + SC.entity(f.ref).label + ' یافت نشد' }); return; }
            rec[f.key] = id;
          } else rec[f.key] = p.v;
        });
        def.fields.forEach(function (f) {
          if (rec[f.key] === undefined || rec[f.key] === null) {
            if (f.required && !rowErrs.some(function (e) { return e.field === f.label; })) rowErrs.push({ field: f.label, msg: 'الزامی است' });
            else if (f.default !== undefined && rec[f.key] === undefined) rec[f.key] = f.default;
          }
          if (typeof rec[f.key] === 'number') {
            if (f.min !== undefined && rec[f.key] < f.min) rowErrs.push({ field: f.label, msg: 'کمتر از حداقل مجاز' });
            if (f.max !== undefined && rec[f.key] > f.max) rowErrs.push({ field: f.label, msg: 'بیشتر از حداکثر مجاز' });
          }
        });
        if (rowErrs.length) { rowErrs.forEach(function (e) { item.errors.push({ row: i + 1, field: e.field, msg: e.msg }); }); continue; }
        var kk = keyOf(def, rec);
        if (kk && seenKeys.has(kk)) { item.errors.push({ row: i + 1, field: '', msg: 'ردیف تکراری (با ردیف ' + F.num(seenKeys.get(kk)) + ')' }); continue; }
        if (kk) seenKeys.set(kk, i + 1);
        var exId = kk ? existingByKey.get(kk) : null;
        rec.id = exId || pendingIds[i] || S.uid();
        if (exId || (rec.code && S.byCode(k, rec.code))) item.updates++; else item.inserts++;
        item.records.push(rec);
      }
    });
    var errorsTotal = 0, rowsTotal = 0;
    items.forEach(function (it) { errorsTotal += it.errors.length; rowsTotal += it.rows; });
    return { items: items, errorsTotal: errorsTotal, rowsTotal: rowsTotal, unknownSheets: unknown };
  }

  /** اعمال برنامه ورود. mode: 'merge' (ادغام و به‌روزرسانی) یا 'replace' (جایگزینی کامل بخش‌های موجود در فایل) */
  function apply(p, mode) {
    var done = [];
    p.items.forEach(function (it) {
      if (!it.records.length && mode !== 'replace') return;
      if (mode === 'replace') S.replaceAll(it.entity, it.records.map(function (r) { return Object.assign({}, r); }), { silent: true });
      else S.bulkUpsert(it.entity, it.records, { silent: true });
      done.push(it.entity);
    });
    if (done.indexOf('salesActuals') >= 0 || done.indexOf('products') >= 0) {
      var cyc = S.settings().cyclePeriod;
      var periods = J.range(J.addMonths(cyc, -12), 12);
      IBP.seed.classify(S.all('products'), S.all('salesActuals'), periods);
      S.bulkUpsert('products', S.all('products'), { silent: true });
    }
    S.touch();
    S.setMeta('lastImport', { at: new Date().toISOString(), entities: done, mode: mode });
    return S.flush().then(function () { return done; });
  }

  function errorReport(p, filename) {
    var rows = [];
    p.items.forEach(function (it) { it.errors.forEach(function (e) { rows.push({ sheet: it.sheet, label: it.label, row: e.row, field: e.field, msg: e.msg }); }); });
    return X.exportTables({
      filename: filename || 'گزارش خطای ورود داده',
      sheets: [{
        name: 'خطاها', title: 'گزارش خطای ورود داده', subtitle: F.num(rows.length) + ' خطا',
        columns: [{ header: 'برگه', key: 'sheet' }, { header: 'بخش', key: 'label' }, { header: 'ردیف', key: 'row', type: 'int' }, { header: 'ستون', key: 'field' }, { header: 'شرح خطا', key: 'msg', width: 70 }],
        rows: rows
      }]
    });
  }

  /** خروجی Excel یک یا چند موجودیت (همان قالب الگو؛ قابل ویرایش و ورود مجدد) */
  function exportEntities(keys, opts) {
    opts = opts || {};
    var rowsFor = null;
    if (opts.records) { rowsFor = {}; rowsFor[keys[0]] = opts.records; }
    return downloadTemplate({ entities: keys, data: 'current', rowsFor: rowsFor, filename: opts.filename || (keys.length === 1 ? SC.entity(keys[0]).label : 'داده‌های IBP') });
  }

  IBP.dataio = {
    buildTemplate: buildTemplate, downloadTemplate: downloadTemplate, exportEntities: exportEntities,
    plan: plan, apply: apply, errorReport: errorReport, parseCell: parseCell, matchEntity: matchEntity, outValue: outValue
  };
})(window.IBP = window.IBP || {});
