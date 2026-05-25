#!/usr/bin/env bash
#
# Aria - desktop installer for Linux.
#
# Sets up everything Aria needs (Python backend + Electron desktop shell)
# and installs a launcher into your applications menu so you can start it
# like any other app - no terminal required afterwards.
#
# Usage:   bash install.sh
#
# Safe to run more than once.

# Re-run under bash if started with plain `sh` (we use bash features).
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi

# --------------------------------------------------------------------------
# Output helpers - colours + a step counter so you can follow the progress
# --------------------------------------------------------------------------
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""; C_RESET=""
fi

TOTAL=6
STEP=0

hr()    { echo "${C_CYAN}========================================================${C_RESET}"; }
title() { echo; hr; echo "${C_CYAN}${C_BOLD}  $*${C_RESET}"; hr; }
step()  { STEP=$((STEP + 1)); echo; echo "${C_BLUE}${C_BOLD}==> [${STEP}/${TOTAL}] $*${C_RESET}"; }
say()   { echo "    $*"; }
ok()    { echo "    ${C_GREEN}${C_BOLD}OK${C_RESET}    $*"; }
warn()  { echo "    ${C_YELLOW}${C_BOLD}NOTE${C_RESET}  $*"; }
fail()  { echo; echo "    ${C_RED}${C_BOLD}FAILED${C_RESET}  $*" >&2; echo; exit 1; }

# Print a command, then run it, so you can see exactly what is happening.
run() { echo "    ${C_DIM}\$ $*${C_RESET}"; "$@"; }

# Run a package-manager command, adding sudo only when it is needed.
pm() {
  if [ -n "${SUDO:-}" ]; then run "$SUDO" "$@"; else run "$@"; fi
}

# --------------------------------------------------------------------------
# Locate the project and check the system
# --------------------------------------------------------------------------
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || fail "Could not enter the project folder."

VENV="$ROOT/.venv"
RENDERER_DIST="$ROOT/electron/renderer/dist"
LAUNCHER="$ROOT/start-aria.sh"
ICON_SRC="$ROOT/electron/renderer/public/icon.svg"

title "Aria  -  desktop installer"
say "This sets Aria up as a normal desktop app. Safe to run again at any time."

[ -f "$ROOT/backend/main.py" ] || \
  fail "This does not look like the Aria folder (backend/main.py is missing).
       Run the script from inside the Aria project folder."

case "$(uname -s 2>/dev/null)" in
  Linux) : ;;
  *) fail "This installer only supports Linux." ;;
esac

# Work out whether we need sudo for system packages.
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi
fi

# --------------------------------------------------------------------------
# Step 1 - system packages
# --------------------------------------------------------------------------
step "Installing system packages (Python, Node.js, curl)"

need=""
command -v python3 >/dev/null 2>&1 || need="$need python3"
python3 -c "import venv, ensurepip" >/dev/null 2>&1 || need="$need python3-venv"
command -v curl >/dev/null 2>&1 || need="$need curl"
command -v node >/dev/null 2>&1 || need="$need nodejs"
command -v npm >/dev/null 2>&1 || need="$need npm"

if [ -z "$need" ]; then
  ok "All required system packages are already installed."
else
  say "These need to be installed:${C_BOLD}${need}${C_RESET}"
  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    fail "Missing packages, but 'sudo' is not available.
       Re-run this script as root, or install python3, python3-venv,
       python3-pip, curl, nodejs and npm yourself, then run it again."
  fi
  if command -v apt-get >/dev/null 2>&1; then
    pm apt-get update || warn "Could not refresh the package list - continuing."
    pm apt-get install -y python3 python3-venv python3-pip curl nodejs npm \
      || fail "Package installation failed (see messages above)."
  elif command -v dnf >/dev/null 2>&1; then
    pm dnf install -y python3 python3-pip curl nodejs npm \
      || fail "Package installation failed (see messages above)."
  elif command -v pacman >/dev/null 2>&1; then
    pm pacman -Sy --noconfirm python curl nodejs npm \
      || fail "Package installation failed (see messages above)."
  elif command -v zypper >/dev/null 2>&1; then
    pm zypper --non-interactive install python3 python3-pip curl nodejs npm \
      || fail "Package installation failed (see messages above)."
  else
    fail "No supported package manager found.
       Please install Python 3 (with the venv module), curl, nodejs and npm,
       then re-run this script."
  fi
  python3 -c "import venv, ensurepip" >/dev/null 2>&1 \
    || fail "Python's 'venv' module is still missing.
       On Debian/Ubuntu install it with:  sudo apt-get install python3-venv"
  ok "System packages installed."
fi

# --------------------------------------------------------------------------
# Step 2 - isolated Python environment
# --------------------------------------------------------------------------
step "Creating an isolated Python environment"
say "Aria's packages go in a private '.venv' folder - your system Python is untouched."

