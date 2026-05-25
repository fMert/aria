import React from "react";

export default function TypingIndicator() {
  return (
    <div style={styles.wrap}>
      <div style={styles.bubble}>
        <span style={{ ...styles.dot, animationDelay: "0ms" }} />
        <span style={{ ...styles.dot, animationDelay: "160ms" }} />
        <span style={{ ...styles.dot, animationDelay: "320ms" }} />
      </div>
      <style>{dotAnim}</style>
    </div>
  );
}

const dotAnim = `
@keyframes typingBounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
`;

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    justifyContent: "flex-start",
    marginBottom: 2,
  },
  bubble: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "10px 14px",
    background: "var(--bubble-aria)",
    borderRadius: "18px 18px 18px 4px",
  },
  dot: {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--typing-dot)",
    animation: "typingBounce 1.2s ease-in-out infinite",
  },
};
