# Aria

A desktop chat application for IRB-approved deception research. Participants converse with "Aria," a simulated human persona powered by GPT-4o. An independent local model (Gemma via Ollama) silently observes conversations and maintains Aria's diary and emotional state.

> **IRB Notice:** This software is designed for use in deception studies in which participants are not immediately informed that their conversation partner is an AI. All deployments must be covered by an Institutional Review Board (IRB) approval. Participants must be fully debriefed at the conclusion of their involvement. The researchers are responsible for ethical use.

---

## Installing — step by step

This section is written for people who have **never used a terminal before**.
Follow it line by line and you will be fine.

When you are done, **Aria will appear in your applications menu** like any
other program. You will not need a terminal to start it.

There is an **automatic installer** (`install.sh`) that does everything for
you and shows you the progress of every step.

### What you need

- A **Linux computer**.
- The **Aria project folder** (the folder that contains `install.sh`,
  `backend/`, and `electron/`).
- Internet access for the install.
- An **OpenAI or Google Gemini API key** — this is what powers Aria's
  conversation. You paste it into the app on first launch. (You only need a
  local model via Ollama if you want the optional background "observer" —
  see [Ollama](#optional-ollama-the-local-observer) below.)

### Install

1. **Open a terminal.** On most Linux systems press `Ctrl` + `Alt` + `T`.

2. **Go into the Aria folder.** If the folder is in your Downloads, type:

   ```bash
   cd ~/Downloads/aria
   ```

   (Replace the path with wherever your Aria folder actually is.)

3. **Run the installer:**

   ```bash
   bash install.sh
   ```

4. **Wait.** The installer prints a numbered step for everything it does
   (`[1/6]`, `[2/6]`, …) and shows the live output so you can watch the
   progress. It may ask for your password once — that is the system asking
   permission to install Python and Node.js.

5. When it finishes it prints **"Installation complete"** and asks
   *"Start Aria now?"* — press `Enter` to launch it.

That's it. From now on, **open your applications menu and search for "Aria"**
to launch it like any other app.

### Starting Aria

- **The normal way:** open your applications menu and click **Aria**.
- **From a terminal** (e.g. for troubleshooting): `./start-aria.sh` from
  inside the Aria folder.

Aria opens as a desktop window. Close the window to quit — there is no
terminal to keep open.

### Optional: Ollama (the local "observer")

Aria has a small background model — the **observer** — that quietly updates
her diary and mood. It runs **on your own device** through a tool called
**Ollama**. This is **optional**: Aria's conversation works fine without it.

Install Ollama:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull tinyllama
```

On the Aria **login screen**, tap the **gear icon (⚙)** in the top-right
corner to set the **observer model** (for example `tinyllama` on a
lower-spec machine). On a strong PC you can leave the default.

### First run — using the app

1. On the login screen, type a **Participant ID** (any name/number).
2. Choose a **provider**: OpenAI, Google Gemini, or Ollama (local).
3. Paste the **API key** for that provider and tap **Verify**, then pick a
   model.
4. (Optional) Tap the **⚙ gear** to choose the observer model.
5. Tap **Start conversation**.

### Troubleshooting

**The installer says it needs `sudo` / a password** — that is the normal
system prompt to install Python and Node.js. Type your login password.

**"npm install failed" or Electron will not install** — your distro's `npm`
may be too old. Update Node.js (Debian/Ubuntu users: see
[nodesource.com](https://github.com/nodesource/distributions)), then re-run
`bash install.sh`.

**Aria does not appear in the menu after installing** — some desktops cache
the menu. Log out and back in, or run:

```bash
update-desktop-database ~/.local/share/applications
```

**Port 8000 is already in use** — another copy of Aria's backend is probably
still running. Close any existing Aria window, or reboot.

**Clicking Aria in the menu does nothing visible** — open a terminal and run
`./start-aria.sh` from inside the Aria folder to see the error message.

### Manual install (if the script will not run)

```bash
# 1. install Python 3, Node.js, npm via your package manager
#    (Debian/Ubuntu: sudo apt-get install python3 python3-venv python3-pip curl nodejs npm)
# 2. create the isolated Python environment
python3 -m venv .venv
# 3. install the backend libraries
.venv/bin/python -m pip install fastapi uvicorn openai httpx pydantic
# 4. install Electron + build the app
npm install
npm run build
# 5. launch
./start-aria.sh
```

To add Aria to your applications menu manually, copy
`electron/renderer/public/icon.svg` to
`~/.local/share/icons/hicolor/scalable/apps/aria.svg` and create
`~/.local/share/applications/aria.desktop` with `Exec=` pointing at
`start-aria.sh`. The installer does both for you automatically.

---

## Developer reference

The sections below are for developers working on Aria itself.

### Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| Python | ≥ 3.10 | |
| Ollama | latest | [ollama.ai](https://ollama.ai) |
| OpenAI **or** Gemini API key | — | Per-participant; provider is selectable at login |

### Setup

#### 1. Install Ollama and pull the observer model

```bash
# Install Ollama (https://ollama.ai)
ollama pull gemma4:e4b
# To use a different observer model (e.g. gemma2:2b on lower-spec machines):
# Set OBSERVER_MODEL=gemma2:2b in your environment
```

#### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

#### 3. Install Node dependencies

```bash
npm install
```

### Running in development

**Terminal 1 — Python backend:**
```bash
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

**Terminal 2 — Electron + Vite:**
```bash
NODE_ENV=development npm run dev
```

The app window will open. On first launch, enter a participant ID, choose a provider (OpenAI or Google Gemini), and enter the participant's API key for that provider. The backend listens on a fixed `127.0.0.1:8000` so the renderer's origin (and its `localStorage`) stays stable across launches.

### Building for distribution

```bash
npm run dist
```

Outputs a platform-specific installer to `dist/`. The Python backend is expected to be available on the participant's machine (or bundled via PyInstaller — see advanced setup below).

#### Bundling the Python backend (optional)

```bash
cd backend
pip install pyinstaller
pyinstaller --onefile --name aria-backend main.py
```

Then update `electron/main.ts` to launch the compiled binary instead of `python3 -m uvicorn`.

---

## Researcher Controls

**Shortcut:** `Ctrl+Shift+R` (or `Cmd+Shift+R` on macOS)

This opens a password prompt. The default password is `aria2024`. To change it:

```bash
# In the researcher panel UI, or via the IPC handler:
# window.aria.setResearcherPassword("your-new-password")
```

### Researcher panel features

- **Overview:** Current love value (0–10), full history of changes with reasons, force-override the value
- **Diary:** Full diary contents, ability to manually append entries
- **Log:** Complete session log (all messages, inner thoughts, observer decisions, API calls, errors)
- **Export:** Download full session data as JSON for analysis
- **Debrief:** Show a debrief screen to the participant explaining the AI nature of the study

---

## File storage

All participant data is stored in `~/.aria/<participant_id>/`:

| File | Description |
|---|---|
| `mirror.txt` | Aria's self-description (generated once, never changed) |
| `diary.md` | Aria's diary, maintained by the observer model |
| `love.json` | Emotional connection score (0–10) and full change history |
| `session.log` | Timestamped NDJSON log of every event |

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `OBSERVER_MODEL` | `gemma4:e4b` | Ollama model name for the observer |
| `ARIA_PORT` | `8000` | Backend port |

---

## Architecture

```
Participant
    ↓ text message
Electron renderer (React)
    ↓ HTTP POST /chat
FastAPI backend (Python)
    ↓ OpenAI API or Gemini API (provider + model selectable at login)
Aria (main model) → <inner_thoughts> + <reply>
    ↓ strip tags → display reply to participant
    ↓ inner_thoughts + reply → Observer (background)
        ↓ Ollama (gemma4:e4b)
            → diary update (if warranted)
            → love value update (if warranted)
```

The observer never blocks the main response path. It runs in a background queue. If Ollama is unavailable, updates queue in memory and apply when Ollama recovers.

---

## Running tests

```bash
cd backend
python3 -m pytest tests/ -v
```

Tests cover: file atomicity, love clamping, inner-thoughts parsing, retry logic, observer NONE-handling, and a 50-turn integration test with mocked OpenAI.

---

## Security notes

- The API key (OpenAI or Gemini) is stored using the OS keychain (`keytar`) — never in plaintext
- The key is never logged, and never transmitted anywhere except the selected provider (`api.openai.com` or `generativelanguage.googleapis.com`)
- The backend only listens on `127.0.0.1` — not reachable from the network
- No telemetry libraries are included

---

## Ethical use

This tool is designed for research contexts with proper IRB oversight. Key requirements for ethical deployment:

1. IRB approval must be in place before any data collection
2. Participants must be fully debriefed at the end of their participation
3. Data must be stored and handled per your institution's IRB-approved protocol
4. The researcher is responsible for all ethical obligations

---

## License

Aria is licensed under the **GNU General Public License v3.0 or later**. See
[LICENSE](LICENSE) for the full text. In short: you may use, modify, and
redistribute this software, but any distributed derivative work must also be
released under the GPL.
