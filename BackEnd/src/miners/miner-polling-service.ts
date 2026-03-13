import { liveDataToSnapshotRaw, normalizePoolsForStorage } from "./miner-normalizer.js";
import { MinerReadService } from "./miner-read-service.js";
import { MinerRepository } from "./miner-repository.js";

export class MinerPollingService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly failureCounts = new Map<number, number>();

  constructor(
    private readonly repository: MinerRepository,
    private readonly readService: MinerReadService,
    private readonly pollIntervalMs = 15_000
  ) {}

  start(): void {
    if (this.timer) return;

    const loop = async () => {
      try {
        await this.pollOnce();
      } finally {
        this.timer = setTimeout(loop, this.pollIntervalMs);
      }
    };

    this.timer = setTimeout(loop, 1_000);
  }

  stop(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private async markOfflineAfterFailure(minerId: number, errorMessage: string): Promise<void> {
    const nextFailureCount = (this.failureCounts.get(minerId) ?? 0) + 1;
    this.failureCounts.set(minerId, nextFailureCount);

    await this.repository.updateMiner(minerId, {
      lastError: errorMessage,
    });

    if (nextFailureCount < 2) {
      return;
    }

    const miner = await this.repository.getMinerById(minerId);
    await this.repository.saveSnapshot({
      minerId,
      online: false,
      minerState: "offline",
      presetName: miner?.currentPreset ?? null,
      presetPretty: null,
      presetStatus: null,
      totalRateThs: 0,
      boardTemps: [],
      hotspotTemps: [],
      fanPwm: null,
      fanRpm: [],
      powerWatts: 0,
      raw: {
        pollingError: errorMessage,
      },
    });
  }

  async pollOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const miners = await this.repository.listEnabledMiners();
      const results = await Promise.allSettled(
        miners.map(async (miner) => {
          const readResult = await this.readService.readMiner(miner);

          if (!readResult.httpOk && !readResult.cgminerOk) {
            throw new Error("Both VNish HTTP and CGMiner reads failed.");
          }

          this.failureCounts.set(miner.id, 0);

          await this.repository.saveSnapshot({
            minerId: miner.id,
            online: readResult.liveData.online,
            minerState: readResult.liveData.minerState,
            presetName: readResult.liveData.presetName,
            presetPretty: readResult.liveData.presetPretty,
            presetStatus: readResult.liveData.presetStatus,
            totalRateThs: readResult.liveData.totalRateThs,
            boardTemps: readResult.liveData.boardTemps,
            hotspotTemps: readResult.liveData.hotspotTemps,
            fanPwm: readResult.liveData.fanPwm,
            fanRpm: readResult.liveData.fanRpm,
            powerWatts: readResult.liveData.powerWatts,
            raw: liveDataToSnapshotRaw(readResult.liveData),
          });

          await this.repository.replacePools(miner.id, normalizePoolsForStorage(readResult.cgminerPools));
          await this.repository.updateMiner(miner.id, {
            lastSeenAt: readResult.liveData.lastSeenAt ?? new Date().toISOString(),
            lastError: null,
            currentPreset: readResult.liveData.presetName,
          });
        })
      );

      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        if (result.status === "fulfilled") continue;
        const miner = miners[index];
        const message = result.reason instanceof Error ? result.reason.message : "Unknown polling error.";
        await this.markOfflineAfterFailure(miner.id, message);
      }
    } finally {
      this.running = false;
    }
  }
}
