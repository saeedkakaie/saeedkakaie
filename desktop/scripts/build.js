/*
 * ساخت فایل نصب ویندوز (Setup.exe) با electron-builder.
 * electron-builder برای زبان فارسی دنبال فایل «Persian» می‌گردد ولی NSIS آن را «Farsi» نام‌گذاری کرده است؛
 * پیش از ساخت، ابزار NSIS دریافت و فایل‌های زبان فارسی با نام مورد انتظار کپی می‌شوند تا نصب‌کننده فارسی باشد.
 * اجرا: node scripts/build.js   (پیش از آن: python scripts/prepare_python.py)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const builder = require('electron-builder');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');

const pkg = require('../package.json');
const NSIS_TOOLSET = pkg.build.toolsets && pkg.build.toolsets.nsis;

function langDirs(root) {
  const out = [];
  (function walk(d, depth) {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(d, e.name);
      if (e.name === 'Language files') out.push(p); else walk(p, depth + 1);
    }
  })(root, 0);
  return out;
}

async function fixPersian() {
  const nsis = await getMakeNsisPath(NSIS_TOOLSET, undefined);
  let root = path.dirname(nsis.path);
  if (nsis.env && nsis.env.NSISDIR) root = nsis.env.NSISDIR;
  const dirs = langDirs(fs.existsSync(path.join(root, 'windows')) ? root : path.dirname(root));
  for (const d of dirs) {
    const nlf = path.join(d, 'Farsi.nlf'), nsh = path.join(d, 'Farsi.nsh');
    if (!fs.existsSync(nlf)) continue;
    fs.copyFileSync(nlf, path.join(d, 'Persian.nlf'));
    fs.writeFileSync(path.join(d, 'Persian.nsh'), fs.readFileSync(nsh, 'utf8').replace('!insertmacro LANGFILE "Farsi" "Persian"', '!insertmacro LANGFILE "Persian" "Persian"'));
    console.log('زبان فارسی NSIS آماده شد:', d);
  }
}

(async () => {
  await fixPersian();
  const result = await builder.build({ targets: builder.Platform.WINDOWS.createTarget('nsis', builder.Arch.x64), publish: 'never' });
  console.log('ساخته شد:\n' + result.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
