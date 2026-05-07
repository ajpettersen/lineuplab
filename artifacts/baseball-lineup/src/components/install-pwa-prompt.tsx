import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "lineupLab.installPromptDismissedAt";
// Re-show the banner 60 days after a dismiss in case the coach
// changed their mind before tournament season.
const RESHOW_AFTER_MS = 1000 * 60 * 60 * 24 * 60;

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as Mac; differentiate by touch points.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // CriOS / FxiOS / EdgiOS = Chrome / Firefox / Edge on iOS — A2HS
  // works the same way (browser share menu), so we still nudge.
  const isWebView = /(CriOS|FxiOS|EdgiOS)/.test(ua);
  return isIos || isWebView;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS-specific:
  const iosStandalone = (
    window.navigator as Navigator & { standalone?: boolean }
  ).standalone === true;
  // Android / desktop PWA:
  const matchMediaStandalone = window.matchMedia(
    "(display-mode: standalone)",
  ).matches;
  return iosStandalone || matchMediaStandalone;
}

/**
 * Subtle one-time banner that nudges iPad/iPhone coaches to install
 * the app to their home screen. The banner only appears when:
 *   - The user is on iOS Safari (or another iOS browser).
 *   - The page is NOT already running in standalone PWA mode.
 *   - The user hasn't dismissed it in the last ~60 days.
 *
 * Why iOS only? Chrome/Edge fire the `beforeinstallprompt` event
 * which we'd handle programmatically (Phase 1.5). iOS Safari has no
 * such API — the only way to install is via the system Share menu,
 * so we have to teach the coach where to look.
 */
export function InstallPwaPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isIosSafari() || isStandalone()) return;
    let lastDismiss = 0;
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      lastDismiss = raw ? Number(raw) || 0 : 0;
    } catch {
      // localStorage unavailable (private browsing) — show anyway.
    }
    if (Date.now() - lastDismiss < RESHOW_AFTER_MS) return;
    // Defer the actual mount so we don't flash for the split second
    // between page load and Clerk redirecting us to /sign-in.
    const t = window.setTimeout(() => setShow(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // ignore
    }
    setShow(false);
  };

  if (!show) return null;

  return (
    <div
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)] rounded-lg border border-primary/20 bg-card shadow-lg p-3 flex items-start gap-3"
      data-testid="banner-install-pwa"
      role="dialog"
      aria-live="polite"
    >
      <div className="flex-1 text-sm">
        <p className="font-semibold text-foreground">
          Install Lineup Lab on your iPad
        </p>
        <p className="text-muted-foreground text-xs mt-0.5">
          Tap the <Share className="inline h-3.5 w-3.5 -mt-0.5" /> share
          button in Safari, then “Add to Home Screen.” That keeps the app
          available offline at the field.
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={dismiss}
        aria-label="Dismiss install banner"
        data-testid="button-dismiss-install-pwa"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
