/** Backend API client. The UI is served by the backend itself, so every call
 *  is same-origin — identical behaviour in Electron, a desktop browser, or
 *  Chrome on a phone (Termux). Paths are relative; they resolve against
 *  whatever host:port the page was loaded from. */

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail = `${r.status}`;
    try { const e = await r.json(); detail = e.detail ?? e.error ?? detail; } catch {}
    throw new Error(detail);
  }
  return r.json();
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) {
    let detail = `${r.status}`;
    try { const e = await r.json(); detail = e.detail ?? e.error ?? detail; } catch {}
    throw new Error(detail);
  }
  return r.json();
}

// Auth
export const validateKey = (provider: string, api_key: string) =>
  post<{ valid: boolean; models?: string[]; error?: string }>("/validate-key", {
    provider,
    api_key,
  });

// Session init
export const initParticipant = (
  participant_id: string,
  api_key: string,
  model: string,
  provider: string,
  observer_model: string
) =>
  post<{ status: string; love_value: number }>("/init", {
    participant_id,
    api_key,
    model,
    provider,
    observer_model,
  });

// Chat
export const sendMessage = (participant_id: string, message: string, model: string) =>
  post<{ reply: string; usage: Record<string, unknown> }>("/chat", { participant_id, message, model });

// Chat history
export const fetchChatHistory = (pid: string) =>
  get<{ messages: Array<{ id: string; from: "user" | "aria"; text: string; ts: number }> }>(
    `/chat-history/${pid}`
  );

// Ollama
export const fetchOllamaModels = () =>
  get<{ available: boolean; models: string[] }>("/ollama/models");

// Researcher
export const getLove = (pid: string) => get<{ value: number; history: unknown[] }>(`/researcher/love/${pid}`);
export const overrideLove = (participant_id: string, value: number, reason = "researcher override") =>
  post("/researcher/love", { participant_id, value, reason });
export const getDiary = (pid: string) => get<{ diary: string }>(`/researcher/diary/${pid}`);
export const appendDiary = (participant_id: string, entry: string) =>
  post("/researcher/diary", { participant_id, entry });
export const getLog = (pid: string) => get<{ log: string }>(`/researcher/log/${pid}`);
export const exportSession = (pid: string) => get<Record<string, unknown>>(`/researcher/export/${pid}`);
export const getHealth = () =>
  get<{ status: string; observer_healthy: boolean; observer_model?: string }>("/health");
