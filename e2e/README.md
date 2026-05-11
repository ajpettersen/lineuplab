# `@workspace/e2e`

End-to-end Playwright tests for the Lineup Lab web app.

## Why this exists

A lightweight, repo-checked Playwright spec to guard the **Select Positions**
feature (9-player vs. 10-player field shape), the **`First L.` short-name**
helper used on player chips and the drag overlay, and the **Innings-by-Position
tally**'s rule that LCF/RCF count as Outfield.

## Auth strategy

The web app uses Clerk. To avoid driving Clerk's hosted UI in tests we use
[`@clerk/testing`](https://clerk.com/docs/testing/playwright/overview):

- `global-setup.ts` calls `clerkSetup()` to fetch a testing token that
  whitelists the test browser with Clerk in dev mode.
- The spec calls `clerk.signIn(...)` to sign a user in programmatically.

Required env (already present in this Replit project for development):

- `CLERK_PUBLISHABLE_KEY` (or `VITE_CLERK_PUBLISHABLE_KEY`)
- `CLERK_SECRET_KEY` — the **dev/test** secret key (NOT a production key).

Optional — pin to a specific seeded test user instead of having the spec
create a disposable one for each run:

- `E2E_CLERK_USER_EMAIL`
- `E2E_CLERK_USER_PASSWORD`

The spec is wired to create a fresh user on each run when the optional
vars are missing, so it works against a clean dev tenant.

## Running

The dev workflows must already be running (`API Server` and `Lineup Lab web`
in the workspace; the shared proxy on `localhost:80` routes both).

```bash
pnpm --filter @workspace/e2e exec playwright install --with-deps chromium
pnpm --filter @workspace/e2e run test:select-positions
```

To point at a different host (e.g. a published preview URL):

```bash
E2E_BASE_URL=https://your-preview.replit.app pnpm --filter @workspace/e2e run test
```

## A note on the Replit shell

Running this spec from the Replit workspace shell currently fails at
browser launch because the bundled headless Chromium needs a few
desktop-Linux shared libs (`libglib-2.0.so.0`, `libnss3`, etc.) that
aren't part of the workspace's Nix profile. The same flow has been
verified end-to-end via the platform's `runTest` testing harness, which
runs Playwright in an environment that already has those system
libraries (see Task #3 history). When running locally or in CI you can
either provide a Nix shell with the GTK/NSS deps, or use Playwright's
official Docker image (`mcr.microsoft.com/playwright`) which ships
everything pre-installed.
