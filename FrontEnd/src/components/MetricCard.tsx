import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
  title: string;
  value: string;
  change?: number;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
}

export function MetricCard({ title, value, change, subtitle, children, className }: MetricCardProps) {
  return (
    <div className={cn("bg-card border border-border rounded-lg p-5 transition-all duration-300 hover:border-primary/20 hover:shadow-[0_0_24px_hsl(var(--primary)/0.06)] hover:-translate-y-0.5", className)}>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">{title}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xl font-mono font-semibold text-foreground">{value}</div>
          {change !== undefined && (
            <span className={cn("text-xs font-mono mt-1", change >= 0 ? "text-positive" : "text-negative")}>
              {change >= 0 ? "+" : ""}{change}%
            </span>
          )}
          {subtitle && <div className="text-xs font-mono text-muted-foreground mt-1">{subtitle}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}
