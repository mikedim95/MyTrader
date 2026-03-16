import express, { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { MinerCommandService } from "./miner-command-service.js";
import { MinerCryptoService } from "./miner-crypto-service.js";
import { buildMinerLiveDataFromSnapshot, liveDataToSnapshotRaw, normalizePoolsForStorage, normalizePresetOptions } from "./miner-normalizer.js";
import { MinerPollingService } from "./miner-polling-service.js";
import { MinerReadService } from "./miner-read-service.js";
import { MinerRepository } from "./miner-repository.js";
import { MinerVerifyService } from "./miner-verify-service.js";
import { buildApiBaseUrl } from "./miner-utils.js";

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const addMinerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  ip: z.string().trim().min(3).max(45),
  password: z.string().min(1),
});

const updateMinerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ip: z.string().trim().min(3).max(45).optional(),
  password: z.string().min(1).optional(),
  isEnabled: z.boolean().optional(),
});

const switchPoolSchema = z.object({
  poolId: z.coerce.number().int().positive(),
});

const rebootSchema = z.object({
  after: z.coerce.number().int().min(0).max(60).default(3),
});

const setPowerLimitSchema = z.object({
  preset: z.string().trim().min(1).max(120),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(120),
});

const fleetHistoryQuerySchema = z.object({
  scope: z.enum(["hour", "day", "week", "month"]).default("hour"),
});

const verifyDraftSchema = addMinerSchema;

const FLEET_HISTORY_SCOPE_CONFIG = {
  hour: { rangeMs: 60 * 60 * 1000, bucketMs: 60 * 1000 },
  day: { rangeMs: 24 * 60 * 60 * 1000, bucketMs: 15 * 60 * 1000 },
  week: { rangeMs: 7 * 24 * 60 * 60 * 1000, bucketMs: 60 * 60 * 1000 },
  month: { rangeMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 6 * 60 * 60 * 1000 },
} as const;

function isValidTemperature(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 150;
}

function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): express.Handler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseOrRespond<T>(schema: z.ZodSchema<T>, input: unknown, res: Response): T | null {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }

  res.status(400).json({
    message: "Invalid request payload.",
    errors: parsed.error.issues,
  });
  return null;
}

function getCreatedBy(req: Request): string | null {
  const candidate = req.header("x-user") ?? req.header("x-username");
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim().toLowerCase() : null;
}

interface MinerApiDeps {
  repository: MinerRepository;
  verifyService: MinerVerifyService;
  readService: MinerReadService;
  commandService: MinerCommandService;
  cryptoService: MinerCryptoService;
  pollingService: MinerPollingService;
}

