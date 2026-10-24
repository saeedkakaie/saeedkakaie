/*
 * ساخت فایل نصب ویندوز (Setup.exe).
 *   ۱) electron-builder برنامه را در dist/win-unpacked آماده می‌کند (Electron + برنامه + موتور + پایتون همراه)
 *   ۲) NSIS با اسکریپت installer/zar-ibp.nsi فایل نصب فارسی می‌سازد که فایل‌ها را مستقیم در پوشه نصب باز می‌کند
 *      (نصب‌کننده پیش‌فرض electron-builder ابتدا یک بسته ۱۸۰ مگابایتی در Temp می‌نوشت که روی برخی رایانه‌ها
 *       به‌دلیل آنتی‌ویروس یا فضای Temp با خطای «خطا هنگام نوشتن در پرونده» متوقف می‌شد)
 *   ۳) latest.yml برای به‌روزرسانی خودکار ساخته می‌شود
 * اجرا: node scripts/build.js   (پیش از آن: python scripts/prepare_python.py)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const builder = require('electron-builder');
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');

const ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');

(async () => {
  console.log('۱) آماده‌سازی برنامه (win-unpacked)');
  await builder.build({ targets: builder.Platform.WINDOWS.createTarget('dir', builder.Arch.x64), publish: 'never' });
  const src = path.join(ROOT, 'dist', 'win-unpacked');
  if (!fs.existsSync(path.join(src, 'Zar IBP.exe'))) throw new Error('win-unpacked ساخته نشد');

  console.log('۲) ساخت فایل نصب با NSIS');
  const out = path.join(ROOT, 'dist', `Zar-IBP-Setup-${pkg.version}.exe`);
  const nsis = await getMakeNsisPath(pkg.build.toolsets && pkg.build.toolsets.nsis, undefined);
  execFileSync(nsis.path, ['-V2', '-INPUTCHARSET', 'UTF8',
    `-DVERSION=${pkg.version}`, `-DSRCDIR=${src}`, `-DOUTFILE=${out}`, `-DICON=${path.join(ROOT, 'build', 'icon.ico')}`,
    path.join(ROOT, 'installer', 'zar-ibp.nsi')], { stdio: 'inherit', env: Object.assign({}, process.env, nsis.env || {}) });

  console.log('۳) فایل به‌روزرسانی latest.yml');
  const buf = fs.readFileSync(out);
  const sha512 = crypto.createHash('sha512').update(buf).digest('base64');
  const name = path.basename(out);
  fs.writeFileSync(path.join(ROOT, 'dist', 'latest.yml'),
    `version: ${pkg.version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${buf.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`);
  console.log(`ساخته شد: ${out} (${Math.round(buf.length / 1048576)} MB)`);
})().catch((e) => { console.error(e); process.exit(1); });
