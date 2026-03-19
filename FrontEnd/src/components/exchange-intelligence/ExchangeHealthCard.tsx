import { Activity, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ExchangeHealth } from "@/types/api";

interface ExchangeHealthCardProps {
  exchanges: ExchangeHealth[];
  isLoading: boolean;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

export function ExchangeHealthCard({ exchanges, isLoading }: ExchangeHealthCardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {isLoading
        ? Array.from({ length: 2 }).map((_, index) => (
            <Card key={`exchange-health-skeleton-${index}`} className="animate-fade-up">
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-28" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-4 w-32" />
              </CardContent>
            </Card>
          ))
        : exchanges.map((exchange) => {
            const online = exchange.status === "online";

            return (
              <Card key={exchange.exchange} className="animate-fade-up">
                <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Exchange Health</div>
                    <div className="mt-2 text-lg font-mono font-semibold text-foreground">
                      {exchange.exchange.charAt(0).toUpperCase() + exchange.exchange.slice(1)}
                    </div>
                  </div>
                  {online ? <Activity className="h-4 w-4 text-positive" /> : <WifiOff className="h-4 w-4 text-negative" />}
                </CardHeader>
                <CardContent className="space-y-3">
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit font-mono uppercase tracking-wider",
                      online ? "border-positive/30 bg-positive/10 text-positive" : "border-negative/30 bg-negative/10 text-negative",
                    )}
                  >
                    {exchange.status}
                  </Badge>
                  <div className="text-sm text-muted-foreground">
                    Updated <span className="font-mono text-foreground">{formatTimestamp(exchange.timestamp)}</span>
                  </div>
                  {exchange.message ? <div className="text-xs text-muted-foreground">{exchange.message}</div> : null}
                </CardContent>
              </Card>
            );
          })}
    </div>
  );
}

