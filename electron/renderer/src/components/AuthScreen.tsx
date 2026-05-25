import React, { useState, useEffect } from "react";
import { validateKey, initParticipant, fetchOllamaModels } from "../lib/api";
import {
  saveApiKey,
  saveParticipantId,
  saveModel,
  saveProvider,
  saveRememberMe,
  loadRememberMe,
  saveObserverModel,
  loadObserverModel,
} from "../lib/storage";

type ProviderKey = "openai" | "gemini" | "ollama";

interface ProviderConfig {
  label: string;
  keyLabel: string;
  keyPlaceholder: string;
  noKey?: boolean;  // true when no API key is needed (local providers)
}

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  openai: {
    label: "OpenAI",
    keyLabel: "OpenAI API Key",
    keyPlaceholder: "sk-...",
  },
  gemini: {
    label: "Google Gemini",
    keyLabel: "Gemini API Key",
    keyPlaceholder: "AIza...",
  },
  ollama: {
    label: "Ollama (local)",
    keyLabel: "",
    keyPlaceholder: "",
    noKey: true,
  },
};

// ---------------------------------------------------------------------------
// Model filtering — only show models that can actually chat
// ---------------------------------------------------------------------------

function filterModels(provider: ProviderKey, ids: string[]): string[] {
  if (provider === "gemini") {
    const exclude = ["embedding", "tts", "image", "computer-use", "customtools", "robotics", "live", "nano-banana"];
    return ids
      .map((id) => id.replace(/^models\//, ""))
      .filter((id) => id.startsWith("gemini-"))
      .filter((id) => !exclude.some((ex) => id.includes(ex)))
      .sort((a, b) => b.localeCompare(a)); // newest first (higher version numbers sort later)
  }
  if (provider === "openai") {
    const chatPrefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
    const exclude = ["realtime", "audio", "search", "instruct"];
    return ids
      .filter((id) => chatPrefixes.some((p) => id.startsWith(p)))
      .filter((id) => !exclude.some((ex) => id.includes(ex)))
      .sort((a, b) => b.localeCompare(a));
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onSuccess: (pid: string, key: string, model: string) => void;
}

export default function AuthScreen({ onSuccess }: Props) {
  const [provider, setProvider] = useState<ProviderKey>("openai");
  const [key, setKey] = useState("");
  const [pid, setPid] = useState("");
  const [model, setModel] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "verifying-key" | "verified" | "starting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [rememberMe, setRememberMe] = useState(() => loadRememberMe());

  // Ollama-specific state
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaState, setOllamaState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");

  // Settings page (observer model selection)
  const [showSettings, setShowSettings] = useState(false);
  const [observerModel, setObserverModel] = useState<string>(() => loadObserverModel());

  const cfg = PROVIDERS[provider];
  const isKeyVerified = status === "verified" || status === "starting";

  // Fetch installed Ollama models whenever the user picks that provider
  useEffect(() => {
    if (provider !== "ollama") return;
    setOllamaState("loading");
    fetchOllamaModels().then(({ available, models }) => {
      if (!available || models.length === 0) {
        setOllamaState("unavailable");
        setOllamaModels([]);
        return;
      }
      setOllamaModels(models);
      setModel(models[0]);
      setOllamaState("ready");
    }).catch(() => {
      setOllamaState("unavailable");
      setOllamaModels([]);
    });
  }, [provider]);

  function handleProviderChange(p: ProviderKey) {
    setProvider(p);
    setStatus("idle");
    setErrorMsg("");
    setAvailableModels([]);
    setModel("");
  }

  async function handleVerifyKey() {
    const effectiveKey = key.trim();
    if (!effectiveKey) return;
    setStatus("verifying-key");
    setErrorMsg("");

    try {
      const result = await validateKey(provider, effectiveKey);
      if (!result.valid) {
        setStatus("error");
        setErrorMsg(result.error ?? "Invalid API key. Please check and try again.");
        return;
      }
      const filtered = filterModels(provider, result.models ?? []);
      if (filtered.length === 0) {
        setStatus("error");
        setErrorMsg("No chat-capable models found for this API key.");
        return;
      }
      setAvailableModels(filtered);
      setModel(filtered[0]);
      setStatus("verified");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message ?? "Couldn't connect to the backend.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const effectiveKey = cfg.noKey ? "" : key.trim();
    if (!pid.trim() || !model) return;
    setStatus("starting");
    setErrorMsg("");

    try {
      // For Ollama the key hasn't been validated yet — do it now
      if (cfg.noKey) {
        const result = await validateKey(provider, effectiveKey);
        if (!result.valid) {
          setStatus("error");
          setErrorMsg("Ollama is not running or not reachable on localhost:11434. Start Ollama and try again.");
          return;
        }
      }
      await initParticipant(
        pid.trim(),
        effectiveKey,
        model,
        provider,
        observerModel.trim() || "aria-gemma",
      );
      await saveApiKey(effectiveKey, pid.trim());
      saveParticipantId(pid.trim());
      saveModel(model, pid.trim());
      saveProvider(provider, pid.trim());
      saveRememberMe(rememberMe);
      onSuccess(pid.trim(), effectiveKey, model);
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message ?? "Couldn't connect to the backend. Make sure the app is running.");
    }
  }

  const canStart = pid.trim() && model && (
    provider === "ollama" ? ollamaState === "ready" : isKeyVerified
  );

  if (showSettings) {
    return (
      <SettingsScreen
        observerModel={observerModel}
        onChange={setObserverModel}
        onDone={() => {
          saveObserverModel(observerModel.trim() || "aria-gemma");
          setShowSettings(false);
        }}
      />
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <button
          type="button"
          style={styles.settingsGear}
          onClick={() => setShowSettings(true)}
          aria-label="Open settings"
        >
          ⚙
        </button>
        <div style={styles.header}>
          <div style={styles.avatar}>A</div>
          <h1 style={styles.name}>Aria</h1>
          <p style={styles.subtitle}>Set up your conversation</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Participant ID</label>
          <input
            style={styles.input}
            type="text"
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            placeholder="Enter participant ID"
            autoFocus
            required
          />

          <label style={styles.label}>Provider</label>
          <div style={styles.modelGrid}>
            {(Object.keys(PROVIDERS) as ProviderKey[]).map((p) => (
              <button
                key={p}
                type="button"
                style={{
                  ...styles.modelCard,
                  ...(provider === p ? styles.modelCardSelected : {}),
                }}
                onClick={() => handleProviderChange(p)}
              >
                <span style={styles.modelName}>{PROVIDERS[p].label}</span>
              </button>
            ))}
          </div>

          {cfg.noKey ? (
            <p style={styles.noKeyNote}>No API key needed — runs locally via Ollama.</p>
          ) : (
            <>
              <label style={styles.label}>{cfg.keyLabel}</label>
              <div style={styles.keyRow}>
                <input
                  style={{ ...styles.input, flex: 1 }}
                  type="password"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    // Reset verification when key changes after being verified
                    if (isKeyVerified) {
                      setStatus("idle");
                      setAvailableModels([]);
                      setModel("");
                    }
                  }}
                  placeholder={cfg.keyPlaceholder}
                  required
                />
                <button
                  type="button"
                  style={{
                    ...styles.verifyBtn,
                    opacity: key.trim() && status !== "verifying-key" ? 1 : 0.5,
                  }}
                  onClick={handleVerifyKey}
                  disabled={!key.trim() || status === "verifying-key"}
                >
                  {status === "verifying-key" ? "Verifying…" : isKeyVerified ? "Verified ✓" : "Verify"}
                </button>
              </div>
            </>
          )}

          {/* Model selection */}
          {provider === "ollama" ? (
            ollamaState === "loading" ? (
              <p style={styles.noKeyNote}>Checking Ollama for installed models…</p>
            ) : ollamaState === "unavailable" ? (
              <p style={{ ...styles.noKeyNote, color: "#ff3b30" }}>
                Ollama is not running or has no models installed.{"\n"}
                Start Ollama and run: <code>ollama pull gemma4:26b</code>
              </p>
            ) : ollamaState === "ready" ? (
              <>
                <label style={styles.label}>Model</label>
                <div style={styles.scrollableModelGrid}>
                  {ollamaModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      style={{
                        ...styles.modelCard,
                        ...(model === m ? styles.modelCardSelected : {}),
                      }}
                      onClick={() => setModel(m)}
                    >
                      <span style={styles.modelName}>{m}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null
          ) : isKeyVerified && availableModels.length > 0 ? (
            <>
              <label style={styles.label}>Model</label>
              <div style={styles.scrollableModelGrid}>
                {availableModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    style={{
                      ...styles.modelCard,
                      ...(model === m ? styles.modelCardSelected : {}),
                    }}
                    onClick={() => setModel(m)}
                  >
                    <span style={styles.modelName}>{m}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}

          {status === "error" && <p style={styles.error}>{errorMsg}</p>}

          {!cfg.noKey && (
            <label style={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={styles.checkbox}
              />
              <span style={styles.checkboxLabel}>Remember my API key</span>
            </label>
          )}

          <button
            type="submit"
            style={{
              ...styles.button,
              opacity: canStart && status !== "starting" ? 1 : 0.6,
            }}
            disabled={!canStart || status === "starting"}
          >
            {status === "starting" ? "Starting…" : "Start conversation"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page — reached from the gear on the login screen
// ---------------------------------------------------------------------------

function SettingsScreen({
  observerModel,
  onChange,
  onDone,
}: {
  observerModel: string;
  onChange: (m: string) => void;
  onDone: () => void;
}) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [ollamaUp, setOllamaUp] = useState<boolean | null>(null);

  useEffect(() => {
    fetchOllamaModels()
      .then(({ available, models }) => {
        setOllamaUp(available);
        setInstalled(models);
      })
      .catch(() => setOllamaUp(false));
  }, []);

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.settingsHeader}>
          <button type="button" style={styles.backBtn} onClick={onDone}>
            ‹ Back
          </button>
          <h1 style={styles.settingsTitle}>Settings</h1>
        </div>

        <label style={styles.label}>Observer model</label>
        <p style={styles.settingsHint}>
          The background model that quietly updates Aria's diary and feelings.
          It runs locally through Ollama and never appears in the chat. On a
          low-power device like a phone, pick a small model such as tinyllama.
        </p>
        <input
          style={styles.input}
          type="text"
          value={observerModel}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. tinyllama, aria-gemma"
        />

        {ollamaUp === false && (
          <p style={{ ...styles.settingsHint, color: "#ff3b30" }}>
            Ollama isn't reachable right now — you can still type a model name.
          </p>
        )}

        {installed.length > 0 && (
          <>
            <label style={styles.label}>Installed Ollama models</label>
            <div style={styles.scrollableModelGrid}>
              {installed.map((m) => (
                <button
                  key={m}
                  type="button"
                  style={{
                    ...styles.modelCard,
                    ...(observerModel === m ? styles.modelCardSelected : {}),
                  }}
                  onClick={() => onChange(m)}
                >
                  <span style={styles.modelName}>{m}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <button type="button" style={styles.button} onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
    padding: 24,
    overflowY: "auto",
  },
  card: {
    background: "#fff",
    borderRadius: 20,
    padding: "32px 28px",
    width: "100%",
    maxWidth: 380,
    boxShadow: "0 4px 40px rgba(0,0,0,0.12)",
    position: "relative",
  },
  header: {
    textAlign: "center",
    marginBottom: 28,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #b993d6, #8ca6db)",
    color: "#fff",
    fontSize: 32,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 12px",
    fontWeight: 600,
  },
  name: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginTop: 8,
  },
  input: {
    background: "var(--input-bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 15,
    color: "var(--text-primary)",
    width: "100%",
  },
  keyRow: {
    display: "flex",
    gap: 8,
    alignItems: "stretch",
  },
  verifyBtn: {
    background: "#007aff",
    color: "#fff",
    borderRadius: 10,
    padding: "0 16px",
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: "nowrap",
    cursor: "pointer",
    border: "none",
    transition: "opacity 0.15s",
  },
  modelGrid: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  scrollableModelGrid: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    maxHeight: 180,
    overflowY: "auto",
    padding: 2,
  },
  modelCard: {
    flex: 1,
    minWidth: 90,
    background: "var(--input-bg)",
    border: "1.5px solid var(--border)",
    borderRadius: 10,
    padding: "10px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  modelCardSelected: {
    borderColor: "#007aff",
    background: "#f0f7ff",
  },
  modelName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  error: {
    color: "#ff3b30",
    fontSize: 13,
    marginTop: 4,
  },
  noKeyNote: {
    fontSize: 13,
    color: "var(--text-secondary)",
    background: "var(--input-bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "10px 14px",
    marginTop: 4,
  },
  button: {
    background: "#007aff",
    color: "#fff",
    borderRadius: 12,
    padding: "14px",
    fontSize: 16,
    fontWeight: 600,
    marginTop: 12,
    transition: "opacity 0.15s",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    cursor: "pointer",
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: "#007aff",
    cursor: "pointer",
  },
  checkboxLabel: {
    fontSize: 13,
    color: "var(--text-secondary)",
  },
  settingsGear: {
    position: "absolute",
    top: 12,
    right: 14,
    fontSize: 20,
    lineHeight: 1,
    color: "var(--text-secondary)",
    padding: 6,
  },
  settingsHeader: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 18,
  },
  settingsTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
  },
  backBtn: {
    fontSize: 15,
    color: "#007aff",
    fontWeight: 500,
    padding: "4px 6px 4px 0",
  },
  settingsHint: {
    fontSize: 12,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginTop: 2,
    marginBottom: 2,
  },
};
