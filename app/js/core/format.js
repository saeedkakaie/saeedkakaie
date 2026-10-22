/*
 * قالب‌بندی اعداد، مبالغ و درصدها.
 * ارقام در DOM لاتین می‌مانند و فونت Vazirmatn-FD آن‌ها را فارسی نمایش می‌دهد؛
 * به این ترتیب کپی و خروجی Excel عدد خالص می‌دهد.
 */
(function (IBP) {
  'use strict';

  var FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
  var nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  var nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  var nf2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

  var SCALES = {
    1: { label: '', short: '' },
    1e3: { label: 'هزار', short: 'K' },
    1e6: { label: 'میلیون', short: 'M' },
    1e9: { label: 'میلیارد', short: 'B' }
  };

  var F = {
    SCALES: SCALES,

    toLatinDigits: function (s) {
      return String(s).replace(/[۰-۹]/g, function (d) { return FA.indexOf(d); })
        .replace(/[٠-٩]/g, function (d) { return AR.indexOf(d); })
        .replace(/٬/g, ',').replace(/٫/g, '.');
    },
    toFaDigits: function (s) {
      return String(s).replace(/\d/g, function (d) { return FA[d]; });
    },
    parseNumber: function (v) {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'number') return isFinite(v) ? v : null;
      var s = F.toLatinDigits(v).replace(/[,\s]/g, '').replace('%', '');
      if (s === '' || s === '-') return null;
      var n = Number(s);
      return isFinite(n) ? n : null;
    },

    num: function (v, digits) {
      if (v === null || v === undefined || isNaN(v)) return '—';
      if (digits === 1) return nf1.format(v);
      if (digits === 2) return nf2.format(v);
      return nf0.format(Math.round(v));
    },
    /** عدد فشرده برای محور نمودار و کارت‌ها: 1.2K / 3.4M */
    compact: function (v) {
      if (v === null || v === undefined || isNaN(v)) return '—';
      var a = Math.abs(v), s = v < 0 ? '-' : '';
      if (a >= 1e12) return s + nf1.format(a / 1e12) + ' هزارمیلیارد';
      if (a >= 1e9) return s + nf1.format(a / 1e9) + ' میلیارد';
      if (a >= 1e6) return s + nf1.format(a / 1e6) + ' میلیون';
      if (a >= 1e4) return s + nf1.format(a / 1e3) + ' هزار';
      return s + nf0.format(a);
    },
    pct: function (v, digits) {
      if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return '—';
      return (digits === 0 ? nf0 : nf1).format(v * 100) + '٪';
    },
    signedPct: function (v) {
      if (v === null || v === undefined || isNaN(v) || !isFinite(v)) return '—';
      return (v > 0 ? '+' : '') + nf1.format(v * 100) + '٪';
    },
    /** مبلغ بر اساس واحد و مقیاس نمایش تنظیمات */
    money: function (v, opts) {
      opts = opts || {};
      var s = IBP.store ? IBP.store.settings() : {};
      var scale = opts.scale || s.displayScale || 1e9;
      if (v === null || v === undefined || isNaN(v)) return '—';
      var out = F.num(v / scale, opts.digits !== undefined ? opts.digits : (scale >= 1e9 ? 1 : 0));
      if (opts.unit === false) return out;
      return out + ' ' + F.moneyUnit(scale);
    },
    moneyUnit: function (scale) {
      var s = IBP.store ? IBP.store.settings() : {};
      scale = scale || s.displayScale || 1e9;
      var cur = s.currency || 'ریال';
      return ((SCALES[scale] && SCALES[scale].label) ? SCALES[scale].label + ' ' : '') + cur;
    },
    escape: function (s) {
      return String(s === null || s === undefined ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  };

  IBP.fmt = F;
})(window.IBP = window.IBP || {});
