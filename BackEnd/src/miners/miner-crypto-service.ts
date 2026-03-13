import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const KEY_LENGTH = 32;
const IV_LENGTH = 12;

export class MinerCryptoService {
  private readonly secretKey: Buffer;

  constructor(secret = process.env.MINER_SECRET_KEY ?? "local-dev-miner-secret") {
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
      throw new Error("Stored miner password is invalid.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.secretKey,
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }
}
