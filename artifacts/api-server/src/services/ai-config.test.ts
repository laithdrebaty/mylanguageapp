import { describe, it, expect, beforeAll } from "vitest";

// The module reads AI_CONFIG_SECRET when it derives the key, and caches the
// result — so it must be present before the first import.
process.env.AI_CONFIG_SECRET =
  process.env.AI_CONFIG_SECRET ?? "0123456789abcdef0123456789abcdef0123456789abcdef";

let encryptSecret: typeof import("./ai-config").encryptSecret;
let decryptSecret: typeof import("./ai-config").decryptSecret;
let keyHint: typeof import("./ai-config").keyHint;
let sameSecret: typeof import("./ai-config").sameSecret;
let isEncryptionAvailable: typeof import("./ai-config").isEncryptionAvailable;

beforeAll(async () => {
  const mod = await import("./ai-config");
  ({ encryptSecret, decryptSecret, keyHint, sameSecret, isEncryptionAvailable } = mod);
});

describe("API key encryption", () => {
  const key = "nvapi-abcdefghijklmnopqrstuvwxyz0123456789";

  it("round-trips a key", () => {
    expect(decryptSecret(encryptSecret(key))).toBe(key);
  });

  it("never stores the key in readable form", () => {
    const stored = encryptSecret(key);
    expect(stored).not.toContain(key);
    expect(stored).not.toContain("nvapi");
    expect(Buffer.from(stored, "utf8").toString("utf8")).not.toContain(key);
  });

  it("produces a different ciphertext every time, so equal keys are not obvious", () => {
    // A deterministic ciphertext would leak that two providers share a key.
    expect(encryptSecret(key)).not.toBe(encryptSecret(key));
  });

  it("refuses ciphertext that has been tampered with", () => {
    const stored = encryptSecret(key);
    const parts = stored.split(".");
    // Flip a character in the ciphertext segment.
    const data = Buffer.from(parts[3], "base64url");
    data[0] ^= 0xff;
    parts[3] = data.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses ciphertext whose auth tag does not match", () => {
    const parts = encryptSecret(key).split(".");
    const tag = Buffer.from(parts[2], "base64url");
    tag[0] ^= 0xff;
    parts[2] = tag.toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a stored value in an unknown format", () => {
    expect(() => decryptSecret("not-a-ciphertext")).toThrow(/not in a recognised format/);
    expect(() => decryptSecret("v2.a.b.c")).toThrow(/not in a recognised format/);
  });

  it("handles a key with non-ASCII characters", () => {
    const unicode = "clé-secrète-٤٢-🔑";
    expect(decryptSecret(encryptSecret(unicode))).toBe(unicode);
  });

  it("reports encryption as available when the secret is long enough", () => {
    expect(isEncryptionAvailable()).toBe(true);
  });
});

describe("keyHint", () => {
  it("shows only the last four characters", () => {
    expect(keyHint("nvapi-abcdefgh6789")).toBe("••••6789");
  });

  it("reveals nothing at all for a very short key", () => {
    expect(keyHint("ab")).toBe("••••");
  });

  it("never contains the leading part of the key", () => {
    const key = "nvapi-SECRETVALUE1234";
    expect(keyHint(key)).not.toContain("SECRET");
  });
});

describe("sameSecret", () => {
  it("matches identical secrets", () => {
    expect(sameSecret("abc123", "abc123")).toBe(true);
  });

  it("rejects different secrets of equal length", () => {
    expect(sameSecret("abc123", "abc124")).toBe(false);
  });

  it("rejects secrets of different lengths without throwing", () => {
    expect(sameSecret("abc", "abcdef")).toBe(false);
  });
});
