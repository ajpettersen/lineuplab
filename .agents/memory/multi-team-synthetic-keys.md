---
name: Multi-team synthetic tenancy keys
description: How additional teams work (team_<uuid> scope keys) and the invariants any new code must respect.
---

A coach's FIRST team is keyed by their Clerk userId. Additional teams (POST /api/teams) get a synthetic scope key `team_<uuid>` with a `team_settings` row + a `team_memberships` owner-row (isOwner=true, permission=full) for the creator. No `teams` table exists — a team IS those two rows.

**Rules for any new code:**
- NEVER check ownership with `userId === ownerUserId` — that's false for synthetic teams. Use `isTeamOwnerUser()` (api-server permissions lib), which checks equality OR the membership `isOwner` flag.
- NEVER pass an `ownerUserId` scope key to Clerk (`getUser`/`getUserList`) without filtering `team_`-prefixed ids — one bad id can fail a whole `getUserList` chunk and blank identity data for real users.
- The "owner row" of a team is the membership row with `isOwner=true`, NOT the row where `memberUserId === ownerUserId`.

**Why:** keeping "team = tenancy key string" meant zero schema change and zero edits to the ~20 data routes; all permission machinery works because the creator has a full-permission membership row.

**How to apply:** any new route, scheduler, or admin surface that touches `ownerUserId` must treat it as an opaque scope key, not a user id.
