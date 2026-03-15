import type { PoolConnection } from "mysql2/promise";
import pool from "../db.js";
import { minerSchemaStatements } from "./miner-schema.js";
import {
  MinerCommandEntity,
  MinerCommandLogInput,
  MinerCommandRecord,
  MinerEntity,
  MinerPersistInput,
  MinerPoolEntity,
  MinerPoolPersistInput,
  MinerPoolRecord,
  MinerSnapshotEntity,
  MinerSnapshotPersistInput,
  MinerSnapshotRecord,
  MinerRecord,
  MinerUpdateInput,
} from "./types.js";
import { mapCommandRecord, mapMinerRecord, mapPoolRecord, mapSnapshotRecord, toMysqlDateTime } from "./miner-utils.js";

export class MinerRepository {
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.ensureSchema().catch((error) => {
        this.initPromise = null;
        throw error;
      });
    }
    await this.initPromise;
  }

  private async ensureSchema(): Promise<void> {
    const conn = await pool.getConnection();
    try {
      for (const statement of minerSchemaStatements) {
        await conn.query(statement);
      }
    } finally {
      conn.release();
    }
  }

  private async withConnection<T>(handler: (conn: PoolConnection) => Promise<T>): Promise<T> {
    await this.init();
    const conn = await pool.getConnection();
    try {
      return await handler(conn);
    } finally {
      conn.release();
    }
  }

  async listMiners(): Promise<MinerEntity[]> {
    await this.init();
    const [rows] = await pool.query<MinerRecord[]>(
      `
        SELECT *
        FROM miners
        ORDER BY name ASC, id ASC
      `
    );
    return rows.map(mapMinerRecord);
  }

  async listEnabledMiners(): Promise<MinerEntity[]> {
    await this.init();
    const [rows] = await pool.query<MinerRecord[]>(
      `
        SELECT *
        FROM miners
        WHERE is_enabled = 1
        ORDER BY name ASC, id ASC
      `
    );
    return rows.map(mapMinerRecord);
  }

  async getMinerById(minerId: number): Promise<MinerEntity | null> {
    await this.init();
    const [rows] = await pool.query<MinerRecord[]>(
      `
        SELECT *
        FROM miners
        WHERE id = ?
        LIMIT 1
      `,
      [minerId]
    );
    const row = rows[0];
    return row ? mapMinerRecord(row) : null;
  }

  async getMinerByIp(ip: string): Promise<MinerEntity | null> {
    await this.init();
    const [rows] = await pool.query<MinerRecord[]>(
      `
        SELECT *
        FROM miners
        WHERE ip = ?
        LIMIT 1
      `,
      [ip.trim()]
    );
    const row = rows[0];
    return row ? mapMinerRecord(row) : null;
  }

  async createMiner(input: MinerPersistInput): Promise<MinerEntity> {
    return this.withConnection(async (conn) => {
      const [result] = await conn.query(
        `
          INSERT INTO miners (
            name,
            ip,
            api_base_url,
            password_enc,
            model,
            firmware,
            current_preset,
            is_enabled,
            verification_status,
            last_seen_at,
            last_error,
            capabilities_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.name,
          input.ip,
          input.apiBaseUrl,
          input.passwordEnc,
          input.model ?? null,
          input.firmware ?? null,
          input.currentPreset ?? null,
          input.isEnabled ?? true,
          input.verificationStatus,
          toMysqlDateTime(input.lastSeenAt),
          input.lastError ?? null,
          input.capabilities ? JSON.stringify(input.capabilities) : null,
        ]
      );

      const insertId = Number((result as { insertId?: number }).insertId ?? 0);
      const miner = await this.getMinerById(insertId);
      if (!miner) {
        throw new Error("Failed to load created miner.");
      }
      return miner;
    });
  }

  async updateMiner(minerId: number, patch: MinerUpdateInput & Partial<MinerPersistInput>): Promise<MinerEntity | null> {
    return this.withConnection(async (conn) => {
      const updates: string[] = [];
      const values: unknown[] = [];

      const push = (field: string, value: unknown) => {
        updates.push(`${field} = ?`);
        values.push(value);
      };

      if (typeof patch.name === "string") push("name", patch.name);
      if (typeof patch.ip === "string") push("ip", patch.ip);
      if (typeof patch.apiBaseUrl === "string") push("api_base_url", patch.apiBaseUrl);
      if (typeof patch.passwordEnc === "string") push("password_enc", patch.passwordEnc);
      if ("model" in patch) push("model", patch.model ?? null);
      if ("firmware" in patch) push("firmware", patch.firmware ?? null);
      if ("currentPreset" in patch) push("current_preset", patch.currentPreset ?? null);
      if (typeof patch.isEnabled === "boolean") push("is_enabled", patch.isEnabled);
      if (typeof patch.verificationStatus === "string") push("verification_status", patch.verificationStatus);
      if ("lastSeenAt" in patch) push("last_seen_at", toMysqlDateTime(patch.lastSeenAt));
      if ("lastError" in patch) push("last_error", patch.lastError ?? null);
      if ("capabilities" in patch) push("capabilities_json", patch.capabilities ? JSON.stringify(patch.capabilities) : null);

      if (updates.length === 0) {
        return this.getMinerById(minerId);
      }

      values.push(minerId);
      await conn.query(
        `
          UPDATE miners
          SET ${updates.join(", ")}
          WHERE id = ?
        `,
        values
      );

      return this.getMinerById(minerId);
    });
  }

  async setMinerEnabled(minerId: number, enabled: boolean): Promise<MinerEntity | null> {
    return this.updateMiner(minerId, { isEnabled: enabled });
  }

  async saveSnapshot(input: MinerSnapshotPersistInput): Promise<MinerSnapshotEntity> {
    return this.withConnection(async (conn) => {
      const [result] = await conn.query(
        `
          INSERT INTO miner_status_snapshots (
            miner_id,
            online,
            miner_state,
            preset_name,
            preset_pretty,
            preset_status,
            total_rate_ths,
            board_temp_1,
            board_temp_2,
            board_temp_3,
            hotspot_temp_1,
            hotspot_temp_2,
            hotspot_temp_3,
            fan_pwm,
            fan_rpm_1,
            fan_rpm_2,
            fan_rpm_3,
            fan_rpm_4,
            power_watts,
            raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.minerId,
          input.online,
          input.minerState,
          input.presetName,
          input.presetPretty,
          input.presetStatus,
          input.totalRateThs,
          input.boardTemps[0] ?? null,
          input.boardTemps[1] ?? null,
          input.boardTemps[2] ?? null,
          input.hotspotTemps[0] ?? null,
          input.hotspotTemps[1] ?? null,
          input.hotspotTemps[2] ?? null,
          input.fanPwm,
          input.fanRpm[0] ?? null,
          input.fanRpm[1] ?? null,
          input.fanRpm[2] ?? null,
          input.fanRpm[3] ?? null,
          input.powerWatts,
          JSON.stringify(input.raw ?? null),
        ]
      );

      const insertId = Number((result as { insertId?: number }).insertId ?? 0);
      const snapshot = await this.getSnapshotById(insertId);
      if (!snapshot) {
        throw new Error("Failed to load created snapshot.");
      }
      return snapshot;
    });
  }

  async getSnapshotById(snapshotId: number): Promise<MinerSnapshotEntity | null> {
    await this.init();
    const [rows] = await pool.query<MinerSnapshotRecord[]>(
      `
        SELECT *
        FROM miner_status_snapshots
        WHERE id = ?
        LIMIT 1
      `,
      [snapshotId]
    );
    const row = rows[0];
    return row ? mapSnapshotRecord(row) : null;
  }

  async getLatestSnapshot(minerId: number): Promise<MinerSnapshotEntity | null> {
    await this.init();
    const [rows] = await pool.query<MinerSnapshotRecord[]>(
      `
        SELECT snapshot.*
        FROM miner_status_snapshots snapshot
        INNER JOIN (
          SELECT MAX(id) AS id
          FROM miner_status_snapshots
          WHERE miner_id = ?
        ) latest ON latest.id = snapshot.id
      `,
      [minerId]
    );
    const row = rows[0];
    return row ? mapSnapshotRecord(row) : null;
  }

  async listLatestSnapshots(): Promise<MinerSnapshotEntity[]> {
    await this.init();
    const [rows] = await pool.query<MinerSnapshotRecord[]>(
      `
        SELECT snapshot.*
        FROM miner_status_snapshots snapshot
        INNER JOIN (
          SELECT miner_id, MAX(id) AS latest_id
          FROM miner_status_snapshots
          GROUP BY miner_id
        ) latest ON latest.latest_id = snapshot.id
        ORDER BY snapshot.miner_id ASC
      `
    );
    return rows.map(mapSnapshotRecord);
  }

  async listHistory(minerId: number, limit = 100): Promise<MinerSnapshotEntity[]> {
    await this.init();
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 100;
    const [rows] = await pool.query<MinerSnapshotRecord[]>(
      `
        SELECT *
        FROM miner_status_snapshots
        WHERE miner_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [minerId, safeLimit]
    );
    return rows.map(mapSnapshotRecord);
  }

  async listHistorySince(minerId: number, sinceIso: string): Promise<MinerSnapshotEntity[]> {
    await this.init();
    const [rows] = await pool.query<MinerSnapshotRecord[]>(
      `
        SELECT *
        FROM miner_status_snapshots
        WHERE miner_id = ?
          AND created_at >= ?
        ORDER BY created_at ASC, id ASC
      `,
      [minerId, toMysqlDateTime(sinceIso)]
    );
    return rows.map(mapSnapshotRecord);
  }

  async replacePools(minerId: number, pools: MinerPoolPersistInput[]): Promise<MinerPoolEntity[]> {
    return this.withConnection(async (conn) => {
      await conn.query(`DELETE FROM miner_pools WHERE miner_id = ?`, [minerId]);

      for (const poolInput of pools) {
        await conn.query(
          `
            INSERT INTO miner_pools (
              miner_id,
              pool_index,
              url,
              username,
              status,
              is_active
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            minerId,
            poolInput.poolIndex,
            poolInput.url,
            poolInput.username,
            poolInput.status,
            poolInput.isActive,
          ]
        );
      }

      const [rows] = await conn.query<MinerPoolRecord[]>(
        `
          SELECT *
          FROM miner_pools
          WHERE miner_id = ?
          ORDER BY pool_index ASC
        `,
        [minerId]
      );
      return rows.map(mapPoolRecord);
    });
  }

  async listPools(minerId: number): Promise<MinerPoolEntity[]> {
    await this.init();
    const [rows] = await pool.query<MinerPoolRecord[]>(
      `
        SELECT *
        FROM miner_pools
        WHERE miner_id = ?
        ORDER BY pool_index ASC
      `,
      [minerId]
    );
    return rows.map(mapPoolRecord);
  }

  async logCommand(input: MinerCommandLogInput): Promise<MinerCommandEntity> {
    return this.withConnection(async (conn) => {
      const [result] = await conn.query(
        `
          INSERT INTO miner_commands (
            miner_id,
            command_type,
            request_json,
            response_json,
            status,
            error_text,
            created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.minerId,
          input.commandType,
          input.request ? JSON.stringify(input.request) : null,
          input.response ? JSON.stringify(input.response) : null,
          input.status,
          input.errorText ?? null,
          input.createdBy ?? null,
        ]
      );

      const insertId = Number((result as { insertId?: number }).insertId ?? 0);
      const [rows] = await conn.query<MinerCommandRecord[]>(
        `
          SELECT *
          FROM miner_commands
          WHERE id = ?
          LIMIT 1
        `,
        [insertId]
      );
      const row = rows[0];
      if (!row) {
        throw new Error("Failed to load created command log.");
      }
      return mapCommandRecord(row);
    });
  }

  async listCommands(minerId: number, limit = 50): Promise<MinerCommandEntity[]> {
    await this.init();
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const [rows] = await pool.query<MinerCommandRecord[]>(
      `
        SELECT *
        FROM miner_commands
        WHERE miner_id = ?
        ORDER BY id DESC
        LIMIT ?
      `,
      [minerId, safeLimit]
    );
    return rows.map(mapCommandRecord);
  }
}
