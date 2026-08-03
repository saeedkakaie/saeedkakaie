"use strict";

const FILLER_WORDS = [
  "چیزه", "یعنی", "بعدش", "خب", "چطور بگم", "راستش",
  "درواقع", "اهممم", "اووم", "آاا", "همینطور که گفتم"
];

const LESSONS = [
  {
    id: "breathing",
    name: "تنفس دیافراگمی",
    desc: "پایه‌ی کنترل صدا و کاهش استرس",
    type: "guided",
    instructions:
      "قبل از هر سخنرانی، تنفس درست به شما آرامش و صدای پایدار می‌دهد.\n" +
      "صاف بنشینید، یک دست را روی شکم بگذارید و طبق راهنمای صوتی نفس بکشید. ۴ دور تکرار می‌کنیم.",
    guidedSteps: [
      { text: "دم عمیق از بینی به مدت چهار ثانیه", ms: 4000 },
      { text: "نگه‌داشتن نفس به مدت دو ثانیه", ms: 2000 },
      { text: "بازدم آرام از دهان به مدت شش ثانیه", ms: 6000 }
    ],
    repeat: 4
  },
  {
    id: "tongue-twister",
    name: "تلفظ شمرده (پیچ زبان)",
    desc: "وضوح کلمات و کنترل زبان",
    type: "speech",
    targetText:
      "چوپان چوب چوپان چوب چوپان را چوب زد",
    instructions:
      "این جمله را سه بار، شمرده و واضح، بلند تکرار کنید:\n" +
      "«چوپان چوب چوپان چوب چوپان را چوب زد»\n" +
      "دکمه‌ی شروع را بزنید، جمله را بخوانید و در پایان دکمه‌ی پایان را بزنید."
  },
  {
    id: "pace-control",
    name: "کنترل سرعت کلام",
    desc: "سرعت ایده‌آل: حدود ۱۲۰ تا ۱۵۰ کلمه در دقیقه",
    type: "speech",
    targetWpm: [120, 150],
    instructions:
      "متن زیر را با سرعتی متعادل و طبیعی بخوانید، نه خیلی تند و نه خیلی کند:\n\n" +
      "«یک سخنران خوب، پیش از صحبت به شنونده فکر می‌کند. او جمله‌هایش را کوتاه نگه می‌دارد، " +
      "بین ایده‌ها مکث می‌کند و روی نکته‌ی اصلی تمرکز دارد. تمرین روزانه، صدای هر فرد را رساتر می‌کند.»\n\n" +
      "پس از پایان، سرعت گفتار شما بر حسب کلمه در دقیقه محاسبه می‌شود."
  },
  {
    id: "filler-words",
    name: "حذف کلمات زائد",
    desc: "شناسایی تیک‌های کلامی مثل «چیزه» و «یعنی»",
    type: "speech",
    instructions:
      "درباره‌ی یک موضوع ساده به مدت حداقل سی ثانیه صحبت کنید، مثلاً «یک روز خوب از زندگی‌تان».\n" +
      "سعی کنید به‌جای کلماتی مثل «چیزه»، «یعنی» و «خب» سکوت کوتاه کنید.\n" +
      "در پایان، تعداد کلمات زائد شما شمارش و مشخص می‌شود."
  },
  {
    id: "free-speech",
    name: "سخنرانی آزاد",
    desc: "گزارش کامل: سرعت، مکث و کلمات زائد",
    type: "speech",
    instructions:
      "به مدت حداقل یک دقیقه درباره‌ی موضوعی که دوست دارید صحبت کنید.\n" +
      "در پایان یک گزارش کامل از سرعت کلام، مکث‌های طولانی و کلمات زائد دریافت می‌کنید."
  }
];

