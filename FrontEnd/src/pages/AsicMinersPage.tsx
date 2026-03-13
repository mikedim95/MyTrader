import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useFleetLive, useFleetOverview, useMinerDetails, useMinerHistory, useMiners } from "@/hooks/useTradingData";
import { FleetOverviewCards } from "@/components/miners/FleetOverviewCards";
import { MinerTable } from "@/components/miners/MinerTable";
import { MinerDetailPanel } from "@/components/miners/MinerDetailPanel";
import { AddMinerDialog } from "@/components/miners/AddMinerDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { MinerVerificationResult } from "@/types/api";

type MinerAction = "restart" | "reboot" | "start" | "stop" | "pause" | "resume";

export function AsicMinersPage() {
  const queryClient = useQueryClient();
  const [selectedMinerId, setSelectedMinerId] = useState<number | undefined>();
  const [draftVerification, setDraftVerification] = useState<MinerVerificationResult | null>(null);

  const { data: overviewData, isPending: loadingOverview } = useFleetOverview();
  const { data: fleetData, isPending: loadingFleet, error: fleetError } = useFleetLive();
  const { data: minersData, isPending: loadingMiners } = useMiners();
  const { data: selectedMinerDetails } = useMinerDetails(selectedMinerId);
  const { data: selectedMinerHistory } = useMinerHistory(selectedMinerId, 120);

  const invalidateMinerQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["fleet-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] }),
      queryClient.invalidateQueries({ queryKey: ["miners-list"] }),
      queryClient.invalidateQueries({ queryKey: ["miner-details", selectedMinerId] }),
      queryClient.invalidateQueries({ queryKey: ["miner-history", selectedMinerId, 120] }),
    ]);
  };

  const verifyDraftMutation = useMutation({
    mutationFn: backendApi.verifyMinerDraft,
    onSuccess: (result) => {
      setDraftVerification(result.verification);
      toast.success("Miner verification completed.");
    },
    onError: (error) => {
      setDraftVerification(null);
      toast.error(error instanceof Error ? error.message : "Miner verification failed.");
    },
  });

  const createMinerMutation = useMutation({
    mutationFn: backendApi.createMiner,
    onSuccess: async () => {
      setDraftVerification(null);
      toast.success("Miner saved to fleet.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save miner.");
    },
  });

  const verifyStoredMinerMutation = useMutation({
    mutationFn: backendApi.verifyMiner,
    onSuccess: async () => {
      toast.success("Miner re-verified.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to re-verify miner.");
    },
  });

  const commandMutation = useMutation({
    mutationFn: async (input: { minerId: number; action: MinerAction }) => {
      switch (input.action) {
        case "restart":
          return backendApi.restartMiner(input.minerId);
        case "reboot":
          return backendApi.rebootMiner(input.minerId, 3);
        case "start":
          return backendApi.startMiner(input.minerId);
        case "stop":
          return backendApi.stopMiner(input.minerId);
        case "pause":
          return backendApi.pauseMiner(input.minerId);
        case "resume":
          return backendApi.resumeMiner(input.minerId);
      }
    },
    onSuccess: async () => {
      toast.success("Miner command completed.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Miner command failed.");
    },
  });

  const switchPoolMutation = useMutation({
    mutationFn: (input: { minerId: number; poolId: number }) => backendApi.switchMinerPool(input.minerId, input.poolId),
    onSuccess: async () => {
      toast.success("Pool switch completed.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to switch pool.");
    },
  });

  const isLoading = loadingOverview || loadingFleet || loadingMiners;
  const miners = minersData?.miners ?? [];
  const fleetLive = fleetData?.miners ?? [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg font-mono font-semibold text-foreground">VNish Fleet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual miner onboarding, backend verification, live telemetry, command execution, and persisted fleet state.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 font-mono text-xs" onClick={() => invalidateMinerQueries()}>
            <RefreshCcw className="h-4 w-4" />
            Refresh
          </Button>
          <AddMinerDialog
            isVerifying={verifyDraftMutation.isPending}
            isSaving={createMinerMutation.isPending}
            verification={draftVerification}
            onVerify={(input) => verifyDraftMutation.mutate(input)}
            onSave={(input) => createMinerMutation.mutate(input)}
          />
        </div>
      </div>

      <FleetOverviewCards overview={overviewData?.overview} />

      {fleetError ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 p-4 text-sm text-negative">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{fleetError instanceof Error ? fleetError.message : "Fleet data could not be loaded."}</div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Fleet Dashboard</div>
            <div className="mt-1 text-sm font-mono text-foreground">
              {miners.length} miners | {fleetLive.filter((miner) => miner.online).length} online
            </div>
          </div>
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>

        <MinerTable
          miners={miners}
          fleetLive={fleetLive}
          onOpen={setSelectedMinerId}
          onVerify={(minerId) => verifyStoredMinerMutation.mutate(minerId)}
          onCommand={(minerId, action) => commandMutation.mutate({ minerId, action })}
        />
      </div>

      {selectedMinerDetails ? (
        <MinerDetailPanel
          details={selectedMinerDetails}
          history={selectedMinerHistory?.history ?? []}
          isCommandPending={commandMutation.isPending || switchPoolMutation.isPending}
          onClose={() => setSelectedMinerId(undefined)}
          onCommand={(action) => commandMutation.mutate({ minerId: selectedMinerDetails.miner.id, action })}
          onSwitchPool={(poolId) => switchPoolMutation.mutate({ minerId: selectedMinerDetails.miner.id, poolId })}
        />
      ) : null}
    </div>
  );
}
