import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Deploy-safe chunk recovery. When a new version is published the
// hashed JS chunk filenames change. A tab still running the previous
// build (or holding a stale precached index.html) can try to lazy-load
// a chunk URL that no longer exists on the server, which throws and —
// because it happens during a dynamic import — collapses the route to
// a blank screen. Vite emits `vite:preloadError` for exactly this case.
// We do a single hard reload to pull the fresh HTML + chunk map, gated
// by a sessionStorage flag so a genuinely broken deploy can't trap the
// user in an infinite reload loop.
const RELOAD_GUARD_KEY = "lineupLab.chunkReloadedAt";
window.addEventListener("vite:preloadError", (event) => {
  const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? "0");
  // Allow another recovery reload if it's been a while (>1 min) — a
  // later, unrelated deploy shouldn't be blocked by an earlier reload
  // earlier in the same session.
  if (Date.now() - last < 60_000) return;
  event.preventDefault();
  sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(<App />);
