import React from "react";
import { Link, useLocation } from "wouter";
import { 
  Home, 
  Users, 
  CalendarDays, 
  BarChart2, 
  Menu,
  Shield,
  SlidersHorizontal
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: Home },
    { href: "/players", label: "Roster", icon: Users },
    { href: "/games", label: "Schedule", icon: CalendarDays },
    { href: "/stats", label: "Season Stats", icon: BarChart2 },
    { href: "/constraints", label: "Constraints", icon: SlidersHorizontal },
  ];

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b bg-primary px-4 shadow-sm md:px-6">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="shrink-0 md:hidden bg-primary-foreground text-primary hover:bg-primary-foreground/90 border-transparent"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle navigation menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col bg-sidebar text-sidebar-foreground border-r-sidebar-border">
            <div className="flex h-16 items-center border-b border-sidebar-border px-4">
              <Shield className="h-6 w-6 mr-2 text-primary" />
              <span className="text-lg font-bold text-sidebar-foreground">DugoutManager</span>
            </div>
            <nav className="grid gap-2 text-lg font-medium p-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location === item.href || (location.startsWith(item.href) && item.href !== "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
                      isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/70"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2 md:gap-4 w-full justify-center md:justify-start">
          <Shield className="h-6 w-6 text-primary-foreground hidden md:block" />
          <h1 className="text-xl font-bold tracking-tight text-primary-foreground hidden md:block">
            DugoutManager
          </h1>
          <h1 className="text-lg font-bold tracking-tight text-primary-foreground md:hidden">
            DugoutManager
          </h1>
        </div>
        <div className="ml-auto hidden md:flex items-center gap-4">
          <nav className="flex items-center gap-6 text-sm font-medium">
            {navItems.map((item) => {
              const isActive = location === item.href || (location.startsWith(item.href) && item.href !== "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`transition-colors hover:text-primary-foreground/80 ${
                    isActive ? "text-primary-foreground border-b-2 border-primary-foreground pb-[18px] pt-[20px]" : "text-primary-foreground/60"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}
