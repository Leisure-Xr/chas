#!/usr/bin/env bash
set -euo pipefail

SHARED_DIR="$(cd "$(dirname "$0")" && pwd)"
CANONICAL="$SHARED_DIR/game-core.js"

cmp -s "$CANONICAL" "$SHARED_DIR/../vscode/media/game-core.js" || {
  echo "VS Code game-core.js differs from shared/game-core.js" >&2
  exit 1
}
cmp -s "$CANONICAL" "$SHARED_DIR/../pycharm/src/main/resources/game-core.js" || {
  echo "PyCharm game-core.js differs from shared/game-core.js" >&2
  exit 1
}

echo "Shared game core copies match."
