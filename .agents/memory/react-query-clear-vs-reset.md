---
name: React Query clear() vs resetQueries()
description: Why qc.clear() leaves mounted components showing stale data and what to use when the data scope changes mid-session.
---

`queryClient.clear()` removes all queries WITHOUT notifying mounted observers — components keep rendering their last data until something else forces a re-render. This made the header show the OLD team name after a team switch (server-side switch succeeded; UI never refetched).

**Rule:** when the data scope changes mid-session (team switch, tenant change) use `await qc.resetQueries()` — it resets every query to initial state, notifies observers, and refetches active queries. Also purge the IndexedDB-persisted cache (`purgePersistedQueryCache()`) or a throttled dehydrate of the old scope can be restored later.

`qc.clear()` is only safe when the whole React tree remounts afterwards (e.g. sign-out/sign-in), which is why the user-change flow got away with it.

**How to apply:** any mutation whose success changes which tenant/scope all queries read from should call the shared reset helper in the team-context hook, not `qc.clear()`.
