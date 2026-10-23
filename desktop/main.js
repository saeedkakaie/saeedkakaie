/*
 * نسخه رومیزی ویندوز (فاز ۸): پوسته Electron برای برنامه IBP گروه زر.
 *
 *   پنجره     برنامه (پوشه app) را مستقیم از فایل باز می‌کند؛ داده‌ها مثل نسخه مرورگری در IndexedDB
 *             ولی در پوشه داده همین برنامه (%APPDATA%\Zar IBP) نگه داشته می‌شوند
 *   موتور     پایتون مستقل همراه نصب (resources/python) موتور تحلیل را روی 127.0.0.1:8765 اجرا می‌کند،
 *             سلامت آن را می‌پاید، در صورت خرابی دوباره راه می‌اندازد و هنگام خروج کامل می‌بندد
 *   کلید      کلید Claude با رمزنگاری سیستم‌عامل (DPAPI ویندوز) ذخیره و فقط به‌عنوان متغیر محیطی به موتور داده می‌شود؛
 *             صفحه برنامه هرگز آن را نمی‌خواند (فقط «تنظیم شده/نشده»)
 *   به‌روزرسانی  از نشانی وب داخلی (پوشه‌ای که فایل‌های خروجی ساخت در آن قرار می‌گیرد) با electron-updater
 */
'use strict';

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn, execFile } = require('child_process');

const PORT = 8765;
const HOST = '127.0.0.1';
const DEV = !app.isPackaged;
const RES = DEV ? path.join(__dirname, '..') : process.resourcesPath;
const APP_INDEX = path.join(RES, 'app', 'index.html');
const ENGINE_DIR = path.join(RES, 'engine');
const IS_WIN = process.platform === 'win32';

// پوشه داده جایگزین (برای آزمون خودکار یا اجرای قابل‌حمل)
if (process.env.IBP_USER_DATA) app.setPath('userData', process.env.IBP_USER_DATA);

let win = null;
let quitting = false;

/* ---------------- تنظیمات و اسرار (پوشه داده کاربر) ---------------- */
const dataDir = () => app.getPath('userData');
const cfgFile = () => path.join(dataDir(), 'desktop-config.json');
const secretFile = () => path.join(dataDir(), 'secrets.json');
function readJson(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function writeJson(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); }
function config() { return Object.assign({ updateUrl: '', autoCheckUpdates: true, bounds: null, maximized: true }, readJson(cfgFile(), {})); }
function saveConfig(patch) { const c = Object.assign(config(), patch); writeJson(cfgFile(), c); return c; }

