---
name: Field Display offline write drainers
description: The two independent drainers behind Field Display offline writes and the rules that keep them from double-POSTing or dropping data.
---

# Field Display offline write drainers

Field Display offline writes (`fd-pending-save-v1:*` lineup snapshots and
`fd-pending-game-patch-v1:*` game patches in localStorage) are drained by
TWO independent systems that can both fire on the same browser `online`
event:

1. **Per-page flush** — `flushSave` / `flushGameSave` in
   `pages/field-display.tsx`, serialized by their own promise chains
   (`saveQueueRef` / `saveGameQueueRef`). Owns the in-memory pending refs
   and the `hasUnsynced*` UI bookkeeping.
2. **Cross-page drain** — `drainOfflineWrites` (`lib/offline-drain.ts`),
   fired by `<OnlineResumer>`, mutex'd by a single `drainPromise`. Runs
   even when Field Display is unmounted (coach left the page while
   offline).

## Rules

- **Never drop a write on error.** Hard-won May 2026 policy: `navigator.onLine`
  lies on flaky/captive-portal WiFi, so ANY thrown POST error is treated as
  transient — keep the localStorage backup + ref, do NOT invalidate (that
  refetches stale server data and wipes the coach's optimistic edits). A real
  persistent 4xx therefore retries forever; the only acceptable mitigation is
  *feedback*, never dropping.

- **The two drainers must coordinate or they double-POST.** Their mutexes are
  independent (one per system), so both can POST the same key in parallel.
  Fix: a shared in-flight claim registry (`tryClaimWriteKey` /
  `releaseWriteKey` in `lib/offline-queue.ts`). Both paths claim before
  posting and release in a `finally`; the loser of the race skips that pass
  and reconciles via its existing retry (online effect / 30s backup timer /
  next drag). Worst case is one *deferred* redundant idempotent POST — never
  simultaneous, never data loss.

- **Poison-pill feedback** lives only in the cross-page drain: per-key
  consecutive-failure counter + a `notified` latch, fired once at
  `>= STUCK_THRESHOLD` via the `OFFLINE_WRITE_STUCK_EVENT` window event that
  `<OnlineResumer>` toasts. Counters are module memory, so reset them on
  success AND prune keys that have left the queue at drain start, or a reused
  gameId key inherits a stale count.

**Why:** these are the app's most data-loss-sensitive paths; a "cleanup" that
clears a key on server error reintroduces the May 2026 silent-edit-loss bug.

**How to apply:** any new offline-capable mutation that stages to localStorage
must (a) go through the claim registry if more than one drainer can touch it,
and (b) follow the never-drop-on-error policy with visible feedback instead.
