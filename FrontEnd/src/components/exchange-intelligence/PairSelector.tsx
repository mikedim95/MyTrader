import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExchangeMarketSymbol } from "@/types/api";

interface PairSelectorProps {
  pairs: ExchangeMarketSymbol[];
  selectedSymbol: ExchangeMarketSymbol;
  onChange: (value: ExchangeMarketSymbol) => void;
}

export function PairSelector({ pairs, selectedSymbol, onChange }: PairSelectorProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 animate-fade-up">
      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Pair Selector</div>
      <div className="mt-2 text-sm text-muted-foreground">
        Polling Kraken, Coinbase, and Crypto.com public REST endpoints every 5 seconds.
      </div>
      <div className="mt-4">
        <Select value={selectedSymbol} onValueChange={(value) => onChange(value as ExchangeMarketSymbol)}>
          <SelectTrigger className="font-mono">
            <SelectValue placeholder="Select pair" />
          </SelectTrigger>
          <SelectContent>
            {pairs.map((pair) => (
              <SelectItem key={pair} value={pair} className="font-mono">
                {pair}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