const els = {
  lessonList: document.getElementById("lesson-list"),
  lessonTitle: document.getElementById("lesson-title"),
  lessonInstructions: document.getElementById("lesson-instructions"),
  btnSpeakInstructions: document.getElementById("btn-speak-instructions"),
  btnStart: document.getElementById("btn-start"),
  btnStop: document.getElementById("btn-stop"),
  volumeBar: document.getElementById("volume-bar"),
  timer: document.getElementById("timer"),
  statusDot: document.getElementById("status-dot"),
  statusText: document.getElementById("status-text"),
  transcript: document.getElementById("transcript"),
  report: document.getElementById("report"),
  reportBody: document.getElementById("report-body"),
  browserWarning: document.getElementById("browser-warning")
};

let currentLesson = null;
let recognition = null;
let audioContext = null;
let analyser = null;
let micStream = null;
let volumeRafId = null;
let sessionTimerId = null;
let sessionStartMs = 0;
let finalTranscript = "";
let interimTranscript = "";
let resultTimestamps = [];
let isRecording = false;

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = !!SpeechRecognitionImpl;

function toPersianDigits(input) {
  const map = { "0": "۰", "1": "۱", "2": "۲", "3": "۳", "4": "۴", "5": "۵", "6": "۶", "7": "۷", "8": "۸", "9": "۹" };
  return String(input).replace(/[0-9]/g, (d) => map[d]);
}

function speak(text) {
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "fa-IR";
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function renderLessonList() {
  els.lessonList.innerHTML = "";
  LESSONS.forEach((lesson) => {
    const li = document.createElement("li");
    li.className = "lesson-item";
    li.dataset.id = lesson.id;
    li.innerHTML = `<span class="name">${lesson.name}</span><span class="desc">${lesson.desc}</span>`;
    li.addEventListener("click", () => selectLesson(lesson.id));
    els.lessonList.appendChild(li);
  });
}

function selectLesson(id) {
  currentLesson = LESSONS.find((l) => l.id === id);
  document.querySelectorAll(".lesson-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.id === id);
  });
  els.lessonTitle.textContent = currentLesson.name;
  els.lessonInstructions.textContent = currentLesson.instructions;
  els.report.classList.add("hidden");
  els.transcript.innerHTML = "";
  els.btnSpeakInstructions.disabled = false;
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;
  resetTimerDisplay();
}

function resetTimerDisplay() {
  els.timer.textContent = toPersianDigits("00:00");
}

function updateTimerDisplay() {
  const elapsedSec = Math.floor((Date.now() - sessionStartMs) / 1000);
  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");
  els.timer.textContent = toPersianDigits(`${mm}:${ss}`);
}

function setStatus(recording, label) {
  isRecording = recording;
  els.statusDot.classList.toggle("recording", recording);
  els.statusText.textContent = label;
}

async function startVolumeMeter() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(micStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  const tick = () => {
    analyser.getByteFrequencyData(data);
    const avg = data.reduce((a, b) => a + b, 0) / data.length;
    const pct = Math.min(100, Math.round((avg / 130) * 100));
    els.volumeBar.style.width = pct + "%";
    volumeRafId = requestAnimationFrame(tick);
  };
  tick();
}

function stopVolumeMeter() {
  if (volumeRafId) cancelAnimationFrame(volumeRafId);
  if (audioContext) audioContext.close();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  els.volumeBar.style.width = "0%";
}

function renderTranscript() {
  const text = (finalTranscript + " " + interimTranscript).trim();
  let html = text;
  FILLER_WORDS.forEach((word) => {
    const re = new RegExp(word, "g");
    html = html.replace(re, `<span class="filler">${word}</span>`);
  });
  els.transcript.innerHTML = html || "&nbsp;";
}

function countFillerWords(text) {
  const counts = {};
  let total = 0;
  FILLER_WORDS.forEach((word) => {
    const re = new RegExp(word, "g");
    const matches = text.match(re);
    if (matches && matches.length) {
      counts[word] = matches.length;
      total += matches.length;
    }
  });
  return { counts, total };
}

