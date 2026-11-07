import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

/**
 * Transactional email. Two ways to send, whichever is configured:
 *
 *  1. SMTP (SMTP_USER + SMTP_PASS) — e.g. a Gmail account with an app
 *     password. Sends to any recipient and needs no domain, which is why
 *     it's the default for a one-team install. Gmail allows ~500/day.
 *  2. Resend (RESEND_API_KEY) — better deliverability at volume, but it
 *     only sends to arbitrary recipients once you verify a domain you own.
 *
 * SMTP wins when both are set. With neither, sendEmail() logs and reports
 * `skipped` rather than throwing, so the app runs fine without any mail
 * provider. Callers must not change behaviour based on the result — the
 * reset flow answers the browser identically either way so no one can
 * probe which emails have accounts.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

/** Resend's shared sender works with no domain setup; override once a domain is verified. */
const DEFAULT_FROM = "Lineup Lab <onboarding@resend.dev>";

/** Gmail unless SMTP_HOST says otherwise; 465 implicit TLS. */
const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 465);

export const emailEnabled = (): boolean =>
  !!(process.env.RESEND_API_KEY || (process.env.SMTP_USER && process.env.SMTP_PASS));

/**
 * Built once and reused — a fresh connection per email is slow and makes
 * Gmail more likely to throttle.
 */
let transporter: Transporter | null = null;
function smtpTransport(user: string, pass: string): Transporter {
  transporter ??= nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user, pass: pass.replace(/\s+/g, "") }, // Google prints app passwords in spaced groups
  });
  return transporter;
}

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
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (smtpUser && smtpPass) {
    try {
      await smtpTransport(smtpUser, smtpPass).sendMail({
        from: process.env.EMAIL_FROM ?? `Lineup Lab <${smtpUser}>`,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        ...(opts.html ? { html: opts.html } : {}),
      });
      return "sent";
    } catch (err) {
      logger.error({ err }, "SMTP send failed");
      return "failed";
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logger.warn({ to: opts.to, subject: opts.subject }, "email skipped — no SMTP_USER/SMTP_PASS or RESEND_API_KEY");
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
