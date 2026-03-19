import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExchangeBestVenue, ExchangeMarketSymbol } from "@/types/api";

interface RecommendationBoxProps {
  symbol: ExchangeMarketSymbol;
  bestBuy: ExchangeBestVenue | null;
  bestSell: ExchangeBestVenue | null;
  isLoading: boolean;
}

function getCurrencyCode(symbol: ExchangeMarketSymbol): "USD" | "EUR" {
  return symbol.endsWith("-EUR") ? "EUR" : "USD";
}

function formatPrice(value: number | null | undefined, symbol: ExchangeMarketSymbol): string {
  if (value === null || value === undefined) return "--";

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: getCurrencyCode(symbol),
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatExchange(value: string | null | undefined): string {
  if (!value) return "--";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function RecommendationBox({ symbol, bestBuy, bestSell, isLoading }: RecommendationBoxProps) {
  return (
    <Card className="animate-fade-up">
      <CardHeader className="pb-3">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Recommendation</div>
        <div className="mt-2 text-sm text-muted-foreground">Best venue by live bid/ask for {symbol}.</div>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {[
          {
            key: "buy",
            label: "Best Place to Buy",
            venue: bestBuy,
            icon: ArrowDownToLine,
            accent: "text-positive",
          },
          {
            key: "sell",
            label: "Best Place to Sell",
            venue: bestSell,
            icon: ArrowUpFromLine,
            accent: "text-foreground",
          },
        ].map((item) => {
          const Icon = item.icon;

          return (
            <div key={item.key} className="rounded-lg border border-border bg-secondary/20 p-4">
              <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </div>
              {isLoading ? (
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ) : (
                <>
                  <div className={`mt-3 text-lg font-mono font-semibold ${item.accent}`}>{formatExchange(item.venue?.exchange)}</div>
                  <div className="mt-1 text-sm font-mono text-muted-foreground">{formatPrice(item.venue?.price, symbol)}</div>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

