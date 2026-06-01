---
name: PWA white-screen on boot
description: Why the published baseball-lineup PWA showed a blank white screen on cold/first load, and the three-part fix.
---

# PWA white-screen / slow first paint

The published app (artifacts/baseball-lineup) showed a white screen for
several seconds on phone + computer when opened. Production API logs were
healthy — this is a CLIENT first-paint problem, not a server outage.

**Why:** `index.html` shipped an empty `<div id="root">`. Nothing paints
until the JS bundle downloads, React mounts, ClerkProvider finishes its
network handshake, and the IndexedDB React Query cache (PersistQueryClient)
rehydrates. The in-app `RouteFallback` spinner can't cover this gap — it
only exists after React has already mounted. Separately, after a publish a
stale tab or precached `index.html` can request renamed hashed chunk files
that now 404, collapsing a lazy route to blank.

**How to apply (the durable pattern for any Vite + PWA + lazy-route app
here):**
1. Put an inline boot splash *inside* `#root` in `index.html` — inline
   `<style>` + markup only, no external CSS/JS, so it paints on the first
   frame. `createRoot().render()` replaces `#root`'s children, so the
   splash self-removes on mount (no teardown code). Hard-code theme colors
   to avoid a flash.
2. Add a `vite:preloadError` listener in the entry (`main.tsx`) that does a
   single sessionStorage-guarded hard reload — recovers from post-deploy
   stale-HTML → renamed-chunk 404s without an infinite reload loop.
3. Set workbox `cleanupOutdatedCaches: true` in the VitePWA config so old
   precaches are purged on SW activation (autoUpdate already does
   skipWaiting + clientsClaim).

Don't reach for server/deployment debugging first when a published SPA/PWA
"white screens" — check whether `index.html` renders anything before JS
boots.
