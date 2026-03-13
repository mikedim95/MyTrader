import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function MinerTable({ miners, fleetLive, onOpen, onVerify, onCommand }: MinerTableProps) {
  const liveMap = getLiveMap(fleetLive);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/30">
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Miner</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">IP</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Status</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Rate</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Max Board</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Hotspot</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider text-right">Fan</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Preset</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Pool</TableHead>
            <TableHead className="font-mono text-[10px] uppercase tracking-wider">Last Seen</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>

        <TableBody>
          {miners.map((miner) => {
            const live = liveMap.get(miner.id);
            const maxBoard = live?.boardTemps.length ? Math.max(...live.boardTemps) : null;
            const maxHotspot = live?.hotspotTemps.length ? Math.max(...live.hotspotTemps) : null;
            const activePool = live?.pools.find((pool, index) => live.poolActiveIndex === index) ?? live?.pools[0];

            return (
              <TableRow key={miner.id} className="cursor-pointer" onClick={() => onOpen(miner.id)}>
                <TableCell>
                  <div className="font-mono text-sm font-semibold text-foreground">{miner.name}</div>
                  <div className="mt-1 text-[11px] font-mono text-muted-foreground">
                    {miner.model ?? "Unknown model"}
                    {miner.firmware ? ` | ${miner.firmware}` : ""}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{miner.ip}</TableCell>
                <TableCell>
                  <MinerStatusBadge online={live?.online ?? false} minerState={live?.minerState} />
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-foreground">
                  {typeof live?.totalRateThs === "number" ? `${live.totalRateThs.toFixed(2)} TH/s` : "--"}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-foreground">{maxBoard !== null ? `${maxBoard}C` : "--"}</TableCell>
                <TableCell className="text-right font-mono text-xs text-foreground">{maxHotspot !== null ? `${maxHotspot}C` : "--"}</TableCell>
                <TableCell className="text-right font-mono text-xs text-foreground">
                  {typeof live?.fanPwm === "number" ? `${live.fanPwm}%` : "--"}
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground">{live?.presetPretty ?? live?.presetName ?? "--"}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{activePool?.url ?? "--"}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{formatLastSeen(live?.lastSeenAt ?? miner.lastSeenAt)}</TableCell>
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
