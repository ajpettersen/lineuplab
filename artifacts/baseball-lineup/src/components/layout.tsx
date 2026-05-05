import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  Users,
  CalendarDays,
  BarChart2,
  Menu,
  Shield,
  ShieldCheck,
  Eye,
  Settings as SettingsIcon,
  LogOut,
  Trophy,
  Clipboard,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTeamSettings } from "@/hooks/use-team-settings";
import { TeamSwitcher } from "@/components/team-switcher";
import { CoachProfilePrompt } from "@/components/coach-profile-prompt";
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
              className="shrink-0 md:hidden bg-primary-foreground text-primary hover:bg-primary-foreground/90 border-transparent"
              data-testid="button-mobile-nav"
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
        <div className="flex items-center gap-3 w-full justify-center md:justify-start">
          <div className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-accent shadow-[0_0_0_2px_rgba(0,0,0,0.18)]">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1
              className="text-xl md:text-2xl font-bold uppercase tracking-wider text-primary-foreground font-broadcast leading-none"
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
        <div className="ml-auto hidden md:flex items-center gap-4">
          {isReadOnly && (
            <div
              className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-300/10 px-2.5 py-1 text-[11px] uppercase tracking-wide text-amber-100"
              data-testid="badge-read-only"
              title="You have read-only access on this team. Ask the head coach for edit access."
            >
              <Eye className="h-3 w-3" />
              Read-only
            </div>
          )}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (location.startsWith(item.href) && item.href !== "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`relative px-3 py-2 rounded-md font-broadcast uppercase tracking-[0.14em] text-[13px] transition-colors ${
                    isActive
                      ? "text-primary-foreground bg-white/10"
                      : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/5"
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute -bottom-[7px] left-3 right-3 h-[3px] rounded-full bg-accent shadow-[0_0_8px_var(--color-broadcast-gold)]" />
                  )}
                </Link>
              );
            })}
          </nav>
          <TeamSwitcher />
          {displayIdentity && (
            <div
              className="flex flex-col leading-tight max-w-[180px]"
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
            className="gap-2 border-white/20 bg-white/5 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            data-testid="button-sign-out"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
      {/* First-time onboarding modal — auto-opens once per (user, team)
          when the coach hasn't filled in their per-team displayName yet. */}
      <CoachProfilePrompt />
    </div>
  );
}
