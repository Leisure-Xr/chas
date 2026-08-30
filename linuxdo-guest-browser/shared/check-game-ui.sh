#!/usr/bin/env bash
set -euo pipefail

SHARED_DIR="$(cd "$(dirname "$0")" && pwd)"
CANONICAL="$SHARED_DIR/game-ui.js"

cmp -s "$CANONICAL" "$SHARED_DIR/../vscode/media/game-ui.js" || {
  echo "VS Code game-ui.js differs from shared/game-ui.js" >&2
  exit 1
}
cmp -s "$CANONICAL" "$SHARED_DIR/../pycharm/src/main/resources/game-ui.js" || {
  echo "PyCharm game-ui.js differs from shared/game-ui.js" >&2
  exit 1
}

echo "Shared game UI copies match."
