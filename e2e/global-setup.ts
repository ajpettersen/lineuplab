import { clerkSetup } from "@clerk/testing/playwright";
import type { FullConfig } from "@playwright/test";

/**
 * Playwright global setup: bootstraps Clerk testing tokens so the spec
 * can sign in programmatically without driving the Clerk hosted UI.
 *
 * Required env (read from the Replit project secrets):
 *   - CLERK_PUBLISHABLE_KEY (or VITE_CLERK_PUBLISHABLE_KEY)
 *   - CLERK_SECRET_KEY
 *
 * Optional — if not provided, the spec will create a fresh disposable
 * test user via Clerk's Backend API:
 *   - E2E_CLERK_USER_EMAIL
 *   - E2E_CLERK_USER_PASSWORD
 */
export default async function globalSetup(_config: FullConfig) {
  const publishable =
    process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (publishable && !process.env.CLERK_PUBLISHABLE_KEY) {
    process.env.CLERK_PUBLISHABLE_KEY = publishable;
  }
  if (!process.env.CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    throw new Error(
      "Missing CLERK_PUBLISHABLE_KEY and/or CLERK_SECRET_KEY — required for the e2e Clerk testing token setup.",
    );
  }
  await clerkSetup();
}
