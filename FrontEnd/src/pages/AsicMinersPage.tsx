import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { backendApi } from "@/lib/api";
import { useFleetHistory, useFleetLive, useFleetOverview, useMinerDetails, useMinerHistory, useMiners } from "@/hooks/useTradingData";
import { BulkActionToolbar } from "@/components/miners/BulkActionToolbar";
import { FleetOverviewCards } from "@/components/miners/FleetOverviewCards";
import { FleetHistoryCharts } from "@/components/miners/FleetHistoryCharts";
import { MinerTable } from "@/components/miners/MinerTable";
import { MinerDetailPanel } from "@/components/miners/MinerDetailPanel";
import { AddMinerDialog } from "@/components/miners/AddMinerDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import type { FleetHistoryScope, MinerEntity, MinerLiveData, MinerVerificationResult } from "@/types/api";

type MinerAction = "restart" | "reboot" | "start" | "stop" | "pause" | "resume";
type BulkMinerAction = Extract<MinerAction, "restart" | "reboot" | "start" | "stop">;

const EMPTY_MINERS: MinerEntity[] = [];
const EMPTY_FLEET_LIVE: MinerLiveData[] = [];

export function AsicMinersPage() {
  const queryClient = useQueryClient();
  const [selectedMinerId, setSelectedMinerId] = useState<number | undefined>();
  const [selectedMinerIds, setSelectedMinerIds] = useState<number[]>([]);
  const [draftVerification, setDraftVerification] = useState<MinerVerificationResult | null>(null);
  const [historyScope, setHistoryScope] = useState<FleetHistoryScope>("hour");

  const { data: overviewData, isPending: loadingOverview, error: overviewError } = useFleetOverview();
  const { data: historyData, isPending: loadingHistory, error: historyError } = useFleetHistory(historyScope);
  const { data: fleetData, isPending: loadingFleet, error: fleetError } = useFleetLive();
  const { data: minersData, isPending: loadingMiners, error: minersError } = useMiners();
  const { data: selectedMinerDetails } = useMinerDetails(selectedMinerId);
  const { data: selectedMinerHistory } = useMinerHistory(selectedMinerId, 120);

  const invalidateMinerQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["fleet-overview"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-history"] }),
      queryClient.invalidateQueries({ queryKey: ["fleet-live"] }),
      queryClient.invalidateQueries({ queryKey: ["miners-list"] }),
      queryClient.invalidateQueries({ queryKey: ["miner-details"] }),
      queryClient.invalidateQueries({ queryKey: ["miner-history"] }),
    ]);
  };

  const executeMinerAction = async (minerId: number, action: MinerAction) => {
    switch (action) {
      case "restart":
        return backendApi.restartMiner(minerId);
      case "reboot":
        return backendApi.rebootMiner(minerId, 3);
      case "start":
        return backendApi.startMiner(minerId);
      case "stop":
        return backendApi.stopMiner(minerId);
      case "pause":
        return backendApi.pauseMiner(minerId);
      case "resume":
        return backendApi.resumeMiner(minerId);
    }
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
    mutationFn: (input: { minerId: number; action: MinerAction }) => executeMinerAction(input.minerId, input.action),
    onSuccess: async () => {
      toast.success("Miner command completed.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Miner command failed.");
    },
  });

  const bulkCommandMutation = useMutation({
    mutationFn: async (input: { minerIds: number[]; action: BulkMinerAction }) => {
      const results = await Promise.allSettled(input.minerIds.map((minerId) => executeMinerAction(minerId, input.action)));
      const failed = results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                minerId: input.minerIds[index],
                message: result.reason instanceof Error ? result.reason.message : "Unknown error",
              },
            ]
          : [],
      );

      return {
        action: input.action,
        total: input.minerIds.length,
        succeeded: input.minerIds.length - failed.length,
        failed,
      };
    },
    onSuccess: async (result) => {
      const actionLabel = result.action.charAt(0).toUpperCase() + result.action.slice(1);

      if (result.succeeded > 0) {
        toast.success(`${actionLabel} sent to ${result.succeeded} miner${result.succeeded === 1 ? "" : "s"}.`);
      }

      if (result.failed.length > 0) {
        toast.error(
          `${actionLabel} failed for ${result.failed.length} miner${result.failed.length === 1 ? "" : "s"}: ${result.failed
            .map(({ minerId }) => `#${minerId}`)
            .join(", ")}`,
        );
      }

      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Bulk miner command failed.");
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

  const presetMutation = useMutation({
    mutationFn: (input: { minerId: number; preset: string }) => backendApi.setMinerPreset(input.minerId, input.preset),
    onSuccess: async () => {
      toast.success("Preset applied.");
      await invalidateMinerQueries();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to apply preset.");
    },
  });

  const miners = minersData?.miners ?? EMPTY_MINERS;
  const fleetLive = fleetData?.miners ?? EMPTY_FLEET_LIVE;
  const overview = overviewData?.overview;
  const isOverviewLoading = loadingOverview && !overview;
  const isTableLoading = loadingMiners && miners.length === 0;
  const hasFleetTelemetry = fleetLive.length > 0;
  const isFleetRefreshing = loadingFleet && !hasFleetTelemetry;
  const allSelected = miners.length > 0 && selectedMinerIds.length === miners.length;
  const someSelected = selectedMinerIds.length > 0 && !allSelected;
  const errorMessages = [fleetError, overviewError, minersError, historyError]
    .map((error) => (error instanceof Error ? error.message : null))
    .filter((message, index, messages): message is string => Boolean(message) && messages.indexOf(message) === index);

  useEffect(() => {
    const validMinerIds = new Set(miners.map((miner) => miner.id));

    setSelectedMinerIds((current) => current.filter((minerId) => validMinerIds.has(minerId)));

    if (selectedMinerId !== undefined && !validMinerIds.has(selectedMinerId)) {
      setSelectedMinerId(undefined);
    }
  }, [miners, selectedMinerId]);

  const handleToggleMiner = (minerId: number, checked: boolean) => {
    setSelectedMinerIds((current) => {
      if (checked) {
        return current.includes(minerId) ? current : [...current, minerId];
      }

      return current.filter((value) => value !== minerId);
    });
  };

  const handleToggleAllMiners = (checked: boolean) => {
    setSelectedMinerIds(checked ? miners.map((miner) => miner.id) : []);
  };

  const handleBulkAction = (action: BulkMinerAction) => {
    if (selectedMinerIds.length === 0 || bulkCommandMutation.isPending) {
      return;
    }

    const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
    const confirmed = window.confirm(`${actionLabel} ${selectedMinerIds.length} selected miner${selectedMinerIds.length === 1 ? "" : "s"}?`);

    if (!confirmed) {
      return;
    }

    bulkCommandMutation.mutate({ minerIds: selectedMinerIds, action });
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-lg md:text-xl font-mono font-semibold text-foreground">VNish Fleet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual miner onboarding, backend verification, live telemetry, command execution, and persisted fleet state.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 font-mono text-sm" onClick={() => invalidateMinerQueries()}>
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

      <FleetOverviewCards overview={overview} isLoading={isOverviewLoading} />

      {errorMessages.length > 0 ? (
        <div className="rounded-lg border border-negative/40 bg-negative/10 p-4 text-sm text-negative animate-fade-up">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4" />
            <div>{errorMessages.join(" ")}</div>
          </div>
        </div>
      ) : null}

      <FleetHistoryCharts
        history={historyData?.history ?? []}
        scope={historyScope}
        onScopeChange={setHistoryScope}
        isLoading={loadingHistory}
      />

      <div className="rounded-lg border border-border bg-card p-4 animate-fade-up">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Fleet Dashboard</div>
            {isTableLoading ? (
              <Skeleton className="mt-2 h-5 w-32" />
            ) : (
              <div className="mt-1 text-sm font-mono text-foreground">
                {miners.length} miners | {hasFleetTelemetry ? `${fleetLive.filter((miner) => miner.online).length} online` : "Live status pending"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <BulkActionToolbar
              count={selectedMinerIds.length}
              isPending={bulkCommandMutation.isPending}
              onAction={handleBulkAction}
              onClear={() => setSelectedMinerIds([])}
            />
            {isFleetRefreshing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        <MinerTable
          miners={miners}
          fleetLive={fleetLive}
          isLoading={isTableLoading}
          selectedMinerIds={selectedMinerIds}
          allSelected={allSelected}
          someSelected={someSelected}
          onOpen={setSelectedMinerId}
          onToggleMiner={handleToggleMiner}
          onToggleAll={handleToggleAllMiners}
          onVerify={(minerId) => verifyStoredMinerMutation.mutate(minerId)}
          onCommand={(minerId, action) => commandMutation.mutate({ minerId, action })}
        />
      </div>

      {selectedMinerDetails ? (
        <MinerDetailPanel
          details={selectedMinerDetails}
          history={selectedMinerHistory?.history ?? []}
          isCommandPending={commandMutation.isPending || switchPoolMutation.isPending}
          isPresetPending={presetMutation.isPending}
          onClose={() => setSelectedMinerId(undefined)}
          onCommand={(action) => commandMutation.mutate({ minerId: selectedMinerDetails.miner.id, action })}
          onSwitchPool={(poolId) => switchPoolMutation.mutate({ minerId: selectedMinerDetails.miner.id, poolId })}
          onApplyPreset={(preset) => presetMutation.mutate({ minerId: selectedMinerDetails.miner.id, preset })}
        />
      ) : null}
    </div>
  );
}
