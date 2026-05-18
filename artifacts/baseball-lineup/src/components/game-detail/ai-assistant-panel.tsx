import { Sparkles, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * AI Assistant search bar + answer/memory chip on the game-detail
 * page. Extracted from `game-detail.tsx` (which was approaching
 * 5,000 lines) to keep this UI surface independently editable. The
 * state and `onAsk` / `onClearMemory` handlers still live in the
 * parent — this is a pure presentation component so the parent can
 * orchestrate the mutation, request-id race-protection, and AI
 * memory refetch without this file needing to know about them.
 */
export function AiAssistantPanel({
  aiInput,
  onAiInputChange,
  aiLoading,
  onAsk,
  aiAnswer,
  onDismissAnswer,
  aiMemoryCount,
  aiMemoryClearing,
  onClearMemory,
  mobileToolsOpen,
}: {
  aiInput: string;
  onAiInputChange: (value: string) => void;
  aiLoading: boolean;
  onAsk: () => void;
  aiAnswer: string | null;
  onDismissAnswer: () => void;
  aiMemoryCount: number;
  aiMemoryClearing: boolean;
  onClearMemory: () => void;
  mobileToolsOpen: boolean;
}) {
  return (
    <Card className={mobileToolsOpen ? "" : "max-sm:hidden"}>
      <CardContent className="p-3">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!aiLoading) onAsk();
          }}
        >
          <Sparkles className="h-4 w-4 text-purple-500 shrink-0 ml-1" />
          <Input
            value={aiInput}
            onChange={(e) => onAiInputChange(e.target.value)}
            placeholder='Ask the assistant — e.g. "Why is Henry on the bench in inning 2?" or "Put Henry at catcher for the first 3 innings"'
            disabled={aiLoading}
            data-testid="input-ai-assistant"
            className="flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={aiLoading || !aiInput.trim()}
            data-testid="button-ai-ask"
          >
            {aiLoading ? "Thinking…" : "Ask"}
          </Button>
        </form>
        {aiAnswer && (
          <div
            className="mt-3 p-3 rounded-md bg-purple-50 border border-purple-200 text-sm text-purple-900 flex items-start justify-between gap-3"
            data-testid="ai-answer"
          >
            <div className="flex items-start gap-2 flex-1">
              <Sparkles className="h-4 w-4 mt-0.5 text-purple-500 shrink-0" />
              <p className="leading-snug">{aiAnswer}</p>
            </div>
            <button
              type="button"
              onClick={onDismissAnswer}
              className="text-purple-400 hover:text-purple-700 shrink-0"
              aria-label="Dismiss assistant message"
              data-testid="button-ai-dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {aiMemoryCount > 0 && (
          <div
            className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground"
            data-testid="ai-memory-indicator"
          >
            <span>
              Remembering {aiMemoryCount} earlier assistant{" "}
              {aiMemoryCount === 1 ? "pin" : "pins"} for this game so they
              aren't undone.
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onClearMemory}
              disabled={aiMemoryClearing}
              data-testid="button-ai-memory-clear"
            >
              {aiMemoryClearing ? "Clearing…" : "Reset"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
