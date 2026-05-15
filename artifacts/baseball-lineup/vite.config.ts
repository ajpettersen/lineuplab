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
        navigateFallbackDenylist: [/^\/api\//, /^\/sign-in/, /^\/sign-up/, /^\/promo-video\//],
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
