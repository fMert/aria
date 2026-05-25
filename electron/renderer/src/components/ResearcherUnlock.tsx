import React, { useState } from "react";

interface Props {
  onSuccess: () => void;
  onCancel: () => void;
}

export default function ResearcherUnlock({ onSuccess, onCancel }: Props) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const aria = (window as any).aria;
    if (!aria?.openResearcherPanel) {
      onCancel();
      return;
    }
    const result = await aria.openResearcherPanel(pw);
    if (result.success) {
      onSuccess();
    } else {
      setError(true);
      setPw("");
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <h2 style={styles.title}>Researcher Access</h2>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setError(false); }}
            placeholder="Password"
            autoFocus
          />
          {error && <p style={styles.error}>Incorrect password</p>}
          <div style={styles.buttons}>
            <button type="button" style={styles.cancel} onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" style={styles.unlock}>
              Unlock
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.4)",
    backdropFilter: "blur(8px)",
  },
  card: {
    background: "#fff",
    borderRadius: 16,
    padding: "28px 24px",
    width: 300,
    boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 16,
    color: "var(--text-primary)",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  input: {
    background: "var(--input-bg)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "11px 13px",
    fontSize: 15,
  },
  error: {
    color: "#ff3b30",
    fontSize: 13,
  },
  buttons: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  cancel: {
    flex: 1,
    padding: "11px",
    borderRadius: 10,
    background: "var(--input-bg)",
    color: "var(--text-primary)",
    fontWeight: 500,
    fontSize: 15,
  },
  unlock: {
    flex: 1,
    padding: "11px",
    borderRadius: 10,
    background: "#007aff",
    color: "#fff",
    fontWeight: 600,
    fontSize: 15,
  },
};
