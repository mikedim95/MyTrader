import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MinerStatusBadge } from "./MinerStatusBadge";
import type { MinerEntity, MinerLiveData } from "@/types/api";

interface MinerTableProps {
  miners: MinerEntity[];
  fleetLive: MinerLiveData[];
  isLoading?: boolean;
  onOpen: (minerId: number) => void;
  onVerify: (minerId: number) => void;
  onCommand: (minerId: number, action: "restart" | "reboot" | "start" | "stop" | "pause" | "resume") => void;
}

function formatLastSeen(value: string | null): string {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

function getLiveMap(fleetLive: MinerLiveData[]): Map<number, MinerLiveData> {
  return new Map(fleetLive.map((miner) => [miner.minerId, miner]));
}

export function MinerTable({ miners, fleetLive, isLoading = false, onOpen, onVerify, onCommand }: MinerTableProps) {
  const liveMap = getLiveMap(fleetLive);

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow className="bg-secondary/30">
            <TableHead className="font-mono text-[11px] uppercase tracking-wider">Miner</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider">IP</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider text-right">Rate</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider text-right">Max Board</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider text-right hidden md:table-cell">Hotspot</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider text-right hidden md:table-cell">Fan</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider hidden lg:table-cell">Preset</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider hidden lg:table-cell">Pool</TableHead>
            <TableHead className="font-mono text-[11px] uppercase tracking-wider hidden xl:table-cell">Last Seen</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading
            ? Array.from({ length: 6 }).map((_, rowIndex) => (
                <TableRow key={`miner-skeleton-${rowIndex}`}>
                  {Array.from({ length: 11 }).map((__, cellIndex) => (
                    <TableCell key={`miner-skeleton-${rowIndex}-${cellIndex}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : miners.map((miner) => {
            const live = liveMap.get(miner.id);
            const maxBoard = live?.boardTemps.length ? Math.max(...live.boardTemps) : null;
            const maxHotspot = live?.hotspotTemps.length ? Math.max(...live.hotspotTemps) : null;
            const activePool = live?.pools.find((pool, index) => live.poolActiveIndex === index) ?? live?.pools[0];

            return (
              <TableRow key={miner.id} className="cursor-pointer transition-colors duration-200 hover:bg-secondary/40" onClick={() => onOpen(miner.id)}>
                <TableCell>
                  <div className="font-mono text-sm font-semibold text-foreground">{miner.name}</div>
                  <div className="mt-1 text-xs font-mono text-muted-foreground">
                    {miner.model ?? "Unknown model"}
                    {miner.firmware ? ` | ${miner.firmware}` : ""}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">{miner.ip}</TableCell>
                <TableCell>
                  <MinerStatusBadge online={live?.online ?? false} minerState={live?.minerState} />
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground">
                  {typeof live?.totalRateThs === "number" ? `${live.totalRateThs.toFixed(2)} TH/s` : "--"}
                </TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground">{maxBoard !== null ? `${maxBoard}C` : "--"}</TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground hidden md:table-cell">{maxHotspot !== null ? `${maxHotspot}C` : "--"}</TableCell>
                <TableCell className="text-right font-mono text-sm text-foreground hidden md:table-cell">
                  {typeof live?.fanPwm === "number" ? `${live.fanPwm}%` : "--"}
                </TableCell>
                <TableCell className="font-mono text-sm text-foreground hidden lg:table-cell">{live?.presetPretty ?? live?.presetName ?? "--"}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground hidden lg:table-cell max-w-[200px] truncate">{activePool?.url ?? "--"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground hidden xl:table-cell">{formatLastSeen(live?.lastSeenAt ?? miner.lastSeenAt)}</TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onOpen(miner.id)}>Open details</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onVerify(miner.id)}>Verify</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "restart")}>Restart mining</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "reboot")}>Reboot</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "stop")}>Stop</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "start")}>Start</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "pause")}>Pause</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onCommand(miner.id, "resume")}>Resume</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
