/**
 * Unit tests for secret-at-rest crypto (#2) and redaction helpers (#18).
 *
 * Techniques: round-trip equivalence, boundary values (empty / short / long),
 * idempotency, tamper detection (security), and legacy-plaintext migration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  encryptOptional,
  maybeDecrypt,
  ENC_PREFIX,
  _resetKeyCacheForTests,
} from "../../services/shared/crypto";
import {
  maskSecret,
  redactConfig,
  redactSecrets,
  REDACTION_PLACEHOLDER,
  SECRET_CONFIG_KEYS,
} from "../../services/shared/redact";

beforeEach(() => {
  process.env.APP_SECRET_KEY = "test-secret-key-for-unit-tests";
  _resetKeyCacheForTests();
});

describe("crypto: encrypt/decrypt round-trip", () => {
  it("round-trips a normal secret", () => {
    const token = encryptSecret("hunter2");
    expect(token.startsWith(ENC_PREFIX)).toBe(true);
    expect(decryptSecret(token)).toBe("hunter2");
  });

  it("round-trips an empty string", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
  });

  it("round-trips unicode and long values", () => {
    const secret = "pä$$🔒-" + "x".repeat(5000);
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("throws TypeError for non-string input", () => {
    // @ts-expect-error deliberate misuse
    expect(() => encryptSecret(123)).toThrow(TypeError);
  });
});

describe("crypto: isEncrypted", () => {
  it("recognizes our tokens", () => {
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
  });
  it("rejects plaintext and non-strings", () => {
    expect(isEncrypted("plain")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(42)).toBe(false);
  });
});

describe("crypto: decrypt tamper detection (security)", () => {
  it("throws when the auth tag / ciphertext is altered", () => {
    const token = encryptSecret("secret");
    const tampered = token.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("throws on a value that is not an encrypted token", () => {
    expect(() => decryptSecret("not-a-token")).toThrow();
  });

  it("throws on truncated ciphertext", () => {
    expect(() => decryptSecret(ENC_PREFIX + "AAAA")).toThrow(/too short|corrupt/);
  });

  it("cannot decrypt with a different key", () => {
    const token = encryptSecret("secret");
    process.env.APP_SECRET_KEY = "a-completely-different-key";
    _resetKeyCacheForTests();
    expect(() => decryptSecret(token)).toThrow();
  });
});

describe("crypto: encryptOptional / maybeDecrypt", () => {
  it("returns null for nullish/empty input", () => {
    expect(encryptOptional(null)).toBeNull();
    expect(encryptOptional(undefined)).toBeNull();
    expect(encryptOptional("")).toBeNull();
    expect(maybeDecrypt(null)).toBeNull();
    expect(maybeDecrypt("")).toBeNull();
  });

  it("never double-encrypts an already-encrypted value", () => {
    const once = encryptOptional("v")!;
    expect(encryptOptional(once)).toBe(once);
  });

  it("passes legacy plaintext through maybeDecrypt (migration)", () => {
    expect(maybeDecrypt("legacy-plaintext")).toBe("legacy-plaintext");
  });

  it("encryptOptional + maybeDecrypt round-trips", () => {
    expect(maybeDecrypt(encryptOptional("roundtrip"))).toBe("roundtrip");
  });
});

describe("redact: maskSecret", () => {
  it("returns empty string for empty/nullish", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret(null)).toBe("");
    expect(maskSecret(undefined)).toBe("");
  });

  it("fully masks short secrets (<= 6 chars, boundary)", () => {
    expect(maskSecret("123456")).toBe("••••");
  });

  it("reveals last 2 chars for longer secrets (boundary 7)", () => {
    expect(maskSecret("1234567")).toBe("••••67");
  });
});

describe("redact: redactConfig", () => {
  it("masks known secret keys, leaves others intact", () => {
    const out = redactConfig({
      grafanaAuthPassword: "supersecret",
      grafanaUrl: "https://g.example.com",
    });
    expect(out.grafanaAuthPassword).toBe("••••et");
    expect(out.grafanaUrl).toBe("https://g.example.com");
  });

  it("leaves empty secret values empty (not set)", () => {
    const out = redactConfig({ grafanaAuthToken: "" });
    expect(out.grafanaAuthToken).toBe("");
  });

  it("does not mutate the input object", () => {
    const input = { grafanaAuthPassword: "secretvalue" };
    redactConfig(input);
    expect(input.grafanaAuthPassword).toBe("secretvalue");
  });

  it("covers every declared secret key", () => {
    const input: Record<string, string> = {};
    for (const k of SECRET_CONFIG_KEYS) input[k] = "longsecret";
    const out = redactConfig(input);
    for (const k of SECRET_CONFIG_KEYS) expect(out[k]).toBe("••••et");
  });
});

describe("redact: redactSecrets", () => {
  it("replaces each secret occurrence with the placeholder", () => {
    const out = redactSecrets("user=admin pass=hunter2 again hunter2", ["hunter2"]);
    expect(out).toBe(`user=admin pass=${REDACTION_PLACEHOLDER} again ${REDACTION_PLACEHOLDER}`);
  });

  it("ignores secrets shorter than 3 chars", () => {
    expect(redactSecrets("a ab abc", ["a", "ab"])).toBe("a ab abc");
  });

  it("redacts the longer secret first when one contains another", () => {
    const out = redactSecrets("token=abcdef", ["abc", "abcdef"]);
    expect(out).toBe(`token=${REDACTION_PLACEHOLDER}`);
  });

  it("is idempotent and handles empty text / null secrets", () => {
    expect(redactSecrets("", ["secret"])).toBe("");
    expect(redactSecrets("nothing here", [null, undefined])).toBe("nothing here");
  });
});
