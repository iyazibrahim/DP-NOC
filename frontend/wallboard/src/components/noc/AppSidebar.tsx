import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Map,
  Building2,
  HardDrive,
  Bell,
  Globe,
  Settings,
  LogOut
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const links = [
  { to: "/", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/maps", label: "Maps", icon: Map },
  { to: "/sites", label: "Sites", icon: Building2 },
  { to: "/devices", label: "Devices", icon: HardDrive },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/websites", label: "Website checks", icon: Globe },
  { to: "/settings", label: "Settings", icon: Settings }
];

export function AppSidebar({ className }: { className?: string }) {
  const { logout } = useAuth();

  return (
    <aside
      className={cn(
        "flex h-full w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        className
      )}
    >
      <div className="flex flex-col gap-1 px-4 py-4">
        <img src="/digital-penang-logo.png" alt="Digital Penang" className="h-8 w-auto object-contain object-left" />
        <div className="text-xs text-muted-foreground">NOC operations</div>
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
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )
              }
            >
              <Icon className="size-4 shrink-0" />
              {l.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="p-2">
        <Button variant="outline" className="w-full justify-start" onClick={logout}>
          <LogOut data-icon="inline-start" />
          Log out
        </Button>
      </div>
    </aside>
  );
}
