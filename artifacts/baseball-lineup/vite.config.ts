import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    // Phase 1 offline support: registers a service worker so the app
    // shell loads with no network (essential for an iPad opened at a
    // field). We deliberately do NOT runtime-cache /api responses
    // here — the React Query persister (lib/query-persister.ts) owns
    // data caching and is per-user-aware via qc.clear() on sign-out.
    // Letting the SW also cache /api would let a previous user's
    // responses leak into the next sign-in on a shared device.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        // Purge precache entries from prior deploys when a new SW
        // activates. Without this, every publish layers another full
        // app-shell precache into CacheStorage and stale revisions can
        // linger, which both bloats the cache and risks serving a
        // mismatched asset after an update. autoUpdate already does
        // skipWaiting + clientsClaim; this rounds out the "always boot
        // the freshest shell" story.
        cleanupOutdatedCaches: true,
        // Pull in our custom Web Push handler (push + notificationclick)
        // INSIDE the Workbox-generated SW. Path is resolved against the
        // SW's base URL — files in `public/` end up at the site root,
        // so `push-sw.js` is the right import target.
        importScripts: ["push-sw.js"],
        // SPA fallback — every navigation request without a real file
        // gets index.html so wouter can take over even when offline.
        navigateFallback: "index.html",
        // Don't intercept /api at all (see comment above) and keep
        // Clerk's auth flow exclusively on the network so login
        // never gets served a stale page.
        navigateFallbackDenylist: [/^\/api\//, /^\/sign-in/, /^\/sign-up/, /^\/promo-video\//, /^\/help-tour\//],
        // Bump the precache size cap so larger JS chunks (recharts,
        // dnd-kit) don't get silently skipped.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Google Fonts CSS — small, fine to cache aggressively.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            // Google Fonts WOFF2 binaries.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      manifest: {
        name: "Lineup Lab",
        short_name: "Lineup Lab",
        description:
          "Build lineups, run rotations, and manage tournament days for youth baseball / softball teams.",
        // Deep navy primary from the broadcast theme.
        theme_color: "#0a2552",
        background_color: "#0a2552",
        display: "standalone",
        orientation: "any",
        start_url: ".",
        scope: ".",
        icons: [
          // Single 1024×1024 master icon — modern iOS/Android/Chrome
          // resample down to whatever size they need from this. The
          // image was generated with ~15% safe-zone padding so iOS's
          // circular mask doesn't clip the shield.
          {
            src: "icon.png",
            sizes: "192x192 512x512 1024x1024",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      // Lets us hit the SW in `pnpm dev` previews so we can verify
      // offline behavior in Replit before publishing.
      devOptions: { enabled: true, type: "module" },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Manual vendor chunking — before this, the entry bundle was
    // ~546KB (164KB gzip) because every third-party SDK (React,
    // Clerk, React Query, Radix, date-fns, lucide-react) got mashed
    // into `index.js` alongside the App shell. The browser had to
    // download + parse the whole thing before the first route could
    // mount.
    //
    // Splitting by vendor does three useful things at once:
    //  1. The browser parallelizes downloads (HTTP/2 multiplexes
    //     these over one connection, so 6 small chunks arrive faster
    //     than one 540KB chunk).
    //  2. Vendor chunks hash separately from app code, so a code-
    //     only deploy doesn't bust the cached `react-vendor.js` and
    //     `clerk-vendor.js` — return visitors only re-download what
    //     actually changed.
    //  3. Parse/compile is cheaper on smaller chunks; Safari in
    //     particular blocks paint on the main thread while parsing
    //     a single huge bundle.
    //
    // Each `manualChunks` predicate must return a stable bucket
    // name; anything that doesn't match falls into the default
    // `index` chunk (App.tsx + providers + shared lib/utils).
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          // React core + scheduler — frozen across the app, biggest
          // single benefit of being its own chunk because every page
          // depends on it but it almost never changes.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/") ||
            id.includes("/node_modules/react/jsx-runtime")
          ) {
            return "react-vendor";
          }
          // Clerk SDK — bulky auth runtime, used on every page via
          // the providers in App.tsx.
          if (id.includes("/node_modules/@clerk/")) {
            return "clerk-vendor";
          }
          // React Query + persister + IDB driver — all loaded on
          // boot by App.tsx.
          if (
            id.includes("/node_modules/@tanstack/react-query") ||
            id.includes("/node_modules/idb-keyval/")
          ) {
            return "query-vendor";
          }
          // Radix UI primitives — many small packages but together
          // they're chunky. Group as one vendor bundle so the
          // browser caches them as a unit.
          if (id.includes("/node_modules/@radix-ui/")) {
            return "radix-vendor";
          }
          // Lucide icons — tree-shakes but the per-icon files still
          // add up across the app. Isolating them keeps icon-only
          // changes from busting the main bundle.
          if (id.includes("/node_modules/lucide-react/")) {
            return "icons-vendor";
          }
          // Date math — used by schedule, dashboard, game detail.
          if (id.includes("/node_modules/date-fns/")) {
            return "date-vendor";
          }
          // Default: leave everything else in the entry chunk so
          // small one-off deps don't fragment the cache. Recharts,
          // dnd-kit, framer-motion are only imported by lazy route
          // chunks, so they stay there and load on demand.
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
