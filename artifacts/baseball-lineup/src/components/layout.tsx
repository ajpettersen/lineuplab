import React, { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  Users,
  CalendarDays,
  CalendarRange,
  BarChart2,
  Activity,
  ChevronDown,
  Menu,
  Shield,
  ShieldCheck,
  Eye,
  Settings as SettingsIcon,
  LogOut,
  Trophy,
  Clipboard,
  ListOrdered,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  LifeBuoy,
  Sparkles,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { TeamSwitcher } from "@/components/team-switcher";
import { SyncStatusChip } from "@/components/sync-status-chip";
import { OfflineBanner } from "@/components/offline-banner";
import { useTeamContext } from "@/hooks/use-team-context";
import { usePermission } from "@/hooks/use-permission";
import { useAdminMe } from "@/hooks/use-admin";
import { useHeartbeat } from "@/hooks/use-heartbeat";
import { prefetchRoute } from "@/lib/route-prefetch";

// These two only render conditionally (a one-time profile modal and an
// iOS "add to home screen" nudge) and never on first paint, so we keep
// them out of the shell's critical bundle and load them lazily.
const CoachProfilePrompt = lazy(() =>
  import("@/components/coach-profile-prompt").then((m) => ({
    default: m.CoachProfilePrompt,
  })),
);
const InstallPwaPrompt = lazy(() =>
  import("@/components/install-pwa-prompt").then((m) => ({
    default: m.InstallPwaPrompt,
  })),
);

type NavLeaf = { href: string; label: string; icon: typeof Home };
type NavGroup = { label: string; icon: typeof Home; children: NavLeaf[] };
type NavItem = NavLeaf | NavGroup;
const isGroup = (n: NavItem): n is NavGroup => "children" in n;

/**
 * Hover-open desktop nav dropdown. Wraps Radix `DropdownMenu` with
 * mouse-enter/leave handlers and a small (140 ms) close grace period
 * so the user can travel from the trigger button to the menu content
 * without it snapping shut. Click still works as a fallback (Radix
 * trigger toggles `open`), and `modal={false}` keeps sibling nav
 * items hoverable while the menu is open.
 */
/**
 * Cross-dropdown coordination event. Any nav item dispatches this on
 * mouseenter with its own label (or `null` for a leaf link); every
 * `NavGroupDropdown` listens, and any dropdown whose label doesn't
 * match snaps shut immediately. This bypasses the 140 ms close grace
 * period when the user is clearly heading to a different top-level
 * item — fixes the "Stats dropdown lingers when I hover Admin" bug.
 */
const NAV_DROPDOWN_HOVER_EVENT = "nav-dropdown-hover";
function dispatchNavHover(label: string | null) {
  window.dispatchEvent(
    new CustomEvent<string | null>(NAV_DROPDOWN_HOVER_EVENT, {
      detail: label,
    }),
  );
}

function NavGroupDropdown({
  group,
  isActive,
  isHrefActive,
}: {
  group: NavGroup;
  isActive: boolean;
  isHrefActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  // Hover-intent gate: opening waits ~120 ms so the menu doesn't
  // pop while the cursor is just *transiting* over the trigger on
  // the way to a different top-level tab (e.g. Dashboard → Settings
  // crosses Team / Events / Statistics). Any mouseleave/sibling
  // hover before the timer fires cancels the pending open.
  const openTimer = useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const cancelOpen = () => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };
  const scheduleOpen = () => {
    cancelOpen();
    openTimer.current = window.setTimeout(() => setOpen(true), 120);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), 140);
  };
  useEffect(
    () => () => {
      cancelClose();
      cancelOpen();
    },
    [],
  );
  // Listen for "another nav item is being hovered" and close
  // immediately if the hovered label isn't ours. Also cancels any
  // pending open so a quick pass-through never resolves into a pop.
  useEffect(() => {
    const onHover = (e: Event) => {
      const detail = (e as CustomEvent<string | null>).detail;
      if (detail !== group.label) {
        cancelClose();
        cancelOpen();
        setOpen(false);
      }
    };
    window.addEventListener(NAV_DROPDOWN_HOVER_EVENT, onHover);
    return () => window.removeEventListener(NAV_DROPDOWN_HOVER_EVENT, onHover);
  }, [group.label]);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`button-nav-${group.label.toLowerCase()}`}
          onMouseEnter={() => {
            cancelClose();
            dispatchNavHover(group.label);
            // If the menu is already open (e.g. user moved off and
            // back within the close-grace window), keep it open
            // immediately. Otherwise gate the open behind 120 ms so a
            // quick mouse transit doesn't pop it.
            if (open) {
              cancelOpen();
            } else {
              scheduleOpen();
            }
          }}
          onMouseLeave={() => {
            cancelOpen();
            scheduleClose();
          }}
          onClick={() => {
            // Radix's trigger already toggles the menu on pointerdown
            // (via onOpenChange). We must NOT toggle again here or the
            // two toggles cancel out and a second click can't close it.
            // We only clear any pending hover-intent open so it doesn't
            // fight the click. Keyboard users open via Enter/Space/Arrow,
            // also routed through onOpenChange.
            cancelOpen();
          }}
          onFocus={() => {
            // Do NOT auto-open on focus. Radix restores focus to the
            // trigger when the menu closes, so opening here created a
            // reopen loop: hovering away (or onto a sibling like
            // Assistant) closed the menu, Radix refocused the trigger,
            // and this handler instantly bounced it back open — the
            // "Statistics dropdown won't close" bug. Keyboard users
            // still open it via Enter/Space/ArrowUp/Down, which Radix
            // routes through onOpenChange. Here we only clear pending
            // hover-intent timers.
            cancelClose();
            cancelOpen();
          }}
          className={`relative shrink-0 inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-2 rounded-md font-broadcast uppercase tracking-[0.1em] text-[13px] transition-colors ${
            isActive
              ? "text-primary-foreground bg-white/10"
              : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/5"
          }`}
        >
          {group.label}
          <ChevronDown className="h-3.5 w-3.5 opacity-80" />
          {isActive && (
            <span className="absolute -bottom-[7px] left-2.5 right-2.5 h-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-broadcast-gold)]" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={4}
        className="min-w-0 w-auto"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
      >
        {group.children.map((child) => {
          const ChildIcon = child.icon;
          const childActive = isHrefActive(child.href);
          return (
            <DropdownMenuItem
              key={child.href}
              asChild
              onSelect={() => {
                cancelClose();
                setOpen(false);
              }}
            >
              <Link
                href={child.href}
                data-testid={`link-nav-${child.label.toLowerCase().replace(/\s+/g, "-")}`}
                onMouseEnter={() => prefetchRoute(child.href)}
                onFocus={() => prefetchRoute(child.href)}
                onTouchStart={() => prefetchRoute(child.href)}
                onClick={() => {
                  cancelClose();
                  setOpen(false);
                }}
                className={`flex items-center gap-2 font-broadcast uppercase tracking-[0.1em] text-[13px] cursor-pointer ${
                  childActive ? "bg-accent/15 text-foreground" : ""
                }`}
              >
                <ChildIcon className="h-4 w-4" />
                {child.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { teamName, usesTournaments, sportProfile } = useTeamSettings();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: ctx } = useTeamContext();
  const { tier, isLoading: permissionLoading } = usePermission();
  const { data: adminMe } = useAdminMe();
  // 60s telemetry ping while tab is visible — feeds the master-admin
  // "active minutes" rollup. Fire-and-forget; failures are silent.
  useHeartbeat();
  // Don't surface the "Read-only" badge while the team context is
  // still loading. `usePermission` defensively defaults `tier='view'`
  // during load so write-buttons stay hidden, but flashing a
  // "Read-only" badge to the actual head coach for ~300ms on every
  // hard refresh looks like a bug.
  const isReadOnly = !permissionLoading && tier === "view";
  const isMasterAdmin = !!adminMe?.isMasterAdmin;
  // Prefer the per-team displayName so other coaches see the name the
  // user picked for THIS team (which may differ from team to team).
  // Falls back to Clerk's email so we always show *something*.
  const displayIdentity =
    ctx?.currentUser.displayName ??
    user?.primaryEmailAddress?.emailAddress ??
    null;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const displayTeamName = teamName || "Loading…";

  // Always-visible chevron arrows on the left/right edges of the top
  // bar that auto-scroll the cluster while hovered. State tracks
  // whether scrolling is currently possible in each direction so the
  // arrows can hide themselves when there's nothing left to reveal.
  const rightClusterRef = useRef<HTMLDivElement | null>(null);
  const scrollDirRef = useRef<-1 | 0 | 1>(0);
  const rafRef = useRef<number | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollAffordance = () => {
    const el = rightClusterRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };

  const stopAutoScroll = () => {
    scrollDirRef.current = 0;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const startAutoScroll = (dir: -1 | 1) => {
    scrollDirRef.current = dir;
    if (rafRef.current != null) return;
    const tick = () => {
      const el = rightClusterRef.current;
      const d = scrollDirRef.current;
      if (!el || d === 0) {
        rafRef.current = null;
        return;
      }
      // Per-frame scroll delta. Halved from the original 8px/frame
      // (~480px/sec at 60fps) to 4px (~240px/sec) on user request —
      // the original speed felt like the bar was running away when a
      // coach just hovered to peek at clipped items.
      el.scrollLeft += d * 4;
      updateScrollAffordance();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const el = rightClusterRef.current;
    if (!el) return;
    updateScrollAffordance();
    const onScroll = () => updateScrollAffordance();
    const onResize = () => updateScrollAffordance();
    el.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    // Re-measure once the team context / nav items finish loading and
    // potentially change the cluster's content width.
    const t = setTimeout(updateScrollAffordance, 250);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      clearTimeout(t);
      stopAutoScroll();
    };
  }, [isMasterAdmin, isReadOnly, displayIdentity]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location]);

  useEffect(() => {
    document.title = "Lineup Lab";
  }, []);

  // Sidebar order chosen by the coach: dashboard first, then schedule
  // (the most-touched coaching surface), then the analysis view, then the
  // people/teams views, then settings (now also home to the Constraints
  // editor, so it doesn't get its own top-level nav slot anymore).
  // Schedule/Tournaments/Practices share the "calendar entry" metaphor
  // so they're collapsed under an Events parent. Rotation Report +
  // Season Stats share the "analysis" metaphor so they're collapsed
  // under a Statistics parent. Both render as hover-open dropdowns on
  // desktop and indented sections in the mobile sheet.

  const navItems: NavItem[] = [
    { href: "/", label: "Dashboard", icon: Home },
    // Team grouping: Roster + Arm Watch collapsed under one header.
    // Settings used to be tucked in here too but coaches kept missing
    // it inside the dropdown — promoted back to its own top-level tab
    // (see below) so it's one click from anywhere.
    {
      label: "Team",
      icon: Users,
      children: [
        // Depth Chart lives as a tab inside the Roster page now, so
        // it's reachable from /players directly. The /depth-chart
        // route still mounts the same page (Depth Chart tab pre-
        // selected) so old links keep working — we just don't show
        // it as its own nav item.
        { href: "/players", label: "Roster", icon: Users },
        // Arm Watch tracks pitcher rest/pitch counts — baseball-only.
        ...(sportProfile.features.pitchCounts
          ? [{ href: "/arm-watch", label: "Arm Watch", icon: Shield }]
          : []),
      ],
    },
    {
      label: "Events",
      icon: CalendarRange,
      children: [
        { href: "/games", label: "Schedule", icon: CalendarDays },
        // Tournaments hidden when the team has flipped off the
        // tournament feature flag in Settings → Defaults, or when the
        // sport doesn't support tournament pitch rules (e.g. basketball).
        // Existing tournament games still render correctly elsewhere; this
        // just removes the dedicated tournaments page from nav.
        ...(usesTournaments && sportProfile.features.tournaments
          ? [{ href: "/tournaments", label: "Tournaments", icon: Trophy }]
          : []),
        { href: "/practices", label: "Practices", icon: Clipboard },
      ],
    },
    {
      label: "Statistics",
      icon: BarChart2,
      children: [
        { href: "/stats", label: "Rotation Report", icon: BarChart2 },
        // Season Stats surfaces batting/pitching box-score totals —
        // baseball-only for now.
        ...(sportProfile.features.boxScoreImport
          ? [{ href: "/season-stats", label: "Season Stats", icon: Activity }]
          : []),
      ],
    },
    // Season-wide AI assistant — answers team-data questions (stats,
    // rotation, schedule) and general coaching help. Distinct from the
    // in-game Lineup Assistant on the game-detail page. Sits just left of
    // Settings at the end of the nav.
    { href: "/ask", label: "Assistant", icon: Sparkles },
    // Settings as its own top-level tab — was previously a child of
    // the Team dropdown but coaches reported losing it inside the
    // menu. The persistent scroll-with-chevrons treatment on the
    // top-bar nav handles overflow if the tab strip wraps on narrow
    // laptops, so promoting it back to top-level is safe.
    { href: "/settings", label: "Settings", icon: SettingsIcon },
    // Help / FAQ + Quick Tour video — its own top-level tab so a
    // brand-new coach can always find "how do I do X?" in one click.
    { href: "/help", label: "Help", icon: LifeBuoy },
    // Master-admin-only: tucked at the end so it doesn't visually
    // dominate for users who'll never see it.
    ...(isMasterAdmin
      ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }]
      : []),
  ];

  const isHrefActive = (href: string) =>
    location === href || (location.startsWith(href) && href !== "/");

  const handleSignOut = () => {
    void signOut();
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header
        className="sticky top-0 z-30 border-b border-[var(--brand-dd)] shadow-md"
        style={{
          background:
            "linear-gradient(135deg, var(--brand-d) 0%, var(--brand-l) 55%, var(--brand) 100%)",
        }}
      >
        {/* Safe-area spacer: when the app runs as an installed PWA on
            iOS the system status bar (clock + battery) sits on top of
            our gradient (we declared `apple-mobile-web-app-status-bar-style:
            black-translucent` in index.html so the bar is transparent).
            This empty strip pushes the actual nav content below the
            status bar while the gradient extends up underneath it.
            Falls back to 0 height in normal mobile browsers and desktop. */}
        <div style={{ height: "env(safe-area-inset-top, 0px)" }} aria-hidden />
        <div
          className="relative flex h-14 md:h-16 items-center gap-3 md:gap-4 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] md:pl-[max(1.5rem,env(safe-area-inset-left))] md:pr-[max(1.5rem,env(safe-area-inset-right))]"
        >
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-accent" />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 md:hidden h-9 w-9 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
              data-testid="button-mobile-nav"
              aria-label="Open navigation menu"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="flex w-72 flex-col bg-sidebar text-sidebar-foreground border-r-sidebar-border"
          >
            {/* Visually-hidden title + description so Radix's a11y
                requirements are met (otherwise it logs a missing-Title
                console warning every time the menu opens). The visible
                team-name banner below is decorative for sighted users. */}
            <SheetTitle className="sr-only">Navigation menu</SheetTitle>
            <SheetDescription className="sr-only">
              Main navigation for {displayTeamName}
            </SheetDescription>
            <div className="flex min-h-16 items-center border-b-2 border-accent/80 px-4 py-3 gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(0,0,0,0.15)]">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div className="flex min-w-0 flex-col leading-tight">
                <span
                  className="text-lg font-bold text-sidebar-foreground font-broadcast uppercase tracking-wide leading-tight"
                  data-testid="text-team-name-mobile"
                >
                  {displayTeamName}
                </span>
                <span className="eyebrow text-accent">
                  Lineup Lab
                </span>
              </div>
            </div>
            <nav className="grid gap-1 p-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                if (isGroup(item)) {
                  // Render the group label as a non-interactive section
                  // header, then each child link indented underneath.
                  return (
                    <div key={item.label} className="mt-2 first:mt-0">
                      <div className="flex items-center gap-3 px-3 py-1.5 text-xs font-broadcast uppercase tracking-[0.16em] text-sidebar-foreground/45">
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </div>
                      <div className="ml-2 border-l border-sidebar-border/60 pl-2">
                        {item.children.map((child) => {
                          const ChildIcon = child.icon;
                          const isActive = isHrefActive(child.href);
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              data-testid={`link-nav-mobile-${child.label.toLowerCase().replace(/\s+/g, "-")}`}
                              onTouchStart={() => prefetchRoute(child.href)}
                              onClick={() => setMobileNavOpen(false)}
                              className={`flex items-center gap-3 rounded-md px-3 py-2 font-broadcast uppercase tracking-[0.12em] text-sm transition-all ${
                                isActive
                                  ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-accent shadow-inner"
                                  : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-l-[3px] border-transparent"
                              }`}
                            >
                              <ChildIcon className="h-5 w-5" />
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                const isActive = isHrefActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`link-nav-mobile-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                    onTouchStart={() => prefetchRoute(item.href)}
                    onClick={() => setMobileNavOpen(false)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 font-broadcast uppercase tracking-[0.12em] text-sm transition-all ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-accent shadow-inner"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground border-l-[3px] border-transparent"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-sidebar-border p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              {displayIdentity && (
                <div
                  className="text-xs text-sidebar-foreground/60 mb-2 truncate"
                  data-testid="text-user-email-mobile"
                >
                  {displayIdentity}
                  {ctx?.currentUser.role && (
                    <span className="ml-1 text-sidebar-foreground/40">
                      · {ctx.currentUser.role}
                    </span>
                  )}
                </div>
              )}
              {isReadOnly && (
                <div
                  className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] uppercase tracking-wide text-amber-200"
                  data-testid="badge-read-only-mobile"
                >
                  <Eye className="h-3 w-3" />
                  Read-only
                </div>
              )}
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleSignOut}
                data-testid="button-sign-out-mobile"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
        {/* Brand cluster — stable across all breakpoints. Shield, team
            name, and "Lineup Lab" eyebrow all keep the same relative
            sizing from phone portrait → landscape → tablet → desktop
            so rotating the device doesn't visibly rebuild the bar.
            Pattern borrowed from ESPN/GameChanger/MLB app: one fixed
            brand block on the left, no size jumps at breakpoints. */}
        <div className="flex items-center gap-2.5 md:gap-3 flex-1 min-w-0 md:flex-none md:shrink-0">
          <div className="flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(0,0,0,0.18)] shrink-0">
            <Shield className="h-[18px] w-[18px] md:h-5 md:w-5 text-primary" />
          </div>
          <div className="flex flex-col leading-tight min-w-0">
            <h1
              className="text-base md:text-lg font-bold uppercase tracking-wider text-primary-foreground font-broadcast leading-tight truncate md:whitespace-nowrap"
              data-testid="text-team-name"
            >
              {displayTeamName}
            </h1>
            <span className="text-[10px] md:text-[11px] font-broadcast uppercase tracking-[0.16em] text-accent leading-none">
              Lineup Lab
            </span>
          </div>
        </div>
        {/* Mobile-only right cluster — sits opposite the brand block
            so the bar always has a clear two-column shape (left brand,
            right actions) regardless of how wide the screen is. Sync
            chip surfaces offline/queued state on phones too (used to be
            desktop-only). TeamSwitcher returns null when the user only
            belongs to one team, so the cluster shrinks gracefully. */}
        <div className="md:hidden flex items-center gap-1.5 shrink-0 ml-auto">
          <SyncStatusChip />
          <TeamSwitcher />
        </div>
        {/* Desktop right cluster: takes remaining width and scrolls
            horizontally when content overflows. Chevron arrow overlays
            (rendered after the scroll container) auto-scroll the bar
            while hovered, so the sign-out button and any clipped nav
            items are always reachable on narrow desktops. */}
        <div className="hidden md:block relative flex-1 min-w-0">
        <div
          ref={rightClusterRef}
          className="flex overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-white/30 [&::-webkit-scrollbar-thumb]:rounded-full"
          data-testid="header-right-cluster"
        >
        <div className="flex items-center gap-2 ml-auto">
          {isReadOnly && (
            <div
              className="shrink-0 inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-300/10 px-2 py-1 text-[11px] uppercase tracking-wide text-amber-100"
              data-testid="badge-read-only"
              title="You have read-only access on this team. Ask the head coach for edit access."
            >
              <Eye className="h-3 w-3" />
              Read-only
            </div>
          )}
          {/* Tightened nav: gap-0.5 between items + px-2.5/text-[13px]/
              tracking-[0.1em] so 6+ tabs (Dashboard, Roster, Games,
              Practices, Stats, History, Settings, Admin…) all fit on a
              standard 13" laptop without triggering the horizontal
              scroller. The active underline span tracks the new padding. */}
          <nav className="flex items-center gap-0.5 shrink-0">
            {navItems.map((item) => {
              if (isGroup(item)) {
                // Active when the current route matches any child.
                const isActive = item.children.some((c) =>
                  isHrefActive(c.href),
                );
                return (
                  <NavGroupDropdown
                    key={item.label}
                    group={item}
                    isActive={isActive}
                    isHrefActive={isHrefActive}
                  />
                );
              }
              const isActive = isHrefActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  onMouseEnter={() => {
                    dispatchNavHover(null);
                    prefetchRoute(item.href);
                  }}
                  onFocus={() => prefetchRoute(item.href)}
                  onTouchStart={() => prefetchRoute(item.href)}
                  className={`relative shrink-0 whitespace-nowrap px-2.5 py-2 rounded-md font-broadcast uppercase tracking-[0.1em] text-[13px] transition-colors ${
                    isActive
                      ? "text-primary-foreground bg-white/10"
                      : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/5"
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute -bottom-[7px] left-2.5 right-2.5 h-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-broadcast-gold)]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="shrink-0">
            <SyncStatusChip />
          </div>
          <div className="shrink-0">
            <TeamSwitcher />
          </div>
          {/* Account menu. The email + Sign out button used to sit in the
              bar and ate ~350px, which pushed the nav into the horizontal
              scroller on laptops; they now live behind one round button. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="shrink-0 flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-white/10 text-sm font-semibold uppercase text-primary-foreground hover:bg-white/20"
                aria-label="Account"
                title={displayIdentity ?? "Account"}
                data-testid="button-account-menu"
              >
                {(displayIdentity ?? "?").trim().charAt(0)}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {displayIdentity && (
                <div className="px-2 py-1.5" data-testid="text-user-identity">
                  <div className="text-sm font-medium truncate">{displayIdentity}</div>
                  {ctx?.currentUser.role && (
                    <div className="text-xs text-muted-foreground truncate">{ctx.currentUser.role}</div>
                  )}
                </div>
              )}
              <DropdownMenuItem onSelect={handleSignOut} data-testid="button-sign-out">
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>
        {/* Chevron arrow overlays — auto-scroll the cluster while
            hovered. They render only when there's actual overflow in
            that direction so they don't appear on wide desktops. */}
        {canScrollLeft && (
          <button
            type="button"
            aria-label="Scroll navigation left"
            data-testid="button-nav-scroll-left"
            onMouseEnter={() => startAutoScroll(-1)}
            onMouseLeave={stopAutoScroll}
            onClick={() => {
              const el = rightClusterRef.current;
              if (!el) return;
              el.scrollBy({ left: -200, behavior: "smooth" });
            }}
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 cursor-pointer text-primary-foreground bg-gradient-to-r from-[var(--brand-d)] via-[var(--brand-d)]/85 to-transparent hover:from-[var(--brand)]"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            aria-label="Scroll navigation right"
            data-testid="button-nav-scroll-right"
            onMouseEnter={() => startAutoScroll(1)}
            onMouseLeave={stopAutoScroll}
            onClick={() => {
              const el = rightClusterRef.current;
              if (!el) return;
              el.scrollBy({ left: 200, behavior: "smooth" });
            }}
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 cursor-pointer text-primary-foreground bg-gradient-to-l from-[var(--brand-d)] via-[var(--brand-d)]/85 to-transparent hover:from-[var(--brand)]"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        </div>
        </div>
      </header>
      <OfflineBanner />
      <main
        // Bottom padding has to clear TWO things on mobile:
        //   (a) the new fixed bottom tab bar (~56px tall), and
        //   (b) iOS's home-indicator gesture strip (env safe-area).
        // On md+ the tab bar is hidden so we drop back to the original
        // 1rem + safe-area clearance.
        className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </main>
      {/* ── Mobile bottom tab bar ─────────────────────────────────────
          Friend feedback was that "navigating on Safari is clunky" —
          the only path to anywhere was the hamburger sheet, which is
          two taps minimum + an opaque overlay. A native-feeling
          fixed-bottom bar with the four most-touched destinations
          (Dashboard, Schedule, Roster, Stats) makes the common case
          one tap and zero overlay. The fifth slot opens the existing
          full-nav sheet for everything else (Practices, Tournaments,
          Settings, Admin, Sign-out). Hidden on md+ where the
          horizontal top-bar nav is already visible. */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-[var(--brand-dd)] shadow-[0_-4px_12px_-4px_rgba(0,0,0,0.25)]"
        style={{
          background:
            "linear-gradient(180deg, var(--brand) 0%, var(--brand-d) 100%)",
          paddingBottom: "env(safe-area-inset-bottom)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
        }}
        data-testid="mobile-bottom-nav"
        aria-label="Primary"
      >
        <div className="flex items-stretch h-14">
          {[
            { href: "/", label: "Home", icon: Home, match: (l: string) => l === "/" },
            {
              href: "/games",
              label: "Schedule",
              icon: CalendarDays,
              match: (l: string) =>
                l.startsWith("/games") || l.startsWith("/tournaments"),
            },
            {
              href: "/players",
              label: "Roster",
              icon: Users,
              match: (l: string) => l.startsWith("/players"),
            },
            {
              href: "/stats",
              label: "Stats",
              icon: BarChart2,
              match: (l: string) =>
                l.startsWith("/stats") || l.startsWith("/season-stats"),
            },
          ].map(({ href, label, icon: Icon, match }) => {
            const active = match(location);
            return (
              <Link
                key={href}
                href={href}
                data-testid={`link-tabbar-${label.toLowerCase()}`}
                onTouchStart={() => prefetchRoute(href)}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-broadcast uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "text-primary-foreground"
                    : "text-primary-foreground/65 hover:text-primary-foreground"
                }`}
              >
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 2} />
                <span>{label}</span>
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 h-[3px] w-10 rounded-b-full bg-accent shadow-[0_0_6px_var(--color-broadcast-gold)]" />
                )}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            data-testid="button-tabbar-more"
            aria-label="Open full navigation menu"
            className="relative flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-broadcast uppercase tracking-[0.12em] text-primary-foreground/65 hover:text-primary-foreground transition-colors"
          >
            <MoreHorizontal className="h-5 w-5" />
            <span>More</span>
          </button>
        </div>
      </nav>
      {/* First-time onboarding modal — auto-opens once per (user, team)
          when the coach hasn't filled in their per-team displayName yet.
          Lazy + Suspense(null): not needed for first paint, so it stays
          out of the shell's critical bundle. */}
      <Suspense fallback={null}>
        <CoachProfilePrompt />
      </Suspense>
      {/* Per-team color CSS vars are injected once at the signed-in app root
          (ProtectedApp in App.tsx) so they also cover full-screen surfaces
          that render outside this shell (Field Display, Onboarding). */}
      {/* iOS-only nudge to "Add to Home Screen" so the app installs
          as a PWA — required for the service worker to keep the page
          available with no wifi at the field. Lazy-loaded; only ever
          renders on iOS Safari outside an installed PWA. */}
      <Suspense fallback={null}>
        <InstallPwaPrompt />
      </Suspense>
    </div>
  );
}