function claudeKey() {
  const s = readJson(secretFile(), {});
  if (!s.anthropic) return '';
  try {
    const buf = Buffer.from(s.anthropic, 'base64');
    return s.encrypted ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch (e) { return ''; }
}
function setClaudeKey(key) {
  key = String(key || '').trim();
  if (!key) { writeJson(secretFile(), {}); return { configured: false }; }
  if (!/^[A-Za-z0-9_\-]{20,300}$/.test(key)) throw new Error('قالب کلید معتبر نیست');
  const enc = safeStorage.isEncryptionAvailable();
  writeJson(secretFile(), { anthropic: (enc ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')).toString('base64'), encrypted: enc, savedAt: new Date().toISOString() });
  return { configured: true, encrypted: enc };
}

/* ---------------- موتور تحلیل پایتون ---------------- */
const engine = { proc: null, status: 'stopped', external: false, restarts: 0, log: null, error: null };

function pythonPath() {
  if (process.env.IBP_PYTHON) return process.env.IBP_PYTHON;
  const bundled = path.join(RES, 'python', IS_WIN ? 'python.exe' : 'bin/python3');
  if (fs.existsSync(bundled)) return bundled;
  return IS_WIN ? 'python' : 'python3';
}
function health(timeout) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/health', timeout: timeout || 1500 }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(body) : null); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
function setEngine(status, extra) {
  Object.assign(engine, { status: status }, extra || {});
  if (win && !win.isDestroyed()) win.webContents.send('ibp:engine', publicEngine());
}
function publicEngine() { return { status: engine.status, external: engine.external, error: engine.error, python: pythonPath(), log: engine.log }; }

async function startEngine() {
  if (engine.proc) return;
  const h = await health();
  if (h) { setEngine('online', { external: true, error: null }); return; } // موتور دیگری (مثلاً اجرای دستی) روی همین درگاه فعال است
  const logDir = path.join(dataDir(), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  engine.log = path.join(logDir, 'engine.log');
  const out = fs.openSync(engine.log, 'w');
  const env = Object.assign({}, process.env);
  delete env.PYTHONHOME; delete env.PYTHONPATH; // پایتون نصب‌شده دیگر روی رایانه نباید روی پایتون همراه اثر بگذارد
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  const key = claudeKey();
  if (key) env.ANTHROPIC_API_KEY = key; else delete env.ANTHROPIC_API_KEY;
  setEngine('starting', { external: false, error: null });
  let proc;
  try {
    proc = spawn(pythonPath(), ['-E', '-s', path.join(ENGINE_DIR, 'run.py'), '--host', HOST, '--port', String(PORT)],
      { cwd: ENGINE_DIR, env: env, windowsHide: true, stdio: ['ignore', out, out] });
  } catch (e) { setEngine('error', { error: String(e.message || e) }); return; }
  engine.proc = proc;
  proc.on('error', (e) => { setEngine('error', { error: 'اجرای پایتون ممکن نشد: ' + e.message }); engine.proc = null; });
  proc.on('exit', (code) => {
    const wasOurs = engine.proc === proc;
    engine.proc = null;
    if (quitting || !wasOurs || engine.status === 'stopping') { if (engine.status === 'stopping') setEngine('stopped'); return; }
    if (engine.restarts < 3) { engine.restarts++; setEngine('starting', { error: 'موتور متوقف شد (کد ' + code + ')؛ اجرای دوباره…' }); setTimeout(startEngine, 1500); }
    else setEngine('error', { error: 'موتور چند بار متوقف شد؛ گزارش موتور را ببینید.' });
  });
  // انتظار برای آماده شدن (بارگذاری اول کتابخانه‌های علمی چند ثانیه طول می‌کشد)
  for (let i = 0; i < 120 && engine.proc === proc; i++) {
    if (await health(1000)) { engine.restarts = 0; setEngine('online', { error: null }); return; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (engine.proc === proc) setEngine('error', { error: 'موتور در زمان مقرر آماده نشد.' });
}
function killTree(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', () => resolve());
    // پردازش‌های موازی پیش‌بینی (ProcessPool) هم باید بسته شوند
    if (IS_WIN) execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else proc.kill('SIGTERM');
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch (e) { /* بسته شده */ } resolve(); }, 4000);
  });
}
async function stopEngine() {
  const p = engine.proc;
  if (!p) return;
  setEngine('stopping');
  await killTree(p);
  engine.proc = null;
  setEngine('stopped');
}
async function restartEngine() {
  if (engine.external && !engine.proc) {
    setEngine('online', { error: 'موتور جداگانه‌ای روی درگاه ' + PORT + ' در حال اجراست؛ برای استفاده از موتور همراه، آن را ببندید.' });
    return publicEngine();
  }
  await stopEngine();
  engine.restarts = 0;
  await startEngine();
  return publicEngine();
}

/* ---------------- به‌روزرسانی ---------------- */
let updater = null;
function getUpdater() {
  if (updater) return updater;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { return null; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-downloaded', (info) => {
    dialog.showMessageBox(win, { type: 'info', buttons: ['نصب و اجرای دوباره', 'بعداً'], defaultId: 0, cancelId: 1, title: 'به‌روزرسانی',
      message: 'نسخه ' + info.version + ' دریافت شد.', detail: 'برنامه بسته و نسخه جدید نصب می‌شود. داده‌ها حفظ می‌شوند.' })
      .then((r) => { if (r.response === 0) { quitting = true; stopEngine().then(() => updater.quitAndInstall()); } });
  });
  return updater;
}
async function checkUpdates(interactive) {
  const url = config().updateUrl;
  if (!url) {
    if (interactive) dialog.showMessageBox(win, { type: 'info', title: 'به‌روزرسانی', message: 'نشانی به‌روزرسانی تنظیم نشده است.', detail: 'در «تنظیمات ← نسخه رومیزی» نشانی پوشه به‌روزرسانی (مثلاً http://server/ibp-updates) را وارد کنید.' });
    return { ok: false, reason: 'no-url' };
  }
  if (DEV) return { ok: false, reason: 'dev' };
  const u = getUpdater();
  if (!u) return { ok: false, reason: 'unavailable' };
  u.setFeedURL({ provider: 'generic', url: url });
  try {
    const r = await u.checkForUpdates();
    const latest = r && r.updateInfo ? r.updateInfo.version : null;
    const newer = latest && latest !== app.getVersion();
    if (interactive && !newer) dialog.showMessageBox(win, { type: 'info', title: 'به‌روزرسانی', message: 'نسخه شما (' + app.getVersion() + ') به‌روز است.' });
    else if (interactive) dialog.showMessageBox(win, { type: 'info', title: 'به‌روزرسانی', message: 'نسخه ' + latest + ' در حال دریافت است…' });
    return { ok: true, current: app.getVersion(), latest: latest, downloading: !!newer };
  } catch (e) {
    if (interactive) dialog.showMessageBox(win, { type: 'warning', title: 'به‌روزرسانی', message: 'بررسی به‌روزرسانی ناموفق بود.', detail: String(e.message || e).slice(0, 400) });
    return { ok: false, reason: 'error', error: String(e.message || e) };
  }
}

/* ---------------- پنجره و منو ---------------- */
function createWindow() {
  const c = config();
  win = new BrowserWindow({
    width: (c.bounds && c.bounds.width) || 1440, height: (c.bounds && c.bounds.height) || 920, x: c.bounds ? c.bounds.x : undefined, y: c.bounds ? c.bounds.y : undefined,
    minWidth: 980, minHeight: 640, show: false, backgroundColor: '#f4f6fb', title: 'برنامه‌ریزی یکپارچه گروه زر',
    icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  if (c.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(APP_INDEX);
  // پیوندهای بیرونی در مرورگر سیستم؛ پنجره برنامه فقط صفحه‌های خود برنامه را نشان می‌دهد
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  const remember = () => { if (!win || win.isDestroyed()) return; const m = win.isMaximized(); saveConfig({ maximized: m, bounds: m ? config().bounds : win.getBounds() }); };
  win.on('resize', debounce(remember, 600));
  win.on('move', debounce(remember, 600));
  win.on('closed', () => { win = null; });
}
function debounce(fn, ms) { let t = null; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

function buildMenu() {
  const tpl = [
    { label: 'برنامه', submenu: [
      { label: 'بارگذاری دوباره', accelerator: 'F5', click: () => win && win.reload() },
      { label: 'تمام‌صفحه', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { label: 'بزرگ‌نمایی', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
      { label: 'کوچک‌نمایی', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
      { label: 'اندازه عادی', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
      { type: 'separator' },
      { label: 'خروج', accelerator: 'Alt+F4', click: () => app.quit() }
    ] },
    { label: 'موتور تحلیل', submenu: [
      { label: 'اجرای دوباره موتور', click: () => restartEngine() },
      { label: 'گزارش موتور', click: () => engine.log && shell.openPath(engine.log) }
    ] },
    { label: 'راهنما', submenu: [
      { label: 'پوشه داده‌ها', click: () => shell.openPath(dataDir()) },
      { label: 'بررسی به‌روزرسانی', click: () => checkUpdates(true) },
      { label: 'ابزار توسعه‌دهنده', accelerator: 'Ctrl+Shift+I', click: () => win && win.webContents.toggleDevTools() },
      { type: 'separator' },
      { label: 'درباره', click: () => dialog.showMessageBox(win, { type: 'info', title: 'درباره', message: 'برنامه‌ریزی یکپارچه کسب‌وکار — هلدینگ گروه زر', detail: 'نسخه ' + app.getVersion() + '\nElectron ' + process.versions.electron + '\nپوشه داده‌ها: ' + dataDir() }) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------------- ارتباط با صفحه (IPC) ---------------- */
function fromApp(e) { return e.senderFrame && e.senderFrame.url && e.senderFrame.url.startsWith('file:'); }
function handle(ch, fn) { ipcMain.handle(ch, (e, ...a) => { if (!fromApp(e)) throw new Error('forbidden'); return fn(...a); }); }

handle('ibp:info', () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, dataDir: dataDir(), engine: publicEngine(),
  claudeConfigured: !!claudeKey(), updateUrl: config().updateUrl, autoCheckUpdates: config().autoCheckUpdates }));
handle('ibp:setClaudeKey', async (key) => { const r = setClaudeKey(key); await restartEngine(); return Object.assign(r, { engine: publicEngine() }); });
handle('ibp:restartEngine', () => restartEngine());
handle('ibp:openDataFolder', () => shell.openPath(dataDir()));
handle('ibp:openEngineLog', () => engine.log ? shell.openPath(engine.log) : '');
handle('ibp:setUpdateConfig', (cfg) => {
  const url = String((cfg && cfg.updateUrl) || '').trim();
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('نشانی باید با http:// یا https:// شروع شود');
  const c = saveConfig({ updateUrl: url.replace(/\/+$/, ''), autoCheckUpdates: !!(cfg && cfg.autoCheckUpdates) });
  return { updateUrl: c.updateUrl, autoCheckUpdates: c.autoCheckUpdates };
});
handle('ibp:checkUpdates', () => checkUpdates(true));

/* ---------------- چرخه عمر ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(() => {
    // برنامه به هیچ دسترسی ویژه مرورگر (دوربین، موقعیت و…) نیاز ندارد
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
    buildMenu();
    createWindow();
    startEngine();
    if (config().autoCheckUpdates) setTimeout(() => checkUpdates(false), 15000);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (e) => {
    if (quitting || !engine.proc) { quitting = true; return; }
    e.preventDefault();
    quitting = true;
    stopEngine().finally(() => app.quit());
  });
}
