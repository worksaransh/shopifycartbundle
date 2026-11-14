import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decrypt, encrypt, isEncrypted } from "./crypto.server";

/**
 * Wraps any SessionStorage so accessToken / refreshToken are encrypted at rest.
 * Non-negotiable per brief: "encrypt access tokens at rest if the template stores them".
 */
export class EncryptedSessionStorage implements SessionStorage {
  constructor(
    private readonly inner: SessionStorage,
    private readonly keyB64: string,
  ) {}

  private clone(session: Session, map: (v: string) => string): Session {
    const copy = Object.assign(Object.create(Object.getPrototypeOf(session)), session) as Session;
    if (copy.accessToken) copy.accessToken = map(copy.accessToken);
    if (copy.refreshToken) copy.refreshToken = map(copy.refreshToken);
    return copy;
  }

  private readonly enc = (v: string) => (isEncrypted(v) ? v : encrypt(v, this.keyB64));
  // Rows written before encryption was enabled are returned as-is rather than failing.
  private readonly dec = (v: string) => (isEncrypted(v) ? decrypt(v, this.keyB64) : v);

  storeSession(session: Session) {
    return this.inner.storeSession(this.clone(session, this.enc));
  }
  async loadSession(id: string) {
    const s = await this.inner.loadSession(id);
    return s ? this.clone(s, this.dec) : undefined;
  }
  deleteSession(id: string) {
    return this.inner.deleteSession(id);
  }
  deleteSessions(ids: string[]) {
    return this.inner.deleteSessions(ids);
  }
  async findSessionsByShop(shop: string) {
    const list = await this.inner.findSessionsByShop(shop);
    return list.map((s) => this.clone(s, this.dec));
  }
}
