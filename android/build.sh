#!/usr/bin/env bash
# ساخت فایل نصب اندروید (APK) بدون Android Studio و Gradle.
# نیاز (اوبونتو/دبیان): sudo apt install aapt apksigner zipalign dalvik-exchange zip default-jdk
#   و android.jar سطح ۳۴ (ANDROID_JAR؛ اگر نباشد دریافت می‌شود)
# امضا: IBP_KEYSTORE و IBP_KS_PASS (اگر کلید نباشد یک کلید جدید در android/keystore ساخته می‌شود —
#   برای به‌روزرسانی برنامه نصب‌شده باید همیشه با همان کلید امضا شود؛ آن را نگه دارید)
set -euo pipefail
cd "$(dirname "$0")"
VERSION_NAME=$(grep -o "version: '[0-9.]*'" ../app/js/app.js | grep -o "[0-9.]*")
VERSION_CODE=$(echo "$VERSION_NAME" | awk -F. '{print $1*10000 + $2*100 + $3}')
OUT=build
JAR=${ANDROID_JAR:-$OUT/android-34.jar}
KS=${IBP_KEYSTORE:-keystore/zar-ibp-release.jks}

rm -rf "$OUT/stage" && mkdir -p "$OUT/stage"
if [ ! -f "$JAR" ]; then
  echo "دریافت android.jar سطح ۳۴…"
  curl -fsSL -o "$JAR" https://raw.githubusercontent.com/Reginer/aosp-android-jar/main/android-34/android.jar
fi

echo "۱) منابع و فایل‌های برنامه (نسخه $VERSION_NAME)"
mkdir -p "$OUT/stage/assets/app" "$OUT/stage/gen" "$OUT/stage/classes"
cp -r ../app/. "$OUT/stage/assets/app/"
aapt2 compile --dir res -o "$OUT/stage/res.zip"
aapt2 link -o "$OUT/stage/base.apk" -I "$JAR" --manifest AndroidManifest.xml --java "$OUT/stage/gen" \
  -A "$OUT/stage/assets" --min-sdk-version 29 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/stage/res.zip"

echo "۲) کامپایل Java"
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -encoding UTF-8 -d "$OUT/stage/classes" \
  $(find src "$OUT/stage/gen" -name "*.java")

echo "۳) تبدیل به dex"
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/stage/classes.dex" "$OUT/stage/classes"
(cd "$OUT/stage" && zip -q -j base.apk classes.dex)

echo "۴) هم‌ترازی و امضا"
zipalign -p -f 4 "$OUT/stage/base.apk" "$OUT/stage/aligned.apk"
if [ ! -f "$KS" ]; then
  echo "کلید امضا پیدا نشد؛ ساخت کلید جدید در $KS"
  mkdir -p "$(dirname "$KS")"
  : "${IBP_KS_PASS:=$(head -c 24 /dev/urandom | base64 | tr -dc A-Za-z0-9 | head -c 24)}"
  keytool -genkeypair -keystore "$KS" -alias zar-ibp -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=Zar Group IBP, O=Zar Group, C=IR" -storepass "$IBP_KS_PASS" -keypass "$IBP_KS_PASS" >/dev/null
  echo "$IBP_KS_PASS" > "$KS.pass"; chmod 600 "$KS.pass"
  echo "رمز کلید در $KS.pass ذخیره شد؛ کلید و رمز را در جای امن نگه دارید."
fi
PASS=${IBP_KS_PASS:-$(cat "$KS.pass")}
APK="$OUT/Zar-IBP-$VERSION_NAME.apk"
IBP_KS_PASS="$PASS" apksigner sign --ks "$KS" --ks-key-alias zar-ibp --ks-pass env:IBP_KS_PASS --key-pass env:IBP_KS_PASS --out "$APK" "$OUT/stage/aligned.apk"
apksigner verify --print-certs "$APK" | head -3
ls -la "$APK"
