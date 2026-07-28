/**
 * Symmetric encryption for secrets at rest (enhancement #2).
 *
 * Uses AES-256-GCM with a key derived (scrypt) from `APP_SECRET_KEY`. Encrypted
 * values are self-describing: they carry a `enc:v1:` prefix so we can tell an
 * encrypted value from legacy plaintext and migrate transparently.
 *
 * If `APP_SECRET_KEY` is unset, a deterministic *insecure* development key is
 * used so local-dev data round-trips across restarts — a one-time warning is
 * logged. Production deployments MUST set `APP_SECRET_KEY`.
 */

import crypto from "crypto";

const ALGO = "aes-256-gcm";
export const ENC_PREFIX = "enc:v1:";
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16;
const KEY_SALT = "grafana-ui-testing/secret-key/v1";

let cachedKey: Buffer | null = null;
let warnedInsecure = false;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.APP_SECRET_KEY || process.env.SECRET_KEY;
  if (!secret) {
    if (!warnedInsecure) {
      warnedInsecure = true;
      console.warn(
        "[crypto] APP_SECRET_KEY is not set — using an INSECURE development key. " +
          "Set APP_SECRET_KEY to a strong random value in any non-local environment."
      );
    }
    cachedKey = crypto.scryptSync("insecure-dev-key", KEY_SALT, 32);
    return cachedKey;
  }
  cachedKey = crypto.scryptSync(secret, KEY_SALT, 32);
  return cachedKey;
}

/** True when a value is one of our encrypted tokens. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/** Encrypt a UTF-8 string into a self-describing `enc:v1:` token. */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new TypeError("encryptSecret expects a string");
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a token produced by {@link encryptSecret}. Throws if tampered/invalid. */
export function decryptSecret(token: string): string {
  if (!isEncrypted(token)) {
    throw new Error("decryptSecret: value is not an encrypted token");
  }
  const raw = Buffer.from(token.slice(ENC_PREFIX.length), "base64");
  if (raw.length < IV_LEN + TAG_LEN) {
    throw new Error("decryptSecret: ciphertext is too short / corrupt");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Encrypt a value for storage, tolerating empty/nullish input (returns null so
 * callers can store SQL NULL). Never double-encrypts an already-encrypted value.
 */
export function encryptOptional(
  value: string | null | undefined
): string | null {
  if (value == null || value === "") return null;
  if (isEncrypted(value)) return value;
  return encryptSecret(value);
}

/**
 * Decrypt a stored value, transparently passing through legacy plaintext (values
 * written before encryption was introduced). Nullish input returns null.
 */
export function maybeDecrypt(
  value: string | null | undefined
): string | null {
  if (value == null || value === "") return null;
  return isEncrypted(value) ? decryptSecret(value) : value;
}

/** Test-only: reset the cached key (e.g. after changing APP_SECRET_KEY). */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
  warnedInsecure = false;
}
