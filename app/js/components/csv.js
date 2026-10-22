/*
 * ورود و خروج CSV (سازگار با Excel؛ با BOM برای نمایش درست فارسی).
 * ارجاع‌ها هنگام خروج با «کد» (یا نام) نوشته می‌شوند و هنگام ورود دوباره به شناسه تبدیل می‌شوند.
 */
(function (IBP) {
  'use strict';

  var S = IBP.store, F = IBP.fmt, J = IBP.jalali;

  function parse(text) {
    text = text.replace(/^﻿/, '');
    var delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    if ((text.split('\n')[0].match(/\t/g) || []).length > 0) delim = '\t';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function esc(v) {
    var s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function refLabel(entity, id) {
    var r = S.get(entity, id);
    if (!r) return '';
    return r.code || S.name(entity, id);
  }

  function exportEntity(entityKey, rows) {
    var def = IBP.schema.entity(entityKey);
    rows = rows || S.all(entityKey);
    var lines = [def.fields.map(function (f) { return esc(f.label); }).join(',')];
    rows.forEach(function (r) {
      lines.push(def.fields.map(function (f) {
        var v = r[f.key];
        if (f.type === 'ref') v = refLabel(f.ref, v);
        else if (f.type === 'date') v = J.isoToJalaliStr(v);
        else if (f.type === 'period') v = v ? J.year(v) + '/' + String(J.month(v)).padStart(2, '0') : '';
        else if (f.type === 'bool') v = v ? 'بله' : 'خیر';
        else if (f.type === 'percent') v = v === null || v === undefined ? '' : Math.round(v * 10000) / 100;
        return esc(v);
      }).join(','));
    });
    var stamp = J.today();
    IBP.ui.download(def.label + ' ' + stamp.jy + '-' + stamp.jm + '-' + stamp.jd + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function template(entityKey) {
    var def = IBP.schema.entity(entityKey);
    IBP.ui.download('الگوی ' + def.label + '.csv', '﻿' + def.fields.map(function (f) { return esc(f.label); }).join(',') + '\r\n', 'text/csv;charset=utf-8');
  }

  /**
   * ورود CSV: ستون‌ها با عنوان فارسی یا کلید فیلد شناسایی می‌شوند.
   * رکوردهای دارای «کد» تکراری به‌روزرسانی می‌شوند (upsert).
   * خروجی: { inserted, updated, errors: [ {line, msg} ] }
   */
  function importEntity(entityKey, text) {
    var def = IBP.schema.entity(entityKey);
    var rows = parse(text);
    if (rows.length < 2) return { inserted: 0, updated: 0, errors: [{ line: 1, msg: 'فایل خالی است' }] };
    var header = rows[0].map(function (x) { return x.trim(); });
    var map = header.map(function (hd) {
      return def.fields.filter(function (f) { return f.label === hd || f.key === hd; })[0] || null;
    });
    var missing = def.fields.filter(function (f) { return f.required && map.indexOf(f) < 0; });
    if (missing.length) return { inserted: 0, updated: 0, errors: [{ line: 1, msg: 'ستون‌های الزامی یافت نشد: ' + missing.map(function (f) { return f.label; }).join('، ') }] };

    var hasCode = def.fields.some(function (f) { return f.key === 'code'; });
    var out = { inserted: 0, updated: 0, errors: [] }, batch = [];
    var refCache = {};
    function resolveRef(entity, v) {
      if (!v) return null;
      if (!refCache[entity]) {
        var m = new Map();
        S.all(entity).forEach(function (r) { if (r.code) m.set(String(r.code).trim(), r.id); m.set(String(S.name(entity, r.id)).trim(), r.id); });
        refCache[entity] = m;
      }
      return refCache[entity].get(String(v).trim()) || null;
    }
    for (var i = 1; i < rows.length; i++) {
      var rec = {}, err = null;
      for (var c = 0; c < map.length && !err; c++) {
        var f = map[c];
        if (!f) continue;
        var raw = (rows[i][c] || '').trim(), v = raw;
        if (raw === '') { v = f.default !== undefined ? f.default : null; }
        else if (f.type === 'number' || f.type === 'money') { v = F.parseNumber(raw); if (v === null) err = f.label + ': عدد نامعتبر'; }
        else if (f.type === 'percent') { v = F.parseNumber(raw); if (v === null) err = f.label + ': درصد نامعتبر'; else v = v > 1 ? v / 100 : v; }
        else if (f.type === 'bool') v = /^(بله|1|true|yes|فعال|✓)$/i.test(raw);
        else if (f.type === 'date') { v = J.jalaliStrToIso(raw); if (!v) err = f.label + ': تاریخ نامعتبر'; }
        else if (f.type === 'period') {
          var pp = F.toLatinDigits(raw).split(/[\/\-.]/);
          v = pp.length === 2 ? J.period(+pp[0], +pp[1]) : (+F.toLatinDigits(raw) || null);
          if (!v || J.month(v) < 1 || J.month(v) > 12) err = f.label + ': دوره نامعتبر (مثال ۱۴۰۵/۰۷)';
        }
        else if (f.type === 'ref') { v = resolveRef(f.ref, raw); if (!v) err = f.label + ': «' + raw + '» یافت نشد'; }
        else if (f.type === 'select' && f.options.indexOf(raw) < 0) err = f.label + ': مقدار «' + raw + '» مجاز نیست';
        if (f.required && (v === null || v === '')) err = f.label + ': الزامی است';
        rec[f.key] = v;
      }
      if (err) { out.errors.push({ line: i + 1, msg: err }); continue; }
      var existing = hasCode && rec.code ? S.byCode(entityKey, rec.code) : null;
      if (existing) { rec.id = existing.id; out.updated++; } else out.inserted++;
      batch.push(rec);
    }
    if (batch.length) S.bulkUpsert(entityKey, batch);
    return out;
  }

  IBP.csv = { parse: parse, exportEntity: exportEntity, importEntity: importEntity, template: template };
})(window.IBP = window.IBP || {});
