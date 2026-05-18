import { createContext, useCallback, useContext, useRef, useState } from "react";
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

/**
 * Promise-based replacement for `window.confirm` that renders a styled,
 * theme-aware AlertDialog instead of the native browser prompt.
 *
 * Why this exists: native `window.confirm` looks out of place on
 * mobile/iPad (browser-chrome modal, can't be themed, can't show
 * formatted descriptions, breaks the in-app aesthetic), and on iOS
 * it can briefly steal focus in a jarring way mid-gesture.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Discard unsaved edits?",
 *     description: "Your changes won't be saved.",
 *     confirmText: "Discard",
 *     variant: "destructive",
 *   });
 *   if (!ok) return;
 */
export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
};

type PendingConfirm = ConfirmOptions & {
  id: number;
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

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

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx;
}
