---
name: React Query mutation defaults clobbered mid-pending
description: Why swapping mutationFn in MutationCache.build alone fails in the browser; must also patch mutation.setOptions
---

**Rule:** To force `setMutationDefaults` mutationFn to win over a hook's baked-in mutationFn (Orval hooks always supply one), overriding `MutationCache.build()` is NOT enough — you must also intercept the built mutation's `setOptions` and re-apply the swap.

**Why:** `useMutation` calls `observer.setOptions()` on every React render. While a mutation is pending, `MutationObserver.setOptions` pushes `this.options` (containing the generated mutationFn) back onto the mutation via `mutation.setOptions`, clobbering the swap before the fetch runs. A pure-node repro (no re-render) passes while the browser fails — misleading. Verified against query-core 5.90.20 source.

**How to apply:** See `SyncAwareMutationCache` in the baseball-lineup App.tsx. Debugging tip: if headers set by a default mutationFn vanish only in the browser, suspect this render-time options push, not bundling/duplicate-package issues. Revalidate on @tanstack/* upgrades (internal behavior).
