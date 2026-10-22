/*
 * تقویم شمسی (جلالی)
 * تبدیل تاریخ میلادی و شمسی بر اساس الگوریتم jalaali-js (Borkowski).
 * دوره‌های برنامه‌ریزی ماهانه به‌صورت عدد صحیح yyyymm شمسی نگه‌داری می‌شوند، مثلاً 140507 یعنی مهر ۱۴۰۵.
 */
(function (IBP) {
  'use strict';

  var BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

  function div(a, b) { return ~~(a / b); }
  function mod(a, b) { return a - ~~(a / b) * b; }

  function jalCal(jy, withoutLeap) {
    var bl = BREAKS.length, gy = jy + 621, leapJ = -14, jp = BREAKS[0], jm, jump, leap, leapG, march, n, i;
    if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error('سال شمسی نامعتبر: ' + jy);
    for (i = 1; i < bl; i += 1) {
      jm = BREAKS[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    march = 20 + leapJ - leapG;
    if (withoutLeap) return { gy: gy, march: march };
    if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
    leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap: leap, gy: gy, march: march };
  }

  function g2d(gy, gm, gd) {
    var d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
    return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  }

  function d2g(jdn) {
    var j = 4 * jdn + 139361631;
    j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
    var i = div(mod(j, 1461), 4) * 5 + 308;
    var gd = div(mod(i, 153), 5) + 1;
    var gm = mod(div(i, 153), 12) + 1;
    var gy = div(j, 1461) - 100100 + div(8 - gm, 6);
    return { gy: gy, gm: gm, gd: gd };
  }

  function j2d(jy, jm, jd) {
    var r = jalCal(jy, true);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  function d2j(jdn) {
    var gy = d2g(jdn).gy, jy = gy - 621, r = jalCal(jy, false), jdn1f = g2d(gy, 3, r.march), jd, jm, k;
    k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        jm = 1 + div(k, 31);
        jd = mod(k, 31) + 1;
        return { jy: jy, jm: jm, jd: jd };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (r.leap === 1) k += 1;
    }
    jm = 7 + div(k, 30);
    jd = mod(k, 30) + 1;
    return { jy: jy, jm: jm, jd: jd };
  }

  var MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  var MONTHS_SHORT = ['فرو', 'ارد', 'خرد', 'تیر', 'مرد', 'شهر', 'مهر', 'آبا', 'آذر', 'دی', 'بهم', 'اسف'];
  var WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  var WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var J = {
    MONTHS: MONTHS,
    MONTHS_SHORT: MONTHS_SHORT,
    WEEKDAYS: WEEKDAYS,
    WEEKDAYS_SHORT: WEEKDAYS_SHORT,

    toJalali: function (gy, gm, gd) {
      if (gy instanceof Date) { gd = gy.getDate(); gm = gy.getMonth() + 1; gy = gy.getFullYear(); }
      return d2j(g2d(gy, gm, gd));
    },
    toGregorian: function (jy, jm, jd) { return d2g(j2d(jy, jm, jd)); },
    isLeap: function (jy) { return jalCal(jy, false).leap === 0; },
    monthLength: function (jy, jm) {
      if (jm <= 6) return 31;
      if (jm <= 11) return 30;
      return J.isLeap(jy) ? 30 : 29;
    },
    /** شماره روز هفته شمسی: ۰ = شنبه */
    weekday: function (jy, jm, jd) {
      var g = J.toGregorian(jy, jm, jd);
      var dow = new Date(g.gy, g.gm - 1, g.gd).getDay(); // 0 = یکشنبه
      return (dow + 1) % 7;
    },
    today: function () { return J.toJalali(new Date()); },

    /* ---------- تاریخ روزانه (ذخیره به‌صورت ISO میلادی، نمایش شمسی) ---------- */
    isoToJalaliStr: function (iso) {
      if (!iso) return '';
      var p = String(iso).split('-');
      if (p.length !== 3) return '';
      var j = J.toJalali(+p[0], +p[1], +p[2]);
      return j.jy + '/' + pad(j.jm) + '/' + pad(j.jd);
    },
    jalaliStrToIso: function (s) {
      if (!s) return '';
      var p = IBP.fmt.toLatinDigits(String(s)).split(/[\/\-.]/);
      if (p.length !== 3) return '';
      var jy = +p[0], jm = +p[1], jd = +p[2];
      if (!jy || jm < 1 || jm > 12 || jd < 1 || jd > J.monthLength(jy, jm)) return '';
      var g = J.toGregorian(jy, jm, jd);
      return g.gy + '-' + pad(g.gm) + '-' + pad(g.gd);
    },
    longDate: function (j) {
      j = j || J.today();
      return WEEKDAYS[J.weekday(j.jy, j.jm, j.jd)] + ' ' + j.jd + ' ' + MONTHS[j.jm - 1] + ' ' + j.jy;
    },

    /* ---------- دوره‌های ماهانه yyyymm ---------- */
    period: function (jy, jm) { return jy * 100 + jm; },
    year: function (p) { return Math.floor(p / 100); },
    month: function (p) { return p % 100; },
    addMonths: function (p, n) {
      var idx = J.year(p) * 12 + (J.month(p) - 1) + n;
      return J.period(Math.floor(idx / 12), (idx % 12) + 1);
    },
    diff: function (a, b) { // تعداد ماه از a تا b
      return (J.year(b) * 12 + J.month(b)) - (J.year(a) * 12 + J.month(a));
    },
    range: function (from, count) {
      var out = [];
      for (var i = 0; i < count; i++) out.push(J.addMonths(from, i));
      return out;
    },
    between: function (from, to) {
      return J.range(from, J.diff(from, to) + 1);
    },
    currentPeriod: function () { var t = J.today(); return J.period(t.jy, t.jm); },
    label: function (p) { return MONTHS[J.month(p) - 1] + ' ' + J.year(p); },
    shortLabel: function (p) { return MONTHS[J.month(p) - 1] + ' ' + String(J.year(p)).slice(2); },
    monthName: function (p) { return MONTHS[J.month(p) - 1]; },
    /** سال مالی دوره با توجه به ماه شروع سال مالی */
    fiscalYear: function (p, startMonth) {
      startMonth = startMonth || 1;
      return J.month(p) >= startMonth ? J.year(p) : J.year(p) - 1;
    },
    fiscalYearPeriods: function (fy, startMonth) {
      return J.range(J.period(fy, startMonth || 1), 12);
    }
  };

  IBP.jalali = J;
})(window.IBP = window.IBP || {});
