import { MinerAuthService } from "./miner-auth-service.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { liveDataToSnapshotRaw, normalizePoolsForStorage } from "./miner-normalizer.js";
import { MinerReadService } from "./miner-read-service.js";
import { MinerRepository } from "./miner-repository.js";
import { MinerLiveData } from "./types.js";

export class MinerCommandService {
  constructor(
    private readonly repository: MinerRepository,
    private readonly httpClient: MinerHttpClient,
    private readonly authService: MinerAuthService,
    private readonly readService: MinerReadService
  ) {}

  private async persistRefreshedState(minerId: number, liveData: MinerLiveData): Promise<void> {
    await this.repository.saveSnapshot({
      minerId,
      online: liveData.online,
      minerState: liveData.minerState,
      presetName: liveData.presetName,
      presetPretty: liveData.presetPretty,
      presetStatus: liveData.presetStatus,
      totalRateThs: liveData.totalRateThs,
      boardTemps: liveData.boardTemps,
      hotspotTemps: liveData.hotspotTemps,
      fanPwm: liveData.fanPwm,
      fanRpm: liveData.fanRpm,
      powerWatts: liveData.powerWatts,
      raw: liveDataToSnapshotRaw(liveData),
    });

    const rawPools =
      liveData.raw &&
      typeof liveData.raw === "object" &&
      "cgminerPools" in (liveData.raw as Record<string, unknown>)
        ? normalizePoolsForStorage((liveData.raw as { cgminerPools?: unknown[] }).cgminerPools ?? [])
        : [];

    await this.repository.replacePools(
      minerId,
      rawPools.length > 0
        ? rawPools
        : liveData.pools.map((pool, index) => ({
            poolIndex: index,
            url: pool.url,
            username: pool.user,
            status: pool.status,
            isActive: liveData.poolActiveIndex === index,
          }))
    );
  }

  private async runCommand(
    minerId: number,
    commandType: string,
    path: string,
    body?: unknown,
    createdBy?: string | null
  ): Promise<{ liveData: MinerLiveData; response: unknown }> {
    const miner = await this.repository.getMinerById(minerId);
    if (!miner) {
      throw new Error(`Miner ${minerId} was not found.`);
    }

    try {
      const token = await this.authService.getValidToken(miner);
      const response = await this.httpClient.post<unknown>(
        miner.apiBaseUrl,
        path,
        body,
        token,
        () => this.authService.retryWithFreshToken(miner)
      );

      await this.repository.logCommand({
        minerId,
        commandType,
        request: body ?? null,
        response,
        status: "completed",
        createdBy,
      });

      const refreshed = await this.readService.readMiner(miner);
      await this.persistRefreshedState(minerId, refreshed.liveData);

      return {
        liveData: refreshed.liveData,
        response,
      };
    } catch (error) {
      await this.repository.logCommand({
        minerId,
        commandType,
        request: body ?? null,
        status: "failed",
        errorText: error instanceof Error ? error.message : "Unknown command failure.",
        createdBy,
      });
      throw error;
    }
  }

  restartMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "restart", "/mining/restart", undefined, createdBy);
  }

  pauseMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "pause", "/mining/pause", undefined, createdBy);
  }

  resumeMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "resume", "/mining/resume", undefined, createdBy);
  }

  startMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "start", "/mining/start", undefined, createdBy);
  }

  stopMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "stop", "/mining/stop", undefined, createdBy);
  }

  reboot(minerId: number, after = 3, createdBy?: string | null) {
    return this.runCommand(minerId, "reboot", "/system/reboot", { after }, createdBy);
  }

  async switchPool(minerId: number, poolId: number, createdBy?: string | null) {
    const pools = await this.repository.listPools(minerId);
    const targetPool = pools.find((pool) => pool.id === poolId);
    if (!targetPool) {
      throw new Error(`Pool ${poolId} was not found for miner ${minerId}.`);
    }

    // TODO: confirm exact VNish switch-pool write schema from a live miner Swagger document if it differs.
    return this.runCommand(
      minerId,
      "switch-pool",
      "/mining/switch-pool",
      { poolId: targetPool.poolIndex },
      createdBy
    );
  }
}
