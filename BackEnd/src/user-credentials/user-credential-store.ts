import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import pool from "../db.js";
import type { NicehashCredentials } from "../types.js";
import type { StrategyUserScope } from "../strategy/strategy-user-scope.js";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const DEFAULT_SECRET = "local-dev-user-credentials-secret";

type CredentialProvider = "nicehash";

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
}

interface CredentialRow extends RowDataPacket {
  encrypted_payload: string;
}

export interface StoredCredentialLookup<T> {
  exists: boolean;
  value: T | null;
  error?: string;
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUserScope(scope?: StrategyUserScope): StrategyUserScope | undefined {
  if (!scope) return undefined;

  const userId =
    typeof scope.userId === "number" && Number.isInteger(scope.userId) && scope.userId > 0 ? scope.userId : undefined;
  const username = typeof scope.username === "string" ? normalizeUsername(scope.username) : undefined;

  if (!userId && !username) return undefined;
  return { userId, username };
}

class UserCredentialCryptoService {
  private readonly secretKey: Buffer;

  constructor(secret = process.env.USER_CREDENTIALS_SECRET ?? process.env.MINER_SECRET_KEY ?? DEFAULT_SECRET) {
    this.secretKey = createHash("sha256").update(secret).digest().subarray(0, KEY_LENGTH);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", this.secretKey, iv);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
  }

  decrypt(cipherText: string): string {
    const [ivHex, tagHex, encryptedHex] = cipherText.split(":");
    if (!ivHex || !tagHex || !encryptedHex) {
      throw new Error("Stored credentials are invalid.");
    }

    const decipher = createDecipheriv("aes-256-gcm", this.secretKey, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  encryptJson<T>(value: T): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(value: string): T {
    return JSON.parse(this.decrypt(value)) as T;
  }
}

export class UserCredentialStore {
  private initPromise: Promise<void> | null = null;
  private readonly cryptoService = new UserCredentialCryptoService();

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
      await conn.query(`
        CREATE TABLE IF NOT EXISTS agent_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL UNIQUE,
          email VARCHAR(255) NULL UNIQUE,
          password_hash VARCHAR(64) NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
      `);

      try {
        await conn.query(`
          ALTER TABLE agent_users
          ADD COLUMN password_hash VARCHAR(64) NULL AFTER email
        `);
      } catch (error) {
        const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
        if (code !== "ER_DUP_FIELDNAME") {
          throw error;
        }
      }

      await conn.query(`
        CREATE TABLE IF NOT EXISTS user_service_credentials (
          user_id INT NOT NULL,
          provider VARCHAR(50) NOT NULL,
          encrypted_payload TEXT NOT NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, provider),
          CONSTRAINT fk_user_service_credentials_user
            FOREIGN KEY (user_id) REFERENCES agent_users(id)
            ON DELETE CASCADE
        ) ENGINE=InnoDB
      `);
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

  private async resolveUserId(
    conn: PoolConnection,
    scope?: StrategyUserScope,
    options?: { createMissing: boolean }
  ): Promise<number | null> {
    const normalizedScope = normalizeUserScope(scope);
    if (!normalizedScope) return null;

    if (normalizedScope.userId) {
      const [rows] = await conn.query<UserRow[]>(
        `
          SELECT id, username
          FROM agent_users
          WHERE id = ?
          LIMIT 1
        `,
        [normalizedScope.userId]
      );
      return rows[0]?.id ?? null;
    }

    const username = normalizedScope.username;
    if (!username) return null;

    const [rows] = await conn.query<UserRow[]>(
      `
        SELECT id, username
        FROM agent_users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `,
      [username]
    );

    const existing = rows[0];
    if (existing) return existing.id;
    if (!options?.createMissing) return null;

    const email = `${username}@myapp.local`;
    await conn.query(
      `
        INSERT INTO agent_users (username, email)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE email = VALUES(email)
      `,
      [username, email]
    );

    const [createdRows] = await conn.query<UserRow[]>(
      `
        SELECT id, username
        FROM agent_users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
      `,
      [username]
    );

    return createdRows[0]?.id ?? null;
  }

  private async lookupCredential<T>(
    provider: CredentialProvider,
    scope?: StrategyUserScope
  ): Promise<StoredCredentialLookup<T>> {
    return this.withConnection(async (conn) => {
      const userId = await this.resolveUserId(conn, scope, { createMissing: false });
      if (!userId) {
        return { exists: false, value: null };
      }

      const [rows] = await conn.query<CredentialRow[]>(
        `
          SELECT encrypted_payload
          FROM user_service_credentials
          WHERE user_id = ? AND provider = ?
          LIMIT 1
        `,
        [userId, provider]
      );

      const row = rows[0];
      if (!row) {
        return { exists: false, value: null };
      }

      try {
        return {
          exists: true,
          value: this.cryptoService.decryptJson<T>(row.encrypted_payload),
        };
      } catch (error) {
        return {
          exists: true,
          value: null,
          error: error instanceof Error ? error.message : "Stored credentials could not be decrypted.",
        };
      }
    });
  }

  private async upsertCredential<T>(provider: CredentialProvider, value: T, scope?: StrategyUserScope): Promise<void> {
    await this.withConnection(async (conn) => {
      const userId = await this.resolveUserId(conn, scope, { createMissing: true });
      if (!userId) {
        throw new Error("A signed-in user is required to store credentials.");
      }

      await conn.query(
        `
          INSERT INTO user_service_credentials (user_id, provider, encrypted_payload)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            encrypted_payload = VALUES(encrypted_payload),
            updated_at = CURRENT_TIMESTAMP
        `,
        [userId, provider, this.cryptoService.encryptJson(value)]
      );
    });
  }

  private async deleteCredential(provider: CredentialProvider, scope?: StrategyUserScope): Promise<void> {
    await this.withConnection(async (conn) => {
      const userId = await this.resolveUserId(conn, scope, { createMissing: false });
      if (!userId) return;

      await conn.query(
        `
          DELETE FROM user_service_credentials
          WHERE user_id = ? AND provider = ?
        `,
        [userId, provider]
      );
    });
  }

  getNicehashCredentials(scope?: StrategyUserScope): Promise<StoredCredentialLookup<NicehashCredentials>> {
    return this.lookupCredential<NicehashCredentials>("nicehash", scope);
  }

  storeNicehashCredentials(credentials: NicehashCredentials, scope?: StrategyUserScope): Promise<void> {
    return this.upsertCredential("nicehash", credentials, scope);
  }

  deleteNicehashCredentials(scope?: StrategyUserScope): Promise<void> {
    return this.deleteCredential("nicehash", scope);
  }
}

export const userCredentialStore = new UserCredentialStore();
