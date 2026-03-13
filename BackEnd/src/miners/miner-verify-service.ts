import { MinerCgminerClient } from "./miner-cgminer-client.js";
import { MinerHttpClient } from "./miner-http-client.js";
import { buildApiBaseUrl, cleanString, parseJsonObject } from "./miner-utils.js";
import { MinerEntity, MinerVerificationResult, MinerVerifyDraftInput } from "./types.js";

interface VerificationProbeResult {
  apiBaseUrl: string;
  result: MinerVerificationResult;
}

export class MinerVerifyService {
  constructor(
    private readonly httpClient: MinerHttpClient,
    private readonly cgminerClient: MinerCgminerClient
  ) {}

  private extractUnlockToken(payload: unknown): string | null {
    const record = parseJsonObject(payload);
    if (!record) return null;
    return (
      cleanString(record.token) ??
      cleanString(record.access_token) ??
      cleanString(record.bearer) ??
      cleanString(record.jwt)
    );
  }

  private async probe(input: MinerVerifyDraftInput): Promise<VerificationProbeResult> {
    const apiBaseUrl = buildApiBaseUrl(input.ip);
    let httpOk = false;
    let cgminerOk = false;
    let unlockOk = false;
    let error: string | null = null;
    let statusPayload: Record<string, unknown> | null = null;
    let perfSummaryPayload: Record<string, unknown> | null = null;
    let presets: unknown[] = [];
    let summary: Record<string, unknown> | null = null;
    let stats: Record<string, unknown> | null = null;
    let unlockToken: string | null = null;

    try {
      statusPayload = await this.httpClient.get<Record<string, unknown>>(apiBaseUrl, "/status");
      httpOk = true;
    } catch (statusError) {
      error = statusError instanceof Error ? statusError.message : "Failed to reach VNish status endpoint.";
    }

    try {
      summary = await this.cgminerClient.summary(input.ip);
      stats = await this.cgminerClient.stats(input.ip);
      cgminerOk = true;
    } catch (cgminerError) {
      if (!error) {
        error = cgminerError instanceof Error ? cgminerError.message : "Failed to reach CGMiner socket.";
      }
    }

    try {
      const unlockPayload = await this.httpClient.post<unknown>(apiBaseUrl, "/unlock", { pw: input.password });
      unlockToken = this.extractUnlockToken(unlockPayload);
      unlockOk = Boolean(unlockToken);
    } catch (unlockError) {
      if (!error) {
        error = unlockError instanceof Error ? unlockError.message : "Failed to unlock miner.";
      }
    }

    try {
      perfSummaryPayload = await this.httpClient.get<Record<string, unknown>>(apiBaseUrl, "/perf-summary");
      httpOk = true;
    } catch (perfError) {
      if (!error) {
        error = perfError instanceof Error ? perfError.message : "Failed to read perf-summary.";
      }
    }

    if (unlockOk) {
      try {
        presets = await this.httpClient.get<unknown[]>(apiBaseUrl, "/autotune/presets", unlockToken ?? undefined);
      } catch {
        presets = [];
      }
    }

    const capabilities = {
      canReadHttp: httpOk,
      canReadCgminer: cgminerOk,
      canUnlock: unlockOk,
      canRestart: unlockOk,
      canReboot: unlockOk,
      canSwitchPool: unlockOk,
      canReadPresets: unlockOk && presets.length > 0,
    };

    return {
      apiBaseUrl,
      result: {
        reachable: httpOk || cgminerOk,
        httpOk,
        cgminerOk,
        unlockOk,
        minerState:
          cleanString(statusPayload?.state) ??
          cleanString(statusPayload?.miner_state) ??
          cleanString(statusPayload?.status) ??
          null,
        currentPreset:
          cleanString(perfSummaryPayload?.preset_name) ??
          cleanString(perfSummaryPayload?.presetName) ??
          null,
        model: cleanString(statusPayload?.model) ?? cleanString(statusPayload?.miner) ?? null,
        firmware: cleanString(statusPayload?.firmware) ?? cleanString(statusPayload?.fw_name) ?? null,
        capabilities,
        presets: presets
          .map((entry) => {
            const record = parseJsonObject(entry);
            if (!record) return null;
            const name = cleanString(record.name) ?? cleanString(record.preset_name);
            if (!name) return null;
            return {
              name,
              pretty: cleanString(record.pretty) ?? cleanString(record.preset_pretty),
              status: cleanString(record.status) ?? cleanString(record.preset_status),
            };
          })
          .filter(
            (
              preset
            ): preset is {
              name: string;
              pretty: string | null;
              status: string | null;
            } => preset !== null
          ),
        error,
      },
    };
  }

  async verifyDraft(input: MinerVerifyDraftInput): Promise<VerificationProbeResult> {
    return this.probe(input);
  }

  async verifyStoredMiner(miner: MinerEntity, plainPassword: string): Promise<VerificationProbeResult> {
    return this.probe({
      name: miner.name,
      ip: miner.ip,
      password: plainPassword,
    });
  }
}