function countLongPauses() {
  let pauses = 0;
  for (let i = 1; i < resultTimestamps.length; i++) {
    if (resultTimestamps[i] - resultTimestamps[i - 1] > 2500) pauses++;
  }
  return pauses;
}

async function startSpeechLesson() {
  if (!speechSupported) {
    els.browserWarning.classList.remove("hidden");
    return;
  }
  finalTranscript = "";
  interimTranscript = "";
  resultTimestamps = [];
  els.transcript.innerHTML = "";
  els.report.classList.add("hidden");

  recognition = new SpeechRecognitionImpl();
  recognition.lang = "fa-IR";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcriptPart = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcriptPart + " ";
      } else {
        interimTranscript += transcriptPart;
      }
    }
    resultTimestamps.push(Date.now());
    renderTranscript();
  };

  recognition.onerror = (event) => {
    setStatus(false, "خطا در تشخیص گفتار: " + event.error);
  };

  recognition.onend = () => {
    if (isRecording) {
      recognition.start();
    }
  };

  recognition.start();
  await startVolumeMeter();

  sessionStartMs = Date.now();
  sessionTimerId = setInterval(updateTimerDisplay, 500);

  setStatus(true, "در حال ضبط…");
  els.btnStart.disabled = true;
  els.btnStop.disabled = false;
}

function stopSpeechLesson() {
  if (recognition) {
    recognition.onend = null;
    recognition.stop();
  }
  clearInterval(sessionTimerId);
  stopVolumeMeter();

  const durationSec = Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000));
  setStatus(false, "پایان‌یافته");
  els.btnStart.disabled = false;
  els.btnStop.disabled = true;

  const fullText = finalTranscript.trim();
  const wordCount = fullText.length ? fullText.split(/\s+/).length : 0;
  const wpm = Math.round((wordCount / durationSec) * 60);
  const { counts, total } = countFillerWords(fullText);
  const longPauses = countLongPauses();

  renderReport({ lesson: currentLesson, durationSec, wordCount, wpm, fillerCounts: counts, fillerTotal: total, longPauses, fullText });
}

function scoreLabel(score) {
  if (score >= 75) return { cls: "score-good", text: "عالی 👏" };
  if (score >= 50) return { cls: "score-mid", text: "قابل قبول، جای پیشرفت هست" };
  return { cls: "score-low", text: "نیاز به تمرین بیشتر" };
}

