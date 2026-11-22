import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveState } from "@/lib/basketball-live";
import { deviceId } from "@/lib/basketball-live-sync";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const POLL_MS = 1000;
const RETRY_MS = 3000;

interface RemoteLive {
  version: number;
  state: LiveState;
  clockDevice: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  lastChange: string | null;
  updatedAt: string;
}

export interface LiveActivity {
  name: string;
  change: string;
  at: number;
  mine: boolean;
}

const pendingKey = (gameId: number) => `lineuplab:basketball-live-pending:${gameId}`;

/**
 * Second-coach mode: share one live game between coaches' devices.
 *
 * - Every local change is pushed (PUT) with the version this device last
 *   saw; other devices poll about once a second and take newer states.
 * - Last write wins. If a push replaced someone else's newer change, the
 *   server hands back what it replaced and `conflict.undo()` puts it back.
 * - Offline: changes keep working locally (the court display saves them on
 *   the device) and the latest one is pushed when the connection is back.
 * - One device runs the clock (start/stop, timeouts); `takeClock` moves it.
 */
export function useLiveSync({
  gameId,
  myName,
  canWrite,
  applyRemote,
}: {
  gameId: number;
  myName: string | null;
  canWrite: boolean;
  applyRemote: (state: LiveState) => void;
}) {
  const me = useRef(deviceId()).current;
  const version = useRef<number | null>(null);
  const pending = useRef<{ state: LiveState; change: string; takeClock?: boolean } | null>(null);
  const sending = useRef(false);
  const apply = useRef(applyRemote);
  apply.current = applyRemote;
  const [clockDevice, setClockDevice] = useState<string | null>(null);
  const [clockName, setClockName] = useState<string | null>(null);
  const [activity, setActivity] = useState<LiveActivity | null>(null);
  const [online, setOnline] = useState(true);
  const [conflict, setConflict] = useState<{ name: string; change: string; state: LiveState } | null>(null);
  const [ready, setReady] = useState(false);

  const flush = useCallback(async () => {
    if (!canWrite || sending.current || !pending.current) return;
    sending.current = true;
    const item = pending.current;
    try {
      const r = await fetch(`${BASE}/api/basketball-games/${gameId}/live`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseVersion: version.current, state: item.state, deviceId: me, change: item.change, name: myName, takeClock: item.takeClock }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const body = (await r.json()) as { live: RemoteLive; replaced: RemoteLive | null };
      version.current = body.live.version;
      setClockDevice(body.live.clockDevice);
      if (body.live.clockDevice === me) setClockName(myName);
      setOnline(true);
      if (body.replaced && body.replaced.updatedBy !== me) {
        setConflict({ name: body.replaced.updatedByName ?? "Another coach", change: body.replaced.lastChange ?? "a change", state: body.replaced.state });
      }
      setActivity({ name: myName ?? "You", change: item.change, at: Date.now(), mine: true });
      if (pending.current === item) {
        pending.current = null;
        try { localStorage.removeItem(pendingKey(gameId)); } catch { /* storage unavailable */ }
      }
    } catch {
      setOnline(false);
      setTimeout(() => void flush(), RETRY_MS);
    } finally {
      sending.current = false;
      if (pending.current && pending.current !== item) void flush();
    }
  }, [canWrite, gameId, me, myName]);

  /** Share a local change (the latest one wins if several queue up offline). */
  const push = useCallback(
    (state: LiveState, change: string, opts: { takeClock?: boolean } = {}) => {
      if (!canWrite) return; // view-only coaches follow along but don't change the game
      pending.current = { state, change, takeClock: opts.takeClock || pending.current?.takeClock };
      try { localStorage.setItem(pendingKey(gameId), "1"); } catch { /* storage unavailable */ }
      void flush();
    },
    [flush, gameId, canWrite],
  );

  // Poll for the other device's changes.
  useEffect(() => {
    if (!gameId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === "visible" && !pending.current) {
        try {
          const since = version.current;
          const r = await fetch(`${BASE}/api/basketball-games/${gameId}/live${since !== null ? `?since=${since}` : ""}`);
          if (r.status === 204) {
            setOnline(true);
          } else if (r.ok) {
            setOnline(true);
            const { live } = (await r.json()) as { live: RemoteLive | null };
            const first = !ready;
            if (live && (version.current === null || live.version > version.current)) {
              version.current = live.version;
              setClockDevice(live.clockDevice);
              if (live.clockDevice === live.updatedBy) setClockName(live.updatedByName);
              // On first load, changes made here while offline win; otherwise take theirs.
              let localPending = false;
              try { localPending = localStorage.getItem(pendingKey(gameId)) === "1"; } catch { /* storage unavailable */ }
              if (!(first && localPending) && !pending.current) {
                if (live.updatedBy !== me) {
                  apply.current(live.state);
                  setActivity({ name: live.updatedByName ?? "Another coach", change: live.lastChange ?? "updated the game", at: Date.parse(live.updatedAt) || Date.now(), mine: false });
                }
              }
            }
            if (first) setReady(true);
          }
        } catch {
          setOnline(false);
        }
      }
      timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, me]);

  return {
    deviceId: me,
    ready,
    online,
    activity,
    /** True when this device runs the clock (or nobody has claimed it yet). */
    clockOwner: !clockDevice || clockDevice === me,
    clockName,
    conflict,
    push,
    undoConflict: () => {
      if (!conflict) return;
      apply.current(conflict.state);
      push(conflict.state, `put back ${conflict.name}'s change (${conflict.change})`);
      setConflict(null);
    },
    dismissConflict: () => setConflict(null),
    /** Reset on the court display: clear the shared copy too. */
    clear: async () => {
      pending.current = null;
      version.current = null;
      try { localStorage.removeItem(pendingKey(gameId)); } catch { /* storage unavailable */ }
      await fetch(`${BASE}/api/basketball-games/${gameId}/live`, { method: "DELETE" }).catch(() => undefined);
    },
  };
}
