import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postAuth, useAuth } from "@/lib/auth";

/** Settings → Coaches: the signed-in coach changes their own password. */
export function PasswordCard() {
  const { email } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await postAuth("change-password", { currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid="card-password">
      <CardHeader>
        <CardTitle>Your password</CardTitle>
        <CardDescription>
          {email ? `You sign in as ${email}. ` : ""}Changing your password signs out your other devices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="max-w-sm space-y-3">
          <input type="email" autoComplete="username" value={email ?? ""} readOnly hidden />
          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
          {saved && <p className="text-sm font-medium text-emerald-700">Password changed.</p>}
          <Button type="submit" disabled={busy || !next} data-testid="button-change-password">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
