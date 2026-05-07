import { useEffect, useState } from "react";

/**
 * Live online/offline tracker. Sources its initial value from
 * `navigator.onLine` and subscribes to the matching window events.
 *
 * `navigator.onLine` is a notoriously coarse signal — it really means
 * "the OS thinks there's a network" not "we can reach our server" —
 * so a more reliable indicator (e.g. last-successful-API-call
 * timestamp) is a Phase 2 concern. For Phase 1 it's accurate enough
 * to drive the SyncStatusChip and the install prompt.
 */
export function useNetworkStatus(): { online: boolean } {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return { online };
}
