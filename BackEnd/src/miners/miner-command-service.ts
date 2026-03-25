import { MinerAuthService } from "./miner-auth-service.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { buildMinerLiveDataFromSnapshot, liveDataToSnapshotRaw, normalizePoolsForStorage } from "./miner-normalizer.js";
import { MinerReadService } from "./miner-read-service.js";
import { MinerRepository } from "./miner-repository.js";
import { MinerEntity, MinerLiveData } from "./types.js";

const START_RECOVERY_WAIT_MS = 5_000;

export class MinerCommandService {
  constructor(
    private readonly repository: MinerRepository,
    private readonly httpClient: MinerHttpClient,
    private readonly authService: MinerAuthService,
    private readonly readService: MinerReadService
  ) {}

  private async getMinerOrThrow(minerId: number): Promise<MinerEntity> {
    const miner = await this.repository.getMinerById(minerId);
    if (!miner) {
      throw new Error(`Miner ${minerId} was not found.`);
    }
    return miner;
  }

  private async postWriteCommand(
    miner: MinerEntity,
    path: string,
    body?: unknown,
    authorizationMode: "raw" | "bearer" = "raw"
  ): Promise<unknown> {
    const token = await this.authService.getFreshToken(miner);
    return this.httpClient.post<unknown>(
      miner.apiBaseUrl,
      path,
      body,
      token,
      () => this.authService.retryWithFreshToken(miner),
      authorizationMode
    );
  }

  private async logCompletedCommand(
    minerId: number,
    commandType: string,
    body: unknown,
    response: unknown,
    createdBy?: string | null
  ): Promise<void> {
    await this.repository.logCommand({
      minerId,
      commandType,
      request: body ?? null,
      response,
      status: "completed",
      createdBy,
    });
  }

  private async logFailedCommand(
    minerId: number,
    commandType: string,
    body: unknown,
    error: unknown,
    createdBy?: string | null
  ): Promise<void> {
    await this.repository.logCommand({
      minerId,
      commandType,
      request: body ?? null,
      status: "failed",
      errorText: error instanceof Error ? error.message : "Unknown command failure.",
      createdBy,
    });
  }

  private async buildFallbackLiveData(miner: MinerEntity): Promise<MinerLiveData> {
    try {
      const [latestMiner, snapshot, pools] = await Promise.all([
        this.repository.getMinerById(miner.id),
        this.repository.getLatestSnapshot(miner.id),
        this.repository.listPools(miner.id),
      ]);

      return buildMinerLiveDataFromSnapshot(latestMiner ?? miner, snapshot, pools);
    } catch {
      return buildMinerLiveDataFromSnapshot(miner, null, []);
    }
  }

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

  private async resolveLiveData(minerId: number, miner: MinerEntity): Promise<MinerLiveData> {
    try {
      const refreshed = await this.readService.readMiner(miner);
      await this.persistRefreshedState(minerId, refreshed.liveData);
      return refreshed.liveData;
    } catch (error) {
      const refreshMessage =
        error instanceof Error ? error.message : "Miner command completed, but refreshing miner state failed.";

      // Do not convert a successful miner write into a failed command because the telemetry readback was malformed.
      await this.repository.updateMiner(minerId, { lastError: refreshMessage }).catch(() => null);

      return this.buildFallbackLiveData(miner);
    }
  }

  private async readCurrentLiveData(minerId: number, miner: MinerEntity): Promise<MinerLiveData | null> {
    try {
      const refreshed = await this.readService.readMiner(miner);
      await this.persistRefreshedState(minerId, refreshed.liveData);
      return refreshed.liveData;
    } catch {
      return null;
    }
  }

  private async runCommand(
    minerId: number,
    commandType: string,
    path: string,
    body?: unknown,
    createdBy?: string | null,
    authorizationMode: "raw" | "bearer" = "raw"
  ): Promise<{ liveData: MinerLiveData; response: unknown }> {
    const miner = await this.getMinerOrThrow(minerId);

    let response: unknown;

    try {
      response = await this.postWriteCommand(miner, path, body, authorizationMode);
      await this.logCompletedCommand(minerId, commandType, body, response, createdBy);
    } catch (error) {
      await this.logFailedCommand(minerId, commandType, body, error, createdBy);
      throw error;
    }

    return {
      liveData: await this.resolveLiveData(minerId, miner),
      response,
    };
  }

  private async waitForStartRecoveryWindow(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, START_RECOVERY_WAIT_MS));
  }

  private async recoverStartCommand(minerId: number, miner: MinerEntity): Promise<{ liveData: MinerLiveData; response: unknown }> {
    const stopResponse = await this.postWriteCommand(miner, "/mining/stop");
    await this.waitForStartRecoveryWindow();
    const startResponse = await this.postWriteCommand(miner, "/mining/start");

    return {
      liveData: await this.resolveLiveData(minerId, miner),
      response: {
        recoveryMode: "stop-wait-start",
        waitMs: START_RECOVERY_WAIT_MS,
        stopResponse,
        startResponse,
      },
    };
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

  async startMining(minerId: number, createdBy?: string | null) {
    const miner = await this.getMinerOrThrow(minerId);

    try {
      const response = await this.postWriteCommand(miner, "/mining/start");
      await this.logCompletedCommand(minerId, "start", null, response, createdBy);

      return {
        liveData: await this.resolveLiveData(minerId, miner),
        response,
      };
    } catch (error) {
      const currentLiveData = await this.readCurrentLiveData(minerId, miner);
      if (currentLiveData?.minerState === "mining") {
        const response = {
          recoveryMode: "already-mining",
          initialError: error instanceof Error ? error.message : "Start command returned an unknown error.",
        };
        await this.logCompletedCommand(minerId, "start", null, response, createdBy);

        return {
          liveData: currentLiveData,
          response,
        };
      }

      try {
        const recovered = await this.recoverStartCommand(minerId, miner);
        const response = {
          recoveryMode: "start-fallback",
          initialError: error instanceof Error ? error.message : "Start command returned an unknown error.",
          recovery: recovered.response,
        };
        await this.logCompletedCommand(minerId, "start", null, response, createdBy);

        return {
          liveData: recovered.liveData,
          response,
        };
      } catch (recoveryError) {
        const initialMessage = error instanceof Error ? error.message : "Start command returned an unknown error.";
        const recoveryMessage =
          recoveryError instanceof Error ? recoveryError.message : "VNish recovery sequence failed.";
        const combinedError = new Error(`${initialMessage} Recovery stop/start sequence also failed: ${recoveryMessage}`);

        await this.logFailedCommand(minerId, "start", null, combinedError, createdBy);
        throw combinedError;
      }
    }
  }

  stopMining(minerId: number, createdBy?: string | null) {
    return this.runCommand(minerId, "stop", "/mining/stop", undefined, createdBy);
  }

  reboot(minerId: number, after = 3, createdBy?: string | null) {
    void after;
    return this.runCommand(minerId, "reboot", "/system/reboot", undefined, createdBy);
  }

  setPreset(minerId: number, preset: string, createdBy?: string | null) {
    return this.runCommand(
      minerId,
      "set-preset",
      "/settings",
      {
        miner: {
          overclock: {
            preset,
          },
        },
      },
      createdBy
    );
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
