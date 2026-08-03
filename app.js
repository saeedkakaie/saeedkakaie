"use strict";

/* =====================================================================
   استودیوی فن‌بیان — برنامه‌ی فشرده‌ی ۱۴ روزه
   یک اپ تک‌فایلی سمت مرورگر: تشخیص گفتار، سنجش زنده‌ی صدا و بازخورد
   صوتی، بدون سرور یا کلید API.
===================================================================== */

const FILLER_WORDS = [
  "چیزه", "یعنی", "بعدش", "خب", "چطور بگم", "راستش",
  "درواقع", "اهممم", "اووم", "آاا", "همینطور که گفتم"
];

const IMPROMPTU_TOPICS = [
  "یک سفر که هرگز فراموشش نمی‌کنید",
  "چیزی که امسال یاد گرفتید و به آن افتخار می‌کنید",
  "یک عادت کوچک که زندگی‌تان را بهتر کرده",
  "شخصی که بیشترین تاثیر را روی شما گذاشته",
  "چرا یادگیری مهارت‌های جدید هیچ‌وقت دیر نیست"
];

const QA_QUESTIONS = [
  "چرا باید به حرف شما اعتماد کنیم؟",
  "بزرگ‌ترین ریسک این پیشنهاد چیست؟",
  "اگر فقط یک دلیل برای این کار داشتید، آن چه بود؟"
];

