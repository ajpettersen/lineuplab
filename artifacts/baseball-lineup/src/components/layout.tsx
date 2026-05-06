import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  Users,
  CalendarDays,
  BarChart2,
  Activity,
  Menu,
  Shield,
  ShieldCheck,
  Eye,
  Settings as SettingsIcon,
  LogOut,
  Trophy,
  Clipboard,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { TeamSwitcher } from "@/components/team-switcher";
import { CoachProfilePrompt } from "@/components/coach-profile-prompt";
import { TeamNamePrompt } from "@/components/team-name-prompt";
import { TeamThemeApplier } from "@/components/team-theme-applier";
import { useTeamContext } from "@/hooks/use-team-context";
import { usePermission } from "@/hooks/use-permission";
import { useAdminMe } from "@/hooks/use-admin";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { teamName } = useTeamSettings();
  const { signOut } = useClerk();
  const { user } = useUser();
  const { data: ctx } = useTeamContext();
  const { tier, isLoading: permissionLoading } = usePermission();
  const { data: adminMe } = useAdminMe();
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
    if (teamName) {
      document.title = `${teamName} • Lineup Lab`;
    }
  }, [teamName]);

  // Sidebar order chosen by the coach: dashboard first, then schedule
  // (the most-touched coaching surface), then the analysis view, then the
  // people/teams views, then settings (now also home to the Constraints
  // editor, so it doesn't get its own top-level nav slot anymore).
  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/games", label: "Schedule", icon: CalendarDays },
    { href: "/stats", label: "Rotation Report", icon: BarChart2 },
    { href: "/season-stats", label: "Season Stats", icon: Activity },
    { href: "/players", label: "Roster", icon: Users },
    { href: "/tournaments", label: "Tournaments", icon: Trophy },
    { href: "/practices", label: "Practices", icon: Clipboard },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
    // Master-admin-only: tucked at the end so it doesn't visually
    // dominate for users who'll never see it.
    ...(isMasterAdmin
      ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }]
      : []),
  ];

  const handleSignOut = () => {
    void signOut();
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header
        className="sticky top-0 z-30 flex h-18 items-center gap-4 border-b border-[hsl(220_85%_14%)] px-4 shadow-md md:px-6 relative"
        style={{
          background:
            "linear-gradient(135deg, hsl(220 85% 18%) 0%, hsl(220 85% 24%) 60%, hsl(220 85% 20%) 100%)",
        }}
      >
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-accent" />
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 bg-primary-foreground text-primary hover:bg-primary-foreground/90 border-transparent"
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
            <div className="flex h-16 items-center border-b-2 border-accent/80 px-4 gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(0,0,0,0.15)]">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div className="flex flex-col leading-tight">
                <span
                  className="text-lg font-bold text-sidebar-foreground font-broadcast uppercase tracking-wide"
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
                const isActive =
                  location === item.href ||
                  (location.startsWith(item.href) && item.href !== "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    data-testid={`link-nav-mobile-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
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
            <div className="mt-auto border-t border-sidebar-border p-4">
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
        <div className="flex items-center gap-3 w-full justify-center md:justify-start md:w-auto md:shrink-0">
          <div className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(0,0,0,0.18)] shrink-0">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1
              className="text-xl md:text-2xl font-bold uppercase tracking-wider text-primary-foreground font-broadcast leading-none whitespace-nowrap"
              data-testid="text-team-name"
            >
              {displayTeamName}
            </h1>
            <span className="hidden md:block eyebrow text-accent">
              Lineup Lab
            </span>
          </div>
        </div>
        {/* Mobile-only team switcher (desktop is in the right cluster). */}
        <div className="md:hidden ml-auto">
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
              const isActive =
                location === item.href ||
                (location.startsWith(item.href) && item.href !== "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
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
            <TeamSwitcher />
          </div>
          {displayIdentity && (
            <div
              className="shrink-0 flex flex-col leading-tight max-w-[180px]"
              data-testid="text-user-identity"
            >
              <span className="text-sm font-medium text-primary-foreground truncate">
                {displayIdentity}
              </span>
              {ctx?.currentUser.role && (
                <span className="text-[11px] text-primary-foreground/60 truncate uppercase tracking-wide">
                  {ctx.currentUser.role}
                </span>
              )}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            className="shrink-0 gap-2 border-white/20 bg-white/5 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
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
            className="absolute left-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 cursor-pointer text-primary-foreground bg-gradient-to-r from-[hsl(220_85%_18%)] via-[hsl(220_85%_18%)]/85 to-transparent hover:from-[hsl(220_85%_22%)]"
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
            className="absolute right-0 top-0 bottom-0 z-10 flex items-center justify-center w-8 cursor-pointer text-primary-foreground bg-gradient-to-l from-[hsl(220_85%_18%)] via-[hsl(220_85%_18%)]/85 to-transparent hover:from-[hsl(220_85%_22%)]"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
      {/* First-time onboarding modal — auto-opens once per (user, team)
          when the coach hasn't filled in their per-team displayName yet. */}
      <CoachProfilePrompt />
      {/* Force the head coach to pick a real team name on first sign-in
          (the seed value is "My Team" / "Team"). */}
      <TeamNamePrompt />
      {/* Inject per-team primary/secondary CSS variables on the html
          element so the brand follows the active team. */}
      <TeamThemeApplier />
    </div>
  );
}
