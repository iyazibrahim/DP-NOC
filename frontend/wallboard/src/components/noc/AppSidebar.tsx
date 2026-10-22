import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Building2,
  HardDrive,
  Bell,
  Globe,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/maps", label: "Maps", icon: Map },
  { to: "/sites", label: "Locations", icon: Building2 },
  { to: "/devices", label: "Devices", icon: HardDrive },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/websites", label: "Websites", icon: Globe },
  { to: "/settings", label: "Settings", icon: Settings }
];

const STORAGE_KEY = "noc-sidebar-collapsed";

export function AppSidebar({ className }: { className?: string }) {
  const { logout } = useAuth();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-[68px]" : "w-[220px]",
        className
      )}
    >
      <div className={cn("flex items-start gap-2 py-3", collapsed ? "flex-col items-center px-2" : "px-3")}>
        {collapsed ? null : (
          <div className="min-w-0 flex-1">
            <img
              src="/digital-penang-logo.png"
              alt="Digital Penang"
              className="h-8 w-auto object-contain object-left"
            />
            <div className="mt-1 text-xs text-muted-foreground">NOC operations</div>
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggle}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              title={l.label}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {collapsed ? <span className="sr-only">{l.label}</span> : l.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-2">
        <Button
          variant="outline"
          className={cn("w-full", collapsed ? "justify-center px-0" : "justify-start")}
          title="Log out"
          onClick={logout}
        >
          <LogOut data-icon="inline-start" />
          {collapsed ? <span className="sr-only">Log out</span> : "Log out"}
        </Button>
      </div>
    </aside>
  );
}
