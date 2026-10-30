import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Master-admin control on the Users table: makes a single-use, 7-day
 * "set your password" link for a coach. Lineup Lab sends no email, so the
 * admin copies the link and sends it themselves.
 */
export function AdminPasswordLink({ userId, hasEmail, hasPassword }: { userId: string; hasEmail: boolean; hasPassword: boolean }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const [askEmail, setAskEmail] = useState(!hasEmail);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(`${BASE}/api/admin/users/${encodeURIComponent(userId)}/password-link`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(askEmail ? { email } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data?.needsEmail) setAskEmail(true);
        setError(typeof data?.error === "string" ? data.error : "Could not make a link.");
        return;
      }
      setLink(`${window.location.origin}${BASE}/set-password#${data.token}`);
      void qc.invalidateQueries({ queryKey: ["admin"] });
    } catch {
      setError("Could not make a link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy. Select the link and copy it by hand.");
    }
  };

  if (link) {
    return (
      <div className="mt-1.5 max-w-xs space-y-1">
        <p className="text-[11px] text-muted-foreground">Send this privately. It works once, for 7 days.</p>
        <div className="flex gap-1">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border px-1.5 py-1 text-[11px]" />
          <button type="button" onClick={() => void copy()} className="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium hover:bg-muted">
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex max-w-xs flex-col items-start gap-1">
      {askEmail && (
        <input type="email" placeholder="Their email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border px-1.5 py-1 text-[11px]" data-testid={`input-password-link-email-${userId}`} />
      )}
      <button type="button" onClick={() => void create()} disabled={busy || (askEmail && !email)}
        className="inline-flex items-center gap-1 rounded border px-1.5 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
        data-testid={`button-password-link-${userId}`}>
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <KeyRound className="h-3 w-3" />}
        {hasPassword ? "Password reset link" : "Set-password link"}
      </button>
      {!hasPassword && <span className="text-[11px] text-amber-700">No password yet</span>}
      {error && <span role="alert" className="text-[11px] text-destructive">{error}</span>}
    </div>
  );
}
