import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Briefcase,
  BarChart3,
  RefreshCw,
  Bot,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  Lock,
  HardDrive,
  Cpu,
} from "lucide-react";

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "trading", label: "Trading", icon: ClipboardList },
  { id: "rebalance", label: "Rebalance", icon: RefreshCw },
  { id: "automation", label: "Automation", icon: Bot },
  { id: "asic-miners", label: "ASIC Miners", icon: HardDrive },
  { id: "nicehash", label: "NiceHash", icon: Cpu },
];

const comingSoon = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "markets", label: "Markets", icon: BarChart3 },
  { id: "orders", label: "Orders", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Settings },
];

export function AppSidebar({ currentPage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        "h-screen flex flex-col border-r border-border bg-card transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className="h-16 flex items-center px-4 border-b border-border">
        {!collapsed && (
          <span className="font-mono text-sm font-semibold tracking-widest text-foreground">
            NEXUS<span className="text-primary">.</span>
          </span>
        )}
        {collapsed && <span className="font-mono text-sm font-bold text-primary mx-auto">N</span>}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        <div
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2",
            collapsed ? "text-center" : "px-3"
          )}
        >
          {collapsed ? "--" : "Main"}
        </div>

        {navItems.map((item) => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="font-mono text-xs">{item.label}</span>}
            </button>
          );
        })}

        <div
          className={cn(
            "text-[10px] font-mono uppercase tracking-wider text-muted-foreground mt-6 mb-2",
            collapsed ? "text-center" : "px-3"
          )}
        >
          {collapsed ? "--" : "Coming Soon"}
        </div>

        {comingSoon.map((item) => (
          <div
            key={item.id}
            className={cn(
              "w-full flex items-center gap-3 rounded-md text-sm opacity-40 cursor-not-allowed",
              collapsed ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
            )}
          >
            <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            {!collapsed && (
              <>
                <span className="font-mono text-xs text-muted-foreground">{item.label}</span>
                <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
              </>
            )}
          </div>
        ))}
      </nav>

      <button
        onClick={() => setCollapsed(!collapsed)}
        className="h-10 flex items-center justify-center border-t border-border text-muted-foreground hover:text-foreground transition-colors"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