const PROGRAM = [
  {
    day: 1, week: 1, module: "پایه‌ها", title: "نقطه‌ی شروع",
    brief: "سنجش اولیه‌ی صدا و کلام",
    teaching: {
      paragraphs: [
        "پیش از هر تمرینی باید بدانید امروز دقیقاً کجای مسیر ایستاده‌اید. این جلسه یک سنجش اولیه است و نمره‌ی امروز، نقطه‌ی مقایسه‌ی شما خواهد بود تا در روز چهاردهم پیشرفت واقعی‌تان را عدد به عدد ببینید."
      ],
      bullets: [
        "با صدای طبیعی خودتان صحبت کنید، نه صدای «رسمی» ساختگی.",
        "نگران مکث یا اشتباه نباشید؛ این فقط یک خط پایه است."
      ]
    },
    script: { cue: "موضوع صحبت", text: "چرا می‌خواهید فن بیانتان را تقویت کنید؟ حداقل ۴۵ ثانیه صحبت کنید." },
    exerciseType: "single",
    minDurationSec: 45,
    isBaseline: true
  },
  {
    day: 2, week: 1, module: "پایه‌ها", title: "تنفس دیافراگمی",
    brief: "ستون هوای صدای شما",
    teaching: {
      paragraphs: [
        "صدای لرزان و کم‌جان معمولاً از مشکل صدا نمی‌آید؛ از تنفس سینه‌ای می‌آید. تنفس دیافراگمی به شما ستون هوای پایدار می‌دهد تا صدا از عمق بیرون بیاید و زیر فشار هم نلرزد."
      ],
      bullets: [
        "یک دست را روی شکم بگذارید؛ هنگام دم باید شکم بالا بیاید، نه سینه.",
        "این تمرین را هر روز پیش از یک مکالمه یا سخنرانی مهم تکرار کنید."
      ]
    },
    exerciseType: "guided",
    guidedSteps: [
      { text: "دم عمیق از بینی، به مدت چهار ثانیه", ms: 4000 },
      { text: "نگه‌داشتن نفس، به مدت دو ثانیه", ms: 2000 },
      { text: "بازدم آرام از دهان، به مدت شش ثانیه", ms: 6000 }
    ],
    repeat: 4
  },
  {
    day: 3, week: 1, module: "پایه‌ها", title: "تلفظ شمرده",
    brief: "وضوح کلمات و کنترل زبان",
    teaching: {
      paragraphs: [
        "کلماتی که در دهان «قاطی» می‌شوند، شنونده را خسته می‌کنند. این سه جمله برای سه گروه صدا طراحی شده‌اند: سایشی‌ها (س، ش)، انفجاری‌ها (پ، ب) و غلتان‌ها (ر). آهسته شروع کنید و کم‌کم سرعت بگیرید."
      ],
      bullets: ["هر کلمه را کامل باز کنید؛ عجله نکنید.", "اگر جایی گیر کردید، همان‌جا دوباره و آهسته‌تر بگویید."]
    },
    script: {
      cue: "سه‌بار با صدای بلند بخوانید",
      text: "شش شغال شاد، شبانه شام شیرین ساختند.\nپدرِ پویا پنج پرتقال پوست کند.\nرضا روی ریل راه‌آهن، روزی راهی رشت شد."
    },
    exerciseType: "single",
    targetText: "شش شغال شاد شبانه شام شیرین ساختند پدر پویا پنج پرتقال پوست کند رضا روی ریل راه آهن روزی راهی رشت شد",
    minDurationSec: 10
  },
  {
    day: 4, week: 1, module: "پایه‌ها", title: "کنترل سرعت کلام",
    brief: "هدف: ۱۲۰ تا ۱۵۰ کلمه در دقیقه",
    teaching: {
      paragraphs: [
        "سرعت زیاد یعنی مغز شنونده جا می‌ماند؛ سرعت خیلی کم یعنی حواسش پرت می‌شود. بازه‌ی طلایی برای گفتار روان، حدود ۱۲۰ تا ۱۵۰ کلمه در دقیقه است."
      ],
      bullets: ["طبیعی بخوانید، نه مثل خبرِ عجله‌ای و نه مثل لالایی."]
    },
    script: {
      cue: "با سرعتی متعادل بخوانید",
      text: "یک سخنران خوب، پیش از صحبت به شنونده فکر می‌کند. او جمله‌هایش را کوتاه نگه می‌دارد، بین ایده‌ها مکث می‌کند و روی نکته‌ی اصلی تمرکز دارد. تمرین روزانه، صدای هر فرد را رساتر می‌کند."
    },
    exerciseType: "single",
    targetWpm: [120, 150],
    minDurationSec: 15
  },
  {
    day: 5, week: 1, module: "پایه‌ها", title: "حذف کلمات زائد",
    brief: "شکار «چیزه»، «یعنی» و «خب»",
    teaching: {
      paragraphs: [
        "کلمات زائد وقتی می‌آیند که مغز دنبال کلمه‌ی بعدی می‌گردد و دهان منتظر نمی‌ماند. راه‌حل ساده است: به‌جای پر کردن سکوت با «چیزه»، بگذارید سکوت بماند. سکوتِ کوتاه، اعتمادبه‌نفس نشان می‌دهد."
      ]
    },
    script: { cue: "موضوع صحبت", text: "یک روز خوب از زندگی‌تان را برایم تعریف کنید. حداقل ۳۰ ثانیه صحبت کنید." },
    exerciseType: "single",
    minDurationSec: 30
  },
  {
    day: 6, week: 1, module: "پایه‌ها", title: "قدرت مکث",
    brief: "سکوت به‌عنوان ابزار تاکید",
    teaching: {
      paragraphs: [
        "مکث، برخلاف تصور رایج، ضعف نیست؛ ابزار است. یک مکثِ نیم‌تا‌یک‌ثانیه‌ای درست قبل یا بعد از نکته‌ی اصلی، توجه شنونده را روی همان نکته قفل می‌کند."
      ],
      bullets: ["علامت || در متن زیر یعنی: اینجا مکث کنید.", "هدف امروز رساندن حداقل ۲ تا ۵ مکث آگاهانه است."]
    },
    script: {
      cue: "با مکث در نشانه‌های ||",
      text: "یک ایده‌ی خوب... || به‌تنهایی کافی نیست. || شما باید آن را باور کنید || و این یعنی همه‌چیز."
    },
    exerciseType: "single",
    encouragePauses: true,
    pauseThresholdMs: 1100,
    pauseGoal: [2, 6],
    minDurationSec: 8
  },
  {
    day: 7, week: 1, module: "پایه‌ها", title: "تنوع لحن",
    brief: "مرور هفته‌ی اول + رنگ صدا",
    teaching: {
      paragraphs: [
        "به نیمه‌ی هفته‌ی اول رسیدید. امروز به‌جای «چه چیزی» می‌گویید، روی «چطور» می‌گویید تمرکز می‌کنیم. یک جمله را با سه لحن متفاوت می‌خوانید تا دامنه‌ی صدایتان گسترده‌تر شود."
      ]
    },
    script: { cue: "جمله‌ی ثابت، سه لحن متفاوت", text: "امروز روزیست که تصمیم شما همه‌چیز را تغییر می‌دهد." },
    exerciseType: "multi",
    multiKind: "tone",
    multiPrompts: [
      { label: "هیجان‌زده", instruction: "این جمله را با هیجان و انرژی زیاد بخوانید", ms: 7000 },
      { label: "جدی", instruction: "همین جمله را با لحنی جدی و محکم بخوانید", ms: 7000 },
      { label: "گرم و دلسوزانه", instruction: "حالا با لحنی گرم و صمیمی بخوانید", ms: 7000 }
    ]
  },
  {
    day: 8, week: 2, module: "ساختار و اجرا", title: "ساختار طلایی سخنرانی",
    brief: "قلاب، بدنه، فراخوان",
    teaching: {
      paragraphs: [
        "هر سخنرانی خوب سه بخش دارد: «قلاب» که در ۱۰ ثانیه‌ی اول توجه می‌گیرد، «بدنه» که حداکثر روی یک ایده‌ی اصلی می‌ماند، و «فراخوان» که به شنونده می‌گوید بعد از این چه کار کند."
      ],
      bullets: ["قلاب می‌تواند یک سوال، یک آمار عجیب یا یک داستان کوتاه باشد.", "بدنه را با یک ایده نگه دارید؛ سه ایده در یک سخنرانی کوتاه، یعنی هیچ ایده."]
    },
    script: { cue: "موضوع", text: "چرا یادگیری فن بیان مهم است؟ سخنرانی خود را با قلاب شروع و با فراخوان تمام کنید." },
    exerciseType: "single",
    minDurationSec: 50
  },
  {
    day: 9, week: 2, module: "ساختار و اجرا", title: "قصه‌گویی",
    brief: "موقعیت، مشکل، تلاش، نتیجه",
    teaching: {
      paragraphs: [
        "آمار فراموش می‌شود؛ داستان یادت می‌ماند. یک داستان کوتاه فقط به چهار تکه نیاز دارد: موقعیت اولیه، مشکلی که پیش آمد، تلاشی که کردید، و نتیجه یا درسی که گرفتید."
      ]
    },
    script: { cue: "موضوع", text: "یک داستان کوتاه واقعی از زندگی‌تان تعریف کنید که در آن مشکلی حل شد." },
    exerciseType: "single",
    minDurationSec: 45
  },
  {
    day: 10, week: 2, module: "ساختار و اجرا", title: "فنون بلاغی",
    brief: "تکرار، پرسش بلاغی، تضاد",
    teaching: {
      paragraphs: [
        "سه ابزار ساده، کلام را به‌یادماندنی می‌کند: تکرارِ سه‌گانه («سریع‌تر، بهتر، ساده‌تر»)، پرسش بلاغی که پاسخش را نمی‌خواهید («آیا وقتش نرسیده؟»)، و تضاد که دو ایده را رودررو می‌گذارد («کوچک شروع کردیم، بزرگ فکر کردیم»)."
      ]
    },
    script: { cue: "موضوع", text: "درباره‌ی یک تغییر مثبت صحبت کنید و حداقل از یکی از این سه ابزار استفاده کنید." },
    exerciseType: "single",
    detectDevices: true,
    minDurationSec: 30
  },
  {
    day: 11, week: 2, module: "ساختار و اجرا", title: "زبان بدن و انرژی صدا",
    brief: "حضور صوتی و فیزیکی",
    teaching: {
      paragraphs: [
        "شنونده فقط کلمات را نمی‌شنود؛ ایستادن، نگاه و انرژی صدای شما را هم «می‌شنود». صاف بایستید، به یک نقطه‌ی ثابت (یا دوربین) نگاه کنید، و اجازه بدهید دست‌هایتان طبیعی حرکت کنند."
      ],
      bullets: ["امروز یک جمله را در سه سطح انرژی می‌خوانید: آرام، معمولی، پرانرژی.", "هدف این است که تفاوت واقعاً در صدایتان شنیده شود."]
    },
    script: { cue: "جمله‌ی ثابت، سه سطح انرژی", text: "این لحظه، لحظه‌ی شماست." },
    exerciseType: "multi",
    multiKind: "build",
    multiPrompts: [
      { label: "آرام", instruction: "این جمله را آرام و آهسته بخوانید", ms: 5000 },
      { label: "معمولی", instruction: "همین جمله را با انرژی معمولی بخوانید", ms: 5000 },
      { label: "پرانرژی", instruction: "حالا با بیشترین انرژی و قدرت بخوانید", ms: 5000 }
    ]
  },
  {
    day: 12, week: 2, module: "ساختار و اجرا", title: "مدیریت استرس و ایمپرومپتو",
    brief: "صحبت بی‌آمادگی، با آرامش",
    teaching: {
      paragraphs: [
        "لرزش دست و تپش قلب پیش از صحبت، نشانه‌ی ضعف نیست؛ نشانه‌ی انرژی اضافه‌ی بدن است. یک نفس عمیق و آگاهانه، همان انرژی را به تمرکز تبدیل می‌کند. امروز یک تمرین تنفس سریع می‌کنید و بلافاصله، بدون آماده‌شدن، درباره‌ی یک موضوع غافلگیرکننده صحبت می‌کنید — دقیقاً مثل یک سخنرانی واقعی."
      ]
    },
    exerciseType: "single",
    preGuidedSteps: [
      { text: "دم عمیق از بینی، چهار ثانیه", ms: 4000 },
      { text: "بازدم آرام از دهان، شش ثانیه", ms: 6000 }
    ],
    impromptu: true,
    minDurationSec: 20
  },
  {
    day: 13, week: 2, module: "ساختار و اجرا", title: "پاسخ به پرسش (PREP)",
    brief: "نکته، دلیل، مثال، نکته",
    teaching: {
      paragraphs: [
        "در پرسش و پاسخ، بهترین ساختار PREP است: نکته‌ی اصلی‌تان را بگویید، دلیلش را توضیح دهید، یک مثال بزنید، و دوباره نکته را تکرار کنید. این ساختار پاسخ را کوتاه و قانع‌کننده نگه می‌دارد."
      ]
    },
    exerciseType: "single",
    qa: true,
    minDurationSec: 20
  },
  {
    day: 14, week: 2, module: "ساختار و اجرا", title: "سخنرانی نهایی",
    brief: "جمع‌بندی و مقایسه با روز اول",
    teaching: {
      paragraphs: [
        "این جلسه‌ی نهایی است. همه‌ی چیزهایی که تمرین کردید را در یک سخنرانی کامل بیاورید: تنفس، سرعت متعادل، مکث آگاهانه، ساختار قلاب-بدنه-فراخوان و کمی بلاغت. در پایان، نتیجه‌ی امروز را با روز اول مقایسه می‌کنید."
      ]
    },
    script: { cue: "موضوع آزاد", text: "درباره‌ی موضوعی که برایتان مهم است، حداقل ۹۰ ثانیه مثل یک سخنران حرفه‌ای صحبت کنید." },
    exerciseType: "single",
    minDurationSec: 90,
    compareBaseline: true
  }
];

