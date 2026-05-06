import { ToastAction } from "@/components/ui/toast";
import type { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ToastFn = ReturnType<typeof useToast>["toast"];

/**
 * Show a "trashed — Undo" toast. Calls `onUndo` if the coach clicks
 * the action within the toast's lifetime. The shadcn Toast viewport
 * auto-dismisses; the action is the only escape hatch.
 *
 * Use after a successful soft-delete or snapshot-delete so the coach
 * can recover from a misclick. The undo handler is responsible for
 * re-invalidating any queries it touches.
 */
export function showUndoToast(
  toast: ToastFn,
  opts: {
    title: string;
    description?: string;
    onUndo: () => void | Promise<void>;
  },
): void {
  toast({
    title: opts.title,
    description: opts.description,
    action: (
      <ToastAction
        altText="Undo"
        onClick={() => {
          void opts.onUndo();
        }}
      >
        Undo
      </ToastAction>
    ),
  });
}

/** POST a JSON body to a backend route. Throws on non-2xx. */
export async function postJson(path: string, body: unknown): Promise<unknown> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.status === 204 ? null : r.json();
}

/**
 * Soft-delete restore for a parent entity (player / game / practice /
 * tournament). Hits `POST /api/{kind}/:id/restore`.
 */
export async function restoreEntity(
  kind: "players" | "games" | "practices" | "tournaments",
  id: number,
): Promise<void> {
  const r = await fetch(`${BASE}/api/${kind}/${id}/restore`, { method: "POST" });
  if (!r.ok) throw new Error(`Restore failed: ${r.status}`);
}
