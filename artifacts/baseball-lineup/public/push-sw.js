/* Web Push handlers — imported into the Workbox-generated service
 * worker via vite-plugin-pwa's `importScripts` config. Runs INSIDE
 * the SW global scope (`self`), so it has access to `self.registration`,
 * `clients`, etc.
 *
 * Two events:
 *   "push"           — push provider woke us up; show a notification.
 *   "notificationclick" — coach tapped the notification; focus an
 *                         existing tab on the deep link, or open one.
 *
 * Payload shape is JSON-encoded by `artifacts/api-server/src/lib/push.ts`
 *   { title, body, url?, tag? }
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    // Some providers wake the SW with no payload; show a fallback so
    // the coach at least knows we wanted their attention.
    payload = {};
  }
  const title = payload.title || "Lineup Lab";
  const body = payload.body || "Tap to open Lineup Lab.";
  const tag = payload.tag || "lineup-lab";
  const url = payload.url || "/";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/icon.png",
      badge: "/icon.png",
      // OS-level coalesce key — re-using the same `tag` replaces an
      // existing notification rather than stacking.
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      // Prefer focusing an existing Lineup Lab tab and routing it to
      // the deep link. Falls back to opening a new tab.
      for (const client of allClients) {
        try {
          // postMessage so the page can use wouter to navigate without
          // a full page load, AND focus the tab.
          client.postMessage({ type: "lineup-lab/navigate", url: targetUrl });
          await client.focus();
          return;
        } catch {
          // ignore and try next client
        }
      }
      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
