import { useMemo } from "react";
import { Activity, ArrowRight, Link2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCryptoComConnection, useExchangeHealth } from "@/hooks/useTradingData";
import { cn } from "@/lib/utils";
import type { ExchangeHealth, ExchangeId } from "@/types/api";

interface PortfolioConnectionsPanelProps {
  onOpenConnections?: () => void;
  onOpenMarketIntel?: () => void;
}

const EXCHANGE_ORDER: ExchangeId[] = ["kraken", "coinbase", "crypto.com"];

function formatExchangeLabel(exchange: ExchangeId): string {
  return exchange === "crypto.com"
    ? "Crypto.com"
    : exchange.charAt(0).toUpperCase() + exchange.slice(1);
}

function feedBadgeClass(health: ExchangeHealth | undefined, isLoading: boolean): string {
  if (isLoading || !health) return "border-border bg-secondary/20 text-muted-foreground";
  return health.status === "online"
    ? "border-positive/30 bg-positive/10 text-positive"
    : "border-negative/30 bg-negative/10 text-negative";
}

export function PortfolioConnectionsPanel({
  onOpenConnections,
  onOpenMarketIntel,
}: PortfolioConnectionsPanelProps) {
  const { data: healthData, isPending: loadingHealth } = useExchangeHealth();
  const { data: cryptoComConnection, isPending: loadingConnection } = useCryptoComConnection();

  const healthByExchange = useMemo(
    () => new Map((healthData?.exchanges ?? []).map((entry) => [entry.exchange, entry])),
    [healthData?.exchanges]
  );

  const publicOnlineCount = (healthData?.exchanges ?? []).filter((entry) => entry.status === "online").length;
  const cryptoComConnected = cryptoComConnection?.connected ?? false;
  const cryptoComSource = cryptoComConnection?.source?.toUpperCase() ?? "NONE";

  return (
    <div className="rounded-lg border border-border bg-card animate-fade-up">
      <div className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Connections</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Live venue setup now stays here in Portfolio. Holdings moved to Exchanges &gt; Market Intel so venue data and exposure sit together.
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary/30 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
            <Link2 className="h-3.5 w-3.5" />
            Live only
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Venues Visible</div>
            <div className="mt-2 text-lg font-mono font-semibold text-foreground">{EXCHANGE_ORDER.length}</div>
            <div className="mt-2 text-xs text-muted-foreground">Kraken, Coinbase, and Crypto.com tracked here.</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Public Feeds</div>
            <div className="mt-2 text-lg font-mono font-semibold text-foreground">
              {loadingHealth ? "--" : `${publicOnlineCount}/${EXCHANGE_ORDER.length}`}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">Market data heartbeat across the live venues.</div>
          </div>
          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Private Link</div>
            <div className="mt-2 text-lg font-mono font-semibold text-foreground">
              {loadingConnection ? "--" : cryptoComConnected ? "Connected" : "Not Connected"}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {cryptoComConnected ? `Crypto.com source ${cryptoComSource}.` : "Connect Crypto.com to unlock authenticated live actions."}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border">
          {EXCHANGE_ORDER.map((exchange, index) => {
            const health = healthByExchange.get(exchange);
            const isCryptoCom = exchange === "crypto.com";

            return (
              <div
                key={exchange}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-3 px-4 py-4",
                  index < EXCHANGE_ORDER.length - 1 && "border-b border-border"
                )}
              >
                <div>
                  <div className="text-sm font-mono font-semibold text-foreground">{formatExchangeLabel(exchange)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {isCryptoCom
                      ? cryptoComConnected
                        ? "Authenticated live access available for this venue."
                        : "Public market checks are active. Private access is not connected yet."
                      : "Read-only market data is available here."}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider",
                      feedBadgeClass(health, loadingHealth)
                    )}
                  >
                    {loadingHealth ? "Checking feed" : health?.status === "online" ? "Feed online" : "Feed offline"}
                  </span>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider",
                      isCryptoCom && cryptoComConnected
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-secondary/20 text-muted-foreground"
                    )}
                  >
                    {isCryptoCom ? (loadingConnection ? "Checking link" : cryptoComConnected ? "Private connected" : "Private off") : "Public only"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" className="font-mono" onClick={onOpenConnections} disabled={!onOpenConnections}>
            <ShieldCheck className="h-4 w-4" />
            Open Connections
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" className="font-mono" onClick={onOpenMarketIntel} disabled={!onOpenMarketIntel}>
            <Activity className="h-4 w-4" />
            Open Market Intel
          </Button>
        </div>
      </div>
    </div>
  );
}
