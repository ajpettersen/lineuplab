import { useEffect, useRef, useState } from "react";
import {
  useChatTournamentPoolPlayFormat,
  type ExtractedPoolPlayFormat,
  type PoolPlayChatMessage,
  type PoolPlayTiebreakerKey,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, MessageCircle, Send, Sparkles, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Conversational format intake. Coach chats with the AI in plain
 * English ("10 teams, top 6 advance, top 2 get a bye, tiebreakers
 * are h2h then run diff…"). Whenever the AI has enough signal it
 * returns a `parsedFormat` preview; the coach clicks "Apply format"
 * to commit it (parent decides whether that seeds a brand-new pool
 * or merges into an existing one).
 *
 * Stateless on the server — every turn re-sends the full thread.
 */

const TIEBREAKER_LABELS: Record<PoolPlayTiebreakerKey, string> = {
  winPct: "Win %",
  h2h: "Head-to-head",
  runDiff: "Run differential",
  runsAllowed: "Fewest runs allowed",
  runsScored: "Most runs scored",
  coinFlip: "Coin flip",
};

const SEED_GREETING =
  "Tell me about your tournament format — how many teams, how many advance, any byes, and what the tiebreakers are (in order).";

type AppliedFormat = {
  advanceCount?: number;
  byeCount?: number;
  tiebreakers?: PoolPlayTiebreakerKey[];
};

export function TournamentFormatChatDialog({
  tournamentId,
  onApplyFormat,
  onClose,
}: {
  tournamentId: number;
  onApplyFormat: (fmt: AppliedFormat) => void;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<PoolPlayChatMessage[]>([
    { role: "assistant", content: SEED_GREETING },
  ]);
  const [pendingFormat, setPendingFormat] = useState<ExtractedPoolPlayFormat | null>(null);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = useChatTournamentPoolPlayFormat({
    mutation: {
      onSuccess: (data) => {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
        if (data.parsedFormat) setPendingFormat(data.parsedFormat);
      },
      onError: (e) => {
        toast({
          title: "Chat failed",
          description: (e as Error)?.message ?? "Try again or use a rules photo instead.",
          variant: "destructive",
        });
      },
    },
  });

  // Auto-scroll on every new message / parsed format card.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pendingFormat, chat.isPending]);

  function send() {
    const text = input.trim();
    if (!text || chat.isPending) return;
    const next: PoolPlayChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    chat.mutate({ id: tournamentId, data: { messages: next } });
  }

  function apply() {
    if (!pendingFormat) return;
    const fmt: AppliedFormat = {};
    if (pendingFormat.advanceCount != null) fmt.advanceCount = pendingFormat.advanceCount;
    if (pendingFormat.byeCount != null) fmt.byeCount = pendingFormat.byeCount;
    if (pendingFormat.tiebreakers && pendingFormat.tiebreakers.length > 0)
      fmt.tiebreakers = pendingFormat.tiebreakers;
    onApplyFormat(fmt);
  }

  const canApply =
    !!pendingFormat &&
    (pendingFormat.advanceCount != null ||
      pendingFormat.byeCount != null ||
      (pendingFormat.tiebreakers != null && pendingFormat.tiebreakers.length > 0));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4" />
            Set up with AI
          </DialogTitle>
          <DialogDescription>
            Describe your tournament format in plain English. The AI will
            propose a setup you can apply with one tap.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-md border bg-muted/20 p-3 space-y-3 min-h-[260px]"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background border"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {chat.isPending && (
            <div className="flex justify-start">
              <div className="rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking…
              </div>
            </div>
          )}
          {pendingFormat && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                <Sparkles className="h-4 w-4" />
                Proposed format
              </div>
              <div className="text-sm text-amber-950 dark:text-amber-100 space-y-1">
                {pendingFormat.teamCount != null && (
                  <div>Teams in pool: <span className="font-semibold">{pendingFormat.teamCount}</span></div>
                )}
                {pendingFormat.advanceCount != null && (
                  <div>Advance: <span className="font-semibold">top {pendingFormat.advanceCount}</span></div>
                )}
                {pendingFormat.byeCount != null && pendingFormat.byeCount > 0 && (
                  <div>Byes: <span className="font-semibold">top {pendingFormat.byeCount}</span></div>
                )}
                {pendingFormat.tiebreakers && pendingFormat.tiebreakers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span>Tiebreakers:</span>
                    {pendingFormat.tiebreakers.map((k, i) => (
                      <span key={`${k}-${i}`} className="flex items-center gap-1">
                        <Badge variant="secondary" className="font-normal">
                          {i + 1}. {TIEBREAKER_LABELS[k] ?? k}
                        </Badge>
                      </span>
                    ))}
                  </div>
                )}
                {pendingFormat.notes && (
                  <div className="text-xs italic opacity-80 pt-1">
                    AI note: {pendingFormat.notes}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. 10 teams, top 6 advance, top 2 get a bye, tiebreakers are h2h, run diff, runs allowed"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={chat.isPending}
            className="flex-1"
          />
          <Button onClick={send} disabled={!input.trim() || chat.isPending} size="icon" aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply} disabled={!canApply}>
            <CheckCircle2 className="h-4 w-4 mr-1.5" />
            Apply format
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
