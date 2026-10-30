import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Lineup Lab's own sign-in (see api-server/src/lib/userSessions.ts and
 * routes/auth.ts). `userId` is the id every other table already scopes by:
 * Clerk's `user_…` id for coaches from before, `usr_…` for accounts made
 * since. Emails are stored lowercased. Passwords are scrypt hashes, never
 * returned to the browser or logged; null until the coach sets one.
 *
 * Production gets these tables from ../../sql/own-login.sql.
 */
export const userAccountsTable = pgTable(
  "user_accounts",
  {
    userId: text("user_id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name"),
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUnique: uniqueIndex("user_accounts_email_unique").on(t.email),
  }),
);

/** One row per signed-in browser. Only a SHA-256 of the cookie's token is kept. */
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userAccountsTable.userId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    userIdx: index("user_sessions_user_id_idx").on(t.userId),
  }),
);

/** Single-use "set your password" links a master admin hands out. */
export const passwordSetupTokensTable = pgTable(
  "password_setup_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => userAccountsTable.userId, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("password_setup_tokens_user_id_idx").on(t.userId),
  }),
);

export type UserAccount = typeof userAccountsTable.$inferSelect;
