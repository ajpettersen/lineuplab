---
name: Offline prefetch race-safety
description: Why offline cache-warming must skip games with pending writes instead of relying on event ordering.
---

# Offline prefetch must be inherently race-safe

Background warming of the offline cache (so coaches can open the Field
Display for upcoming games with no signal) must NOT cache server GETs for
any game that currently has an unsynced offline write queued. Doing so
overwrites the coach's optimistic Field Display state with pre-drain
server data.

**Rule:** the prefetch pass reads the set of game ids with pending writes
(localStorage keys `fd-pending-save-v1:{id}` / `fd-pending-game-patch-v1:{id}`)
and SKIPS per-game warming (game / lineup / pitch-count GETs) for those
games. List/roster/tournament warming is always safe (never offline-edited).
A skipped game is re-warmed on a later pass once its pending key drains.

**Why:** an earlier attempt tried to fix the race with an event handshake
(only warm after OnlineResumer dispatches a drain-complete event). That was
edge-triggered and fragile — a drain-complete signal fired while signed-out
(or before Clerk auth was ready) was lost, leaving a non-empty queue stuck
without ever warming. Filtering by pending-write set makes warming safe to
run at any time, so the component can warm unconditionally on sign-in plus
re-warm on the drain-complete event, with no ordering dependency.

**How to apply:** any new background cache-warming for offline-editable
entities must exclude entities with queued offline writes at fetch time,
not gate the whole pass on an event/queue-count check. Keep the
drain-complete event only as a re-warm trigger, never as the sole gate.
