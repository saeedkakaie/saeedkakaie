/*
 * تقویم مناسبت‌ها و اثر آن‌ها بر تقاضا.
 *
 * مناسبت‌های قمری (رمضان، دهه اول محرم) هر سال حدود ۱۱ روز جابه‌جا می‌شوند؛ بنابراین فصلی‌بودن
 * ماه‌های شمسی آن‌ها را پوشش نمی‌دهد و باید جداگانه مدل شوند. مناسبت‌های ثابت شمسی (نوروز،
 * بازگشایی مدارس، تابستان) در ضرایب فصلی مدل‌های پیش‌بینی دیده می‌شوند.
 *
 * شدت مناسبت در هر ماه شمسی = تعداد روزهای مناسبت در آن ماه ÷ تعداد روزهای ماه (۰ تا ۱)
 * ضریب تقاضا = Π (۱ + اثر × شدت) برای همه مناسبت‌های مرتبط با خانواده محصول
 */
(function (IBP) {
  'use strict';

  var J = IBP.jalali;
  var fmt = null;
  try {
    fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
    var test = fmt.formatToParts(new Date(Date.UTC(2026, 1, 18)));
    if (!test.some(function (p) { return p.type === 'month' && +p.value === 9; })) fmt = null;
  } catch (e) { fmt = null; }

  /** تبدیل حسابی (تقویم قمری جدولی) برای مرورگرهایی که تقویم ام‌القری ندارند */
  function tabularHijri(gy, gm, gd) {
    var jd = Math.floor(Date.UTC(gy, gm - 1, gd) / 864e5) + 2440588;
    var l = jd - 1948440 + 10632;
    var n = Math.floor((l - 1) / 10631);
    l = l - 10631 * n + 354;
    var j = Math.floor((10985 - l) / 5316) * Math.floor(50 * l / 17719) + Math.floor(l / 5670) * Math.floor(43 * l / 15238);
    l = l - Math.floor((30 - j) / 15) * Math.floor(17719 * j / 50) - Math.floor(j / 16) * Math.floor(15238 * j / 43) + 29;
    var m = Math.floor(24 * l / 709);
    return { y: 30 * n + j - 30, m: m, d: l - Math.floor(709 * m / 24) };
  }
  function hijri(gy, gm, gd) {
    if (!fmt) return tabularHijri(gy, gm, gd);
    var o = {};
    fmt.formatToParts(new Date(Date.UTC(gy, gm - 1, gd))).forEach(function (p) { o[p.type] = p.value; });
    return { y: parseInt(o.year, 10), m: +o.month, d: +o.day };
  }

  var lunarCache = {};
  /** روزهای رمضان و دهه اول محرم در یک ماه شمسی */
  function lunarDays(period) {
    if (lunarCache[period]) return lunarCache[period];
    var jy = J.year(period), jm = J.month(period), len = J.monthLength(jy, jm);
    var out = { ramadan: 0, muharram: 0, days: len };
    for (var d = 1; d <= len; d++) {
      var g = J.toGregorian(jy, jm, d), hj = hijri(g.gy, g.gm, g.gd);
      if (hj.m === 9) out.ramadan++;
      if (hj.m === 1 && hj.d <= 12) out.muharram++;
    }
    lunarCache[period] = out;
    return out;
  }

  var KIND_KEY = { 'رمضان': 'ramadan', 'محرم': 'muharram' };

  /** شدت یک مناسبت در یک ماه (۰ تا ۱) */
  function intensity(period, ev) {
    if (!ev) return 0;
    var k = KIND_KEY[ev.kind];
    if (k) { var ld = lunarDays(period); return ld[k] / ld.days; }
    if (ev.startPeriod && period >= ev.startPeriod && period <= (ev.endPeriod || ev.startPeriod)) return 1;
    return 0;
  }

  /** ضریب مناسبت‌ها برای یک خانواده محصول در یک ماه (بر اساس اثرهای ثبت‌شده) */
  function factor(period, familyId, impacts) {
    var S = IBP.store, f = 1;
    (impacts || S.all('eventImpacts')).forEach(function (im) {
      if (im.familyId !== familyId || !im.uplift) return;
      var w = intensity(period, S.get('events', im.eventId));
      if (w) f *= Math.max(0, 1 + im.uplift * w);
    });
    return f;
  }

  /** ماتریس شدت همه مناسبت‌ها در دوره‌ها: [{event, values:[...]}] */
  function calendar(periods) {
    return IBP.store.all('events').map(function (ev) {
      return { event: ev, values: periods.map(function (p) { return intensity(p, ev); }) };
    });
  }

  /** شدت پیش‌فرض رمضان/محرم بدون نیاز به رکورد مناسبت (برای مولد داده تستی) */
  function lunarIntensity(period, kind) {
    var ld = lunarDays(period);
    return ld[kind] / ld.days;
  }

  IBP.events = { hijri: hijri, lunarDays: lunarDays, intensity: intensity, factor: factor, calendar: calendar, lunarIntensity: lunarIntensity, usingUmmAlQura: !!fmt };
})(window.IBP = window.IBP || {});
