---
name: PWA service worker hijacks embedded artifact iframes
description: Embedding another artifact via iframe (e.g. a video) requires adding its path to the baseball-lineup PWA navigateFallbackDenylist, or the SW serves the app shell into the iframe in production.
---

# PWA navigation fallback hijacks cross-artifact iframes

The baseball-lineup web app is a `vite-plugin-pwa` PWA whose Workbox service
worker uses `navigateFallback: "index.html"` — every navigation request without a
matching precached file gets the SPA shell so wouter can route offline.

When the app embeds ANOTHER artifact through an `<iframe src="/some-artifact/">`
(these are served at sibling paths by the shared proxy / production static
handlers), the iframe load is a *navigation request*. If that path is not on
`navigateFallbackDenylist`, the service worker intercepts it and returns
baseball-lineup's own `index.html` INTO the iframe instead of letting the request
reach the real static handler. The video/other-artifact never loads and the frame
shows the app shell or errors.

**Why it only shows up in production:** the symptom appears on the published /
installed-PWA app where the SW is fully active and the precache is populated. The
Replit dev preview routes the iframe path straight to that artifact's dev server,
so it looks fine in the editor — masking the bug until deploy.

**How to apply:** every time you embed an artifact path in an iframe from
baseball-lineup, add `/^\/<artifact-path>\//` to `navigateFallbackDenylist` in
`artifacts/baseball-lineup/vite.config.ts`. Existing entries: `/promo-video/`,
`/help-tour/`. The denylist also already excludes `/api/`, `/sign-in`,
`/sign-up`. The fix is build-time (baked into the generated SW), so it only takes
effect after a re-publish; clients pick it up on next visit via
`registerType: "autoUpdate"` (skipWaiting + clientsClaim + cleanupOutdatedCaches).