/* ---------------------------- ذخیره‌سازی ---------------------------- */

const STORAGE_KEY = "fanbayan_progress_v2";

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { completed: {}, streak: 0, lastActiveDate: null, baseline: null };
    return JSON.parse(raw);
  } catch {
    return { completed: {}, streak: 0, lastActiveDate: null, baseline: null };
  }
}

function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function touchStreak(progress) {
  const today = todayStr();
  if (progress.lastActiveDate === today) return;
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  progress.streak = progress.lastActiveDate === yesterday ? progress.streak + 1 : 1;
  progress.lastActiveDate = today;
}

let progress = loadProgress();

/* ---------------------------- کمک‌های فارسی ---------------------------- */

function toPersianDigits(input) {
  const map = { "0": "۰", "1": "۱", "2": "۲", "3": "۳", "4": "۴", "5": "۵", "6": "۶", "7": "۷", "8": "۸", "9": "۹" };
  return String(input).replace(/[0-9]/g, (d) => map[d]);
}

function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "fa-IR";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = !!SpeechRecognitionImpl;

/* ---------------------------- موتور ضبط صدا ---------------------------- */

const Capture = {
  recognition: null,
  audioCtx: null,
  analyser: null,
  micStream: null,
  rafId: null,
  timerId: null,
  autoTimeoutId: null,
  startMs: 0,
  finalTranscript: "",
  interimTranscript: "",
  resultTimestamps: [],
  volumeSamples: [],
  ledCells: [],
  resolver: null,
  active: false,

  bindUi({ ledContainer, timerEl, transcriptEl, dotEl, statusEl }) {
    this.ui = { ledContainer, timerEl, transcriptEl, dotEl, statusEl };
    ledContainer.innerHTML = "";
    this.ledCells = [];
    const total = 24;
    for (let i = 0; i < total; i++) {
      const cell = document.createElement("div");
      const zone = i < total * 0.6 ? "z-signal" : i < total * 0.85 ? "z-accent" : "z-warn";
      cell.className = "led-cell " + zone;
      ledContainer.appendChild(cell);
      this.ledCells.push(cell);
    }
  },

  paintMeter(level) {
    const lit = Math.round((level / 100) * this.ledCells.length);
    this.ledCells.forEach((cell, i) => cell.classList.toggle("lit", i < lit));
  },

  renderTranscript() {
    const text = (this.finalTranscript + " " + this.interimTranscript).trim();
    let html = text;
    FILLER_WORDS.forEach((word) => {
      html = html.replace(new RegExp(word, "g"), `<span class="filler">${word}</span>`);
    });
    this.ui.transcriptEl.innerHTML = html || "&nbsp;";
  },

  updateTimer() {
    const elapsed = Math.floor((Date.now() - this.startMs) / 1000);
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    this.ui.timerEl.textContent = `${mm}:${ss}`;
  },

  async start({ autoMs } = {}) {
    this.finalTranscript = "";
    this.interimTranscript = "";
    this.resultTimestamps = [];
    this.volumeSamples = [];
    this.ui.transcriptEl.innerHTML = "";
    this.active = true;
    this.ui.dotEl.classList.add("on");
    this.ui.statusEl.textContent = "در حال ضبط…";

    if (speechSupported) {
      this.recognition = new SpeechRecognitionImpl();
      this.recognition.lang = "fa-IR";
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.onresult = (event) => {
        this.interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const part = event.results[i][0].transcript;
          if (event.results[i].isFinal) this.finalTranscript += part + " ";
          else this.interimTranscript += part;
        }
        this.resultTimestamps.push(Date.now());
        this.renderTranscript();
      };
      this.recognition.onerror = () => {};
      this.recognition.onend = () => { if (this.active) { try { this.recognition.start(); } catch {} } };
      this.recognition.start();
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(this.micStream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    let lastSample = 0;
    const tick = (now) => {
      this.analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const pct = Math.min(100, Math.round((avg / 130) * 100));
      this.paintMeter(pct);
      if (!lastSample || now - lastSample > 150) {
        this.volumeSamples.push(pct);
        lastSample = now;
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);

    this.startMs = Date.now();
    this.timerId = setInterval(() => this.updateTimer(), 400);
    this.updateTimer();

    return new Promise((resolve) => {
      this.resolver = resolve;
      if (autoMs) this.autoTimeoutId = setTimeout(() => this.stop(), autoMs);
    });
  },

  stop() {
    if (!this.active) return;
    this.active = false;
    clearTimeout(this.autoTimeoutId);
    clearInterval(this.timerId);
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.recognition) { this.recognition.onend = null; try { this.recognition.stop(); } catch {} }
    if (this.audioCtx) this.audioCtx.close();
    if (this.micStream) this.micStream.getTracks().forEach((t) => t.stop());
    this.ledCells.forEach((c) => c.classList.remove("lit"));
    this.ui.dotEl.classList.remove("on");
    this.ui.statusEl.textContent = "پایان‌یافته";

    const durationSec = Math.max(1, Math.round((Date.now() - this.startMs) / 1000));
    const fullText = this.finalTranscript.trim();
    const wordCount = fullText.length ? fullText.split(/\s+/).length : 0;
    const wpm = Math.round((wordCount / durationSec) * 60);
    const avgVolume = this.volumeSamples.length
      ? Math.round(this.volumeSamples.reduce((a, b) => a + b, 0) / this.volumeSamples.length)
      : 0;

    const metrics = { durationSec, wordCount, wpm, fullText, avgVolume, resultTimestamps: this.resultTimestamps.slice() };
    if (this.resolver) this.resolver(metrics);
    this.resolver = null;
  }
};

function countFillerWords(text) {
  const counts = {};
  let total = 0;
  FILLER_WORDS.forEach((word) => {
    const matches = text.match(new RegExp(word, "g"));
    if (matches && matches.length) { counts[word] = matches.length; total += matches.length; }
  });
  return { counts, total };
}

function countPauses(timestamps, thresholdMs) {
  let n = 0;
  for (let i = 1; i < timestamps.length; i++) {
    if (timestamps[i] - timestamps[i - 1] > thresholdMs) n++;
  }
  return n;
}

function detectRhetoricalDevices(text) {
  const found = [];
  if (/آیا|مگر/.test(text)) found.push("پرسش بلاغی");
  if (/اما|ولی/.test(text)) found.push("تضاد");
  const words = text.split(/\s+/).filter((w) => w.length >= 3);
  const freq = {};
  words.forEach((w) => { freq[w] = (freq[w] || 0) + 1; });
  if (Object.values(freq).some((c) => c >= 3)) found.push("تکرار سه‌گانه");
  return found;
}

/* ---------------------------- ارزیابی ---------------------------- */

function scoreBand(score) {
  if (score >= 75) return { cls: "good", text: "عالی" };
  if (score >= 50) return { cls: "mid", text: "قابل قبول" };
  return { cls: "low", text: "نیاز به تمرین بیشتر" };
}

function evaluateSingle(lesson, metrics) {
  const { durationSec, wordCount, wpm, fullText, resultTimestamps } = metrics;
  const tips = [];
  const stats = [];
  let score = 100;

  if (wordCount === 0) {
    const band = scoreBand(0);
    return {
      score: 0, band,
      stats: [{ k: "مدت زمان", v: durationSec + " ثانیه" }],
      tips: ["صدایی ثبت نشد. مطمئن شوید میکروفون فعال است و دوباره تلاش کنید."]
    };
  }

  const { counts, total: fillerTotal } = countFillerWords(fullText);
  score -= Math.min(35, fillerTotal * 6);
  if (fillerTotal > 0) {
    const list = Object.entries(counts).map(([w, c]) => `«${w}» (${toPersianDigits(c)} بار)`).join("، ");
    tips.push(`کلمات زائد شناسایی‌شده: ${list}. به‌جای آن‌ها سکوت کوتاه کنید.`);
  } else {
    tips.push("هیچ کلمه‌ی زائدی شناسایی نشد — عالی.");
  }
  stats.push({ k: "کلمات زائد", v: toPersianDigits(fillerTotal) });

  if (lesson.minDurationSec && durationSec < lesson.minDurationSec) {
    score -= 10;
    tips.push(`مدت صحبت شما ${toPersianDigits(durationSec)} ثانیه بود؛ هدف حداقل ${toPersianDigits(lesson.minDurationSec)} ثانیه است.`);
  }

  if (lesson.targetWpm) {
    const [min, max] = lesson.targetWpm;
    stats.push({ k: "سرعت کلام", v: wpm + " wpm" });
    if (wpm < min) { score -= 15; tips.push(`سرعت ${toPersianDigits(wpm)} کلمه در دقیقه بود؛ کمی سریع‌تر بخوانید.`); }
    else if (wpm > max) { score -= 15; tips.push(`سرعت ${toPersianDigits(wpm)} کلمه در دقیقه بود؛ کمی آرام‌تر بخوانید.`); }
    else tips.push(`سرعت گفتار (${toPersianDigits(wpm)} کلمه در دقیقه) در بازه‌ی ایده‌آل است.`);
  }

  const pauseThreshold = lesson.pauseThresholdMs || 2500;
  const pauseCount = countPauses(resultTimestamps, pauseThreshold);
  if (lesson.encouragePauses) {
    stats.push({ k: "مکث‌های ثبت‌شده", v: toPersianDigits(pauseCount) });
    const [gMin, gMax] = lesson.pauseGoal || [2, 5];
    if (pauseCount < gMin) { score -= 15; tips.push("مکث‌های شما کم بود؛ سعی کنید قبل یا بعد از نکته‌ی مهم آگاهانه سکوت کنید."); }
    else if (pauseCount > gMax) { score -= 5; tips.push("مکث‌های زیادی ثبت شد؛ فقط روی مهم‌ترین نکته‌ها مکث کنید."); }
    else tips.push("استفاده از مکث در این تمرین متعادل بود — همین‌طور ادامه دهید.");
  } else if (pauseCount > 3) {
    score -= 8;
    stats.push({ k: "مکث‌های طولانی", v: toPersianDigits(pauseCount) });
    tips.push(`${toPersianDigits(pauseCount)} مکث طولانی ثبت شد؛ جمله‌بندی را از پیش در ذهن مرور کنید.`);
  }

  if (lesson.targetText) {
    const targetWords = lesson.targetText.split(/\s+/);
    const spokenWords = fullText.split(/\s+/);
    const matched = targetWords.filter((w) => spokenWords.includes(w)).length;
    const accuracy = Math.round((matched / targetWords.length) * 100);
    stats.push({ k: "دقت تلفظ", v: accuracy + "%" });
    tips.push(`دقت تطبیق با متن هدف: ${toPersianDigits(accuracy)}٪.`);
    score = Math.round((score + accuracy) / 2);
  }

  if (lesson.detectDevices) {
    const devices = detectRhetoricalDevices(fullText);
    if (devices.length) { score = Math.min(100, score + 10); tips.push(`ابزار بلاغی شناسایی‌شده: ${devices.join("، ")}. آفرین!`); }
    else tips.push("هنوز از پرسش بلاغی، تضاد یا تکرار استفاده نکرده‌اید؛ بار بعد امتحان کنید.");
  }

  let baselineDelta = null;
  if (lesson.compareBaseline && progress.baseline) {
    const b = progress.baseline;
    const scoreDelta = Math.round(score - b.score);
    const fillerRateNow = Math.round((fillerTotal / Math.max(1, wordCount)) * 100);
    const fillerRateDelta = b.fillerRatePer100 - fillerRateNow;
    baselineDelta = { scoreDelta, fillerRateDelta, fromDate: b.date };
  }

  if (lesson.isBaseline) {
    const fillerRatePer100 = Math.round((fillerTotal / Math.max(1, wordCount)) * 100);
    progress.baseline = { score: Math.max(0, Math.min(100, score)), wpm, fillerRatePer100, date: todayStr() };
  }

  score = Math.max(0, Math.min(100, score));
  stats.unshift({ k: "مدت زمان", v: toPersianDigits(durationSec) + " ثانیه" }, { k: "تعداد کلمات", v: toPersianDigits(wordCount) });

  return { score, band: scoreBand(score), stats, tips, baselineDelta };
}

function evaluateMulti(lesson, segments) {
  const tips = [];
  const stats = segments.map((s, i) => ({ k: lesson.multiPrompts[i].label, v: toPersianDigits(s.avgVolume) }));
  const totalWords = segments.reduce((a, s) => a + s.wordCount, 0);

  if (totalWords === 0) {
    return { score: 0, band: scoreBand(0), stats, tips: ["صدایی در هیچ‌کدام از بخش‌ها ثبت نشد. دوباره تلاش کنید."] };
  }

  let score = 60;
  if (lesson.multiKind === "tone") {
    const volumes = segments.map((s) => s.avgVolume);
    const spread = Math.max(...volumes) - Math.min(...volumes);
    if (spread >= 12) { score = 90; tips.push("تنوع صدای خوبی بین سه لحن ثبت شد — دامنه‌ی صدایتان گسترده است."); }
    else if (spread >= 5) { score = 70; tips.push("کمی تنوع لحن ثبت شد؛ تفاوت بین حالت‌ها را پررنگ‌تر کنید."); }
    else { score = 45; tips.push("سه لحن تقریباً یک‌شکل شنیده شدند؛ برای هیجان‌زده بلندتر و برای گرم/دلسوزانه نرم‌تر بخوانید."); }
  } else if (lesson.multiKind === "build") {
    const volumes = segments.map((s) => s.avgVolume);
    const monotonic = volumes[1] > volumes[0] + 2 && volumes[2] > volumes[1] + 2;
    if (monotonic) { score = 90; tips.push("افزایش انرژی صدا از آرام تا پرانرژی به‌خوبی شنیده شد."); }
    else { score = 55; tips.push("افزایش انرژی بین سه سطح چندان محسوس نبود؛ در سطح «پرانرژی» بلندتر و با قاطعیت بیشتر بخوانید."); }
  }

  return { score, band: scoreBand(score), stats, tips };
}

/* ---------------------------- رندر ---------------------------- */

const root = document.getElementById("app");
let state = { view: "dashboard", day: null, capturedMulti: [] };
let sessionToken = 0;

function leaveSession() {
  sessionToken++;
  if (Capture.active) Capture.stop();
}

function nextDay() {
  const d = PROGRAM.find((l) => !progress.completed[l.day]);
  return d ? d.day : null;
}

function statGridHtml(stats) {
  return `<div class="stat-grid">${stats.map((s) => `
    <div class="stat-cell"><div class="k">${s.k}</div><div class="v tabular">${s.v}</div></div>
  `).join("")}</div>`;
}

function reportHtml(result) {
  let deltaHtml = "";
  if (result.baselineDelta) {
    const d = result.baselineDelta;
    const scoreCls = d.scoreDelta >= 0 ? "delta-good" : "delta-bad";
    const fillerCls = d.fillerRateDelta >= 0 ? "delta-good" : "delta-bad";
    deltaHtml = `<div class="teaching" style="margin-top:16px;">
      <p><strong>نسبت به روز اول:</strong></p>
      <p class="${scoreCls}">امتیاز ${d.scoreDelta >= 0 ? "+" : ""}${toPersianDigits(d.scoreDelta)}</p>
      <p class="${fillerCls}">کلمات زائد به‌ازای هر ۱۰۰ کلمه: ${d.fillerRateDelta >= 0 ? "کاهش" : "افزایش"} ${toPersianDigits(Math.abs(d.fillerRateDelta))} واحد</p>
    </div>`;
  }
  return `
    <div class="score-strip">
      <div class="score-dial ${result.band.cls} tabular">${toPersianDigits(result.score)}/۱۰۰</div>
      <div class="score-verdict">${result.band.text}</div>
    </div>
    ${statGridHtml(result.stats)}
    <div class="tips">${result.tips.map((t) => `<div class="tip"><span class="mark">›</span><span>${t}</span></div>`).join("")}</div>
    ${deltaHtml}
  `;
}

function render() {
  if (!speechSupported) {
    root.innerHTML = `<div class="masthead"><div class="brand"><span class="eyebrow">FAN-E-BAYAN STUDIO</span><h1>استودیوی فن‌بیان</h1></div></div>
    <div class="warning">مرورگر شما از تشخیص گفتار پشتیبانی نمی‌کند. لطفاً از آخرین نسخه‌ی Chrome یا Edge استفاده کنید.</div>`;
    return;
  }
  if (state.view === "session") renderSession();
  else renderDashboard();
}

function renderDashboard() {
  const done = Object.keys(progress.completed).length;
  const nd = nextDay();
  const nextLesson = nd ? PROGRAM.find((l) => l.day === nd) : null;

  const modules = [...new Set(PROGRAM.map((l) => l.module))];
  const railHtml = modules.map((mod) => `
    <div class="rail-module">
      <h3>${mod}</h3>
      <div class="rail-track">
        ${PROGRAM.filter((l) => l.module === mod).map((l) => {
          const isDone = !!progress.completed[l.day];
          const isNext = l.day === nd;
          return `<div class="rail-node ${isDone ? "done" : ""} ${isNext ? "next" : ""}" data-day="${l.day}">
            <div class="dot tabular">${isDone ? "✓" : toPersianDigits(l.day)}</div>
            <div class="meta"><span class="t">${l.title}</span><span class="s">${l.brief}</span></div>
          </div>`;
        }).join("")}
      </div>
    </div>
  `).join("");

  root.innerHTML = `
    <div class="masthead">
      <div class="brand">
        <span class="eyebrow">FAN-E-BAYAN STUDIO · 14-DAY PROGRAM</span>
        <h1>استودیوی فن‌بیان</h1>
      </div>
      <div class="onair ${nd ? "" : "live"}">${nd ? "IN PROGRESS" : "PROGRAM COMPLETE"}<span class="bulb"></span></div>
    </div>

    <div class="console">
      <div class="gauge"><div class="label">جلسات انجام‌شده</div><div class="value tabular">${toPersianDigits(done)} <small>/ ۱۴</small></div></div>
      <div class="gauge"><div class="label">روزهای متوالی</div><div class="value tabular">${toPersianDigits(progress.streak)} <small>روز</small></div></div>
      <div class="gauge"><div class="label">امتیاز خط پایه</div><div class="value tabular">${progress.baseline ? toPersianDigits(progress.baseline.score) : "—"}</div></div>
    </div>

    ${nextLesson ? `
    <div class="next-session" data-day="${nextLesson.day}" id="next-cta">
      <div class="copy">
        <span class="kicker">SESSION ${String(nextLesson.day).padStart(2, "0")}</span>
        <div><strong>${nextLesson.title}</strong> — ${nextLesson.brief}</div>
      </div>
      <button class="btn record" id="btn-jump-next"><span class="glyph">▶</span> شروع</button>
    </div>` : `
    <div class="next-session">
      <div class="copy"><span class="kicker">COMPLETE</span><div><strong>هر ۱۴ جلسه را تمام کردید.</strong> از فهرست کنار، هر جلسه را برای مرور دوباره انتخاب کنید.</div></div>
    </div>`}

    <div class="layout">
      <div class="rail">${railHtml}</div>
      <div class="stage" style="display:flex;align-items:center;justify-content:center;min-height:200px;color:var(--muted);text-align:center;">
        یک جلسه از فهرست کنار را انتخاب کنید تا شروع کنید.
      </div>
    </div>

    <div class="footnote"><button id="btn-reset">بازنشانی کامل پیشرفت</button></div>
  `;

  root.querySelectorAll(".rail-node").forEach((el) => {
    el.addEventListener("click", () => { state.view = "session"; state.day = Number(el.dataset.day); render(); });
  });
  const jumpBtn = document.getElementById("btn-jump-next");
  if (jumpBtn) jumpBtn.addEventListener("click", () => { state.view = "session"; state.day = nextLesson.day; render(); });
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (confirm("کل پیشرفت شما پاک شود؟")) { localStorage.removeItem(STORAGE_KEY); progress = loadProgress(); render(); }
  });
}

