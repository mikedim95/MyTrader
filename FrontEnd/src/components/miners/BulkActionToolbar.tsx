import { Play, Power, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BulkMinerAction = "restart" | "reboot" | "start" | "stop";

interface BulkActionToolbarProps {
  count: number;
  isPending?: boolean;
  onAction: (action: BulkMinerAction) => void;
  onClear: () => void;
}

const bulkActions: { action: BulkMinerAction; icon: typeof RotateCcw; label: string }[] = [
  { action: "restart", icon: RotateCcw, label: "Restart" },
  { action: "reboot", icon: Power, label: "Reboot" },
  { action: "start", icon: Play, label: "Start" },
  { action: "stop", icon: Square, label: "Stop" },
];

export function BulkActionToolbar({ count, isPending = false, onAction, onClear }: BulkActionToolbarProps) {
  if (count === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
      <span className="text-xs font-mono font-semibold text-primary">{count} selected</span>
      <div className="mx-1 h-4 w-px bg-border" />
      {bulkActions.map(({ action, icon: Icon, label }) => (
        <Button
          key={action}
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 font-mono text-[11px]"
          disabled={isPending}
          onClick={() => onAction(action)}
        >
          <Icon className="h-3 w-3" />
          {label}
        </Button>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="ml-auto h-8 gap-1 px-2 font-mono text-[11px]"
        disabled={isPending}
        onClick={onClear}
      >
        <X className="h-3 w-3" />
        Clear
      </Button>
    </div>
  );
}
