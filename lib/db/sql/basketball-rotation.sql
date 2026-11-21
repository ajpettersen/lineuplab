-- Basketball bench-sheet setup, one row per team. Matches
-- src/schema/basketball_rotation.ts. Additive and safe to rerun; apply to
-- production by hand (or review `drizzle-kit push`'s plan first).
CREATE TABLE IF NOT EXISTS "basketball_rotation_settings" (
  "user_id" text PRIMARY KEY,
  "half_minutes" double precision NOT NULL DEFAULT 20,
  "shift_minutes" double precision NOT NULL DEFAULT 2.5,
  "guard_spots" integer NOT NULL DEFAULT 2,
  "front_spots" integer NOT NULL DEFAULT 3,
  "flex_shifts" integer NOT NULL DEFAULT 1,
  "player_tags" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "game_day" jsonb NOT NULL DEFAULT '{"absentIds":[],"guardOrder":[],"frontOrder":[]}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Per-game starters and playing time from the basketball court display.
CREATE TABLE IF NOT EXISTS "basketball_game_stats" (
  "game_id" integer PRIMARY KEY,
  "user_id" text NOT NULL,
  "starter_ids" integer[] NOT NULL DEFAULT '{}',
  "played_sec" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "basketball_game_stats_user_id_idx" ON "basketball_game_stats" ("user_id");

-- Default subs at a time (null = ask for each game) and per-game lineups.
ALTER TABLE "basketball_rotation_settings" ADD COLUMN IF NOT EXISTS "default_sub_size" integer DEFAULT 2;
CREATE TABLE IF NOT EXISTS "basketball_game_lineups" (
  "game_id" integer PRIMARY KEY,
  "user_id" text NOT NULL,
  "absent_ids" integer[] NOT NULL DEFAULT '{}',
  "guard_order" integer[] NOT NULL DEFAULT '{}',
  "front_order" integer[] NOT NULL DEFAULT '{}',
  "sub_size" integer NOT NULL DEFAULT 2,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "basketball_game_lineups_user_id_idx" ON "basketball_game_lineups" ("user_id");

-- Position groups per team, and one starting order across all groups.
ALTER TABLE "basketball_rotation_settings" ADD COLUMN IF NOT EXISTS "group_layout" text NOT NULL DEFAULT 'guards-front';
ALTER TABLE "basketball_game_lineups" ADD COLUMN IF NOT EXISTS "start_order" integer[] NOT NULL DEFAULT '{}';
ALTER TABLE "basketball_game_lineups" ADD COLUMN IF NOT EXISTS "shift_minutes" double precision;
ALTER TABLE "basketball_game_lineups" ADD COLUMN IF NOT EXISTS "flex_shifts" integer;

-- Drawn plays (Settings → Plays), shown on the court display at timeouts.
CREATE TABLE IF NOT EXISTS "basketball_plays" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "notes" text,
  "group_layout" text NOT NULL DEFAULT 'guards-front',
  "data" jsonb NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "basketball_plays_user_id_idx" ON "basketball_plays" ("user_id");

-- A coach's own shift-by-shift plan for a game (replaces the generated rotation).
ALTER TABLE "basketball_game_lineups" ADD COLUMN IF NOT EXISTS "custom_shifts" jsonb;
