import {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
} from "electron";
import path from "path";
import http from "http";
import { spawn, ChildProcess } from "child_process";
import keytar from "keytar";

const SERVICE_NAME = "aria-app";
const KEY_NAME = "openai-api-key";
const RESEARCHER_PW_KEY = "researcher-password";

let mainWindow: BrowserWindow | null = null;
let researcherWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
let backendPort = 0;

// ---------------------------------------------------------------------------
// Backend startup
// ---------------------------------------------------------------------------

// A FIXED port — not a random one. The renderer is served by the backend, so
// the page origin is http://127.0.0.1:<port>. A changing port would change the
// origin every launch and wipe the renderer's localStorage (saved participant,
// settings, "remember me"). It is also the address used to open the app on a
// phone, so it must be predictable.
const BACKEND_PORT = 8000;

function backendHealthy(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

async function startBackend(): Promise<void> {
  backendPort = BACKEND_PORT;

  // Reuse a backend that's already listening (a previous instance, or one
  // started by hand) rather than spawning a second that can't bind the port.
  if (await backendHealthy()) return;

  const backendDir = path.join(app.getAppPath(), "backend");
  const pythonCmd = process.platform === "win32" ? "python" : "python3";

  backendProcess = spawn(
    pythonCmd,
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    { cwd: backendDir, stdio: "ignore" }
  );

  backendProcess.on("error", (err) => {
    console.error("Backend failed to start:", err);
  });

  // Wait until backend is accepting connections
  await waitForBackend();
}

function waitForBackend(): Promise<void> {
  return new Promise((resolve) => {
    const tryConnect = () => {
      const req = http.get(`http://127.0.0.1:${backendPort}/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(tryConnect, 300);
      });
      req.on("error", () => setTimeout(tryConnect, 300));
    };
    setTimeout(tryConnect, 500);
  });
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------
async function createMainWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 430,
    height: 760,
    minWidth: 380,
    minHeight: 600,
    title: "Messages",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // The backend serves the UI itself, so the desktop window loads the same
  // same-origin web app a browser would. backendPort is set by startBackend().
  await mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createResearcherWindow(): void {
  if (researcherWindow) {
    researcherWindow.focus();
    return;
  }
  researcherWindow = new BrowserWindow({
    width: 900,
    height: 700,
    title: "Aria — Research Panel",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  researcherWindow.loadURL(`http://127.0.0.1:${backendPort}/?researcher=1`);

  researcherWindow.on("closed", () => {
    researcherWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  await startBackend();
  await createMainWindow();

  globalShortcut.register("CommandOrControl+Shift+R", () => {
    mainWindow?.webContents.send("researcher-shortcut");
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  backendProcess?.kill();
});

app.on("activate", () => {
  if (mainWindow === null) createMainWindow();
});

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

// Expose backend port to renderer
ipcMain.handle("get-backend-port", () => backendPort);

// Keytar — encrypted key storage
ipcMain.handle("keytar-get", async (_e, service: string, account: string) => {
  return keytar.getPassword(service, account);
});

ipcMain.handle("keytar-set", async (_e, service: string, account: string, password: string) => {
  return keytar.setPassword(service, account, password);
});

ipcMain.handle("keytar-delete", async (_e, service: string, account: string) => {
  return keytar.deletePassword(service, account);
});

// Researcher panel unlock
ipcMain.handle("open-researcher-panel", async (_e, enteredPassword: string) => {
  const stored = await keytar.getPassword(SERVICE_NAME, RESEARCHER_PW_KEY);
  const expected = stored ?? "aria2024"; // default password if not set
  if (enteredPassword === expected) {
    createResearcherWindow();
    return { success: true };
  }
  return { success: false };
});

ipcMain.handle("set-researcher-password", async (_e, pw: string) => {
  await keytar.setPassword(SERVICE_NAME, RESEARCHER_PW_KEY, pw);
  return { success: true };
});

// Export — open save dialog
ipcMain.handle("save-export", async (_e, data: string) => {
  const { filePath } = await dialog.showSaveDialog({
    title: "Export session data",
    defaultPath: "aria-session-export.json",
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (filePath) {
    const fs = require("fs");
    fs.writeFileSync(filePath, data, "utf-8");
    return { saved: true, path: filePath };
  }
  return { saved: false };
});
