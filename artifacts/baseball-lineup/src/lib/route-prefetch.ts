// Intent-based route prefetching. The router (App.tsx) code-splits
// every page via React.lazy, so the chunk for a route isn't fetched
// until the user actually navigates there — which adds a visible
// stall on the first visit to each page. Warming the chunk on nav
// intent (hover / focus / touchstart) means it's usually already in
// memory by the time the click lands, so navigation feels instant.
//
// IMPORTANT: the dynamic-import specifiers below must match the ones
// in App.tsx's `lazy(() => import(...))` calls EXACTLY. Vite keys
// module chunks by specifier, so identical strings resolve to the
// same chunk — calling these here just kicks off the same fetch the
// router would do later, it never duplicates the bundle.
const importers: Record<string, () => Promise<unknown>> = {
  "/": () => import("@/pages/dashboard"),
  "/players": () => import("@/pages/players"),
  "/games": () => import("@/pages/games"),
  "/tournaments": () => import("@/pages/tournaments"),
  "/practices": () => import("@/pages/practices"),
  "/stats": () => import("@/pages/stats"),
  "/season-stats": () => import("@/pages/season-stats"),
  "/arm-watch": () => import("@/pages/arm-watch"),
  "/settings": () => import("@/pages/settings"),
  "/help": () => import("@/pages/help"),
  "/admin": () => import("@/pages/admin"),
};

// Only fire each import once per session — once the chunk is fetched
// the browser caches it, so repeated hovers are free no-ops.
const warmed = new Set<string>();

export function prefetchRoute(href: string): void {
  const fn = importers[href];
  if (!fn || warmed.has(href)) return;
  warmed.add(href);
  // If the fetch fails (offline, stale deploy), drop it from the
  // warmed set so a later hover can retry. The real navigation has
  // its own error recovery (vite:preloadError handler in main.tsx).
  fn().catch(() => warmed.delete(href));
}
