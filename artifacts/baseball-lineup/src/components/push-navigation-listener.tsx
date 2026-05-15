import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Bridges Web Push notification clicks into client-side navigation.
 *
 * The service worker (`public/push-sw.js`) does:
 *   1) `client.postMessage({ type: "lineup-lab/navigate", url })`
 *   2) `client.focus()`
 *
 * This component listens for that message in the page context and uses
 * wouter's `setLocation` to deep-link without a full page reload — so a
 * coach with the app already open lands on `/games/:id` instead of
 * just being focused on whatever page they had open. Falls back
 * silently when the SW isn't available.
 */
export function PushNavigationListener() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const handler = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; url?: string }
        | undefined;
      if (!data || data.type !== "lineup-lab/navigate") return;
      const target = typeof data.url === "string" ? data.url : null;
      if (!target) return;
      // Only follow same-origin paths — defense in depth in case a
      // future SW message ever leaks an absolute URL.
      try {
        const u = new URL(target, window.location.origin);
        if (u.origin === window.location.origin) {
          setLocation(u.pathname + u.search + u.hash);
        }
      } catch {
        // Not a parseable URL — ignore.
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => {
      navigator.serviceWorker.removeEventListener("message", handler);
    };
  }, [setLocation]);
  return null;
}
