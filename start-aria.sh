#!/usr/bin/env bash
#
# Aria - launcher.
#
# Launches Aria as a desktop window (Electron). Electron starts the Python
# backend itself, so a single click opens the full app. This script is what
# the apps-menu entry calls; you can also run it from a terminal.
#
# Usage:   ./start-aria.sh

ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$ROOT/node_modules/.bin/electron"
PY="$ROOT/.venv/bin/python"
MAIN_JS="$ROOT/electron/dist/main.js"

if [ ! -x "$ELECTRON" ] || [ ! -x "$PY" ] || [ ! -f "$MAIN_JS" ]; then
  msg="Aria is not installed yet. Run this first:  bash install.sh"
  echo "$msg" >&2
  # Show a GUI error too, so launching from the menu without an install
  # doesn't fail silently.
  if [ -z "$TERM" ] || [ "$TERM" = "dumb" ]; then
    if command -v zenity >/dev/null 2>&1; then
      zenity --error --text="$msg" >/dev/null 2>&1 || true
    elif command -v kdialog >/dev/null 2>&1; then
      kdialog --error "$msg" >/dev/null 2>&1 || true
    fi
  fi
  exit 1
fi

# Make sure the backend can find the venv's python when Electron spawns it.
export PATH="$ROOT/.venv/bin:$PATH"

# Start Ollama in the background if it's installed but not already running.
# (It's optional - Aria works without it.)
if command -v ollama >/dev/null 2>&1; then
  if ! curl -s -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    ollama serve >/dev/null 2>&1 &
  fi
fi

cd "$ROOT"
exec "$ELECTRON" .
