import { logger } from "./logger";

/**
 * Transactional email via Resend's HTTP API (no SDK — one fetch call).
 *
 * Deliberately optional: with RESEND_API_KEY unset, sendEmail() logs and
 * reports `skipped` instead of throwing, so the app runs fine without a
 * mail provider and the password-reset route can ship before the key
 * exists. Callers must not change behaviour based on the result — the
 * reset flow answers the browser identically either way so no one can
 * probe which emails have accounts.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** Resend's shared sender works with no domain setup; override once a domain is verified. */
const DEFAULT_FROM = "Lineup Lab <onboarding@resend.dev>";

export const emailEnabled = (): boolean => !!process.env.RESEND_API_KEY;

export function appUrl(): string {
  return (process.env.LINEUP_LAB_APP_URL ?? "https://lineup-lab-production-7c33.up.railway.app").replace(/\/+$/, "");
}

export type SendResult = "sent" | "skipped" | "failed";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn({ to: opts.to, subject: opts.subject }, "email skipped — RESEND_API_KEY not set");
    return "skipped";
  }
  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? DEFAULT_FROM,
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        ...(opts.html ? { html: opts.html } : {}),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!r.ok) {
      // Body can name the problem (unverified domain, bad key) but may echo
      // the recipient, so log the status and a short excerpt only.
      const detail = (await r.text().catch(() => "")).slice(0, 200);
      logger.error({ status: r.status, detail }, "email send failed");
      return "failed";
    }
    return "sent";
  } catch (err) {
    logger.error({ err }, "email send threw");
    return "failed";
  }
}
