#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYCHARM_HOME="${PYCHARM_HOME:-/Applications/PyCharm.app}"
IDE_CONTENTS="$PYCHARM_HOME/Contents"
JAVAC="$IDE_CONTENTS/jbr/Contents/Home/bin/javac"
BUILD_DIR="$PROJECT_DIR/build/local"
CLASSES_DIR="$BUILD_DIR/classes"
TEST_CLASSES_DIR="$BUILD_DIR/test-classes"
PLUGIN_DIR="$BUILD_DIR/staging/LinuxDoGuestBrowser"
PLUGIN_JAR="$PLUGIN_DIR/lib/linuxdo-guest-browser.jar"
OUTPUT_ZIP="$PROJECT_DIR/build/distributions/linuxdo-guest-browser-pycharm-0.5.0.zip"

if [[ ! -x "$JAVAC" || ! -d "$IDE_CONTENTS/lib" ]]; then
  echo "PyCharm SDK not found at: $PYCHARM_HOME" >&2
  echo "Set PYCHARM_HOME to the PyCharm .app directory." >&2
  exit 1
fi

"$PROJECT_DIR/../shared/check-game-core.sh"

rm -rf "$BUILD_DIR"
mkdir -p "$CLASSES_DIR/META-INF" "$TEST_CLASSES_DIR" "$PLUGIN_DIR/lib" "$(dirname "$OUTPUT_ZIP")"

find "$PROJECT_DIR/src/main/java" -name '*.java' -print0 \
  | xargs -0 "$JAVAC" \
      --release 17 \
      -encoding UTF-8 \
      -cp "$IDE_CONTENTS/lib/*" \
      -d "$CLASSES_DIR"

cp -R "$PROJECT_DIR/src/main/resources/." "$CLASSES_DIR/"
cp "$PROJECT_DIR/THIRD_PARTY_NOTICES.md" "$PLUGIN_DIR/"

find "$PROJECT_DIR/src/test/java" -name '*.java' -print0 \
  | xargs -0 "$JAVAC" \
      --release 17 \
      -encoding UTF-8 \
      -cp "$CLASSES_DIR:$IDE_CONTENTS/lib/*" \
      -d "$TEST_CLASSES_DIR"
"$IDE_CONTENTS/jbr/Contents/Home/bin/java" -cp "$CLASSES_DIR:$TEST_CLASSES_DIR" studio.lexiao.linuxdo.ShareCodeTest

(
  cd "$CLASSES_DIR"
  zip -q -r "$PLUGIN_JAR" .
)

rm -f "$OUTPUT_ZIP"
(
  cd "$BUILD_DIR/staging"
  zip -q -r "$OUTPUT_ZIP" LinuxDoGuestBrowser
)

echo "$OUTPUT_ZIP"
