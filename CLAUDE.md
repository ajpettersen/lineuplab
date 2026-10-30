# CLAUDE.md

Practical notes for working in this repo. The app is Lineup Lab: the web app
is `artifacts/baseball-lineup`, the API is `artifacts/api-server`, and the
database schema is `lib/db` (Drizzle).

## Deployment (Railway)

- One Railway service, "Lineup Lab" in project `lineuplab`, defined in
  `.railway/railway.ts` (build and start commands live there). It deploys
  from `main` on GitHub (`ajpettersen/lineuplab`) and serves at
  `lineup-lab-production-7c33.up.railway.app`.
- **Deploys don't change the database schema.** Replit used to run
  `pnpm --filter db push` after every merge; that hook is gone. After a schema
  change in `lib/db/src/schema`, push it yourself against production:
  `railway run pnpm --filter db push` (from this folder, which is linked to the
  service). Review what drizzle-kit says it will do first; it can drop columns.
- `pnpm-workspace.yaml` used to exclude every platform's native binaries except
  Linux x64 (a Replit install-size trick), which made `pnpm install` fail on a
  Mac. Don't reintroduce per-platform `'-'` overrides.

## Sign-in (Clerk)

- Clerk runs on a test-tier instance (`capital-polliwog-64.clerk.accounts.dev`)
  that came from Replit's managed integration, so there may be no Clerk
  dashboard of our own. Real users sign in with Google; the rest of the
  accounts are e2e test users at `@example.com`.
- Leave `VITE_CLERK_PROXY_URL` unset. The proxy in
  `middlewares/clerkProxyMiddleware.ts` is meant for Clerk's paid tier with a
  registered domain.

## Box-score screenshots

Screenshots uploaded for box-score import are read by the AI and discarded.
They used to be saved to Replit's object storage, which doesn't exist outside
Replit. `imagePaths` remains in the API, always empty, for older clients.
