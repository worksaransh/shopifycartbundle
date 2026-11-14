// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createBeacon } from "../../packages/storefront/src/beacon";

async function sent(blob: Blob) {
  return JSON.parse(await blob.text());
}

describe("beacon", () => {
  it("batches and aggregates events, sending one beacon on flush", async () => {
    const send = vi.fn(() => true);
    const b = createBeacon("/apps/bundlekit/event", { send, schedule: () => 0 });
    b.track("bundle_added", "b1");
    b.track("bundle_added", "b1");
    b.track("tier_selected", "3");
    b.flush();
    expect(send).toHaveBeenCalledTimes(1);
    const calls = send.mock.calls as unknown as [string, Blob][];
    expect(calls[0][0]).toBe("/apps/bundlekit/event");
    expect(await sent(calls[0][1])).toEqual({
      events: [
        { t: "bundle_added", r: "b1", n: 2 },
        { t: "tier_selected", r: "3", n: 1 },
      ],
    });
  });
  it("once() sends only the first occurrence", () => {
    const send = vi.fn(() => true);
    const b = createBeacon("/e", { send, schedule: () => 0 });
    b.once("bundle_viewed", "b1");
    b.once("bundle_viewed", "b1");
    b.once("bundle_viewed", "b2");
    b.flush();
    const calls = send.mock.calls as unknown as [string, Blob][];
    return sent(calls[0][1]).then((p) => expect(p.events).toHaveLength(2));
  });
  it("does nothing without an endpoint and never throws if sending fails", () => {
    const send = vi.fn(() => {
      throw new Error("blocked");
    });
    createBeacon(undefined, { send }).track("bundle_added", "b1");
    const b = createBeacon("/e", { send, schedule: () => 0 });
    b.track("upsell_added", "u1");
    expect(() => b.flush()).not.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("sends no personal data: only type, ref id and count", async () => {
    const send = vi.fn(() => true);
    const b = createBeacon("/e", { send, schedule: () => 0 });
    b.track("upsell_viewed", "u".repeat(200));
    b.flush();
    const calls = send.mock.calls as unknown as [string, Blob][];
    const e = (await sent(calls[0][1])).events[0];
    expect(Object.keys(e).sort()).toEqual(["n", "r", "t"]);
    expect(e.r).toHaveLength(64);
  });
});
