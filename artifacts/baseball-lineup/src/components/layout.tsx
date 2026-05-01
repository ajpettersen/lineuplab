import React, { useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Home,
  Users,
  CalendarDays,
  BarChart2,
  Menu,
  Shield,
  SlidersHorizontal,
  Settings as SettingsIcon,
  LogOut,
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTeamSettings } from "@/hooks/use-team-settings";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { teamName } = useTeamSettings();
  const { signOut } = useClerk();
  const { user } = useUser();

  const displayTeamName = teamName || "Loading…";

  useEffect(() => {
    if (teamName) {
      document.title = `${teamName} • Lineup Manager`;
    }
  }, [teamName]);

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/players", label: "Roster", icon: Users },
    { href: "/games", label: "Schedule", icon: CalendarDays },
    { href: "/stats", label: "Season Stats", icon: BarChart2 },
    { href: "/constraints", label: "Constraints", icon: SlidersHorizontal },
    { href: "/settings", label: "Settings", icon: SettingsIcon },
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
        <Sheet>
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
            <div className="flex h-16 items-center border-b border-sidebar-border px-4 gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div className="flex flex-col leading-tight">
                <span
                  className="text-base font-bold text-sidebar-foreground"
                  data-testid="text-team-name-mobile"
                >
                  {displayTeamName}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-accent">
                  Lineup Manager
                </span>
              </div>
            </div>
            <nav className="grid gap-1 text-base font-medium p-4">
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
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition-all ${
                      isActive
                        ? "bg-sidebar-accent text-sidebar-accent-foreground border-l-[3px] border-accent"
                        : "text-sidebar-foreground/75 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-sidebar-border p-4">
              {user?.primaryEmailAddress?.emailAddress && (
                <div
                  className="text-xs text-sidebar-foreground/60 mb-2 truncate"
                  data-testid="text-user-email-mobile"
                >
                  {user.primaryEmailAddress.emailAddress}
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
          <div className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-accent shadow-sm">
            <Shield className="h-5 w-5 text-primary" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1
              className="text-lg md:text-xl font-bold tracking-tight text-primary-foreground"
              data-testid="text-team-name"
            >
              {displayTeamName}
            </h1>
            <span className="hidden md:block text-[11px] uppercase tracking-[0.18em] text-accent font-semibold">
              Lineup Manager
            </span>
          </div>
        </div>
        <div className="ml-auto hidden md:flex items-center gap-4">
          <nav className="flex items-center gap-1 text-sm font-medium">
            {navItems.map((item) => {
              const isActive =
                location === item.href ||
                (location.startsWith(item.href) && item.href !== "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-testid={`link-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={`relative px-3 py-2 rounded-md transition-colors ${
                    isActive
                      ? "text-primary-foreground bg-white/10"
                      : "text-primary-foreground/70 hover:text-primary-foreground hover:bg-white/5"
                  }`}
                >
                  {item.label}
                  {isActive && (
                    <span className="absolute -bottom-[7px] left-3 right-3 h-[3px] rounded-full bg-accent" />
                  )}
                </Link>
              );
            })}
          </nav>
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
    </div>
  );
}