function renderSession() {
  const lesson = PROGRAM.find((l) => l.day === state.day);
  const isDone = !!progress.completed[lesson.day];

  root.innerHTML = `
    <div class="masthead">
      <div class="brand"><span class="eyebrow">FAN-E-BAYAN STUDIO</span><h1>استودیوی فن‌بیان</h1></div>
      <div class="onair"><span class="bulb"></span> جلسه ${toPersianDigits(lesson.day)} از ۱۴</div>
    </div>
    <div class="layout">
      <div class="stage">
        <button class="back" id="btn-back">← بازگشت به داشبورد</button>
        <span class="kicker">SESSION ${String(lesson.day).padStart(2, "0")} · ${lesson.module}</span>
        <h2>${lesson.title}${isDone ? " ✓" : ""}</h2>

        <div class="teaching">
          ${lesson.teaching.paragraphs.map((p) => `<p>${p}</p>`).join("")}
          ${lesson.teaching.bullets ? `<ul>${lesson.teaching.bullets.map((b) => `<li>${b}</li>`).join("")}</ul>` : ""}
        </div>

        ${lesson.script ? `<div class="script-card"><span class="cue">${lesson.script.cue}</span>${lesson.script.text.replace(/\n/g, "<br />")}</div>` : ""}

        <div id="exercise-area"></div>
      </div>
      <div class="rail" style="padding:16px;color:var(--muted);font-size:.85rem;">
        روش کار: راهنما را بخوانید، دکمه‌ی شروع را بزنید، طبق دستور صحبت کنید و در پایان گزارش را ببینید.
      </div>
    </div>
  `;

  document.getElementById("btn-back").addEventListener("click", () => { leaveSession(); state.view = "dashboard"; render(); });

  const area = document.getElementById("exercise-area");
  if (lesson.exerciseType === "guided") renderGuidedExercise(area, lesson);
  else if (lesson.exerciseType === "multi") renderMultiExercise(area, lesson);
  else renderSingleExercise(area, lesson);
}

