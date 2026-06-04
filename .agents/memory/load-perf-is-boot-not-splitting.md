---
name: Load perf is boot/shell, not code-splitting
description: Why "app loads slowly on all UIs" is NOT a missing-code-splitting problem in baseball-lineup
---

When a user reports the app "takes a while to load on all UIs", do NOT reach for
route-level code-splitting — it is already done.

**Facts (verify before relying):**
- Every page route in `artifacts/baseball-lineup/src/App.tsx` is already `React.lazy`.
- `artifacts/baseball-lineup/vite.config.ts` already splits node_modules into
  react/clerk/query/radix/icons/date vendor chunks (`manualChunks`).

**Why it still feels slow:** the cost is BOOT/SHELL, not page bundles —
Clerk init + React Query IndexedDB hydration (`PersistQueryClientProvider`,
`src/lib/query-persister.ts`) + vendor chunk download on first paint. The
PWA-white-screen note is related (empty #root until shell hydrates).

**Safe wins that actually help (already applied):**
- Intent prefetch (`src/lib/route-prefetch.ts`) warms a route's lazy chunk on
  hover/focus/touchstart so the FIRST visit to each page doesn't stall. The
  dynamic-import specifiers MUST match App.tsx's `lazy(() => import(...))`
  strings exactly, or Vite emits a duplicate chunk instead of reusing it.
- Lazy-load non-first-paint shell UI (e.g. `CoachProfilePrompt`,
  `InstallPwaPrompt` in `layout.tsx`) behind `Suspense fallback={null}`.

**What to avoid:** touching the Clerk/IndexedDB boot path or the vendor-chunk
strategy — high risk, marginal gain. The 5000-line `game-detail.tsx` /
`field-display.tsx` are already lazy; splitting them is maintainability, NOT
load speed, and they back the live-game surface (high regression risk).
