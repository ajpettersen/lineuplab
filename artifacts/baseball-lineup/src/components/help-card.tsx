import { useState } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HelpCircle, Send, Loader2, ArrowRight } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface HelpAnswer {
  answer: string;
  links: { label: string; href: string }[];
}

const SAMPLE_QUESTIONS = [
  "I have 10 defensive players, how do I do that in this app?",
  "How do I import a roster from a screenshot?",
  "How do I share my team with another coach?",
  "How does the Fairness Score work?",
];

/**
 * Dashboard FAQ card. Coach types a question, we route it through
 * `POST /api/help/ask` (gpt-5.2 with a baked-in feature catalog) and
 * render the answer plus any deep-links the model suggests. Sample
 * prompts seed the input as one-tap shortcuts when the card is empty.
 */
export function HelpCard() {
  const [question, setQuestion] = useState("");
  const [submittedQuestion, setSubmittedQuestion] = useState<string | null>(null);
  const [answer, setAnswer] = useState<HelpAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const ask = async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3 || isLoading) return;
    setIsLoading(true);
    setError(null);
    setAnswer(null);
    setSubmittedQuestion(trimmed);
    try {
      const resp = await fetch(`${BASE}/api/help/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (!resp.ok) {
        let msg = "Help is unavailable right now.";
        try {
          const body = (await resp.json()) as { error?: string };
          if (body.error) msg = body.error;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const data = (await resp.json()) as HelpAnswer;
      setAnswer(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card data-testid="card-dashboard-help">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          Ask the app
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Not sure how something works? Ask in plain English and we'll point you
          to the right place.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
          className="flex gap-2"
        >
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How do I play with 10 fielders?"
            maxLength={500}
            disabled={isLoading}
            data-testid="input-help-question"
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={isLoading || question.trim().length < 3}
            data-testid="button-help-ask"
            size="default"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="ml-2 hidden sm:inline">
              {isLoading ? "Asking…" : "Ask"}
            </span>
          </Button>
        </form>

        {!answer && !error && !isLoading && (
          <div className="flex flex-wrap gap-2 pt-1">
            {SAMPLE_QUESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setQuestion(s);
                  void ask(s);
                }}
                className="text-xs text-left px-2.5 py-1.5 rounded-full border border-border bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                data-testid={`button-help-sample-${SAMPLE_QUESTIONS.indexOf(s)}`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {submittedQuestion && (answer || error || isLoading) && (
          <div className="pt-2 border-t border-border space-y-2">
            <div className="text-xs text-muted-foreground italic">
              You asked: {submittedQuestion}
            </div>
            {isLoading && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking…
              </div>
            )}
            {error && (
              <div className="text-sm text-destructive" data-testid="text-help-error">
                {error}
              </div>
            )}
            {answer && (
              <>
                <div
                  className="text-sm text-foreground whitespace-pre-wrap leading-relaxed"
                  data-testid="text-help-answer"
                >
                  {answer.answer}
                </div>
                {answer.links.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {answer.links.map((l, i) => (
                      <Link
                        key={`${l.href}-${i}`}
                        href={l.href}
                        data-testid={`link-help-${i}`}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1"
                        >
                          {l.label}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
