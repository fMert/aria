import React, { useState, useEffect } from "react";
import {
  getLove,
  overrideLove,
  getDiary,
  appendDiary,
  getLog,
  exportSession,
  getHealth,
} from "../lib/api";
import { loadParticipantId } from "../lib/storage";

type Tab = "overview" | "diary" | "log" | "export";

interface Props {
  participantId?: string;
}

export default function ResearcherPanel({ participantId: propPid }: Props) {
  const [pid, setPid] = useState(propPid ?? loadParticipantId() ?? "");
  const [tab, setTab] = useState<Tab>("overview");
  const [love, setLove] = useState<{ value: number; history: any[] } | null>(null);
  const [loveOverride, setLoveOverride] = useState("");
  const [diary, setDiary] = useState("");
  const [diaryEntry, setDiaryEntry] = useState("");
  const [log, setLog] = useState("");
  const [health, setHealth] = useState<{ status: string; observer_healthy: boolean } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    if (!pid) return;
    refresh();
  }, [pid, tab]);

  async function refresh() {
    try {
      const h = await getHealth();
      setHealth(h);
      if (tab === "overview") {
        const l = await getLove(pid);
        setLove(l);
      } else if (tab === "diary") {
        const d = await getDiary(pid);
        setDiary(d.diary);
      } else if (tab === "log") {
        const l = await getLog(pid);
        setLog(l.log);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function handleLoveOverride() {
    const val = parseInt(loveOverride, 10);
    if (isNaN(val) || val < 0 || val > 10) {
      setStatusMsg("Value must be 0–10");
      return;
    }
    await overrideLove(pid, val);
    setLoveOverride("");
    setStatusMsg(`Love set to ${val}`);
    refresh();
  }

  async function handleDiaryAppend() {
    if (!diaryEntry.trim()) return;
    await appendDiary(pid, diaryEntry.trim());
    setDiaryEntry("");
    setStatusMsg("Entry appended");
    refresh();
  }

  async function handleExport() {
    try {
      const data = await exportSession(pid);
      const json = JSON.stringify(data, null, 2);
      const aria = (window as any).aria;
      if (aria?.saveExport) {
        const result = await aria.saveExport(json);
        setStatusMsg(result.saved ? `Saved to ${result.path}` : "Save cancelled");
      } else {
        // Browser fallback
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `aria-${pid}-export.json`;
        a.click();
        URL.revokeObjectURL(url);
        setStatusMsg("Downloaded");
      }
    } catch (e) {
      setStatusMsg("Export failed");
    }
  }

  async function handleDebrief() {
    const msg = `Thank you for participating in this study.\n\nWe want to be fully transparent with you: the person you were messaging in this study was not a real human. "Aria" was an AI assistant.\n\nThis study was investigating [RESEARCHER: fill in your study description here].\n\nIf you have any questions or concerns, please contact the research team.\n\nThank you for your participation.`;
    alert(msg);
  }

  return (
    <div style={styles.root}>
      <div style={styles.sidebar}>
        <div style={styles.sideTitle}>Research Panel</div>
        <div style={styles.pidRow}>
          <input
            style={styles.pidInput}
            value={pid}
            onChange={(e) => setPid(e.target.value)}
            placeholder="Participant ID"
          />
        </div>
        {health && (
          <div style={styles.healthRow}>
            <span style={{ color: health.status === "ok" ? "#34c759" : "#ff3b30" }}>●</span>
            {" "}Backend
            {" "}
            <span style={{ color: health.observer_healthy ? "#34c759" : "#ff9500" }}>●</span>
            {" "}Observer
          </div>
        )}
        {(["overview", "diary", "log", "export"] as Tab[]).map((t) => (
          <button
            key={t}
            style={{ ...styles.tabBtn, ...(tab === t ? styles.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button style={styles.debriefBtn} onClick={handleDebrief}>
          Show Debrief Screen
        </button>
      </div>

      <div style={styles.main}>
        {statusMsg && (
          <div style={styles.statusBanner}>
            {statusMsg}{" "}
            <button onClick={() => setStatusMsg("")} style={{ marginLeft: 8 }}>✕</button>
          </div>
        )}

        {tab === "overview" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Love Value</h2>
            {love && (
              <>
                <div style={styles.loveDisplay}>{love.value} / 10</div>
                <div style={styles.loveBar}>
                  <div style={{ ...styles.loveFill, width: `${love.value * 10}%` }} />
                </div>
                <div style={styles.row}>
                  <input
                    style={styles.smallInput}
                    type="number"
                    min={0}
                    max={10}
                    value={loveOverride}
                    onChange={(e) => setLoveOverride(e.target.value)}
                    placeholder="0–10"
                  />
                  <button style={styles.actionBtn} onClick={handleLoveOverride}>
                    Force value
                  </button>
                </div>
                <h3 style={{ marginTop: 20, fontSize: 14, color: "var(--text-secondary)" }}>
                  History
                </h3>
                <div style={styles.historyList}>
                  {love.history.length === 0 && (
                    <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>No changes yet</p>
                  )}
                  {love.history.slice(-20).reverse().map((h: any, i: number) => (
                    <div key={i} style={styles.historyItem}>
                      <span style={{ color: h.delta > 0 ? "#34c759" : "#ff3b30", fontWeight: 600 }}>
                        {h.delta > 0 ? "+" : ""}{h.delta}
                      </span>
                      {" "}→ {h.new} — {h.reason}
                      <span style={{ color: "var(--text-secondary)", fontSize: 11, marginLeft: 8 }}>
                        {new Date(h.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "diary" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Diary</h2>
            <textarea
              style={styles.diaryText}
              value={diary}
              readOnly
            />
            <h3 style={{ marginTop: 16, fontSize: 14, color: "var(--text-secondary)" }}>
              Append entry
            </h3>
            <textarea
              style={{ ...styles.diaryText, height: 80 }}
              value={diaryEntry}
              onChange={(e) => setDiaryEntry(e.target.value)}
              placeholder="Add a diary entry…"
            />
            <button style={styles.actionBtn} onClick={handleDiaryAppend}>
              Append
            </button>
          </div>
        )}

        {tab === "log" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Session Log</h2>
            <button style={{ ...styles.actionBtn, marginBottom: 12 }} onClick={refresh}>
              Refresh
            </button>
            <pre style={styles.logPre}>{log || "(empty)"}</pre>
          </div>
        )}

        {tab === "export" && (
          <div style={styles.section}>
            <h2 style={styles.sectionTitle}>Export</h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 16 }}>
              Export all session data (love history, diary, conversation log, message history) as JSON.
            </p>
            <button style={styles.actionBtn} onClick={handleExport}>
              Export session data
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    height: "100%",
    fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
  },
  sidebar: {
    width: 200,
    background: "#1c1c1e",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    padding: "16px 12px",
    gap: 6,
    flexShrink: 0,
  },
  sideTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "#8e8e93",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  pidRow: { marginBottom: 4 },
  pidInput: {
    width: "100%",
    background: "#2c2c2e",
    border: "none",
    borderRadius: 8,
    padding: "8px 10px",
    color: "#fff",
    fontSize: 13,
  },
  healthRow: {
    fontSize: 12,
    color: "#8e8e93",
    marginBottom: 6,
  },
  tabBtn: {
    textAlign: "left",
    padding: "9px 12px",
    borderRadius: 8,
    color: "#ebebf5",
    fontSize: 14,
    fontWeight: 500,
    background: "transparent",
  },
  tabActive: {
    background: "#3a3a3c",
  },
  debriefBtn: {
    marginTop: "auto",
    padding: "9px 12px",
    borderRadius: 8,
    background: "#ff9500",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    textAlign: "center",
  },
  main: {
    flex: 1,
    overflowY: "auto",
    background: "var(--bg)",
    padding: "24px",
  },
  statusBanner: {
    background: "#34c759",
    color: "#fff",
    borderRadius: 8,
    padding: "10px 14px",
    marginBottom: 16,
    fontSize: 14,
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
  },
  section: {
    maxWidth: 640,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 16,
    color: "var(--text-primary)",
  },
  loveDisplay: {
    fontSize: 48,
    fontWeight: 800,
    color: "var(--text-primary)",
    marginBottom: 8,
  },
  loveBar: {
    height: 8,
    background: "var(--border)",
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 16,
  },
  loveFill: {
    height: "100%",
    background: "linear-gradient(90deg, #ff9500, #ff3b30)",
    borderRadius: 4,
    transition: "width 0.4s",
  },
  row: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  smallInput: {
    width: 80,
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "9px 10px",
    fontSize: 14,
  },
  actionBtn: {
    background: "#007aff",
    color: "#fff",
    borderRadius: 8,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
  },
  historyList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 8,
    maxHeight: 300,
    overflowY: "auto",
  },
  historyItem: {
    background: "#fff",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    color: "var(--text-primary)",
    border: "1px solid var(--border)",
  },
  diaryText: {
    width: "100%",
    height: 300,
    background: "#fff",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "12px",
    fontSize: 14,
    fontFamily: "inherit",
    lineHeight: 1.6,
    resize: "vertical",
    color: "var(--text-primary)",
  },
  logPre: {
    background: "#1c1c1e",
    color: "#4cd964",
    borderRadius: 10,
    padding: "16px",
    fontSize: 12,
    fontFamily: "monospace",
    overflowX: "auto",
    maxHeight: 500,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  },
};