function markComplete(lesson, score) {
  progress.completed[lesson.day] = { score, date: todayStr() };
  touchStreak(progress);
  saveProgress(progress);
}

function transportHtml() {
  return `
    <div class="transport">
      <button class="btn ghost" id="btn-hear"><span class="glyph">»</span> شنیدن راهنما</button>
      <button class="btn record" id="btn-start">شروع ضبط</button>
      <button class="btn stop" id="btn-stop" disabled>پایان ضبط</button>
    </div>
    <div class="live">
      <div class="meter-row"><span class="label">میزان صدا</span><div class="led-meter" id="led-meter"></div></div>
      <div class="timer-row">
        <span class="rec-dot" id="rec-dot"></span>
        <span id="timer" class="tabular">00:00</span>
        <span id="status-text">آماده</span>
      </div>
    </div>
    <div class="transcript-box"><h4>متن پیاده‌شده</h4><div class="transcript" id="transcript"></div></div>
    <div class="report hidden" id="report"><h3>گزارش عملکرد</h3><div id="report-body"></div>
      <div class="transport" style="margin-top:14px;"><button class="btn ghost" id="btn-again">تمرین دوباره</button><button class="btn" id="btn-return">بازگشت به داشبورد</button></div>
    </div>
  `;
}

function readableInstructions(lesson) {
  const parts = [lesson.teaching.paragraphs[0]];
  if (lesson.script) parts.push(lesson.script.text.replace(/\|\|/g, "،"));
  return parts.join(" ");
}

