import React from "react";
import type { Message } from "./ChatScreen";

interface Props {
  msg: Message;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export default function MessageBubble({ msg }: Props) {
  const isUser = msg.from === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          maxWidth: "72%",
          padding: "8px 12px 6px",
          borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
          background: isUser ? "var(--bubble-user)" : "var(--bubble-aria)",
          color: isUser ? "var(--bubble-user-text)" : "var(--bubble-aria-text)",
          fontSize: 15,
          lineHeight: 1.45,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}
      >
        {msg.text}
        <span
          style={{
            fontSize: 10.5,
            opacity: 0.55,
            marginLeft: 8,
            float: "right",
            paddingTop: 5,
            whiteSpace: "nowrap",
            userSelect: "none",
          }}
        >
          {formatTime(msg.ts)}
        </span>
      </div>
    </div>
  );
}
