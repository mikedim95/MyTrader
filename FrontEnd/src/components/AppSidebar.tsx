import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  BarChart3,
  RefreshCw,
  Bot,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Lock,
  HardDrive,
  Cpu,
  Menu,
  X,
  LayoutDashboard,
  Newspaper,
  BrainCircuit,
  ActivitySquare,
  ArrowLeftRight,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
}

const navItems = [
  { id: "portfolio", label: "Portfolio", icon: Briefcase },
  { id: "trading", label: "Trading", icon: ClipboardList },
  { id: "exchange-intelligence", label: "Exchange Intel", icon: ArrowLeftRight },
  { id: "rebalance", label: "Rebalance", icon: RefreshCw },
  { id: "automation", label: "Strategies", icon: Bot },
  { id: "decision-intelligence", label: "Decision Intel", icon: BrainCircuit },
  { id: "signal-review", label: "Signal Review", icon: ActivitySquare },
  { id: "btc-news", label: "BTC News", icon: Newspaper },
  { id: "asic-miners", label: "ASIC Miners", icon: HardDrive },
  { id: "nicehash", label: "NiceHash", icon: Cpu },
];

const comingSoon = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "markets", label: "Markets", icon: BarChart3 },
  { id: "orders", label: "Orders", icon: ClipboardList },
];

export function AppSidebar({ currentPage, onNavigate }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNavigate = (page: string) => {
    onNavigate(page);
    if (isMobile) setMobileOpen(false);
  };

  const sidebarContent = (
    <>
      <div className="h-14 flex items-center px-4 border-b border-border shrink-0">
        {!collapsed && (
          <span className="font-mono text-base font-semibold tracking-widest text-foreground">
            NEXUS<span className="text-primary transition-colors duration-500">.</span>
          </span>
        )}
        {collapsed && !isMobile && <span className="font-mono text-base font-bold text-primary mx-auto transition-colors duration-500">N</span>}
        {isMobile && (
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 py-4 space-y-1 px-2 overflow-y-auto">
        <div
          className={cn(
            "text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2",
            collapsed && !isMobile ? "text-center" : "px-3"
          )}
        >
          {collapsed && !isMobile ? "--" : "Main"}
        </div>

        {navItems.map((item) => {
          const active = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => handleNavigate(item.id)}
              className={cn(
                "w-full flex items-center gap-3 rounded-md text-sm transition-all duration-300 ease-out transform-gpu",
                collapsed && !isMobile ? "justify-center px-2 py-3" : "px-3 py-3",
                active
                  ? "bg-secondary text-foreground shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50 hover:translate-x-1"
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {(isMobile || !collapsed) && <span className="font-mono text-sm">{item.label}</span>}
            </button>
          );
        })}

        <div
          className={cn(
            "text-[11px] font-mono uppercase tracking-wider text-muted-foreground mt-6 mb-2",
            collapsed && !isMobile ? "text-center" : "px-3"
          )}
        >
          {collapsed && !isMobile ? "--" : "Coming Soon"}
        </div>

        {comingSoon.map((item) => (
          <div
            key={item.id}
            className={cn(
              "w-full flex items-center gap-3 rounded-md text-sm opacity-40 cursor-not-allowed",
              collapsed && !isMobile ? "justify-center px-2 py-3" : "px-3 py-3"
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
            {(isMobile || !collapsed) && (
              <>
                <span className="font-mono text-sm text-muted-foreground">{item.label}</span>
                <Lock className="h-3.5 w-3.5 ml-auto text-muted-foreground" />
              </>
            )}
          </div>
        ))}
      </nav>

      {!isMobile && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-12 flex items-center justify-center border-t border-border text-muted-foreground hover:text-foreground transition-all duration-300 hover:bg-secondary/40 shrink-0"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      )}
    </>
  );

  // Mobile: hamburger + slide-over drawer
  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setMobileOpen(true)}
          className="fixed top-3 left-3 z-50 rounded-lg border border-border bg-card/90 backdrop-blur p-2.5 text-muted-foreground hover:text-foreground"
        >
          <Menu className="h-5 w-5" />
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 animate-overlay-fade" onClick={() => setMobileOpen(false)}>
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" />
            <aside
              className="absolute left-0 top-0 h-full w-72 bg-card border-r border-border flex flex-col animate-slide-in-right"
              onClick={(e) => e.stopPropagation()}
            >
              {sidebarContent}
            </aside>
          </div>
        )}
      </>
    );
  }

  // Desktop: standard sidebar
  return (
    <aside
      className={cn(
        "h-screen flex flex-col border-r border-border bg-card transition-all duration-300 ease-out shrink-0",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {sidebarContent}
    </aside>
  );
}
