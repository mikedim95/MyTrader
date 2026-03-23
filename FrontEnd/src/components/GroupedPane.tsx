import { useEffect } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GroupedPaneTab<T extends string = string> {
  id: T;
  label: string;
  icon: LucideIcon;
}

interface GroupedPaneProps<T extends string = string> {
  title: string;
  description: string;
  tabs: GroupedPaneTab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
  children: ReactNode;
}

export function GroupedPane<T extends string = string>({
  title,
  tabs,
  activeTab,
  onTabChange,
  children,
}: GroupedPaneProps<T>) {
  useEffect(() => {
    const scrollContainer = document.querySelector("main");
    if (!(scrollContainer instanceof HTMLElement)) return;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scrollContainer.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  }, [activeTab]);

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-20 border-b border-border bg-background/75 backdrop-blur-xl">
        <div className="px-4 py-3 md:px-6">
          <div
            className="grid gap-0 overflow-hidden rounded-xl border border-border bg-card/90 shadow-[0_10px_30px_rgba(0,0,0,0.16)]"
            style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
            aria-label={`${title} tabs`}
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.id === activeTab;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    "inline-flex min-w-0 items-center justify-center gap-2 border-r border-border px-3 py-3 text-xs font-mono uppercase tracking-[0.18em] transition-all duration-300 last:border-r-0",
                    active
                      ? "bg-primary/10 text-foreground shadow-[inset_0_-1px_0_hsl(var(--primary)/0.35)]"
                      : "bg-card/80 text-muted-foreground hover:bg-secondary/35 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div key={activeTab} className="tab-panel-enter">
        {children}
      </div>
    </div>
  );
}
