import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * Options accepted by `useConfirm()`. Lives in a separate file from
 * the provider component so the file containing the React component
 * (`confirm.tsx`) only exports components — required for Vite's
 * react-refresh to fast-refresh edits in `<ConfirmProvider>` instead
 * of doing a full reload.
 */
export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
};

export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Promise-based replacement for `window.confirm`. Resolves to `true`
 * when the user confirms, `false` for cancel / dismiss / overlay
 * click / Escape. Backed by a single theme-aware AlertDialog mounted
 * once at the app root (`<ConfirmProvider>`).
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx;
}
