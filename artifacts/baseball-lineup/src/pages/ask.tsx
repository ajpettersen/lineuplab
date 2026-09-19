import { useRef, useState, useEffect, type ReactNode } from "react";
import { Sparkles, Send, User } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ChatMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Who has sat on the bench the most this season?",
  "How many times has each player pitched?",
  "What's our win-loss record so far?",
  "Who has the highest OPS on the team?",
];

// In-app paths the assistant hands back (e.g. a lineup-copy preview link
// from its prepare_lineup_copy tool), optionally wrapped as a markdown link.
const APP_LINK_RE = /\[([^\]]+)\]\((\/games\/\d+[^\s)]*)\)|(\/games\/\d+(?:\?[^\s)]*)?)/g;

function WithAppLinks({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(APP_LINK_RE)) {
    out.push(text.slice(last, m.index));
    const href = m[2] ?? m[3]!;
    out.push(
      <Link key={m.index} href={href} className="font-medium text-primary underline underline-offset-2">
        {m[1] ?? "Open it"}
      </Link>,
    );
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

export default function Ask() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    const next: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setLoading(true);
    const myRequestId = ++requestIdRef.current;
    try {
      // Send a bounded tail of the conversation so context stays small and
      // within the server's 24-message cap.
      const resp = await fetch(`${BASE}/api/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20) }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${resp.status})`);
      }
      const data = await resp.json();
      if (myRequestId !== requestIdRef.current) return;
      setMessages((prev) => [...prev, { role: "assistant", content: data.text }]);
    } catch (e) {
      if (myRequestId !== requestIdRef.current) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)] max-w-3xl mx-auto">
      <div className="mb-3">
        <h1 className="text-2xl font-display font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" />
          Ask Lineup Lab
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Your team's AI — ask about rotations, stats, the schedule, or anything coaching.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-lg border bg-card p-4 space-y-4"
        data-testid="ask-messages"
      >
        {empty && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 py-8">
            <div className="rounded-full bg-primary/10 p-3">
              <Sparkles className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="font-medium">Ask anything about your team</p>
              <p className="text-sm text-muted-foreground mt-1">
                I can look up your roster, results, season stats, and playing-time fairness.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs rounded-full border px-3 py-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  data-testid="ask-suggestion"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex gap-2.5 ${m.role === "user" ? "justify-end" : "justify-start"}`}
            data-testid={`ask-message-${m.role}`}
          >
            {m.role === "assistant" && (
              <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-fit">
                <Sparkles className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={`rounded-2xl px-3.5 py-2 text-sm leading-snug whitespace-pre-wrap max-w-[80%] ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground rounded-br-sm"
                  : "bg-muted text-foreground rounded-bl-sm"
              }`}
            >
              {m.role === "assistant" ? <WithAppLinks text={m.content} /> : m.content}
            </div>
            {m.role === "user" && (
              <div className="shrink-0 rounded-full bg-muted p-1.5 h-fit">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-2.5 justify-start" data-testid="ask-loading">
            <div className="shrink-0 rounded-full bg-primary/10 p-1.5 h-fit">
              <Sparkles className="h-4 w-4 text-primary animate-pulse" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive mt-2" data-testid="ask-error">
          {error}
        </p>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Ask about your team or coaching…"
          rows={1}
          disabled={loading}
          data-testid="input-ask"
          className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring max-h-32"
        />
        <Button
          type="submit"
          size="icon"
          disabled={loading || !input.trim()}
          data-testid="button-ask-send"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
