'use strict';
/* ============================================================
   0) بوت / تم
   ============================================================ */
const SEED = JSON.parse(document.getElementById('seed-data').textContent);
const LEGACY_SAMPLE = JSON.parse(document.getElementById('legacy-sample').textContent);
const STORAGE_KEY = 'cmdm_demo_v1';

document.documentElement.lang = 'fa';
document.documentElement.dir = 'rtl';

(function initTheme(){
  const saved = localStorage.getItem('cmdm_theme');
  if(saved) document.documentElement.setAttribute('data-theme', saved);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('cmdm_theme', next);
  });
})();

function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ============================================================
   1) موتور نرمال‌سازی/عارضه‌یابی متن (پورت از cleanup_engine.py)
   ============================================================ */
const AR_YE = 'ي', FA_YE = 'ی', AR_KE = 'ك', FA_KE = 'ک', AR_HEH = 'ة', FA_HEH = 'ه';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩', ASCII_DIGITS = '0123456789';
function translateDigits(s){
  let out = '';
  for(const ch of s){
    let i = FA_DIGITS.indexOf(ch);
    if(i === -1) i = AR_DIGITS.indexOf(ch);
    out += i === -1 ? ch : ASCII_DIGITS[i];
  }
  return out;
}
function normalize(s){
  if(typeof s !== 'string') return '';
  s = translateDigits(s);
  s = s.split(AR_YE).join(FA_YE).split(AR_KE).join(FA_KE).split(AR_HEH).join(FA_HEH);
  s = s.split('ـ').join('');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
function fullClean(s){
  if(typeof s !== 'string') return '';
  s = translateDigits(s);
  s = s.split(AR_YE).join(FA_YE).split(AR_KE).join(FA_KE).split(AR_HEH).join(FA_HEH);
  s = s.split('ـ').join('');
  s = s.split('"').join('');
  s = s.replace(/,(\d)/g, '.$1');
  s = s.replace(/\s+/g, ' ').trim();
  if(s.startsWith('(') && (s.split('(').length - 1) > (s.split(')').length - 1)) s = s.slice(1).trim();
  s = s.replace(/^[-*]\s+/, '');
  return s;
}
function looseKey(s){
  s = normalize(s).toLowerCase();
  s = s.replace(/(?<=\d)\.(?=\d)/g, '§D§');
  s = s.replace(/[^0-9a-zA-Zآ-ی§D]/g, '');
  return s.split('§D§').join('.');
}
function hasQuoteIssue(s){
  if(typeof s !== 'string') return false;
  const n = (s.match(/"/g) || []).length;
  return (n % 2 === 1) || s.startsWith('"') || s.trim().endsWith('"');
}
function mapGroup(raw){
  if(!raw || !String(raw).trim()) return '';
  const key = String(raw).trim();
  return SEED.group_mapping[key] || key;
}
function checkNewRuleCompliance(descRaw){
  const reasons = [];
  if(typeof descRaw !== 'string' || !descRaw.trim()) return ['شرح خالی است'];
  if([...descRaw].some(ch => ch === AR_YE || ch === AR_KE || ch === AR_HEH)) reasons.push('حروف عربی غیراستاندارد (ي/ك/ة) به‌جای فارسی (ی/ک/ه)');
  if([...descRaw].some(ch => FA_DIGITS.includes(ch) || AR_DIGITS.includes(ch))) reasons.push('ارقام فارسی/عربی به‌جای ارقام لاتین');
  if(hasQuoteIssue(descRaw)) reasons.push('نقل‌قول ناقص/اضافه در متن');
  if(/\d,\d/.test(descRaw)) reasons.push('کاما به‌جای نقطه‌ی اعشاری در عدد فنی');
  if(/\s{2,}/.test(descRaw)) reasons.push('فاصله‌گذاری غیراستاندارد (فاصله‌ی تکراری)');
  if(/^[-*(]/.test(descRaw.trim())) reasons.push('کاراکتر ابتدایی نامتعارف (-، * یا «(»)');
  if(descRaw.trim().length > 40) reasons.push('طول شرح بیش از ۴۰ کاراکتر (فیلد شرح کوتاه SAP)');
  if(/[a-zA-Z][آ-ی]|[آ-ی][a-zA-Z]/.test(descRaw.replace(/\s+/g, ''))) reasons.push('چسبیدگی حروف فارسی/لاتین یا عدد بدون فاصله');
  return reasons;
}
function pickGoldenCode(codes, plantsPerCode){
  return [...codes].sort((a, b) => {
    const pa = plantsPerCode.get(a) || 0, pb = plantsPerCode.get(b) || 0;
    if(pb !== pa) return pb - pa;
    return String(a).localeCompare(String(b));
  })[0];
}
/* شباهت متن (تقریب rapidfuzz با فاصله ادیت روی Indel) */
function editDistance(a, b){
  const m = a.length, n = b.length;
  if(m === 0) return n; if(n === 0) return m;
  let prev = new Array(n + 1); for(let j = 0; j <= n; j++) prev[j] = j;
  for(let i = 1; i <= m; i++){
    const cur = [i];
    for(let j = 1; j <= n; j++){
      cur[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j-1], prev[j], cur[j-1]);
    }
    prev = cur;
  }
  return prev[n];
}
function similarityRatio(a, b){
  if(!a && !b) return 100;
  if(!a || !b) return 0;
  const dist = editDistance(a, b);
  return Math.round((1 - dist / (a.length + b.length)) * 200 * 10) / 10; // 0..100
}

/* ============================================================
   2) تحلیل بانک کالای فعلی (پورت از analyze_legacy)
   ============================================================ */
function analyzeLegacy(rows){
  const enriched = rows.map(r => ({
    plant: r['پلنت'], groupRaw: r['Material Group'], code: String(r['کد کالا']),
    descRaw: r['شرح کالا'], unit: r['واحد'],
    descFull: fullClean(r['شرح کالا']), descLoose: looseKey(r['شرح کالا']),
    groupMapped: mapGroup(r['Material Group']),
  }));

  const unitByCode = new Map();
  enriched.forEach(r => { if(!unitByCode.has(r.code)) unitByCode.set(r.code, new Set()); unitByCode.get(r.code).add(r.unit); });
  const codesMultiUnit = new Set([...unitByCode.entries()].filter(([, s]) => s.size > 1).map(([c]) => c));

  function groupBy(arr, keyFn){ const m = new Map(); arr.forEach(x => { const k = keyFn(x); if(!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; }

  const byFull = groupBy(enriched, r => r.descFull);
  const dupFullKeys = new Set([...byFull.entries()].filter(([, arr]) => new Set(arr.map(r => r.code)).size > 1).map(([k]) => k));
  const byLoose = groupBy(enriched, r => r.descLoose);
  const dupLooseKeys = new Set([...byLoose.entries()].filter(([, arr]) => new Set(arr.map(r => r.code)).size > 1).map(([k]) => k));

  const clusters = [];
  const codeToGolden = new Map();
  const descToClusterIdx = new Map();

  for(const desc of dupFullKeys){
    const grp = byFull.get(desc);
    const codes = [...new Set(grp.map(r => r.code))].sort();
    const plantsPerCode = new Map(); codes.forEach(c => plantsPerCode.set(c, new Set(grp.filter(r => r.code === c).map(r => r.plant)).size));
    const golden = pickGoldenCode(codes, plantsPerCode);
    const groups = [...new Set(grp.map(r => r.groupMapped).filter(Boolean))];
    const units = [...new Set(grp.map(r => r.unit))];
    const idx = clusters.length;
    clusters.push({ kind: 'exact', desc, codes, golden, groupConflict: groups.length > 1, unitConflict: units.length > 1 });
    codes.forEach(c => codeToGolden.set(c, golden));
    descToClusterIdx.set('exact|' + desc, idx);
  }
  for(const lk of dupLooseKeys){
    const grp = byLoose.get(lk);
    const codes = [...new Set(grp.map(r => r.code))].sort();
    if(codes.length < 2) continue;
    const fullSet = new Set(grp.map(r => r.descFull));
    if(fullSet.size === 1 && dupFullKeys.has([...fullSet][0])) continue;
    const plantsPerCode = new Map(); codes.forEach(c => plantsPerCode.set(c, new Set(grp.filter(r => r.code === c).map(r => r.plant)).size));
    const golden = pickGoldenCode(codes, plantsPerCode);
    const groups = [...new Set(grp.map(r => r.groupMapped).filter(Boolean))];
    const units = [...new Set(grp.map(r => r.unit))];
    const idx = clusters.length;
    clusters.push({ kind: 'loose', desc: lk, codes, golden, groupConflict: groups.length > 1, unitConflict: units.length > 1 });
    codes.forEach(c => { if(!codeToGolden.has(c)) codeToGolden.set(c, golden); });
    descToClusterIdx.set('loose|' + lk, idx);
  }

  const records = enriched.map(r => {
    const reasons = checkNewRuleCompliance(r.descRaw);
    let clusterIdx = descToClusterIdx.get('exact|' + r.descFull);
    if(clusterIdx === undefined) clusterIdx = descToClusterIdx.get('loose|' + r.descLoose);
    return {
      plant: r.plant, groupRaw: r.groupRaw, groupMapped: r.groupMapped, code: r.code,
      descRaw: r.descRaw, descNorm: r.descFull, unit: r.unit,
      quoteIssue: hasQuoteIssue(r.descRaw), needsNorm: r.descRaw !== r.descFull,
      groupMissing: !String(r.groupRaw || '').trim(), unitConflict: codesMultiUnit.has(r.code),
      dupExact: dupFullKeys.has(r.descFull),
      dupLoose: clusterIdx !== undefined && clusters[clusterIdx].kind === 'loose',
      nonCompliant: reasons.length > 0, reasons,
      suggestedCode: codeToGolden.get(r.code) || r.code,
    };
  });

  const kpi = {
    'کل ردیف‌ها': enriched.length,
    'کد کالای یکتا': new Set(enriched.map(r => r.code)).size,
    'خوشه تکرار دقیق': clusters.filter(c => c.kind === 'exact').length,
    'خوشه تکرار نرم (فرمتی)': clusters.filter(c => c.kind === 'loose').length,
    'خوشه با ناهماهنگی گروه': clusters.filter(c => c.groupConflict).length,
    'کد با ناهماهنگی واحد بین پلنت‌ها': codesMultiUnit.size,
    'ردیف با خرابی نقل‌قول': records.filter(r => r.quoteIssue).length,
    'ردیف نیازمند نرمال‌سازی متن': records.filter(r => r.needsNorm).length,
    'ردیف با گروه خالی': records.filter(r => r.groupMissing).length,
    'ردیف ناسازگار با استاندارد نگارش جدید': records.filter(r => r.nonCompliant).length,
  };
  return { kpi, clusters, records };
}

/* ============================================================
   3) وضعیت (state) + persistence
   ============================================================ */
const WORKFLOW_STEPS = [
  ['duplicate_gate', 'گیت جستجوی تکرار'], ['technical', 'تایید فنی'],
  ['commercial', 'تایید بازرگانی'], ['mrp', 'تایید برنامه‌ریزی (MRP)'],
  ['governance', 'تایید نهایی حاکمیت داده'],
];
const STATUS_AFTER = { duplicate_gate: 'pending_technical', technical: 'pending_commercial', commercial: 'pending_mrp', mrp: 'pending_governance', governance: 'active' };
const STATUS_LABELS = {
  pending_technical: 'در انتظار تایید فنی', pending_commercial: 'در انتظار تایید بازرگانی',
  pending_mrp: 'در انتظار تایید MRP', pending_governance: 'در انتظار تایید حاکمیت داده',
  active: 'فعال / صادرشده', rejected: 'رد شده',
};
const KRALJIC_QUADRANTS = {
  'low|low': ['عمومی / غیربحرانی', 'ساده‌سازی خرید، سفارش‌گذاری خودکار/تنکارتی، کاهش هزینه‌ی اداری خرید.'],
  'low|high': ['اهرمی (Leverage)', 'استفاده از قدرت چانه‌زنی، مناقصه/استعلام رقابتی، تجمیع حجم خرید.'],
  'high|low': ['گلوگاهی (Bottleneck)', 'اطمینان از تداوم تامین، موجودی اطمینان، شناسایی منبع جایگزین.'],
  'high|high': ['استراتژیک (Strategic)', 'شراکت بلندمدت با تامین‌کننده، قرارداد چارچوب، مدیریت ریسک مشترک.'],
};
function computeKraljic(risk, impact){
  const rb = risk >= 4 ? 'high' : 'low', ib = impact >= 4 ? 'high' : 'low';
  return KRALJIC_QUADRANTS[rb + '|' + ib];
}

function defaultState(){
  const groupSerials = {}; SEED.groups.forEach(g => groupSerials[g.prefix] = 1);
  return { materials: [], missingValueRequests: [], groupSerials, extraValues: {}, nextId: 1, legacyBatches: [] };
}
let STATE = loadState();
function loadState(){
  try{ const raw = localStorage.getItem(STORAGE_KEY); if(raw) return { ...defaultState(), ...JSON.parse(raw) }; }catch(e){}
  return defaultState();
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); }
function resetDemo(){ if(confirm('همه‌ی داده‌های دمو (کالاهای ثبت‌شده، ارزیابی‌ها، بانک پاکسازی) روی این مرورگر پاک شود؟')){ STATE = defaultState(); saveState(); renderAll(); toast('بازنشانی شد'); } }

/* ============================================================
   4) طبقه‌بندی: ادغام قالب پایه (SEED) + مقادیر افزوده‌شده در دمو
   ============================================================ */
function getItemTypesForGroup(groupName){ return Object.keys(SEED.templates[groupName] ? {} : {}) ; }
function templateFor(groupName){ return SEED.templates[groupName] || []; }
function attributeValues(groupName, itemTypeName, attrName){
  const tpl = templateFor(groupName).find(([n]) => n === itemTypeName);
  let base = [];
  if(tpl){ const a = tpl[1].find(([an]) => an === attrName); if(a) base = a[1]; }
  const key = groupName + '|' + itemTypeName + '|' + attrName;
  const extra = STATE.extraValues[key] || [];
  return [...base.filter(v => v !== SEED.other_value), ...extra, SEED.other_value];
}

/* ============================================================
   5) منطق تعریف کد جدید
   ============================================================ */
function buildDescription(itemTypeName, orderedValues, maxLen){
  const full = [itemTypeName, ...orderedValues.filter(Boolean)].join(' ');
  const short = full.length <= maxLen ? full : full.slice(0, maxLen - 1).trimEnd() + '…';
  return { full, short };
}
function duplicateGate(groupName, fullDescription, excludeMaterialId){
  const key = looseKey(fullDescription);
  const candidates = [];
  STATE.materials.filter(m => m.group === groupName && m.status !== 'rejected' && m.id !== excludeMaterialId).forEach(m => {
    const score = similarityRatio(key, m.descLoose);
    if(score >= 72) candidates.push({ label: m.description, code: m.code || m.draftNo, score, source: 'کالاهای فعال/در جریان تایید' });
  });
  (window.__legacyAnalysis && window.__legacyAnalysis.records || []).filter(r => r.groupMapped === groupName).forEach(r => {
    const score = similarityRatio(key, looseKey(r.descNorm));
    if(score >= 72) candidates.push({ label: r.descNorm, code: r.code, score, source: 'بانک کالای فعلی (پاکسازی‌شده)' });
  });
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] ? candidates[0].score : 0;
  const verdict = top >= 90 ? 'block' : (top >= 72 ? 'warn' : 'pass');
  return { verdict, candidates: candidates.slice(0, 6), looseKey: key };
}
function issueCode(groupPrefix){
  const serial = STATE.groupSerials[groupPrefix] || 1;
  STATE.groupSerials[groupPrefix] = serial + 1;
  return groupPrefix + String(serial).padStart(5, '0');
}

/* ============================================================
   6) روتر / رندر
   ============================================================ */
const VIEWS = ['dashboard', 'wizard', 'bank', 'legacy', 'kraljic', 'classification'];
let currentDetailId = null;
let wizardState = { group: '', itemType: '', selections: {}, unit: '', plants: [], requester: '', ack: false, lastGate: null, lastDesc: null };
let legacyFilter = 'all';

function setTab(tab){
  document.querySelectorAll('.tabstrip button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + tab));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}
document.getElementById('tabstrip').addEventListener('click', e => {
  const btn = e.target.closest('button[data-tab]'); if(!btn) return;
  setTab(btn.dataset.tab);
});

function h(strings, ...vals){ return strings.reduce((acc, s, i) => acc + s + (vals[i] !== undefined ? vals[i] : ''), ''); }
function esc(s){ return String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function renderAll(){
  const root = document.getElementById('views');
  root.innerHTML = VIEWS.map(v => `<section class="view" id="view-${v}"></section>`).join('');
  renderDashboard(); renderWizard(); renderBank(); renderLegacy(); renderKraljic(); renderClassification();
  setTab(document.querySelector('.tabstrip button.active').dataset.tab);
}

/* ---------------- Dashboard ---------------- */
function renderDashboard(){
  const el = document.getElementById('view-dashboard');
  const materials = STATE.materials;
  const active = materials.filter(m => m.status === 'active').length;
  const inProgress = materials.filter(m => m.status !== 'active' && m.status !== 'rejected').length;
  const openReq = STATE.missingValueRequests.filter(r => r.status === 'باز').length;
  const kraljicRows = materials.filter(m => m.kraljic);
  const dist = { 'استراتژیک (Strategic)': 0, 'اهرمی (Leverage)': 0, 'گلوگاهی (Bottleneck)': 0, 'عمومی / غیربحرانی': 0 };
  kraljicRows.forEach(m => dist[m.kraljic.quadrant] = (dist[m.kraljic.quadrant] || 0) + 1);
  const totalK = Object.values(dist).reduce((a, b) => a + b, 0);
  const lastBatch = STATE.legacyBatches[STATE.legacyBatches.length - 1];
  const recent = [...materials].slice(-6).reverse();

  el.innerHTML = h`
    <div class="demo-banner">⚠️ <div>این نسخه یک <strong>دموی کاملاً کارکردی سمت‌کاربر</strong> است — همان منطق نسخه‌ی سرور واقعی (FastAPI)، اما داده‌ها فقط روی همین مرورگر ذخیره می‌شوند. برای استفاده‌ی تیمی با دیتابیس مشترک، نسخه‌ی سرور لازم است.</div></div>
    <h2 class="section-title">داشبورد حاکمیت داده کالا</h2>
    <div class="section-sub">دید یکپارچه‌ی زنجیره تامین: کدینگ، پاکسازی بانک فعلی، طبقه‌بندی خرید</div>
    <div class="grid cols-4">
      <div class="kpi"><div class="l">کل کالاهای ثبت‌شده</div><div class="v">${materials.length}</div></div>
      <div class="kpi"><div class="l">کد فعال/صادرشده</div><div class="v">${active}</div></div>
      <div class="kpi"><div class="l">در جریان تایید</div><div class="v">${inProgress}</div></div>
      <div class="kpi"><div class="l">درخواست مقدار جدید</div><div class="v">${openReq}</div></div>
    </div>

    <div class="card">
      <h3>📦 آخرین بانک کالای عارضه‌یابی‌شده</h3>
      ${lastBatch ? h`
        <p class="text-sm text-muted">${esc(lastBatch.name)} — ${lastBatch.kpi['کل ردیف‌ها']} ردیف</p>
        <div class="grid cols-2">
          ${Object.entries(lastBatch.kpi).map(([k,v]) => h`<div class="text-sm flex-between" style="border-bottom:1px solid var(--border); padding:5px 0;"><span class="text-muted">${esc(k)}</span><strong class="mono">${v}</strong></div>`).join('')}
        </div>
        <div class="btn-row" style="margin-top:12px;"><button class="btn sm primary" onclick="setTab('legacy')">مشاهده گزارش کامل</button></div>
      ` : h`<div class="empty"><div class="icon">🗂️</div><p>هنوز بانکی عارضه‌یابی نشده.</p><button class="btn sm primary" onclick="setTab('legacy')">شروع</button></div>`}
    </div>

    <div class="card">
      <h3>🧭 توزیع ماتریس کرالجیک</h3>
      ${totalK ? Object.entries(dist).map(([label, cnt]) => h`
        <div style="margin-bottom:9px;">
          <div class="flex-between text-sm"><span>${esc(label)}</span><strong class="mono">${cnt}</strong></div>
          <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:6px; height:7px; overflow:hidden;"><div style="background:var(--brand); height:100%; width:${totalK ? cnt/totalK*100 : 0}%;"></div></div>
        </div>`).join('') : h`<div class="empty"><div class="icon">📐</div><p>هنوز ارزیابی کرالجیک ثبت نشده.</p></div>`}
    </div>

    <div class="card">
      <h3>🗃️ کالاهای اخیر</h3>
      ${recent.length ? h`<div class="table-wrap"><table><thead><tr><th>کد</th><th>شرح</th><th>وضعیت</th><th></th></tr></thead><tbody>
        ${recent.map(m => h`<tr><td class="mono">${esc(m.code || m.draftNo)}</td><td>${esc(m.description)}</td><td>${statusBadge(m.status)}</td><td><button class="btn sm" onclick="openDetail(${m.id})">مشاهده</button></td></tr>`).join('')}
      </tbody></table></div>` : h`<div class="empty"><div class="icon">📭</div><p>هنوز کالایی ثبت نشده.</p></div>`}
    </div>

    <div class="card">
      <h3>🏭 توزیع در گروه‌های استاندارد</h3>
      <div class="grid cols-2">
        ${SEED.groups.map(g => {
          const cnt = materials.filter(m => m.group === g.name).length;
          return h`<div class="flex-between text-sm" style="padding:6px 0; border-bottom:1px solid var(--border);"><span>${g.prefix} — ${esc(g.name)}</span><strong class="mono">${cnt}</strong></div>`;
        }).join('')}
      </div>
    </div>
    <div class="btn-row" style="margin-top:16px;"><button class="btn sm" onclick="resetDemo()">🗑️ بازنشانی داده‌های دمو</button></div>
  `;
}
function statusBadge(status){
  const cls = status === 'active' ? 'brand' : (status === 'rejected' ? 'red' : 'amber');
  return `<span class="badge ${cls}">${esc(STATUS_LABELS[status] || status)}</span>`;
}

/* ---------------- Wizard ---------------- */
function renderWizard(){
  const el = document.getElementById('view-wizard');
  el.innerHTML = h`
    <h2 class="section-title">ثبت درخواست کالای جدید</h2>
    <div class="section-sub">همه‌چیز از فهرست انتخاب می‌شود — شرح استاندارد خودکار ساخته می‌شود؛ کد فقط بعد از تایید نهایی صادر می‌شود.</div>
    <div class="steps">
      <div class="step ${wStep() >= 1 ? (wStep() > 1 ? 'done' : 'active') : ''}">۱ طبقه‌بندی</div>
      <div class="step ${wStep() >= 2 ? (wStep() > 2 ? 'done' : 'active') : ''}">۲ ویژگی‌ها</div>
      <div class="step ${wStep() >= 3 ? (wStep() > 3 ? 'done' : 'active') : ''}">۳ واحد و پلنت‌ها</div>
      <div class="step ${wStep() >= 4 ? 'active' : ''}">۴ گیت تکرار و ثبت</div>
    </div>
    <div class="two-col">
      <div>
        <div class="card">
          <h3>۱) طبقه‌بندی کالا</h3>
          <div class="grid cols-2">
            <div class="field"><label>گروه اصلی</label>
              <select id="w-group">
                <option value="">— انتخاب کنید —</option>
                ${SEED.groups.map(g => h`<option value="${esc(g.name)}" ${wizardState.group === g.name ? 'selected' : ''}>${g.prefix} — ${esc(g.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field"><label>نوع کالا</label>
              <select id="w-itemtype" ${wizardState.group ? '' : 'disabled'}>
                <option value="">— انتخاب کنید —</option>
                ${wizardState.group ? templateFor(wizardState.group).map(([name]) => h`<option value="${esc(name)}" ${wizardState.itemType === name ? 'selected' : ''}>${esc(name)}</option>`).join('') : ''}
              </select>
            </div>
          </div>
        </div>
        ${wizardState.itemType ? renderWizardAttrs() : ''}
        ${wizardState.itemType ? renderWizardUnitPlant() : ''}
      </div>
      <div>
        <div class="card">
          <h3>پیش‌نمایش شرح خودکار</h3>
          <div id="w-preview">${renderWizardPreview()}</div>
        </div>
      </div>
    </div>
  `;
  bindWizardEvents();
}
function wStep(){
  if(!wizardState.group) return 1;
  if(!wizardState.itemType) return 1;
  const tpl = templateFor(wizardState.group).find(([n]) => n === wizardState.itemType);
  const attrs = tpl ? tpl[1] : [];
  const complete = attrs.every(([name]) => wizardState.selections[name] && wizardState.selections[name] !== SEED.other_value);
  if(!complete) return 2;
  if(!wizardState.plants.length) return 3;
  return 4;
}
function renderWizardAttrs(){
  const tpl = templateFor(wizardState.group).find(([n]) => n === wizardState.itemType);
  const attrs = tpl ? tpl[1] : [];
  return h`<div class="card">
    <h3>۲) ویژگی‌های استاندارد (قالب ثابت این نوع کالا)</h3>
    <div class="grid cols-2">
      ${attrs.map(([attrName]) => {
        const values = attributeValues(wizardState.group, wizardState.itemType, attrName);
        const sel = wizardState.selections[attrName] || '';
        return h`<div class="field">
          <label>${esc(attrName)} *</label>
          <select class="w-attr" data-attr="${esc(attrName)}">
            <option value="">— انتخاب کنید —</option>
            ${values.map(v => h`<option value="${esc(v)}" ${sel === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
          </select>
          ${sel === SEED.other_value ? h`<div class="hint" style="color:var(--amber);">مقدار مناسبی نیست؟ <button type="button" class="btn sm" onclick="requestMissingValue('${esc(attrName)}')">درخواست افزودن برای حاکمیت داده</button></div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <p class="hint text-sm">اگر مقدار مناسب نبود، «سایر» را انتخاب و درخواست افزودن ثبت کنید — نیازی به تایپ نیست.</p>
  </div>`;
}
function renderWizardUnitPlant(){
  return h`<div class="card">
    <h3>۳) واحد اندازه‌گیری و پلنت‌ها</h3>
    <div class="grid cols-2">
      <div class="field"><label>واحد اندازه‌گیری</label>
        <select id="w-unit">${SEED.units.map(u => h`<option value="${esc(u.name)}" ${wizardState.unit === u.name ? 'selected' : ''}>${esc(u.name)} (${esc(u.symbol)})</option>`).join('')}</select>
      </div>
      <div class="field"><label>درخواست‌دهنده</label>
        <select id="w-requester">${SEED.users.filter(u => u.role === 'submitter').map(u => h`<option value="${esc(u.name)}" ${wizardState.requester === u.name ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="field"><label>پلنت‌های مصرف‌کننده</label>
      <div class="tag-list">
        ${SEED.plants.map(p => h`<label class="chk"><input type="checkbox" class="w-plant" value="${esc(p.name)}" ${wizardState.plants.includes(p.name) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('')}
      </div>
    </div>
  </div>`;
}
function renderWizardPreview(){
  if(wStep() < 3){
    return h`<div class="empty" style="padding:20px 6px;"><div class="icon">📝</div><p class="text-sm">با تکمیل ویژگی‌ها، شرح استاندارد اینجا ساخته می‌شود.</p></div>`;
  }
  const tpl = templateFor(wizardState.group).find(([n]) => n === wizardState.itemType);
  const attrs = tpl ? tpl[1] : [];
  const orderedValues = attrs.map(([name]) => wizardState.selections[name]);
  const { full, short } = buildDescription(wizardState.itemType, orderedValues, 40);
  wizardState.lastDesc = { full, short };
  const gate = duplicateGate(wizardState.group, full, null);
  wizardState.lastGate = gate;
  const cls = gate.verdict === 'block' ? 'block' : (gate.verdict === 'warn' ? 'warn' : 'pass');
  const title = gate.verdict === 'block' ? '⛔ احتمال بسیار بالای تکرار — ثبت مسدود است'
    : gate.verdict === 'warn' ? '⚠️ موارد مشابه یافت شد — بررسی کنید' : '✅ موردی مشابه یافت نشد';
  const canSubmit = wizardState.plants.length > 0 && (gate.verdict === 'pass' || (gate.verdict === 'warn' && wizardState.ack));
  return h`
    <div class="desc-preview">${esc(full)}<span class="short">شرح کوتاه SAP (≤۴۰ نویسه): ${esc(short)}</span></div>
    <div class="gate-box ${cls}"><strong>${title}</strong>
      ${gate.candidates.length ? h`<ul>${gate.candidates.map(c => h`<li>${esc(c.label)} <span class="badge gray">${esc(c.code)}</span> — شباهت ${c.score}٪ (${esc(c.source)})</li>`).join('')}</ul>` : ''}
    </div>
    ${gate.verdict === 'warn' ? h`<label class="chk" style="margin-bottom:10px;"><input type="checkbox" id="w-ack" ${wizardState.ack ? 'checked' : ''}> موارد مشابه را بررسی کردم، کالای جدیدی است</label>` : ''}
    <button class="btn primary block" id="w-submit" ${canSubmit ? '' : 'disabled'}>ثبت درخواست (ورود به گردش تایید)</button>
    ${!wizardState.plants.length ? h`<p class="hint text-sm" style="color:var(--red);">حداقل یک پلنت مصرف‌کننده را انتخاب کنید.</p>` : ''}
  `;
}
function bindWizardEvents(){
  const g = document.getElementById('w-group');
  if(g) g.onchange = () => { wizardState = { ...wizardState, group: g.value, itemType: '', selections: {}, plants: [], ack: false }; renderWizard(); };
  const it = document.getElementById('w-itemtype');
  if(it) it.onchange = () => { wizardState.itemType = it.value; wizardState.selections = {}; wizardState.ack = false; renderWizard(); };
  document.querySelectorAll('.w-attr').forEach(sel => sel.onchange = () => {
    wizardState.selections[sel.dataset.attr] = sel.value; wizardState.ack = false; renderWizard();
  });
  const unit = document.getElementById('w-unit'); if(unit) unit.onchange = () => wizardState.unit = unit.value;
  const req = document.getElementById('w-requester'); if(req) req.onchange = () => wizardState.requester = req.value;
  document.querySelectorAll('.w-plant').forEach(chk => chk.onchange = () => {
    wizardState.plants = [...document.querySelectorAll('.w-plant:checked')].map(c => c.value);
    document.getElementById('w-preview').innerHTML = renderWizardPreview();
    bindPreviewEvents();
  });
  bindPreviewEvents();
}
function bindPreviewEvents(){
  const ack = document.getElementById('w-ack');
  if(ack) ack.onchange = () => { wizardState.ack = ack.checked; document.getElementById('w-preview').innerHTML = renderWizardPreview(); bindPreviewEvents(); };
  const submit = document.getElementById('w-submit');
  if(submit) submit.onclick = submitWizard;
}
function requestMissingValue(attrName){
  STATE.missingValueRequests.push({
    id: STATE.nextId++, group: wizardState.group, itemType: wizardState.itemType, attribute: attrName,
    requestedBy: wizardState.requester || SEED.users.find(u => u.role === 'submitter').name, status: 'باز',
    createdAt: new Date().toISOString(),
  });
  saveState();
  toast('درخواست برای واحد حاکمیت داده ثبت شد.');
  renderClassification();
}
function submitWizard(){
  if(!wizardState.unit) wizardState.unit = SEED.units[0].name;
  if(!wizardState.requester) wizardState.requester = SEED.users.find(u => u.role === 'submitter').name;
  const group = SEED.groups.find(g => g.name === wizardState.group);
  const { full, short } = wizardState.lastDesc;
  const tpl = templateFor(wizardState.group).find(([n]) => n === wizardState.itemType);
  const attrs = (tpl ? tpl[1] : []).map(([name]) => ({ name, value: wizardState.selections[name] }));
  const material = {
    id: STATE.nextId++, draftNo: 'DRAFT-' + String(STATE.materials.length + 1).padStart(6, '0'), code: null,
    group: wizardState.group, groupPrefix: group.prefix, itemType: wizardState.itemType,
    attributes: attrs, unit: wizardState.unit, plants: [...wizardState.plants],
    description: full, descriptionShort: short, descLoose: looseKey(full),
    status: 'pending_technical', requestedBy: wizardState.requester, createdAt: new Date().toISOString(),
    duplicateCandidates: wizardState.lastGate.candidates,
    approvalSteps: WORKFLOW_STEPS.map(([key, label]) => ({
      key, label,
      status: key === 'duplicate_gate' ? 'approved' : 'pending',
      actor: key === 'duplicate_gate' ? 'سیستم (گیت خودکار)' : '',
      actedAt: key === 'duplicate_gate' ? new Date().toISOString() : null,
      comment: key === 'duplicate_gate' ? (wizardState.lastGate.candidates.length ? `نتیجه: ${wizardState.lastGate.verdict} — ${wizardState.lastGate.candidates.length} مورد مشابه یافت شد.` : 'موردی مشابه یافت نشد.') : '',
    })),
    datasheet: null, kraljic: null,
  };
  STATE.materials.push(material);
  saveState();
  wizardState = { group: '', itemType: '', selections: {}, unit: '', plants: [], requester: '', ack: false, lastGate: null, lastDesc: null };
  toast('درخواست ثبت شد ✔');
  renderDashboard(); renderWizard(); renderBank();
  openDetail(material.id);
}

/* ---------------- Bank (list + detail) ---------------- */
function renderBank(){
  const el = document.getElementById('view-bank');
  if(currentDetailId){ renderMaterialDetail(el); return; }
  el.innerHTML = h`
    <h2 class="section-title">بانک کالا</h2>
    <div class="section-sub">کالاهای ثبت‌شده در سامانه (فعال و در جریان تایید)</div>
    ${STATE.materials.length ? h`<div class="table-wrap"><table><thead><tr><th>کد</th><th>شرح</th><th>گروه</th><th>وضعیت</th><th></th></tr></thead><tbody>
      ${[...STATE.materials].reverse().map(m => h`<tr>
        <td class="mono">${esc(m.code || m.draftNo)}</td><td>${esc(m.description)}</td><td>${esc(m.group)}</td>
        <td>${statusBadge(m.status)}</td><td><button class="btn sm" onclick="openDetail(${m.id})">مشاهده</button></td>
      </tr>`).join('')}
    </tbody></table></div>` : h`<div class="empty"><div class="icon">📭</div><p>هنوز کالایی ثبت نشده.</p><button class="btn sm primary" onclick="setTab('wizard')">+ ثبت کالای جدید</button></div>`}
  `;
}
function openDetail(id){ currentDetailId = id; setTab('bank'); renderBank(); }
function closeDetail(){ currentDetailId = null; renderBank(); }
function renderMaterialDetail(el){
  const m = STATE.materials.find(x => x.id === currentDetailId);
  if(!m){ currentDetailId = null; renderBank(); return; }
  const nextStepKey = m.status.startsWith('pending_') ? m.status.replace('pending_', '') : null;
  el.innerHTML = h`
    <button class="btn sm" style="margin-bottom:12px;" onclick="closeDetail()">← بازگشت به بانک کالا</button>
    <div class="flex-between" style="margin-bottom:6px;">
      <h2 class="section-title mono" style="margin-bottom:0;">${esc(m.code || m.draftNo)}</h2>
      ${statusBadge(m.status)}
    </div>
    <div class="section-sub">${esc(m.description)}</div>

    <div class="card">
      <h3>مشخصات کالا</h3>
      <div class="grid cols-2 text-sm">
        <div><span class="text-muted">گروه:</span> ${esc(m.group)}</div>
        <div><span class="text-muted">نوع کالا:</span> ${esc(m.itemType)}</div>
        <div><span class="text-muted">واحد:</span> ${esc(m.unit)}</div>
        <div><span class="text-muted">درخواست‌دهنده:</span> ${esc(m.requestedBy)}</div>
      </div>
      <div class="tag-list" style="margin-top:8px;">${m.plants.map(p => `<span class="badge blue">${esc(p)}</span>`).join('')}</div>
      <div class="divider"></div>
      <div class="table-wrap"><table><thead><tr><th>ویژگی</th><th>مقدار</th></tr></thead><tbody>
        ${m.attributes.map(a => h`<tr><td>${esc(a.name)}</td><td>${esc(a.value)}</td></tr>`).join('')}
      </tbody></table></div>
    </div>

    <div class="card">
      <h3>🔄 گردش تایید</h3>
      <div class="timeline">
        ${m.approvalSteps.map(s => h`<div class="tl">
          <div class="tl-dot ${s.status}">${s.status === 'approved' ? '✓' : s.status === 'rejected' ? '✕' : '…'}</div>
          <div style="flex:1;">
            <div class="tl-title">${esc(s.label)}</div>
            ${s.status !== 'pending' ? h`<div class="tl-meta">${esc(s.actor)} — ${s.actedAt ? new Date(s.actedAt).toLocaleString('fa-IR') : ''}</div>${s.comment ? `<div class="tl-comment">${esc(s.comment)}</div>` : ''}`
              : (s.key === nextStepKey ? h`
                <div class="field" style="margin:8px 0 4px;"><label>تاییدکننده</label>
                  <select id="approve-actor">${SEED.users.filter(u => u.role === s.key).map(u => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('')}</select>
                </div>
                <input type="text" id="approve-comment" placeholder="یادداشت (اختیاری)" style="margin-bottom:8px;">
                <div class="btn-row"><button class="btn sm primary" onclick="approveStep('${s.key}','approve')">تایید</button><button class="btn sm danger" onclick="approveStep('${s.key}','reject')">رد</button></div>
              ` : `<div class="tl-meta">در انتظار مرحله‌ی قبل</div>`)}
          </div>
        </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <h3>📋 دیتاشیت خرید</h3>
      <div class="grid cols-2">
        <div class="field"><label>سازنده</label><input type="text" id="ds-manufacturer" value="${esc(m.datasheet?.manufacturer || '')}"></div>
        <div class="field"><label>برند</label><input type="text" id="ds-brand" value="${esc(m.datasheet?.brand || '')}"></div>
      </div>
      <div class="field"><label>مدل/کد کاتالوگ</label><input type="text" id="ds-model" value="${esc(m.datasheet?.model || '')}"></div>
      <div class="grid cols-2">
        <div class="field"><label>مبدا تامین</label><select id="ds-origin">${['داخلی','وارداتی - آسیا','وارداتی - اروپا','وارداتی - سایر'].map(o => `<option ${m.datasheet?.origin===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label>Incoterm</label><select id="ds-incoterm"><option value="">—</option>${['EXW','FCA','FOB','CFR','CIF','DAP','DDP'].map(o => `<option ${m.datasheet?.incoterm===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label>بازه زمان تحویل</label><select id="ds-lead"><option value="">—</option>${['کمتر از ۱ هفته','۱ تا ۲ هفته','۲ تا ۴ هفته','۱ تا ۳ ماه','بیش از ۳ ماه'].map(o => `<option ${m.datasheet?.lead===o?'selected':''}>${o}</option>`).join('')}</select></div>
        <div class="field"><label>بازه قیمت</label><select id="ds-price"><option value="">—</option>${['زیر ۱۰ میلیون ریال','۱۰ تا ۱۰۰ میلیون ریال','۱۰۰ میلیون تا ۱ میلیارد ریال','بالای ۱ میلیارد ریال'].map(o => `<option ${m.datasheet?.price===o?'selected':''}>${o}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>حداقل سفارش (MOQ)</label><input type="text" id="ds-moq" value="${esc(m.datasheet?.moq || '')}"></div>
      <button class="btn primary block" onclick="saveDatasheet()">ذخیره دیتاشیت</button>
    </div>

    <div class="card">
      <h3>🧭 ماتریس کرالجیک</h3>
      <div class="grid cols-2">
        <div class="field"><label>ریسک تامین (۱=کم … ۵=زیاد)</label><select id="kr-risk">${[1,2,3,4,5].map(i => `<option value="${i}" ${m.kraljic?.risk===i?'selected':''}>${i}</option>`).join('')}</select></div>
        <div class="field"><label>تاثیر بر هزینه/سود (۱=کم … ۵=زیاد)</label><select id="kr-impact">${[1,2,3,4,5].map(i => `<option value="${i}" ${m.kraljic?.impact===i?'selected':''}>${i}</option>`).join('')}</select></div>
      </div>
      <button class="btn primary block" onclick="saveKraljic()">ثبت ارزیابی</button>
      <div id="kr-result" style="margin-top:10px;">${m.kraljic ? h`<div class="gate-box pass"><strong>${esc(m.kraljic.quadrant)}</strong><p style="margin-top:4px;">${esc(m.kraljic.note)}</p></div>` : ''}</div>
    </div>
  `;
}
function approveStep(stepKey, decision){
  const m = STATE.materials.find(x => x.id === currentDetailId);
  const step = m.approvalSteps.find(s => s.key === stepKey);
  const actor = document.getElementById('approve-actor').value;
  const comment = document.getElementById('approve-comment').value;
  step.status = decision === 'approve' ? 'approved' : 'rejected';
  step.actor = actor; step.actedAt = new Date().toISOString(); step.comment = comment;
  if(decision === 'approve'){
    m.status = STATUS_AFTER[stepKey];
    if(stepKey === 'governance') m.code = issueCode(m.groupPrefix);
  } else { m.status = 'rejected'; }
  saveState();
  toast(decision === 'approve' ? 'تایید شد ✔' : 'رد شد');
  renderBank(); renderDashboard();
}
function saveDatasheet(){
  const m = STATE.materials.find(x => x.id === currentDetailId);
  m.datasheet = {
    manufacturer: document.getElementById('ds-manufacturer').value, brand: document.getElementById('ds-brand').value,
    model: document.getElementById('ds-model').value, origin: document.getElementById('ds-origin').value,
    incoterm: document.getElementById('ds-incoterm').value, lead: document.getElementById('ds-lead').value,
    price: document.getElementById('ds-price').value, moq: document.getElementById('ds-moq').value,
  };
  saveState(); toast('دیتاشیت ذخیره شد ✔');
}
function saveKraljic(){
  const m = STATE.materials.find(x => x.id === currentDetailId);
  const risk = parseInt(document.getElementById('kr-risk').value), impact = parseInt(document.getElementById('kr-impact').value);
  const [quadrant, note] = computeKraljic(risk, impact);
  m.kraljic = { risk, impact, quadrant, note };
  saveState();
  document.getElementById('kr-result').innerHTML = h`<div class="gate-box pass"><strong>${esc(quadrant)}</strong><p style="margin-top:4px;">${esc(note)}</p></div>`;
  renderDashboard();
  renderKraljic();
}

/* ---------------- Legacy cleanup ---------------- */
function renderLegacy(){
  const el = document.getElementById('view-legacy');
  const batch = STATE.legacyBatches[STATE.legacyBatches.length - 1];
  el.innerHTML = h`
    <h2 class="section-title">عارضه‌یابی و پاکسازی بانک کالای فعلی</h2>
    <div class="section-sub">فایل CSV (پلنت، Material Group، کد کالا، شرح کالا، واحد) بارگذاری کنید یا داده‌ی نمونه را امتحان کنید.</div>
    <div class="card">
      <h3>📤 بارگذاری</h3>
      <div class="field"><label>فایل CSV</label><input type="file" id="legacy-file" accept=".csv"></div>
      <div class="btn-row">
        <button class="btn primary" onclick="uploadLegacyCsv()">تحلیل فایل CSV</button>
        <button class="btn" onclick="loadLegacySample()">بارگذاری داده نمونه (دمو)</button>
      </div>
      <p class="hint text-sm">نسخه‌ی سرور واقعی از فایل اکسل (xlsx) پشتیبانی می‌کند؛ این دمو برای سادگی CSV می‌پذیرد.</p>
    </div>
    <div id="legacy-report">${batch ? renderLegacyReport(batch) : h`<div class="empty"><div class="icon">🗂️</div><p>هنوز فایلی بارگذاری نشده.</p></div>`}</div>
  `;
}
function loadLegacySample(){
  const result = analyzeLegacy(LEGACY_SAMPLE);
  window.__legacyAnalysis = result;
  STATE.legacyBatches.push({ name: 'sample_legacy_demo.csv', importedAt: new Date().toISOString(), ...result });
  saveState();
  legacyFilter = 'all';
  document.getElementById('legacy-report').innerHTML = renderLegacyReport(STATE.legacyBatches[STATE.legacyBatches.length - 1]);
  renderDashboard();
  toast('داده‌ی نمونه بارگذاری شد');
}
function parseCsv(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {}; headers.forEach((h, i) => row[h] = (cells[i] || '').trim());
    return row;
  });
}
function uploadLegacyCsv(){
  const input = document.getElementById('legacy-file');
  if(!input.files.length){ toast('ابتدا یک فایل CSV انتخاب کنید'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const rows = parseCsv(reader.result);
      const required = ['پلنت', 'Material Group', 'کد کالا', 'شرح کالا', 'واحد'];
      const missing = required.filter(c => !(c in (rows[0] || {})));
      if(missing.length){ toast('ستون‌های زیر یافت نشد: ' + missing.join('، ')); return; }
      const result = analyzeLegacy(rows);
      window.__legacyAnalysis = result;
      STATE.legacyBatches.push({ name: input.files[0].name, importedAt: new Date().toISOString(), ...result });
      saveState();
      legacyFilter = 'all';
      document.getElementById('legacy-report').innerHTML = renderLegacyReport(STATE.legacyBatches[STATE.legacyBatches.length - 1]);
      renderDashboard();
      toast('تحلیل انجام شد ✔');
    }catch(e){ toast('خطا در خواندن فایل: ' + e.message); }
  };
  reader.readAsText(input.files[0], 'utf-8');
}
function renderLegacyReport(batch){
  const filters = [['all','همه'],['duplicate','تکراری'],['non_compliant','ناسازگار با استاندارد جدید'],['unit_conflict','ناهماهنگی واحد'],['group_missing','گروه خالی']];
  let records = batch.records;
  if(legacyFilter === 'duplicate') records = records.filter(r => r.dupExact || r.dupLoose);
  else if(legacyFilter === 'non_compliant') records = records.filter(r => r.nonCompliant);
  else if(legacyFilter === 'unit_conflict') records = records.filter(r => r.unitConflict);
  else if(legacyFilter === 'group_missing') records = records.filter(r => r.groupMissing);

  return h`
    <div class="card">
      <div class="flex-between"><h3 style="margin:0;">گزارش: ${esc(batch.name)}</h3></div>
      <div class="grid cols-4" style="margin-top:10px;">
        ${Object.entries(batch.kpi).map(([k,v]) => h`<div class="kpi"><div class="l">${esc(k)}</div><div class="v">${v}</div></div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h3>🧩 خوشه‌های تکراری</h3>
      ${batch.clusters.length ? h`<div class="table-wrap"><table><thead><tr><th>نوع</th><th>شرح</th><th>کدها</th><th>طلایی</th><th>ناهماهنگی گروه</th></tr></thead><tbody>
        ${batch.clusters.map(c => h`<tr>
          <td><span class="badge ${c.kind==='exact'?'brand':'blue'}">${c.kind==='exact'?'دقیق':'فرمتی'}</span></td>
          <td>${esc(c.desc)}</td><td>${c.codes.map(x=>`<span class="badge gray">${esc(x)}</span>`).join(' ')}</td>
          <td class="mono">${esc(c.golden)}</td><td>${c.groupConflict ? '<span class="badge red">بله</span>' : '<span class="badge gray">خیر</span>'}</td>
        </tr>`).join('')}
      </tbody></table></div>` : h`<div class="empty"><div class="icon">✅</div><p>خوشه‌ی تکراری یافت نشد.</p></div>`}
    </div>
    <div class="card">
      <h3>📋 ردیف‌های بانک</h3>
      <div class="pill-filters">${filters.map(([k,l]) => h`<button class="${legacyFilter===k?'active':''}" onclick="setLegacyFilter('${k}')">${l}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>پلنت</th><th>کد</th><th>گروه</th><th>شرح خام</th><th>شرح پیشنهادی</th><th>مسائل</th></tr></thead><tbody>
        ${records.map(r => h`<tr>
          <td>${esc(r.plant)}</td><td class="mono">${esc(r.code)}</td><td>${esc(r.groupMapped)}</td>
          <td>${esc(r.descRaw)}</td><td>${esc(r.descNorm)}</td>
          <td>
            ${r.dupExact ? '<span class="badge red">تکرار دقیق</span>' : ''}
            ${r.dupLoose ? '<span class="badge amber">تکرار فرمتی</span>' : ''}
            ${r.quoteIssue ? '<span class="badge amber">نقل‌قول</span>' : ''}
            ${r.unitConflict ? '<span class="badge red">واحد</span>' : ''}
            ${r.groupMissing ? '<span class="badge red">گروه خالی</span>' : ''}
            ${r.nonCompliant ? `<span class="badge blue" title="${esc(r.reasons.join(' | '))}">ناسازگار</span>` : ''}
          </td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>
  `;
}
function setLegacyFilter(k){
  legacyFilter = k;
  const batch = STATE.legacyBatches[STATE.legacyBatches.length - 1];
  document.getElementById('legacy-report').innerHTML = renderLegacyReport(batch);
}

/* ---------------- Kraljic overview ---------------- */
function renderKraljic(){
  const el = document.getElementById('view-kraljic');
  const points = STATE.materials.filter(m => m.kraljic).map(m => ({ code: m.code || m.draftNo, desc: m.description, group: m.group, x: m.kraljic.risk, y: m.kraljic.impact, quadrant: m.kraljic.quadrant }));
  const margin = 44, plot = 300, size = margin * 2 + plot;
  el.innerHTML = h`
    <h2 class="section-title">ماتریس کرالجیک خرید</h2>
    <div class="section-sub">دسته‌بندی کالاها بر اساس ریسک تامین و تاثیر بر هزینه/سود</div>
    <div class="card">
      <div style="overflow-x:auto;">
      <svg viewBox="0 0 ${size+30} ${size}" width="100%" style="max-width:520px; display:block; margin:0 auto;">
        <rect x="${margin}" y="${margin}" width="${plot/2}" height="${plot/2}" fill="var(--blue-100)"/>
        <rect x="${margin+plot/2}" y="${margin}" width="${plot/2}" height="${plot/2}" fill="var(--red-100)"/>
        <rect x="${margin}" y="${margin+plot/2}" width="${plot/2}" height="${plot/2}" fill="var(--surface-2)"/>
        <rect x="${margin+plot/2}" y="${margin+plot/2}" width="${plot/2}" height="${plot/2}" fill="var(--amber-100)"/>
        <text x="${margin+plot/4}" y="${margin+16}" text-anchor="middle" font-size="10" fill="var(--blue)">اهرمی</text>
        <text x="${margin+plot*3/4}" y="${margin+16}" text-anchor="middle" font-size="10" fill="var(--red)">استراتژیک</text>
        <text x="${margin+plot/4}" y="${margin+plot-6}" text-anchor="middle" font-size="10" fill="var(--ink-500)">عمومی</text>
        <text x="${margin+plot*3/4}" y="${margin+plot-6}" text-anchor="middle" font-size="10" fill="var(--amber)">گلوگاهی</text>
        <line x1="${margin}" y1="${margin}" x2="${margin}" y2="${margin+plot}" stroke="var(--ink-300)"/>
        <line x1="${margin}" y1="${margin+plot}" x2="${margin+plot}" y2="${margin+plot}" stroke="var(--ink-300)"/>
        <text x="${margin+plot/2}" y="${size-6}" text-anchor="middle" font-size="10" fill="var(--ink-500)">ریسک تامین →</text>
        ${points.map(p => {
          const px = margin + (p.x - 1) / 4 * plot, py = margin + (5 - p.y) / 4 * plot;
          return `<circle cx="${px}" cy="${py}" r="6" fill="var(--brand)" stroke="var(--surface)" stroke-width="1.5"><title>${esc(p.code)} — ${esc(p.desc)}</title></circle>`;
        }).join('')}
      </svg>
      </div>
    </div>
    <div class="card">
      <h3>فهرست ارزیابی‌شده‌ها</h3>
      ${points.length ? h`<div class="table-wrap"><table><thead><tr><th>کد</th><th>شرح</th><th>ریسک</th><th>تاثیر</th><th>ربع</th></tr></thead><tbody>
        ${points.map(p => h`<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.desc)}</td><td>${p.x}</td><td>${p.y}</td><td><span class="badge blue">${esc(p.quadrant)}</span></td></tr>`).join('')}
      </tbody></table></div>` : h`<div class="empty"><div class="icon">📐</div><p>هنوز ارزیابی ثبت نشده. از جزئیات هر کالا در «بانک کالا» ثبت کنید.</p></div>`}
    </div>
  `;
}

/* ---------------- Classification admin ---------------- */
function renderClassification(){
  const el = document.getElementById('view-classification');
  const openReqs = STATE.missingValueRequests.filter(r => r.status === 'باز');
  el.innerHTML = h`
    <h2 class="section-title">مدیریت طبقه‌بندی (ویژه حاکمیت داده)</h2>
    <div class="section-sub">۱۸ گروه اصلی قفل هستند. نوع کالا/ویژگی/مقدار از همین‌جا توسعه می‌یابد.</div>
    ${openReqs.length ? h`<div class="card">
      <h3>🔔 درخواست‌های باز افزودن مقدار (${openReqs.length})</h3>
      <div class="table-wrap"><table><thead><tr><th>گروه</th><th>نوع کالا</th><th>ویژگی</th><th>درخواست‌دهنده</th><th></th></tr></thead><tbody>
        ${openReqs.map(r => h`<tr>
          <td>${esc(r.group)}</td><td>${esc(r.itemType)}</td><td>${esc(r.attribute)}</td><td>${esc(r.requestedBy)}</td>
          <td><div class="btn-row"><input type="text" id="newval-${r.id}" placeholder="مقدار جدید" style="width:120px;"><button class="btn sm primary" onclick="resolveRequest(${r.id})">افزودن</button></div></td>
        </tr>`).join('')}
      </tbody></table></div>
    </div>` : ''}
    <div class="card">
      <h3>📚 مرور طبقه‌بندی</h3>
      ${SEED.groups.map(g => {
        const tpl = templateFor(g.name);
        return h`<details style="margin-bottom:8px; border:1px solid var(--border); border-radius:10px; padding:8px 12px;">
          <summary style="cursor:pointer; font-weight:700; font-size:13px;">${g.prefix} — ${esc(g.name)} <span class="badge gray">${tpl.length} نوع کالا</span></summary>
          <div style="margin-top:8px;">
            ${tpl.map(([itemTypeName, attrs]) => h`
              <div style="background:var(--surface-2); border-radius:9px; padding:9px 11px; margin-bottom:7px;">
                <strong class="text-sm">${esc(itemTypeName)}</strong>
                ${attrs.map(([attrName]) => h`
                  <div style="margin-top:6px; padding-inline-start:10px; border-inline-start:2px solid var(--border);">
                    <div class="text-sm">${esc(attrName)}</div>
                    <div class="tag-list" style="margin-top:4px;">
                      ${attributeValues(g.name, itemTypeName, attrName).map(v => `<span class="badge ${v===SEED.other_value?'red':'gray'}">${esc(v)}</span>`).join('')}
                    </div>
                  </div>
                `).join('')}
              </div>
            `).join('')}
          </div>
        </details>`;
      }).join('')}
    </div>
  `;
}
function resolveRequest(reqId){
  const req = STATE.missingValueRequests.find(r => r.id === reqId);
  const val = document.getElementById('newval-' + reqId).value.trim();
  if(!val){ toast('مقدار را وارد کنید'); return; }
  const key = req.group + '|' + req.itemType + '|' + req.attribute;
  if(!STATE.extraValues[key]) STATE.extraValues[key] = [];
  STATE.extraValues[key].push(val);
  req.status = 'برطرف‌شد';
  saveState();
  toast('مقدار افزوده و درخواست برطرف شد ✔');
  renderClassification();
}

/* ============================================================
   7) بوت
   ============================================================ */
window.setTab = setTab; window.openDetail = openDetail; window.closeDetail = closeDetail;
window.approveStep = approveStep; window.saveDatasheet = saveDatasheet; window.saveKraljic = saveKraljic;
window.requestMissingValue = requestMissingValue; window.resolveRequest = resolveRequest;
window.loadLegacySample = loadLegacySample; window.uploadLegacyCsv = uploadLegacyCsv; window.setLegacyFilter = setLegacyFilter;
window.resetDemo = resetDemo;

if(STATE.legacyBatches.length){ window.__legacyAnalysis = STATE.legacyBatches[STATE.legacyBatches.length - 1]; }
renderAll();
