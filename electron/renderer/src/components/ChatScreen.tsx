import React, { useState, useEffect, useRef, useCallback } from "react";
import { sendMessage, fetchChatHistory } from "../lib/api";
import { typingDelay, maybeDoubleText, secondMessageDelay } from "../lib/timing";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import Header from "./Header";

export interface Message {
  id: string;
  from: "user" | "aria";
  text: string;
  ts: number;
  read?: boolean;
}

interface Props {
  participantId: string;
  apiKey: string;
  model: string;
  onLogout: () => void;
}

type SendState = "idle" | "waiting" | "typing";

export default function ChatScreen({ participantId, model, onLogout }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [sendState, setSendState] = useState<SendState>("idle");
  const [retryError, setRetryError] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<string | null>(null);

  // Load previous messages on first mount
  useEffect(() => {
    fetchChatHistory(participantId).then(({ messages: prev }) => {
      // Drop any blank messages left by older failed generations.
      const real = prev.filter((m) => m.text.trim());
      if (real.length > 0) {
        setMessages(real.map((m) => ({ ...m, read: true })));
      }
    }).catch(() => {/* no history yet — start fresh */});
  }, [participantId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sendState]);

  const addMessage = useCallback((msg: Message) => {
    // Never render a blank bubble — a failed generation surfaces as a retry,
    // not an empty message (and an empty bubble would still draw a "Read").
    if (!msg.text.trim()) return;
    setMessages((prev) => [...prev, msg]);
  }, []);

  async function handleSend() {
    const text = inputText.trim();
    if (!text || sendState !== "idle") return;
    setInputText("");
    setSendState("waiting");

    const userMsg: Message = {
      id: crypto.randomUUID(),
      from: "user",
      text,
      ts: Date.now(),
    };
    addMessage(userMsg);

    try {
      // Fetch the reply in the background while showing typing indicator
      const [replyPromise] = [sendMessage(participantId, text, model)];

      // Show typing indicator after a short pause
      await sleep(600);
      setSendState("typing");
      setRetryError(false);

      const result = await replyPromise;
      const reply = result.reply;

      // Realistic delay
      const delay = typingDelay(reply);
      await sleep(delay);

      const [firstPart, secondPart] = maybeDoubleText(reply);

      addMessage({
        id: crypto.randomUUID(),
        from: "aria",
        text: firstPart,
        ts: Date.now(),
        read: false,
      });

      if (secondPart) {
        setSendState("typing");
        await sleep(secondMessageDelay());
        addMessage({
          id: crypto.randomUUID(),
          from: "aria",
          text: secondPart,
          ts: Date.now(),
          read: false,
        });
      }

      setSendState("idle");

      // Mark as read after 1s
      setTimeout(() => {
        setMessages((prev) =>
          prev.map((m) => (m.from === "aria" ? { ...m, read: true } : m))
        );
      }, 1000);
    } catch (err) {
      // Silently retry — stay in "typing" state, retry every 10s
      scheduleRetry(text);
    }
  }

  function scheduleRetry(text: string) {
    if (pendingRef.current) return;
    pendingRef.current = text;
    setSendState("typing");
    setRetryError(true);
    const attempt = async () => {
      try {
        const result = await sendMessage(participantId, text, model);
        const reply = result.reply;
        pendingRef.current = null;
        await sleep(typingDelay(reply));
        addMessage({
          id: crypto.randomUUID(),
          from: "aria",
          text: reply,
          ts: Date.now(),
        });
        setSendState("idle");
        setRetryError(false);
      } catch {
        setTimeout(attempt, 10000);
      }
    };
    setTimeout(attempt, 10000);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const lastAriaMsg = [...messages].reverse().find((m) => m.from === "aria");

  return (
    <div style={styles.root}>
      <Header onLogout={onLogout} />
      <div style={styles.messageList}>
        {messages.map((msg, i) => {
          const prev = i > 0 ? messages[i - 1] : null;
          const showDate = !prev || !sameDay(prev.ts, msg.ts);
          return (
            <React.Fragment key={msg.id}>
              {showDate && <DateSeparator ts={msg.ts} />}
              <MessageBubble msg={msg} />
            </React.Fragment>
          );
        })}
        {sendState !== "idle" && !retryError && <TypingIndicator />}
        {sendState !== "idle" && retryError && (
          <div style={styles.retryMessage}>Aria didn't respond, retrying...</div>
        )}
        {lastAriaMsg?.read && sendState === "idle" && (
          <div style={styles.readReceipt}>Read</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        <textarea
          ref={inputRef}
          style={styles.input}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="iMessage"
          rows={1}
          disabled={sendState !== "idle"}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: inputText.trim() && sendState === "idle" ? 1 : 0.3,
          }}
          onClick={handleSend}
          disabled={!inputText.trim() || sendState !== "idle"}
          aria-label="Send"
        >
          ↑
        </button>
      </div>
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function DateSeparator({ ts }: { ts: number }) {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  let label: string;
  if (sameDay(ts, now.getTime())) {
    label = "Today";
  } else if (sameDay(ts, yesterday.getTime())) {
    label = "Yesterday";
  } else {
    const sameYear = d.getFullYear() === now.getFullYear();
    label = d.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    });
  }

  return (
    <div
      style={{
        alignSelf: "center",
        background: "var(--date-chip-bg, rgba(255,255,255,0.06))",
        color: "var(--text-secondary)",
        borderRadius: 12,
        padding: "4px 12px",
        fontSize: 12,
        margin: "14px 0 8px",
        userSelect: "none",
      }}
    >
      {label}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "var(--chat-bg)",
  },
  messageList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  readReceipt: {
    textAlign: "right",
    fontSize: 11,
    color: "var(--text-secondary)",
    marginRight: 4,
    marginTop: 2,
  },
  inputRow: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: "8px 12px 12px",
    borderTop: "1px solid var(--border)",
    background: "var(--chat-bg)",
  },
  input: {
    flex: 1,
    background: "var(--input-bg)",
    border: "1px solid var(--border)",
    borderRadius: 20,
    padding: "10px 14px",
    fontSize: 15,
    color: "var(--text-primary)",
    resize: "none",
    lineHeight: 1.4,
    maxHeight: 120,
    overflowY: "auto",
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    background: "#007aff",
    color: "#fff",
    fontSize: 18,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "opacity 0.15s",
  },
  retryMessage: {
    fontSize: 13,
    color: "#ff3b30",
    fontStyle: "italic",
    marginLeft: 16,
    marginBottom: 4,
  },
};
