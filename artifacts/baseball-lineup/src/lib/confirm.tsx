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
  resolve: (value: boolean) => void;
};

const ConfirmContext = createContext<
  ((opts: ConfirmOptions) => Promise<boolean>) | null
>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  // Resolve the in-flight promise exactly once, even if Radix fires
  // both onAction AND onOpenChange(false) back-to-back.
  const settledRef = useRef(false);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        settledRef.current = false;
        setPending({ ...opts, resolve });
      }),
    [],
  );

  const settle = (value: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    pending?.resolve(value);
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