if [ -x "$VENV/bin/python" ]; then
  ok "Environment already exists."
else
  run python3 -m venv "$VENV" || fail "Could not create the Python environment."
  ok "Environment created at .venv"
fi

PY="$VENV/bin/python"
say "Updating the package installer (pip)..."
run "$PY" -m pip install --upgrade pip || warn "Could not update pip - continuing anyway."

# --------------------------------------------------------------------------
# Step 3 - backend dependencies
# --------------------------------------------------------------------------
step "Installing Aria's backend libraries"
say "Downloading FastAPI, the OpenAI client, and a few small libraries."
run "$PY" -m pip install fastapi uvicorn openai httpx pydantic \
  || fail "A library failed to install. Scroll up to see which one."
ok "Backend libraries installed."

# --------------------------------------------------------------------------
# Step 4 - Electron and renderer dependencies
# --------------------------------------------------------------------------
step "Installing the desktop shell (Electron)"

if [ -x "$ROOT/node_modules/.bin/electron" ] && [ -d "$ROOT/node_modules/electron/dist" ]; then
  ok "Electron is already installed."
else
  say "Downloading Electron and the renderer's build tools (one-time)."
  run npm install --no-audit --fund=false || fail "npm install failed."
  [ -x "$ROOT/node_modules/.bin/electron" ] && [ -d "$ROOT/node_modules/electron/dist" ] \
    || fail "Electron did not install correctly. Try deleting node_modules and re-running."
  ok "Electron installed."
fi

# --------------------------------------------------------------------------
# Step 5 - build the app
# --------------------------------------------------------------------------
step "Building the app"

say "Compiling the Electron main process..."
run npm run build:electron || fail "Could not build the Electron main process."

if [ -f "$RENDERER_DIST/index.html" ]; then
  ok "Renderer already built - skipping (run 'npm run build:renderer' to rebuild)."
else
  say "Building the renderer (this can take a minute)..."
  run npm run build:renderer || fail "Building the renderer failed."
  [ -f "$RENDERER_DIST/index.html" ] || fail "The build did not produce the renderer files."
  ok "Renderer built."
fi

# --------------------------------------------------------------------------
# Step 6 - desktop launcher (menu entry + icon)
# --------------------------------------------------------------------------
step "Installing the desktop launcher"

APP_ID="aria"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/scalable/apps"
DESKTOP_FILE="$DESKTOP_DIR/${APP_ID}.desktop"
ICON_DEST="$ICON_DIR/${APP_ID}.svg"

mkdir -p "$DESKTOP_DIR" "$ICON_DIR" || fail "Could not create application directories."

if [ -f "$ICON_SRC" ]; then
  run cp -f "$ICON_SRC" "$ICON_DEST" \
    || warn "Could not copy the icon - the menu entry will use a generic one."
else
  warn "Icon file not found at $ICON_SRC - the menu entry will use a generic icon."
fi

[ -f "$LAUNCHER" ] || fail "Launcher script is missing: $LAUNCHER"
chmod +x "$LAUNCHER" 2>/dev/null

cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Aria
Comment=Aria desktop chat
Exec=$LAUNCHER
Icon=$APP_ID
Terminal=false
Categories=Network;Chat;
StartupWMClass=Aria
EOF

chmod +x "$DESKTOP_FILE" 2>/dev/null

# Refresh menu / icon caches if the tools are available - silent if not.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f "$DATA_HOME/icons/hicolor" >/dev/null 2>&1 || true
fi

ok "Desktop entry installed: $DESKTOP_FILE"

# --------------------------------------------------------------------------
# Optional: Ollama hint
# --------------------------------------------------------------------------
echo
if command -v ollama >/dev/null 2>&1; then
  say "Ollama is installed (used for the optional local 'observer' model)."
  say "Pull a small observer model with:  ${C_BOLD}ollama pull tinyllama${C_RESET}"
else
  warn "Ollama is not installed (it is optional - Aria still works with an"
  warn "OpenAI or Gemini API key)."
  say "To install Ollama later:"
  say "    ${C_BOLD}curl -fsSL https://ollama.com/install.sh | sh${C_RESET}"
fi

# --------------------------------------------------------------------------
# Done
# --------------------------------------------------------------------------
title "Installation complete"
echo
say "${C_BOLD}Aria is now in your applications menu.${C_RESET}"
say "Open your menu and search for ${C_BOLD}Aria${C_RESET}, or run from a terminal:"
say "    ${C_GREEN}${C_BOLD}$LAUNCHER${C_RESET}"
echo

if [ -t 0 ]; then
  printf "    %sStart Aria now? [Y/n] %s" "$C_BOLD" "$C_RESET"
  read -r answer
  case "${answer:-y}" in
    [Nn]*) say "No problem - launch it from your apps menu when you are ready." ;;
    *)     exec "$LAUNCHER" ;;
  esac
fi
