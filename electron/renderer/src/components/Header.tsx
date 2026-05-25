import React from "react";

interface Props {
  onLogout: () => void;
}

export default function Header({ onLogout }: Props) {
  return (
    <div style={styles.header}>
      <div style={styles.avatar}>A</div>
      <div style={styles.info}>
        <div style={styles.name}>Aria</div>
        <div style={styles.status}>Active now</div>
      </div>
      <button style={styles.logoutBtn} onClick={onLogout} title="Log out">
        &#x2715;
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 16px",
    borderBottom: "1px solid var(--border)",
    background: "var(--header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #b993d6, #8ca6db)",
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    flex: 1,
  },
  name: {
    fontSize: 15,
    fontWeight: 700,
    color: "var(--text-primary)",
    lineHeight: 1.2,
  },
  status: {
    fontSize: 12,
    color: "var(--text-secondary)",
  },
  logoutBtn: {
    marginLeft: "auto",
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "transparent",
    border: "none",
    color: "var(--text-secondary)",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
    transition: "background 0.15s, color 0.15s",
  },
};
