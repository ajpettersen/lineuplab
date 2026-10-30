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

## Sign-in (Lineup Lab's own, not Clerk)

Email + password sign-in run by the app itself (`routes/auth.ts`,
`lib/userSessions.ts`, `lib/passwords.ts`, `lib/passwordSetup.ts`; on the web
`lib/auth.tsx` and `components/auth-forms.tsx`). It replaced Clerk, which ran
through Replit's managed integration.

- **Account ids didn't change.** Every `user_id` / `owner_user_id` /
  `member_user_id` column still holds the same id: Clerk's `user_…` id for
  coaches from before, `usr_…` for accounts made since. Never mint `team_…`
  ids: that prefix marks synthetic team owners.
- Logins live in `user_accounts` (lowercased email, scrypt hash, nullable
  until set); sessions in `user_sessions`, keyed by a SHA-256 of the
  `lineuplab_session` HttpOnly cookie. Schema: `lib/db/src/schema/user_accounts.ts`,
  with `lib/db/sql/own-login.sql` as the identical hand-applied version.
- Lineup Lab sends no email. Coaches who forget a password, or who never had
  one (everyone from the Clerk days signed in with Google), get a single-use,
  7-day link from a master admin: Admin → Users → "Set-password link", or
  `railway run pnpm --filter @workspace/api-server run auth password-link <email>`.
  Master admins are `MASTER_ADMIN_USER_IDS`.
- `auth import-accounts` gives every coach with data a login: email from
  Clerk if `CLERK_SECRET_KEY` still works for them, otherwise from
  `team_memberships.member_email`. Most spring 2026 coaches came from the
  Replit deployment's Clerk instance, which Railway's key can't read, so
  their saved team email is all there is. Safe to rerun.
- Wrong passwords are limited per email and overall, in memory
  (`lib/signInLimits.ts`), never per IP.

## Box-score screenshots

Screenshots uploaded for box-score import are read by the AI and discarded.
They used to be saved to Replit's object storage, which doesn't exist outside
Replit. `imagePaths` remains in the API, always empty, for older clients.