export function createMinerRouter(deps: MinerApiDeps): Router {
  const router = Router();

  const getMinerOrRespond = async (minerId: number, res: Response) => {
    const miner = await deps.repository.getMinerById(minerId);
    if (!miner) {
      res.status(404).json({ message: `Miner ${minerId} not found.` });
      return null;
    }
    return miner;
  };

  const proxyEnvelope = (minerId: number, data: unknown, latencyMs: number) => ({
    ok: true,
    minerId: String(minerId),
    source: "vnish",
    data,
    fetchedAt: new Date().toISOString(),
    latencyMs,
  });

  const proxyRead = async (
    res: Response,
    minerId: number,
    path: string,
    options?: { authenticated?: boolean }
  ) => {
    const miner = await getMinerOrRespond(minerId, res);
    if (!miner) return;

    const startedAt = Date.now();
    try {
      const data = await deps.readService.readPayload(miner, path, options);
      res.json(proxyEnvelope(miner.id, data, Date.now() - startedAt));
    } catch (error) {
      res.status(502).json({
        ok: false,
        error: "upstream_error",
        message: error instanceof Error ? error.message : `Failed to read ${path} from miner.`,
      });
    }
  };

  const persistLiveRead = async (minerId: number) => {
    const miner = await deps.repository.getMinerById(minerId);
    if (!miner) {
      throw new Error(`Miner ${minerId} was not found.`);
    }

    const readResult = await deps.readService.readMiner(miner);
    await deps.repository.saveSnapshot({
      minerId,
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
    await deps.repository.replacePools(minerId, normalizePoolsForStorage(readResult.cgminerPools));
    return readResult.liveData;
  };

  router.post(
    "/miners/verify-draft",
    asyncHandler(async (req, res) => {
      const body = parseOrRespond(verifyDraftSchema, req.body, res);
      if (!body) return;

      const verification = await deps.verifyService.verifyDraft(body);
      res.json({
        apiBaseUrl: verification.apiBaseUrl,
        verification: verification.result,
      });
    })
  );

  router.post(
    "/miners",
    asyncHandler(async (req, res) => {
      const body = parseOrRespond(addMinerSchema, req.body, res);
      if (!body) return;

      const existing = await deps.repository.getMinerByIp(body.ip);
      if (existing) {
        res.status(409).json({ message: `A miner with IP ${body.ip} already exists.` });
        return;
      }

      const verification = await deps.verifyService.verifyDraft(body);
      if (!verification.result.reachable || !verification.result.unlockOk) {
        res.status(400).json({
          message: "Miner verification failed. Save is blocked until verify succeeds.",
          verification: verification.result,
        });
        return;
      }

      const miner = await deps.repository.createMiner({
        name: body.name,
        ip: body.ip,
        apiBaseUrl: verification.apiBaseUrl,
        passwordEnc: deps.cryptoService.encrypt(body.password),
        model: verification.result.model,
        firmware: verification.result.firmware,
        currentPreset: verification.result.currentPreset,
        verificationStatus: "verified",
        capabilities: verification.result.capabilities,
        lastSeenAt: new Date().toISOString(),
        lastError: verification.result.error,
        isEnabled: true,
      });

      const liveData = await persistLiveRead(miner.id).catch(() => null);

      res.status(201).json({
        miner,
        verification: verification.result,
        liveData,
      });
    })
  );

  router.get(
    "/miners",
    asyncHandler(async (_req, res) => {
      const miners = await deps.repository.listMiners();
      res.json({ miners });
    })
  );

  router.get(
    "/miners/:id",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const miner = await deps.repository.getMinerById(params.id);
      if (!miner) {
        res.status(404).json({ message: `Miner ${params.id} not found.` });
        return;
      }

      const snapshot = await deps.repository.getLatestSnapshot(miner.id);
      const pools = await deps.repository.listPools(miner.id);
      const commands = await deps.repository.listCommands(miner.id);
      const presets = normalizePresetOptions(
        await deps.readService.readPayload<unknown[]>(miner, "/autotune/presets", { authenticated: true }).catch(() => [])
      );

      res.json({
        miner,
        liveData: buildMinerLiveDataFromSnapshot(miner, snapshot, pools),
        pools,
        presets,
        commands,
      });
    })
  );

  router.patch(
    "/miners/:id",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      const body = parseOrRespond(updateMinerSchema, req.body, res);
      if (!params || !body) return;

      const miner = await deps.repository.getMinerById(params.id);
      if (!miner) {
        res.status(404).json({ message: `Miner ${params.id} not found.` });
        return;
      }

      const updated = await deps.repository.updateMiner(miner.id, {
        name: body.name,
        ip: body.ip,
        apiBaseUrl: body.ip ? buildApiBaseUrl(body.ip) : undefined,
        passwordEnc: body.password ? deps.cryptoService.encrypt(body.password) : undefined,
        isEnabled: body.isEnabled,
        verificationStatus: body.ip || body.password ? "pending" : undefined,
      });

      res.json({ miner: updated });
    })
  );

  router.post(
    "/miners/:id/verify",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const miner = await deps.repository.getMinerById(params.id);
      if (!miner) {
        res.status(404).json({ message: `Miner ${params.id} not found.` });
        return;
      }

      const password = deps.cryptoService.decrypt(miner.passwordEnc);
      const verification = await deps.verifyService.verifyStoredMiner(miner, password);

      await deps.repository.updateMiner(miner.id, {
        apiBaseUrl: verification.apiBaseUrl,
        model: verification.result.model,
        firmware: verification.result.firmware,
        currentPreset: verification.result.currentPreset,
        verificationStatus: verification.result.reachable && verification.result.unlockOk ? "verified" : "failed",
        capabilities: verification.result.capabilities,
        lastSeenAt: verification.result.reachable ? new Date().toISOString() : miner.lastSeenAt,
        lastError: verification.result.error,
      });

      res.json({ verification: verification.result });
    })
  );

  router.post(
    "/miners/:id/enable",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const miner = await deps.repository.setMinerEnabled(params.id, true);
      res.json({ miner });
    })
  );

  router.post(
    "/miners/:id/disable",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const miner = await deps.repository.setMinerEnabled(params.id, false);
      res.json({ miner });
    })
  );

  router.get(
    "/miners/:id/live",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const liveData = await persistLiveRead(params.id);
      res.json({ liveData });
    })
  );

  router.post(
    "/miners/:id/test-connection",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const miner = await getMinerOrRespond(params.id, res);
      if (!miner) return;

      const startedAt = Date.now();
      const verification = await deps.verifyService.verifyStoredMiner(miner, deps.cryptoService.decrypt(miner.passwordEnc));
      res.json({
        ok: verification.result.reachable,
        latencyMs: Date.now() - startedAt,
        details: verification.result,
      });
    })
  );

  router.get(
    "/miners/:id/status",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/status", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/info",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/info", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/summary",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/summary", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/perf-summary",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/perf-summary", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/chips",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/chips", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/layout",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/layout", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/settings",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      await proxyRead(res, params.id, "/settings", { authenticated: true });
    })
  );

  router.get(
    "/miners/:id/autotune-presets",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const miner = await getMinerOrRespond(params.id, res);
      if (!miner) return;

      const startedAt = Date.now();
      try {
        const presets = await deps.readService.readPayload<unknown[]>(miner, "/autotune/presets", { authenticated: true });
        res.json(proxyEnvelope(miner.id, normalizePresetOptions(presets), Date.now() - startedAt));
      } catch (error) {
        res.status(502).json({
          ok: false,
          error: "upstream_error",
          message: error instanceof Error ? error.message : "Failed to read autotune presets from miner.",
        });
      }
    })
  );

  router.post(
    "/miners/:id/power-limit",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      const body = parseOrRespond(setPowerLimitSchema, req.body, res);
      if (!params || !body) return;

      const result = await deps.commandService.setPreset(params.id, body.preset, getCreatedBy(req));
      res.json(result);
    })
  );

  router.get(
    "/miners/:id/history",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      const query = parseOrRespond(historyQuerySchema, req.query, res);
      if (!params || !query) return;

      const history = await deps.repository.listHistory(params.id, query.limit);
      res.json({
        history: history.map((snapshot) => ({
          id: snapshot.id,
          createdAt: snapshot.createdAt,
          online: snapshot.online,
          totalRateThs: snapshot.totalRateThs,
          powerWatts: snapshot.powerWatts,
          boardTemps: snapshot.boardTemps.filter(isValidTemperature),
          hotspotTemps: snapshot.hotspotTemps.filter(isValidTemperature),
          fanPwm: snapshot.fanPwm,
        })),
      });
    })
  );

  router.get(
    "/miners/:id/pools",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;

      const pools = await deps.repository.listPools(params.id);
      res.json({ pools });
    })
  );

  router.get(
    "/fleet/live",
    asyncHandler(async (_req, res) => {
      const miners = await deps.repository.listMiners();
      const snapshots = await deps.repository.listLatestSnapshots();
      const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.minerId, snapshot]));

      const fleet = await Promise.all(
        miners.map(async (miner) => {
          const pools = await deps.repository.listPools(miner.id);
          return buildMinerLiveDataFromSnapshot(miner, snapshotMap.get(miner.id) ?? null, pools);
        })
      );

      res.json({ miners: fleet });
    })
  );

  router.get(
    "/fleet/history",
    asyncHandler(async (req, res) => {
      const query = parseOrRespond(fleetHistoryQuerySchema, req.query, res);
      if (!query) return;

      const scope = query.scope ?? "hour";
      const scopeConfig = FLEET_HISTORY_SCOPE_CONFIG[scope];
      const now = Date.now();
      const sinceIso = new Date(now - scopeConfig.rangeMs).toISOString();
      const miners = await deps.repository.listMiners();
      const history = await Promise.all(
        miners.map(async (miner) => {
          const points = await deps.repository.listHistoryBucketsSince(
            miner.id,
            sinceIso,
            Math.max(60, Math.round(scopeConfig.bucketMs / 1000))
          );

          return {
            minerId: miner.id,
            minerName: miner.name,
            minerIp: miner.ip,
            points,
          };
        })
      );

      res.json({
        history: history.filter((series) => series.points.length > 0),
        generatedAt: new Date().toISOString(),
        scope,
      });
    })
  );

  router.get(
    "/fleet/overview",
    asyncHandler(async (_req, res) => {
      const miners = await deps.repository.listMiners();
      const snapshots = await deps.repository.listLatestSnapshots();
      const snapshotMap = new Map(snapshots.map((snapshot) => [snapshot.minerId, snapshot]));

      const fleet = await Promise.all(
        miners.map(async (miner) => {
          const pools = await deps.repository.listPools(miner.id);
          return buildMinerLiveDataFromSnapshot(miner, snapshotMap.get(miner.id) ?? null, pools);
        })
      );

      const onlineMiners = fleet.filter((miner) => miner.online).length;
      const totalRateThs = fleet.reduce((sum, miner) => sum + (miner.totalRateThs ?? 0), 0);
      const totalPowerWatts = fleet.reduce((sum, miner) => sum + (miner.powerWatts ?? 0), 0);
      const hottestBoardTemp = fleet.flatMap((miner) => miner.boardTemps).reduce<number | null>((max, value) => {
        if (!isValidTemperature(value)) return max;
        if (max === null) return value;
        return Math.max(max, value);
      }, null);
      const hottestHotspotTemp = fleet.flatMap((miner) => miner.hotspotTemps).reduce<number | null>((max, value) => {
        if (!isValidTemperature(value)) return max;
        if (max === null) return value;
        return Math.max(max, value);
      }, null);

      res.json({
        overview: {
          totalMiners: miners.length,
          onlineMiners,
          enabledMiners: miners.filter((miner) => miner.isEnabled).length,
          totalRateThs,
          totalPowerWatts,
          hottestBoardTemp,
          hottestHotspotTemp,
          generatedAt: new Date().toISOString(),
        },
      });
    })
  );

  router.post(
    "/miners/:id/restart",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const result = await deps.commandService.restartMining(params.id, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/reboot",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      const body = parseOrRespond(rebootSchema, req.body ?? {}, res);
      if (!params || !body) return;
      const result = await deps.commandService.reboot(params.id, body.after, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/start",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const result = await deps.commandService.startMining(params.id, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/stop",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const result = await deps.commandService.stopMining(params.id, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/pause",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const result = await deps.commandService.pauseMining(params.id, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/resume",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      if (!params) return;
      const result = await deps.commandService.resumeMining(params.id, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/miners/:id/switch-pool",
    asyncHandler(async (req, res) => {
      const params = parseOrRespond(idParamSchema, req.params, res);
      const body = parseOrRespond(switchPoolSchema, req.body, res);
      if (!params || !body) return;
      const result = await deps.commandService.switchPool(params.id, body.poolId, getCreatedBy(req));
      res.json(result);
    })
  );

  router.post(
    "/fleet/poll-now",
    asyncHandler(async (_req, res) => {
      await deps.pollingService.pollOnce();
      res.json({ success: true });
    })
  );

  return router;
}
