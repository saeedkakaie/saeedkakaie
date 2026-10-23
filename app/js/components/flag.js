/*
 * پرچم متحرک لوگوی گروه زر.
 * پارچه پرچم از چند نوار عمودی ساخته می‌شود که هر کدام با اختلاف فاز موج می‌خورند (CSS)؛
 * سایه چین‌ها هم‌فاز با موج حرکت می‌کند. با prefers-reduced-motion پرچم ثابت می‌ماند.
 */
(function (IBP) {
  'use strict';

  var LOGO = 'assets/img/zar-logo.png', RATIO = 360 / 274;

  /** opts: { width, height, slices, title } */
  function flag(opts) {
    opts = opts || {};
    var W = opts.width || 96, H = opts.height || 64, N = opts.slices || Math.max(14, Math.round(W / 4.5)), sw = W / N;
    // لوگو در میانه پارچه با حاشیه یکسان (۷۸٪ ارتفاع)
    var lh = H * 0.78, lw = lh * RATIO;
    if (lw > W * 0.86) { lw = W * 0.86; lh = lw / RATIO; }
    var lx = (W - lw) / 2, ly = (H - lh) / 2;
    var root = document.createElement('div');
    root.className = 'zar-flag';
    root.setAttribute('role', 'img');
    root.setAttribute('aria-label', opts.title || 'گروه زر');
    root.style.setProperty('--fw', W + 'px');
    root.style.setProperty('--fh', H + 'px');
    var pole = document.createElement('span'); pole.className = 'zf-pole';
    var cloth = document.createElement('div'); cloth.className = 'zf-cloth';
    for (var k = 0; k < N; k++) {
      // نوار k از سمت میله (راست) به بیرون؛ دامنه موج دور از میله بیشتر است
      var x0 = W - (k + 1) * sw;
      var s = document.createElement('i');
      s.className = 'zf-s';
      s.style.width = (sw + 0.6) + 'px';
      s.style.setProperty('--k', k);
      s.style.setProperty('--a', (0.15 + 0.85 * k / (N - 1)).toFixed(3));
      s.style.backgroundImage = 'url(' + LOGO + '), linear-gradient(180deg, #b8892b 0, #f0d58a 1.5px, #ffffff 2.5px, #f7f3ea calc(100% - 2.5px), #f0d58a calc(100% - 1.5px), #b8892b 100%)';
      s.style.backgroundSize = lw.toFixed(1) + 'px ' + lh.toFixed(1) + 'px, ' + W + 'px ' + H + 'px';
      s.style.backgroundPosition = (lx - x0).toFixed(2) + 'px ' + ly.toFixed(2) + 'px, ' + (-x0).toFixed(2) + 'px 0';
      s.style.backgroundRepeat = 'no-repeat';
      cloth.appendChild(s);
    }
    root.appendChild(pole);
    root.appendChild(cloth);
    return root;
  }

  IBP.flag = flag;
  IBP.flag.LOGO = LOGO;
})(window.IBP = window.IBP || {});