function renderSingleExercise(area, lesson) {
  area.innerHTML = transportHtml();
  Capture.bindUi({
    ledContainer: document.getElementById("led-meter"),
    timerEl: document.getElementById("timer"),
    transcriptEl: document.getElementById("transcript"),
    dotEl: document.getElementById("rec-dot"),
    statusEl: document.getElementById("status-text")
  });

  document.getElementById("btn-hear").addEventListener("click", () => speak(readableInstructions(lesson)));

  document.getElementById("btn-start").addEventListener("click", async () => {
    const myToken = sessionToken;
    document.getElementById("btn-start").disabled = true;
    document.getElementById("report").classList.add("hidden");

    if (lesson.preGuidedSteps) {
      document.getElementById("status-text").textContent = "آماده‌سازی…";
      for (const step of lesson.preGuidedSteps) {
        speak(step.text);
        await new Promise((r) => setTimeout(r, step.ms));
        if (myToken !== sessionToken) return;
      }
    }
    if (lesson.impromptu) {
      const topic = IMPROMPTU_TOPICS[Math.floor(Math.random() * IMPROMPTU_TOPICS.length)];
      document.querySelector(".script-card")?.remove();
      area.insertAdjacentHTML("afterbegin", `<div class="script-card"><span class="cue">موضوع غافلگیرکننده</span>${topic}</div>`);
      speak("موضوع شما این است: " + topic);
      await new Promise((r) => setTimeout(r, 3500));
      if (myToken !== sessionToken) return;
    }
    if (lesson.qa) {
      const q = QA_QUESTIONS[Math.floor(Math.random() * QA_QUESTIONS.length)];
      document.querySelector(".script-card")?.remove();
      area.insertAdjacentHTML("afterbegin", `<div class="script-card"><span class="cue">پرسش</span>${q}</div>`);
      speak(q);
      await new Promise((r) => setTimeout(r, 3000));
      if (myToken !== sessionToken) return;
    }

    document.getElementById("btn-stop").disabled = false;
    const metrics = await Capture.start({});
    if (myToken !== sessionToken) return;
    const result = evaluateSingle(lesson, metrics);
    document.getElementById("report-body").innerHTML = reportHtml(result);
    document.getElementById("report").classList.remove("hidden");
    document.getElementById("btn-start").disabled = false;
    document.getElementById("btn-stop").disabled = true;
    markComplete(lesson, result.score);
    speak(`امتیاز شما ${result.score} از صد. ${result.tips[0] || ""}`);
    wireReportButtons(lesson);
  });

  document.getElementById("btn-stop").addEventListener("click", () => Capture.stop());
}

