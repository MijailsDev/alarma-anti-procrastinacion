#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-win}"

echo "=== Build Alarma Anti-Procrastinacion ==="
echo "Target: $TARGET"
echo "Root:   $ROOT"
echo ""

# 1. Generate icons if needed
if [ ! -f "$ROOT/frontend/icons/icon-256.png" ]; then
  echo "[1/3] Generating icons..."
  python3 "$ROOT/scripts/generate-icons.py"
else
  echo "[1/3] Icon already exists."
fi

# 2. Rebuild native modules for Electron
echo "[2/3] Rebuilding native modules..."
cd "$ROOT"
npx electron-builder install-app-deps

# 3. Build
echo "[3/3] Running electron-builder for $TARGET..."
npx electron-builder build "--$TARGET" --config electron-builder.yml

echo ""
echo "=== Done ==="
