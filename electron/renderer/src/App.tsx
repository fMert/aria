import React, { useState, useEffect } from "react";
import AuthScreen from "./components/AuthScreen";
import ChatScreen from "./components/ChatScreen";
import ResearcherPanel from "./components/ResearcherPanel";
import ResearcherUnlock from "./components/ResearcherUnlock";
import { loadApiKey, loadParticipantId, loadModel, loadProvider, loadObserverModel, clearSession } from "./lib/storage";
import { initParticipant } from "./lib/api";

type Screen = "loading" | "auth" | "chat" | "researcher-unlock" | "researcher";

export default function App() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [participantId, setParticipantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [isResearcherMode] = useState(
    () => new URLSearchParams(window.location.search).get("researcher") === "1"
  );

  useEffect(() => {
    (async () => {
      if (isResearcherMode) {
        setScreen("researcher");
        return;
      }
      const pid = loadParticipantId();
      if (pid) {
        const provider = loadProvider(pid);
        const key = await loadApiKey(pid); // "" for keyless, null if not found
        const mdl = loadModel(pid);
        if (key !== null) {
          try {
            // Re-init the backend client — it loses state when the process restarts.
            await initParticipant(pid, key, mdl, provider, loadObserverModel());
            setApiKey(key);
            setParticipantId(pid);
            setModel(mdl);
            setScreen("chat");
            return;
          } catch {
            // Credentials or backend changed — fall through to auth screen.
          }
        }
      }
      setScreen("auth");
    })();

    // Listen for researcher shortcut from main process
    const aria = (window as any).aria;
    if (!aria?.onResearcherShortcut) return;
    const off = aria.onResearcherShortcut(() => {
      setScreen("researcher-unlock");
    });
    return off;
  }, [isResearcherMode]);

  async function handleLogout() {
    await clearSession();
    setParticipantId("");
    setApiKey("");
    setModel("gpt-4o");
    setScreen("auth");
  }

  if (screen === "loading") return <LoadingScreen />;

  if (screen === "researcher") return <ResearcherPanel participantId={participantId} />;

  if (screen === "researcher-unlock")
    return (
      <ResearcherUnlock
        onSuccess={() => setScreen("researcher")}
        onCancel={() => setScreen("chat")}
      />
    );

  if (screen === "auth")
    return (
      <AuthScreen
        onSuccess={(pid, key, mdl) => {
          setParticipantId(pid);
          setApiKey(key);
          setModel(mdl);
          setScreen("chat");
        }}
      />
    );

  return (
    <ChatScreen
      participantId={participantId}
      apiKey={apiKey}
      model={model}
      onLogout={handleLogout}
    />
  );
}

function LoadingScreen() {
  return (
    <div style={loadingStyles.container}>
      <div style={loadingStyles.avatar}>A</div>
      <div style={loadingStyles.spinner} />
      <p style={loadingStyles.text}>Setting up your conversation…</p>
    </div>
  );
}

const loadingStyles: Record<string, React.CSSProperties> = {
  container: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    background: "var(--bg)",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #b993d6, #8ca6db)",
    color: "#fff",
    fontSize: 28,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "3px solid var(--border)",
    borderTopColor: "#007aff",
    animation: "aria-spin 0.8s linear infinite",
  },
  text: {
    fontSize: 14,
    color: "var(--text-secondary)",
  },
};