function wireReportButtons(lesson) {
  document.getElementById("btn-again").addEventListener("click", () => { sessionToken++; renderSession(); });
  document.getElementById("btn-return").addEventListener("click", () => { leaveSession(); state.view = "dashboard"; render(); });
}

async function renderMultiExercise(area, lesson) {
  area.innerHTML = `
    <div class="transport"><button class="btn record" id="btn-start">شروع دنباله‌ی تمرین</button></div>
    <div class="live">
      <div class="meter-row"><span class="label">میزان صدا</span><div class="led-meter" id="led-meter"></div></div>
      <div class="timer-row"><span class="rec-dot" id="rec-dot"></span><span id="timer" class="tabular">00:00</span><span id="status-text">آماده</span></div>
    </div>
    <div class="transcript-box"><h4>متن پیاده‌شده</h4><div class="transcript" id="transcript"></div></div>
    <div class="report hidden" id="report"><h3>گزارش عملکرد</h3><div id="report-body"></div>
      <div class="transport" style="margin-top:14px;"><button class="btn ghost" id="btn-again">تمرین دوباره</button><button class="btn" id="btn-return">بازگشت به داشبورد</button></div>
    </div>
  `;
  Capture.bindUi({
    ledContainer: document.getElementById("led-meter"),
    timerEl: document.getElementById("timer"),
    transcriptEl: document.getElementById("transcript"),
    dotEl: document.getElementById("rec-dot"),
    statusEl: document.getElementById("status-text")
  });

  document.getElementById("btn-start").addEventListener("click", async () => {
    const myToken = sessionToken;
    document.getElementById("btn-start").disabled = true;
    const segments = [];
    for (const prompt of lesson.multiPrompts) {
      document.getElementById("status-text").textContent = prompt.label;
      speak(prompt.instruction);
      await new Promise((r) => setTimeout(r, 1800));
      if (myToken !== sessionToken) return;
      const metrics = await Capture.start({ autoMs: prompt.ms });
      if (myToken !== sessionToken) return;
      segments.push(metrics);
    }
    const result = evaluateMulti(lesson, segments);
    document.getElementById("report-body").innerHTML = reportHtml(result);
    document.getElementById("report").classList.remove("hidden");
    markComplete(lesson, result.score);
    speak(`امتیاز شما ${result.score} از صد. ${result.tips[0] || ""}`);
    wireReportButtons(lesson);
  });
}

