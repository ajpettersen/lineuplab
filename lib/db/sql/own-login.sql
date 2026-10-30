-- Lineup Lab's own email + password sign-in, replacing Clerk. Accounts keep
-- the id every other table already uses (Clerk's `user_…` id for existing
-- coaches, `usr_…` for new ones). Matches src/schema/user_accounts.ts;
-- applied by hand to production (`drizzle-kit push` could also do it, but
-- review its plan first).
CREATE TABLE IF NOT EXISTS "user_accounts" (
  "user_id" text PRIMARY KEY,
  "email" text NOT NULL,
  "display_name" text,
  "password_hash" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_accounts_email_unique" ON "user_accounts" ("email");

CREATE TABLE IF NOT EXISTS "user_sessions" (
  "token_hash" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "user_sessions_user_id_user_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("user_id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx" ON "user_sessions" ("user_id");

CREATE TABLE IF NOT EXISTS "password_setup_tokens" (
  "token_hash" text PRIMARY KEY,
  "user_id" text NOT NULL,
  "created_by_user_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  CONSTRAINT "password_setup_tokens_user_id_user_accounts_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("user_id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "password_setup_tokens_user_id_idx" ON "password_setup_tokens" ("user_id");
