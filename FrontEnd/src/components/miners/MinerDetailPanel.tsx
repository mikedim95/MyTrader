import { useEffect, useState } from "react";
import { Loader2, RotateCcw, Gauge, Square, Play, Pause, Power, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MinerStatusBadge } from "./MinerStatusBadge";
import type { MinerDetailResponse, MinerHistoryPoint } from "@/types/api";

interface MinerDetailPanelProps {
  details: MinerDetailResponse;
  history: MinerHistoryPoint[];
  isCommandPending: boolean;
  isPresetPending: boolean;
  onClose: () => void;
  onCommand: (action: "restart" | "reboot" | "start" | "stop" | "pause" | "resume") => void;
  onSwitchPool: (poolId: number) => void;
  onApplyPreset: (preset: string) => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}

export function MinerDetailPanel({
  details,
  history,
  isCommandPending,
  isPresetPending,
  onClose,
  onCommand,
  onSwitchPool,
  onApplyPreset,
}: MinerDetailPanelProps) {
  const { miner, liveData, presets, commands } = details;
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  useEffect(() => {
    setSelectedPreset(liveData.presetName ?? presets[0]?.name ?? "");
  }, [liveData.presetName, presets]);

  const canApplyPreset = selectedPreset.length > 0 && selectedPreset !== (liveData.presetName ?? "") && !isPresetPending;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm animate-overlay-fade" onClick={onClose}>
      <div
        className="h-full w-full max-w-4xl overflow-y-auto border-l border-border bg-card animate-slide-in-right"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-card/95 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-mono text-lg font-semibold text-foreground">{miner.name}</h2>
                <MinerStatusBadge online={liveData.online} minerState={liveData.minerState} />
              </div>
              <div className="mt-1 text-xs font-mono text-muted-foreground">
                {miner.model ?? "Unknown model"} | {miner.ip} | {miner.firmware ?? "Unknown firmware"}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <div className="space-y-6 p-4 stagger-children">
          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Overview</div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="State" value={liveData.minerState ?? "--"} />
              <Metric label="Preset" value={liveData.presetPretty ?? liveData.presetName ?? "--"} />
              <Metric label="Rate" value={typeof liveData.totalRateThs === "number" ? `${liveData.totalRateThs.toFixed(2)} TH/s` : "--"} />
              <Metric label="Fan Duty" value={typeof liveData.fanPwm === "number" ? `${liveData.fanPwm}%` : "--"} />
              <Metric label="Power" value={typeof liveData.powerWatts === "number" ? `${liveData.powerWatts} W` : "--"} />
              <Metric label="Last Seen" value={liveData.lastSeenAt ? new Date(liveData.lastSeenAt).toLocaleString() : "--"} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Thermal</div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
              <div className="rounded-md border border-border bg-secondary/20 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Board Temps</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveData.boardTemps.length > 0
                    ? liveData.boardTemps.map((temp, index) => (
                        <span key={`board-${index}`} className="rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                          Board {index + 1}: {temp}C
                        </span>
                      ))
                    : <span className="font-mono text-sm text-muted-foreground">No board temp data.</span>}
                </div>
              </div>

              <div className="rounded-md border border-border bg-secondary/20 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Hotspot Temps</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {liveData.hotspotTemps.length > 0
                    ? liveData.hotspotTemps.map((temp, index) => (
                        <span key={`hotspot-${index}`} className="rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                          Hotspot {index + 1}: {temp}C
                        </span>
                      ))
                    : <span className="font-mono text-sm text-muted-foreground">No hotspot data.</span>}
                </div>
              </div>

              <div className="rounded-md border border-border bg-secondary/20 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Chip Temps</div>
                <div className="mt-3 space-y-2 font-mono text-sm text-foreground">
                  {liveData.chipTempStrings.length > 0
                    ? liveData.chipTempStrings.map((entry) => <div key={entry}>{entry}</div>)
                    : <div className="text-muted-foreground">No chip temp strings.</div>}
                </div>
              </div>

              <div className="rounded-md border border-border bg-secondary/20 p-4">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">PCB Temps</div>
                <div className="mt-3 space-y-2 font-mono text-sm text-foreground">
                  {liveData.pcbTempStrings.length > 0
                    ? liveData.pcbTempStrings.map((entry) => <div key={entry}>{entry}</div>)
                    : <div className="text-muted-foreground">No PCB temp strings.</div>}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Chains</div>
            <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <div key={index} className="rounded-md border border-border bg-secondary/20 p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Chain {index + 1}</div>
                  <div className="mt-2 font-mono text-sm text-foreground">
                    Rate: {typeof liveData.chainRates[index] === "number" ? `${liveData.chainRates[index].toFixed(2)} TH/s` : "--"}
                  </div>
                  <div className="mt-1 font-mono text-sm text-muted-foreground">
                    State: {liveData.chainStates[index] ?? "--"}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Pools</div>
            <div className="space-y-3">
              {liveData.pools.map((pool, index) => (
                <div key={`${pool.id}-${index}`} className="flex flex-col gap-3 rounded-md border border-border bg-secondary/20 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-foreground break-all">{pool.url}</div>
                    <div className="mt-1 font-mono text-xs text-muted-foreground">
                      Worker: {pool.user} | Status: {pool.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {liveData.poolActiveIndex === index ? (
                      <span className="rounded-full bg-positive/10 px-3 py-1 text-[11px] font-mono uppercase tracking-wider text-positive">
                        Active
                      </span>
                    ) : null}
                    <Button
                      variant="outline"
                      className="font-mono text-sm"
                      disabled={isCommandPending || liveData.poolActiveIndex === index}
                      onClick={() => onSwitchPool(pool.id)}
                    >
                      Switch Pool
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">Commands</div>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
              {[
                { label: "Restart Mining", action: "restart" as const, icon: RotateCcw },
                { label: "Start", action: "start" as const, icon: Play },
                { label: "Stop", action: "stop" as const, icon: Square },
                { label: "Pause", action: "pause" as const, icon: Pause },
                { label: "Resume", action: "resume" as const, icon: Play },
                { label: "Reboot", action: "reboot" as const, icon: Power },
              ].map((actionItem) => (
                <Button
                  key={actionItem.label}
                  variant="outline"
                  className="h-auto justify-start gap-3 py-4 font-mono text-sm"
                  disabled={isCommandPending}
                  onClick={() => onCommand(actionItem.action)}
                >
                  {isCommandPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <actionItem.icon className="h-4 w-4" />}
                  {actionItem.label}
                </Button>
              ))}
            </div>

            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" />
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Autotune Presets</div>
              </div>

              {presets.length > 0 ? (
                <div className="grid gap-3 grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px]">
                  <Select value={selectedPreset} onValueChange={setSelectedPreset} disabled={isPresetPending}>
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue placeholder="Choose preset" />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset) => (
                        <SelectItem key={preset.name} value={preset.name} className="font-mono text-sm">
                          {preset.pretty ?? preset.name}
                          {preset.status ? ` | ${preset.status}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    className="font-mono text-sm"
                    disabled={!canApplyPreset}
                    onClick={() => onApplyPreset(selectedPreset)}
                  >
                    {isPresetPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Apply Preset
                  </Button>
                </div>
              ) : (
                <div className="font-mono text-sm text-muted-foreground">No presets discovered from VNish for this miner yet.</div>
              )}

              {presets.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {presets.map((preset) => {
                    const isCurrent = preset.name === liveData.presetName;
                    return (
                      <span
                        key={preset.name}
                        className={`rounded-md px-3 py-1.5 text-[11px] font-mono ${
                          isCurrent
                            ? "bg-primary/15 text-primary border border-primary/30"
                            : "bg-background text-muted-foreground border border-border"
                        }`}
                      >
                        {preset.pretty ?? preset.name}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="rounded-md border border-border bg-secondary/20 p-4">
              <div className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Recent Commands</div>
              <div className="space-y-2">
                {commands.slice(0, 8).map((command) => (
                  <div key={command.id} className="rounded-md bg-background px-3 py-2 font-mono text-sm text-foreground">
                    {command.commandType} | {command.status} | {new Date(command.createdAt).toLocaleString()}
                    {command.errorText ? ` | ${command.errorText}` : ""}
                  </div>
                ))}
                {commands.length === 0 ? <div className="font-mono text-sm text-muted-foreground">No commands logged yet.</div> : null}
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground">History</div>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[700px]">
                <thead className="bg-secondary/30">
                  <tr>
                    {["Time", "Online", "Rate", "Power", "Board Max", "Hotspot Max", "Fan PWM"].map((label) => (
                      <th key={label} className="px-3 py-2 text-left text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.slice(0, 20).map((point) => (
                    <tr key={point.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-sm text-foreground">{new Date(point.createdAt).toLocaleString()}</td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">{point.online ? "yes" : "no"}</td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">
                        {typeof point.totalRateThs === "number" ? `${point.totalRateThs.toFixed(2)} TH/s` : "--"}
                      </td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">{typeof point.powerWatts === "number" ? `${point.powerWatts} W` : "--"}</td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">
                        {point.boardTemps.length > 0 ? `${Math.max(...point.boardTemps)}C` : "--"}
                      </td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">
                        {point.hotspotTemps.length > 0 ? `${Math.max(...point.hotspotTemps)}C` : "--"}
                      </td>
                      <td className="px-3 py-2 font-mono text-sm text-foreground">{typeof point.fanPwm === "number" ? `${point.fanPwm}%` : "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
