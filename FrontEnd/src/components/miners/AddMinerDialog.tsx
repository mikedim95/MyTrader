import { useEffect, useState } from "react";
import { Loader2, PlusCircle, ShieldCheck, ShieldX } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MinerVerificationResult } from "@/types/api";

interface AddMinerDialogProps {
  isVerifying: boolean;
  isSaving: boolean;
  verification: MinerVerificationResult | null;
  onVerify: (input: { name: string; ip: string; password: string }) => void;
  onSave: (input: { name: string; ip: string; password: string }) => void;
}

export function AddMinerDialog({ isVerifying, isSaving, verification, onVerify, onSave }: AddMinerDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setIp("");
      setPassword("");
    }
  }, [open]);

  const input = {
    name: name.trim(),
    ip: ip.trim(),
    password: password.trim(),
  };

  const canSubmit = input.name.length > 0 && input.ip.length > 0 && input.password.length > 0;
  const canSave = canSubmit && verification?.reachable && verification?.unlockOk;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 font-mono text-xs">
          <PlusCircle className="h-4 w-4" />
          Add Miner
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl border-border bg-card">
        <DialogHeader>
          <DialogTitle className="font-mono text-base">Add VNish Miner</DialogTitle>
          <DialogDescription>
            Enter the miner IP and password, verify reachability, then save it into the fleet database.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Name</label>
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Rack-A-01" className="mt-2 font-mono" />
            </div>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">IP Address</label>
              <Input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="192.168.1.101" className="mt-2 font-mono" />
            </div>

            <div>
              <label className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="VNish password"
                className="mt-2 font-mono"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-4">
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Verification Result</div>
            {!verification ? (
              <div className="mt-4 text-sm text-muted-foreground">Run Verify to test VNish HTTP, CGMiner, unlock, and capability discovery.</div>
            ) : (
              <div className="mt-4 space-y-3 text-sm">
                {[
                  ["VNish HTTP reachable", verification.httpOk],
                  ["CGMiner socket reachable", verification.cgminerOk],
                  ["Password valid", verification.unlockOk],
                ].map(([label, ok]) => (
                  <div key={String(label)} className="flex items-center justify-between rounded-md border border-border bg-background/60 px-3 py-2">
                    <span className="font-mono text-xs text-foreground">{label}</span>
                    {ok ? <ShieldCheck className="h-4 w-4 text-positive" /> : <ShieldX className="h-4 w-4 text-negative" />}
                  </div>
                ))}

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md border border-border bg-background/60 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Preset</div>
                    <div className="mt-1 font-mono text-xs text-foreground">{verification.currentPreset ?? "--"}</div>
                  </div>
                  <div className="rounded-md border border-border bg-background/60 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">State</div>
                    <div className="mt-1 font-mono text-xs text-foreground">{verification.minerState ?? "--"}</div>
                  </div>
                  <div className="rounded-md border border-border bg-background/60 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Model</div>
                    <div className="mt-1 font-mono text-xs text-foreground">{verification.model ?? "--"}</div>
                  </div>
                  <div className="rounded-md border border-border bg-background/60 p-3">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Firmware</div>
                    <div className="mt-1 font-mono text-xs text-foreground">{verification.firmware ?? "--"}</div>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background/60 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Capabilities</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-mono text-foreground">
                    {Object.entries(verification.capabilities).map(([key, value]) => (
                      <div key={key} className={value ? "text-positive" : "text-muted-foreground"}>
                        {key}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border border-border bg-background/60 p-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                    Available Presets {verification.presets.length > 0 ? `(${verification.presets.length})` : ""}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {verification.presets.length > 0 ? (
                      verification.presets.map((preset) => (
                        <span key={preset.name} className="rounded-md border border-border bg-card px-3 py-1 text-[10px] font-mono text-foreground">
                          {preset.pretty ?? preset.name}
                        </span>
                      ))
                    ) : (
                      <div className="text-xs font-mono text-muted-foreground">No presets returned by VNish during verification.</div>
                    )}
                  </div>
                </div>

                {verification.error ? (
                  <div className="rounded-md border border-negative/40 bg-negative/10 px-3 py-2 text-xs font-mono text-negative">
                    {verification.error}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            disabled={!canSubmit || isVerifying}
            onClick={() => onVerify(input)}
          >
            {isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Verify
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={!canSave || isSaving}
            onClick={() => {
              onSave(input);
              setOpen(false);
            }}
          >
            {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
