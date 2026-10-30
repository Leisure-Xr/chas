#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGE="$PROJECT_DIR/build/distributions/linuxdo-guest-browser-pycharm-16.3.zip"
VERIFY_SOURCE=""
# 发布包（build-local.sh 与 dist/）的目录名、jar 名和第三方声明是固定的。Gradle buildPlugin 的产物按
# 项目名命名目录和 jar，也不带第三方声明；CI 检查它时用 --gradle-layout 只放宽这两项。
GRADLE_LAYOUT=""
for argument in "$@"; do
  case "$argument" in
    --source) VERIFY_SOURCE="--source" ;;
    --gradle-layout) GRADLE_LAYOUT="yes" ;;
    -*) echo "Usage: $0 [package.zip] [--source] [--gradle-layout]" >&2; exit 2 ;;
    *) PACKAGE="$argument" ;;
  esac
done

"$PROJECT_DIR/../shared/check-game-core.sh"
"$PROJECT_DIR/../shared/check-game-ui.sh"

test -f "$PACKAGE"
unzip -tq "$PACKAGE"

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
unzip -Z1 "$PACKAGE" > "$TEMP_DIR/package-list.txt"
unzip -q "$PACKAGE" -d "$TEMP_DIR/package"
if [[ -z "$GRADLE_LAYOUT" ]]; then
  grep -Fxq 'LinuxDoGuestBrowser/lib/linuxdo-guest-browser.jar' "$TEMP_DIR/package-list.txt"
  grep -Fxq 'LinuxDoGuestBrowser/THIRD_PARTY_NOTICES.md' "$TEMP_DIR/package-list.txt"
  PLUGIN_JAR="$TEMP_DIR/package/LinuxDoGuestBrowser/lib/linuxdo-guest-browser.jar"
else
  if [[ "$(cut -d/ -f1 "$TEMP_DIR/package-list.txt" | sort -u | wc -l | tr -d ' ')" != "1" ]]; then
    echo "Package must contain exactly one plugin directory: $PACKAGE" >&2
    exit 1
  fi
  PLUGIN_JAR=""
  while IFS= read -r entry; do
    if unzip -Z1 "$TEMP_DIR/package/$entry" | grep -Fxq 'META-INF/plugin.xml'; then
      if [[ -n "$PLUGIN_JAR" ]]; then
        echo "Package contains more than one plugin jar: $PACKAGE" >&2
        exit 1
      fi
      PLUGIN_JAR="$TEMP_DIR/package/$entry"
    fi
  done < <(grep -E '^[^/]+/lib/[^/]+\.jar$' "$TEMP_DIR/package-list.txt")
  if [[ -z "$PLUGIN_JAR" ]]; then
    echo "Package contains no plugin jar: $PACKAGE" >&2
    exit 1
  fi
fi
unzip -tq "$PLUGIN_JAR"
unzip -Z1 "$PLUGIN_JAR" > "$TEMP_DIR/jar-list.txt"
grep -Fxq 'META-INF/plugin.xml' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'break-overlay.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'game-core.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'game-ui.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'reader-mode.css' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'reader-mode.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'page-probe.js' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/IdeThemePalette.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/GuestSessionCleanup.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/DocumentLoadState.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/LinuxDoToolWindowFactory.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/ReaderHistory.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/FavoritesPanel.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/FavoritesViewModel.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/ReaderFavorites.class' "$TEMP_DIR/jar-list.txt"
grep -Fxq 'studio/lexiao/linuxdo/ShareCode.class' "$TEMP_DIR/jar-list.txt"

if [[ "$VERIFY_SOURCE" == "--source" ]]; then
  if ! grep -Fxq 'studio/lexiao/linuxdo/ForumSite.class' "$TEMP_DIR/jar-list.txt"; then
    echo "Candidate package is missing multi-forum support: ForumSite.class" >&2
    exit 1
  fi
  mkdir "$TEMP_DIR/resources"
  unzip -q "$PLUGIN_JAR" -d "$TEMP_DIR/resources"
  while IFS= read -r -d '' source; do
    relative="${source#"$PROJECT_DIR/src/main/resources/"}"
    # Gradle patches plugin.xml; its metadata is checked by the QA runner.
    [[ "$relative" == "META-INF/plugin.xml" ]] && continue
    if ! cmp -s "$source" "$TEMP_DIR/resources/$relative"; then
      echo "Candidate resource missing or stale: $relative" >&2
      exit 1
    fi
  done < <(find "$PROJECT_DIR/src/main/resources" -type f -print0)
fi

echo "Package verification passed: $PACKAGE"
