#!/usr/bin/env bash
set -euo pipefail

# Сборка подписанного установочного APK приложения ONI PLR Studio Android (КИПиА Edition)
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_MAIN="${ROOT_DIR}/android/app/src/main"
BUILD_TMP="${ROOT_DIR}/.build-apk-tmp"
OUT_APK="${ROOT_DIR}/ONI-PLR-Studio-Android.apk"

# Поиск установленного JDK и Android SDK (локального либо системного ANDROID_HOME)
if [[ -z "${JAVA_HOME:-}" ]]; then
  if [[ -d "/tmp/jdk/jdk-17.0.20.1+1" ]]; then
    export JAVA_HOME="/tmp/jdk/jdk-17.0.20.1+1"
  fi
fi
if [[ -n "${JAVA_HOME:-}" ]]; then
  export PATH="${JAVA_HOME}/bin:${PATH}"
fi

SDK_ROOT="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/tmp/android-sdk}}"
BUILD_TOOLS_DIR="$(ls -d "${SDK_ROOT}/build-tools/"* 2>/dev/null | sort -V | tail -n 1 || true)"
PLATFORM_JAR="$(ls "${SDK_ROOT}/platforms/android-"*/android.jar 2>/dev/null | sort -V | tail -n 1 || true)"

if [[ -z "${BUILD_TOOLS_DIR}" || -z "${PLATFORM_JAR}" ]]; then
  echo "Ошибка: не найдены Android SDK build-tools или android.jar в ${SDK_ROOT}" >&2
  exit 1
fi

AAPT2="${BUILD_TOOLS_DIR}/aapt2"
D8="${BUILD_TOOLS_DIR}/d8"
ZIPALIGN="${BUILD_TOOLS_DIR}/zipalign"
APKSIGNER="${BUILD_TOOLS_DIR}/apksigner"

echo "=== [1/6] Очистка временной директории сборки ==="
rm -rf "${BUILD_TMP}"
mkdir -p "${BUILD_TMP}/compiled_res" "${BUILD_TMP}/gen" "${BUILD_TMP}/classes"

echo "=== [2/6] Компиляция ресурсов Android (aapt2 compile) ==="
"${AAPT2}" compile --dir "${APP_MAIN}/res" -o "${BUILD_TMP}/compiled_res/res.zip"

echo "=== [3/6] Линковка манифеста, ресурсов и оффлайн-бандла IDE assets/www (aapt2 link) ==="
"${AAPT2}" link \
  -I "${PLATFORM_JAR}" \
  --manifest "${APP_MAIN}/AndroidManifest.xml" \
  -A "${APP_MAIN}/assets" \
  --java "${BUILD_TMP}/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  -0 js -0 css -0 html -0 json -0 svg \
  -o "${BUILD_TMP}/unaligned.apk" \
  "${BUILD_TMP}/compiled_res/res.zip"

echo "=== [4/6] Компиляция Java-кода Activity и моста КИПиА (javac 17 -> bytecode 11) ==="
find "${APP_MAIN}/java" "${BUILD_TMP}/gen" -name "*.java" > "${BUILD_TMP}/sources.txt"
javac \
  -encoding UTF-8 \
  --release 11 \
  -classpath "${PLATFORM_JAR}" \
  -d "${BUILD_TMP}/classes" \
  @"${BUILD_TMP}/sources.txt"

echo "=== [5/6] Преобразование классов в Dalvik DEX (d8) и упаковка в APK ==="
find "${BUILD_TMP}/classes" -name "*.class" > "${BUILD_TMP}/classes.txt"
"${D8}" \
  --min-api 24 \
  --lib "${PLATFORM_JAR}" \
  --output "${BUILD_TMP}" \
  @"${BUILD_TMP}/classes.txt"

(cd "${BUILD_TMP}" && zip -q -u unaligned.apk classes.dex)

echo "=== [6/6] Выравнивание (zipalign 4K) и криптографическая подпись APK v1+v2+v3 (apksigner) ==="
"${ZIPALIGN}" -f -p 4 "${BUILD_TMP}/unaligned.apk" "${BUILD_TMP}/aligned.apk"

KEYSTORE="${BUILD_TMP}/oni-release.jks"
keytool -genkeypair \
  -v \
  -keystore "${KEYSTORE}" \
  -storepass "oniplrstudio" \
  -keypass "oniplrstudio" \
  -alias "oni_key" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=ONI PLR Studio Android, OU=KIPiA, O=ONI Open Tools, L=Moscow, C=RU" >/dev/null 2>&1

"${APKSIGNER}" sign \
  --ks "${KEYSTORE}" \
  --ks-key-alias "oni_key" \
  --ks-pass pass:oniplrstudio \
  --key-pass pass:oniplrstudio \
  --v1-signing-enabled true \
  --v2-signing-enabled true \
  --v3-signing-enabled true \
  --out "${OUT_APK}" \
  "${BUILD_TMP}/aligned.apk"

"${APKSIGNER}" verify --verbose "${OUT_APK}"
rm -rf "${BUILD_TMP}"
echo "=== ГОТОВО! Установочный APK создан: ${OUT_APK} ($(du -h "${OUT_APK}" | cut -f1)) ==="
