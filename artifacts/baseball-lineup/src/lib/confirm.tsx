import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ConfirmContext,
  type ConfirmOptions,
} from "@/lib/use-confirm";

// Re-export the hook + types from the dedicated hook module so
// existing `import { useConfirm } from "@/lib/confirm"` call sites
// keep working without an extra file rename. The hook itself lives
// in `use-confirm.ts` so this .tsx module only exports components —
// otherwise Vite's react-refresh can't fast-refresh edits here and
// every change triggers a full page reload.
export { useConfirm, type ConfirmOptions, type ConfirmFn } from "@/lib/use-confirm";

type PendingConfirm = ConfirmOptions & {
  id: number;
  resolve: (value: boolean) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Track which dialog instance we're settling so a stale Radix
  // onOpenChange(false) firing AFTER we've already replaced the
  // pending request can't accidentally resolve the new one.
  const settledIdsRef = useRef<Set<number>>(new Set());
  const idRef = useRef(0);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const id = ++idRef.current;
        // If a previous request is still on-screen, resolve it as
        // "cancel" before replacing — otherwise that caller's promise
        // would hang forever (real risk if a user re-triggers the
        // same action quickly, or two async flows race).
        setPending((prev) => {
          if (prev && !settledIdsRef.current.has(prev.id)) {
            settledIdsRef.current.add(prev.id);
            prev.resolve(false);
          }
          return { ...opts, id, resolve };
        });
      }),
    [],
  );

  const settle = (value: boolean) => {
    if (!pending) return;
    if (settledIdsRef.current.has(pending.id)) return;
    settledIdsRef.current.add(pending.id);
    pending.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          // Closing via overlay click / Escape / Cancel button all
          // route through here. Treat any close-without-confirm as
          // "cancel" so consumers reliably get `false`.
          if (!open) settle(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description && (
              <AlertDialogDescription>
                {pending.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>
              {pending?.cancelText ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => settle(true)}
              className={
                pending?.variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : undefined
              }
              data-testid="button-confirm-action"
            >
              {pending?.confirmText ?? "Continue"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