function renderReport({ lesson, durationSec, wordCount, wpm, fillerCounts, fillerTotal, longPauses, fullText }) {
  let score = 100;
  const tips = [];

  score -= Math.min(40, fillerTotal * 6);
  if (fillerTotal > 0) {
    const list = Object.entries(fillerCounts).map(([w, c]) => `«${w}» (${toPersianDigits(c)} بار)`).join("، ");
    tips.push(`به‌جای کلمات زائد (${list})، سکوت کوتاه کنید تا کلامتان روان‌تر شنیده شود.`);
  } else if (wordCount > 0) {
    tips.push("عالی، هیچ کلمه‌ی زائدی شناسایی نشد.");
  }

  if (lesson.targetWpm) {
    const [min, max] = lesson.targetWpm;
    if (wpm < min) {
      score -= 15;
      tips.push(`سرعت شما ${toPersianDigits(wpm)} کلمه در دقیقه بود؛ کمی سریع‌تر صحبت کنید (هدف: ${toPersianDigits(min)} تا ${toPersianDigits(max)}).`);
    } else if (wpm > max) {
      score -= 15;
      tips.push(`سرعت شما ${toPersianDigits(wpm)} کلمه در دقیقه بود؛ کمی آرام‌تر صحبت کنید (هدف: ${toPersianDigits(min)} تا ${toPersianDigits(max)}).`);
    } else {
      tips.push(`سرعت گفتار شما (${toPersianDigits(wpm)} کلمه در دقیقه) در بازه‌ی ایده‌آل است.`);
    }
  }

  if (longPauses > 3) {
    score -= 10;
    tips.push(`${toPersianDigits(longPauses)} مکث طولانی ثبت شد؛ سعی کنید جمله‌بندی را از پیش در ذهن مرور کنید.`);
  }

  if (lesson.targetText) {
    const targetWords = lesson.targetText.replace(/[^؀-ۿ\s]/g, "").split(/\s+/);
    const spokenWords = fullText.split(/\s+/);
    const matched = targetWords.filter((w) => spokenWords.includes(w)).length;
    const accuracy = targetWords.length ? Math.round((matched / targetWords.length) * 100) : 0;
    tips.push(`دقت تطبیق با متن هدف: ${toPersianDigits(accuracy)}٪.`);
    score = Math.round((score + accuracy) / 2);
  }

  if (wordCount === 0) {
    score = 0;
    tips.length = 0;
    tips.push("صدایی ثبت نشد. مطمئن شوید میکروفون فعال است و دوباره تلاش کنید.");
  }

  score = Math.max(0, Math.min(100, score));
  const label = scoreLabel(score);

  els.reportBody.innerHTML = `
    <span class="score-badge ${label.cls}">امتیاز: ${toPersianDigits(score)} از ۱۰۰ — ${label.text}</span>
    <dl>
      <dt>مدت زمان</dt><dd>${toPersianDigits(durationSec)} ثانیه</dd>
      <dt>تعداد کلمات</dt><dd>${toPersianDigits(wordCount)}</dd>
      <dt>سرعت کلام</dt><dd>${toPersianDigits(wpm)} کلمه/دقیقه</dd>
      <dt>کلمات زائد</dt><dd>${toPersianDigits(fillerTotal)}</dd>
      <dt>مکث‌های طولانی</dt><dd>${toPersianDigits(longPauses)}</dd>
    </dl>
    <div class="tips">${tips.map((t) => "• " + t).join("<br />")}</div>
  `;
  els.report.classList.remove("hidden");

  const spokenSummary = `امتیاز شما ${score} از صد است. ${tips[0] || ""}`;
  speak(spokenSummary);
}

async function runGuidedLesson(lesson) {
  setStatus(true, "در حال راهنمایی…");
  els.btnStart.disabled = true;
  els.btnStop.disabled = true;

  sessionStartMs = Date.now();
  sessionTimerId = setInterval(updateTimerDisplay, 500);

  for (let round = 1; round <= lesson.repeat; round++) {
    for (const step of lesson.guidedSteps) {
      els.lessonInstructions.textContent = `دور ${toPersianDigits(round)} از ${toPersianDigits(lesson.repeat)}: ${step.text}`;
      speak(step.text);
      await new Promise((resolve) => setTimeout(resolve, step.ms));
    }
  }

  clearInterval(sessionTimerId);
  setStatus(false, "پایان‌یافته");
  els.lessonInstructions.textContent = lesson.instructions;
  els.btnStart.disabled = false;

  els.reportBody.innerHTML = `
    <span class="score-badge score-good">تمرین تنفس با موفقیت انجام شد 👏</span>
    <div class="tips">• این تمرین را روزی دو بار، پیش از هر مکالمه یا سخنرانی مهم، تکرار کنید.</div>
  `;
  els.report.classList.remove("hidden");
  speak("آفرین، تمرین تنفس با موفقیت به پایان رسید.");
}

els.btnSpeakInstructions.addEventListener("click", () => {
  if (currentLesson) speak(currentLesson.instructions.replace(/«|»/g, ""));
});

els.btnStart.addEventListener("click", () => {
  if (!currentLesson) return;
  if (currentLesson.type === "guided") {
    runGuidedLesson(currentLesson);
  } else {
    startSpeechLesson();
  }
});

els.btnStop.addEventListener("click", () => {
  stopSpeechLesson();
});

if (!speechSupported) {
  els.browserWarning.classList.remove("hidden");
}

renderLessonList();
