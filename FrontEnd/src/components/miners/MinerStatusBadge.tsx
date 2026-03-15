import { cn } from "@/lib/utils";

interface MinerStatusBadgeProps {
  online: boolean;
  minerState?: string | null;
}

export function MinerStatusBadge({ online, minerState }: MinerStatusBadgeProps) {
  const normalized = (minerState ?? "").trim().toLowerCase();

  const tone = !online
    ? {
        label: "Offline",
        bg: "bg-muted",
        text: "text-muted-foreground",
        dot: "bg-muted-foreground",
      }
    : normalized.includes("pause")
      ? {
          label: "Paused",
          bg: "bg-[hsl(45_100%_50%/0.12)]",
          text: "text-[hsl(45,100%,50%)]",
          dot: "bg-[hsl(45,100%,50%)]",
        }
      : normalized.includes("stop")
        ? {
            label: "Stopped",
            bg: "bg-negative/10",
            text: "text-negative",
            dot: "bg-negative",
          }
        : normalized.includes("reboot")
          ? {
              label: "Rebooting",
              bg: "bg-primary/10",
              text: "text-primary",
              dot: "bg-primary",
            }
          : {
              label: minerState ?? "Online",
              bg: "bg-positive/10",
              text: "text-positive",
              dot: "bg-positive",
            };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-wider transition-all duration-300",
        tone.bg,
        tone.text
      )}
    >
      <span className={cn(
        "h-1.5 w-1.5 rounded-full transition-shadow duration-500",
        tone.dot,
        online && "animate-pulse shadow-[0_0_6px_currentColor]"
      )} />
      {tone.label}
    </span>
  );
}
