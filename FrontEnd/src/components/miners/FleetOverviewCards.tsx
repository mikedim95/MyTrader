import { Activity, Cpu, Flame, Gauge, Power } from "lucide-react";
import type { FleetOverview } from "@/types/api";

interface FleetOverviewCardsProps {
  overview?: FleetOverview;
}

function formatValue(value: number | null | undefined, suffix = ""): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value.toFixed(1)}${suffix}`;
}

export function FleetOverviewCards({ overview }: FleetOverviewCardsProps) {
  const cards = [
    {
      label: "Miners Online",
      value: overview ? `${overview.onlineMiners} / ${overview.totalMiners}` : "--",
      sub: overview ? `${overview.enabledMiners} enabled` : "Awaiting backend data",
      icon: Cpu,
      tone: "text-positive",
    },
    {
      label: "Fleet Rate",
      value: overview ? `${formatValue(overview.totalRateThs, " TH/s")}` : "--",
      sub: "Latest backend snapshot",
      icon: Activity,
      tone: "text-primary",
    },
    {
      label: "Fleet Power",
      value: overview ? `${formatValue((overview.totalPowerWatts ?? 0) / 1000, " kW")}` : "--",
      sub: overview?.totalPowerWatts ? `${overview.totalPowerWatts.toLocaleString()} W` : "No power data yet",
      icon: Power,
      tone: "text-foreground",
    },
    {
      label: "Hottest Board",
      value: overview?.hottestBoardTemp !== null && overview?.hottestBoardTemp !== undefined ? `${overview.hottestBoardTemp}C` : "--",
      sub: overview?.hottestHotspotTemp !== null && overview?.hottestHotspotTemp !== undefined ? `Hotspot ${overview.hottestHotspotTemp}C` : "Hotspot pending",
      icon: Flame,
      tone: "text-amber-400",
    },
    {
      label: "Generated",
      value: overview?.generatedAt ? new Date(overview.generatedAt).toLocaleTimeString() : "--",
      sub: "Refreshes every 15s",
      icon: Gauge,
      tone: "text-sky-300",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 stagger-children">
      {cards.map((card) => (
        <div
          key={card.label}
          className="group rounded-lg border border-border bg-card p-4 transition-all duration-300 hover:border-primary/30 hover:shadow-[0_0_20px_hsl(var(--primary)/0.08)] hover:-translate-y-0.5"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{card.label}</span>
            <card.icon className={`h-4 w-4 ${card.tone} transition-transform duration-300 group-hover:scale-110`} />
          </div>
          <div className={`text-lg md:text-xl font-mono font-semibold ${card.tone}`}>{card.value}</div>
          <div className="mt-1 text-xs font-mono text-muted-foreground">{card.sub}</div>
        </div>
      ))}
    </div>
  );
}
