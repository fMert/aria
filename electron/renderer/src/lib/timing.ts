/** Realistic typing delay and double-text logic. */

export function typingDelay(replyText: string): number {
  const words = replyText.split(/\s+/).length;
  const base = words <= 8 ? 3000 : words <= 20 ? 8000 : 14000;
  const jitter = Math.random() * 4000 - 2000;
  return Math.max(2000, base + jitter);
}

/** Occasionally split a reply into two messages sent back-to-back. */
export function maybeDoubleText(reply: string): [string, string | null] {
  // ~20% chance of double text on longer messages
  const sentences = reply.match(/[^.!?]+[.!?]+/g);
  if (!sentences || sentences.length < 2) return [reply, null];
  if (Math.random() > 0.2) return [reply, null];

  const mid = Math.floor(sentences.length / 2);
  const first = sentences.slice(0, mid).join(" ").trim();
  const second = sentences.slice(mid).join(" ").trim();
  return [first, second];
}

export function secondMessageDelay(): number {
  return 1500 + Math.random() * 2000;
}
