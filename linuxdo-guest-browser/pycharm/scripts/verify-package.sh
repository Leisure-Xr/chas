#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="${1:-$PROJECT_DIR/build/distributions/linuxdo-guest-browser-pycharm-0.10.0.zip}"

"$PROJECT_DIR/../shared/check-game-core.sh"

test -f "$PACKAGE"
unzip -tq "$PACKAGE"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
unzip -Z1 "$PACKAGE" > "$TEMP_DIR/package-list.txt"
grep -Fxq 'LinuxDoGuestBrowser/lib/linuxdo-guest-browser.jar' "$TEMP_DIR/package-list.txt"
grep -Fxq 'LinuxDoGuestBrowser/THIRD_PARTY_NOTICES.md' "$TEMP_DIR/package-list.txt"
unzip -q "$PACKAGE" -d "$TEMP_DIR"
PLUGIN_JAR="$TEMP_DIR/LinuxDoGuestBrowser/lib/linuxdo-guest-browser.jar"
unzip -tq "$PLUGIN_JAR"
unzip -Z1 "$PLUGIN_JAR" > "$TEMP_DIR/jar-list.txt"
grep -Fxq 'META-INF/plugin.xml' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'break-overlay.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'game-core.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'reader-mode.css' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'reader-mode.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/LinuxDoToolWindowFactory.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/ReaderHistory.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/ShareCode.class' "$TEMP_DIR/jar-list.txt"

echo "Package verification passed: $PACKAGE"
