# `@workspace/e2e`

End-to-end Playwright tests for the Lineup Lab web app.

## Why this exists

A lightweight, repo-checked Playwright spec to guard the **Select Positions**
feature (9-player vs. 10-player field shape), the **`First L.` short-name**
helper used on player chips and the drag overlay, and the **Innings-by-Position
tally**'s rule that LCF/RCF count as Outfield.

## Auth strategy

The spec signs in through the app's own API instead of driving the sign-in
page: it POSTs to `/api/auth/sign-up` with a disposable `@example.com`
coach, which sets the session cookie on the browser context.

Optional — sign in as a specific existing account instead:

- `E2E_USER_EMAIL`
- `E2E_USER_PASSWORD`

Each run without them leaves one new test account behind, so point it at a
development database, not production.

## Running

The API server and the Lineup Lab web dev server must already be running,
with the web app reachable at `E2E_BASE_URL` (or the default in
`playwright.config.ts`).

```bash
pnpm --filter @workspace/e2e exec playwright install --with-deps chromium
pnpm --filter @workspace/e2e run test:select-positions
```

To point at a different host (e.g. a published preview URL):

```bash
E2E_BASE_URL=https://your-preview.example.com pnpm --filter @workspace/e2e run test
```

## Linux system libraries

Playwright's headless Chromium needs a few desktop-Linux shared libraries
(`libglib-2.0.so.0`, `libnss3`, etc.). `playwright install --with-deps`
installs them on Debian/Ubuntu; otherwise use Playwright's official Docker
image (`mcr.microsoft.com/playwright`), which ships everything pre-installed.
