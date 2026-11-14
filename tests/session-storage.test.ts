import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../app/lib/crypto.server";
import { EncryptedSessionStorage } from "../app/lib/session-storage.server";

const key = Buffer.alloc(32, 9).toString("base64");

function memoryStorage() {
  const rows = new Map<string, Session>();
  const storage: SessionStorage = {
    storeSession: async (s) => (rows.set(s.id, s), true),
    loadSession: async (id) => rows.get(id),
    deleteSession: async (id) => rows.delete(id),
    deleteSessions: async (ids) => (ids.forEach((i) => rows.delete(i)), true),
    findSessionsByShop: async (shop) => [...rows.values()].filter((s) => s.shop === shop),
  };
  return { rows, storage };
}

describe("crypto", () => {
  it("round-trips and uses a fresh IV", () => {
    const a = encrypt("secret", key);
    expect(a).not.toContain("secret");
    expect(encrypt("secret", key)).not.toBe(a);
    expect(decrypt(a, key)).toBe("secret");
  });
  it("rejects tampered ciphertext", () => {
    const a = encrypt("secret", key);
    expect(() => decrypt(a.slice(0, -2) + "AA", key)).toThrow();
  });
});

describe("EncryptedSessionStorage", () => {
  it("stores ciphertext and returns plaintext", async () => {
    const { rows, storage } = memoryStorage();
    const enc = new EncryptedSessionStorage(storage, key);
    const s = new Session({
      id: "s1",
      shop: "a.myshopify.com",
      state: "x",
      isOnline: false,
      accessToken: "shpat_1",
      refreshToken: "r1",
    });
    await enc.storeSession(s);
    expect(rows.get("s1")!.accessToken).toMatch(/^enc:v1:/);
    expect(rows.get("s1")!.refreshToken).toMatch(/^enc:v1:/);
    expect(s.accessToken).toBe("shpat_1"); // caller's object untouched
    const loaded = await enc.loadSession("s1");
    expect(loaded!.accessToken).toBe("shpat_1");
    expect(loaded!.refreshToken).toBe("r1");
    expect((await enc.findSessionsByShop("a.myshopify.com"))[0].accessToken).toBe("shpat_1");
  });
});
