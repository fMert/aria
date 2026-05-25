/** Credential + settings storage. Uses Electron keytar when available;
 *  falls back to localStorage in a plain browser (desktop or Android/Termux). */

const SERVICE = "aria-app";
const PID_ACCOUNT = "participant-id";
const MODEL_PREFIX = "model-";
const PROVIDER_PREFIX = "provider-";
const REMEMBER_KEY = "remember-me";
const OBSERVER_MODEL_KEY = "observer-model";

function isElectron() {
  return typeof window !== "undefined" && !!(window as any).aria;
}

// API key is stored per-participant so different users on the same device
// don't share or overwrite each other's credentials.
export async function saveApiKey(key: string, pid: string): Promise<void> {
  if (!key) return; // keyless provider (e.g. Ollama) — nothing to store
  if (isElectron()) {
    await (window as any).aria.keytarSet(SERVICE, pid, key);
  } else {
    localStorage.setItem(`key-${pid}`, key);
  }
}

export async function loadApiKey(pid: string): Promise<string | null> {
  // Keyless providers never stored a key — return "" (valid, no key needed)
  if (loadProvider(pid) === "ollama") return "";
  if (isElectron()) {
    return (window as any).aria.keytarGet(SERVICE, pid);
  }
  return localStorage.getItem(`key-${pid}`);
}

export async function clearApiKey(pid: string): Promise<void> {
  if (isElectron()) {
    await (window as any).aria.keytarDelete(SERVICE, pid);
  } else {
    localStorage.removeItem(`key-${pid}`);
  }
}

export function saveParticipantId(id: string) {
  localStorage.setItem(PID_ACCOUNT, id);
}

export function loadParticipantId(): string | null {
  return localStorage.getItem(PID_ACCOUNT);
}

export function saveModel(model: string, pid: string) {
  localStorage.setItem(`${MODEL_PREFIX}${pid}`, model);
}

export function loadModel(pid: string): string {
  return localStorage.getItem(`${MODEL_PREFIX}${pid}`) ?? "gpt-4o";
}

export function saveProvider(provider: string, pid: string) {
  localStorage.setItem(`${PROVIDER_PREFIX}${pid}`, provider);
}

export function loadProvider(pid: string): string {
  return localStorage.getItem(`${PROVIDER_PREFIX}${pid}`) ?? "openai";
}

/** The local Ollama model used by the background observer. Global, not
 *  per-participant — the observer is a single shared process. Lets a phone
 *  pick a tiny model (e.g. tinyllama) while desktop keeps a larger one. */
export function saveObserverModel(model: string) {
  localStorage.setItem(OBSERVER_MODEL_KEY, model);
}

export function loadObserverModel(): string {
  return localStorage.getItem(OBSERVER_MODEL_KEY) ?? "aria-gemma";
}

export function saveRememberMe(value: boolean) {
  localStorage.setItem(REMEMBER_KEY, value ? "1" : "0");
}

export function loadRememberMe(): boolean {
  return localStorage.getItem(REMEMBER_KEY) === "1";
}

/** Clear the current session — returns to the login screen without deleting
 *  the user's data files on the backend. The API key stays in keytar under
 *  the participant's own account so re-login is seamless for returning users. */
export async function clearSession() {
  const pid = loadParticipantId();
  const remembered = loadRememberMe();
  localStorage.removeItem(PID_ACCOUNT);
  // If the user didn't check "Remember me", wipe the stored key too
  if (!remembered && pid) {
    await clearApiKey(pid);
  }
}
