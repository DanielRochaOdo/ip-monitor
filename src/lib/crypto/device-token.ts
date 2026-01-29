import crypto from "crypto";
import { getRequiredEnv } from "@/lib/env";

const TOKEN_KEY_ENV = "DEVICE_TOKEN_ENCRYPTION_KEY";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = getRequiredEnv(TOKEN_KEY_ENV);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${TOKEN_KEY_ENV} must be base64 for 32 bytes (256-bit)`);
  }
  cachedKey = key;
  return key;
}

export function encryptDeviceToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptDeviceToken(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("invalid encrypted token format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return plain.toString("utf8");
}