async function renderGuidedExercise(area, lesson) {
  area.innerHTML = `
    <div class="transport"><button class="btn record" id="btn-start">شروع تمرین راهنما</button></div>
    <div id="guide-status" style="color:var(--muted);min-height:24px;"></div>
    <div class="report hidden" id="report"><h3>گزارش</h3><div id="report-body"></div>
      <div class="transport" style="margin-top:14px;"><button class="btn" id="btn-return">بازگشت به داشبورد</button></div>
    </div>
  `;
  document.getElementById("btn-start").addEventListener("click", async () => {
    const myToken = sessionToken;
    document.getElementById("btn-start").disabled = true;
    const statusEl = document.getElementById("guide-status");
    for (let round = 1; round <= lesson.repeat; round++) {
      for (const step of lesson.guidedSteps) {
        statusEl.textContent = `دور ${toPersianDigits(round)} از ${toPersianDigits(lesson.repeat)}: ${step.text}`;
        speak(step.text);
        await new Promise((r) => setTimeout(r, step.ms));
        if (myToken !== sessionToken) return;
      }
    }
    statusEl.textContent = "تمرین تنفس با موفقیت انجام شد.";
    document.getElementById("report-body").innerHTML = `
      <div class="score-strip"><div class="score-dial good tabular">۱۰۰/۱۰۰</div><div class="score-verdict">انجام شد</div></div>
      <div class="tips"><div class="tip"><span class="mark">›</span><span>این تمرین را روزی دو بار، پیش از هر مکالمه یا سخنرانی مهم، تکرار کنید.</span></div></div>
    `;
    document.getElementById("report").classList.remove("hidden");
    markComplete(lesson, 100);
    speak("آفرین، تمرین تنفس با موفقیت به پایان رسید.");
    document.getElementById("btn-return").addEventListener("click", () => { leaveSession(); state.view = "dashboard"; render(); });
  });
}

render();
