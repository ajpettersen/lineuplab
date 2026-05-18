import type { useToast } from "@/hooks/use-toast";

type ToastFn = ReturnType<typeof useToast>["toast"];

/**
 * Standard "show an error to the coach" helper used by mutation
 * onError handlers and try/catch blocks across the app.
 *
 * Why this exists: most error toasts used to be a single line like
 *
 *   onError: () => toast({ title: "Failed to add game", variant: "destructive" })
 *
 * That throws away the actual error message — so when the server
 * returned a useful detail ("That game date is in the past"), the
 * coach only ever saw "Failed to add game" and had no way to recover
 * without contacting support. This helper surfaces the real message
 * in the description and gives callers a one-liner replacement.
 *
 * Usage:
 *   onError: (err) => toastError(toast, "Failed to add game", err)
 *
 * Optional `hint` appends a recovery suggestion after the error:
 *   toastError(toast, "Failed to save lineup", err, {
 *     hint: "The lineup was refreshed — check whether your changes are there before retrying.",
 *   });
 */
export function toastError(
  toast: ToastFn,
  title: string,
  err: unknown,
  opts?: { hint?: string },
): void {
  const detail =
    err instanceof Error && err.message
      ? err.message
      : typeof err === "string" && err
        ? err
        : "Something went wrong.";
  const description = opts?.hint ? `${detail} ${opts.hint}` : detail;
  toast({ title, description, variant: "destructive" });
}
