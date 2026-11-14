import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- in-memory stand-in for the tables the analytics services use (all keyed like the real unique constraints)
const mem = vi.hoisted(() => {
  const totals = new Map<
    string,
    {
      shopId: string;
      orderGid: string;
      totalMinor: bigint;
      currency: string;
      touched: boolean;
      createdAt: Date;
    }
  >();
  const attrs = new Map<
    string,
    {
      shopId: string;
      orderGid: string;
      source: string;
      refId: string;
      revenueMinor: bigint;
      currency: string;
      createdAt: Date;
    }
  >();
  const events = new Map<string, { count: number }>();
  const tk = (w: { shopId_orderGid: { shopId: string; orderGid: string } }) =>
    `${w.shopId_orderGid.shopId}|${w.shopId_orderGid.orderGid}`;
  const ak = (w: {
    shopId_orderGid_source_refId: { shopId: string; orderGid: string; source: string; refId: string };
  }) => Object.values(w.shopId_orderGid_source_refId).join("|");
  const ek = (w: {
    shopId_date_eventType_refId: { shopId: string; date: Date; eventType: string; refId: string };
  }) => {
    const k = w.shopId_date_eventType_refId;
    return `${k.shopId}|${k.date.toISOString()}|${k.eventType}|${k.refId}`;
  };
  return {
    totals,
    attrs,
    events,
    db: {
      shop: { findFirst: vi.fn(async () => ({ id: "shop1" })) },
      bundle: { findMany: vi.fn(async () => [{ id: "b1" }]) },
      upsellRule: { findMany: vi.fn(async () => [{ id: "u1" }]) },
      orderTotal: {
        findUnique: vi.fn(
          async (a: Parameters<typeof tk>[0] extends never ? never : { where: Parameters<typeof tk>[0] }) =>
            totals.get(tk(a.where)) ?? null,
        ),
        upsert: vi.fn(
          async (a: {
            where: Parameters<typeof tk>[0];
            create: {
              shopId: string;
              orderGid: string;
              totalMinor: bigint;
              currency: string;
              touched: boolean;
            };
          }) => {
            if (!totals.has(tk(a.where))) totals.set(tk(a.where), { ...a.create, createdAt: new Date() });
          },
        ),
        update: vi.fn(async (a: { where: Parameters<typeof tk>[0]; data: { totalMinor: bigint } }) => {
          Object.assign(totals.get(tk(a.where))!, a.data);
        }),
      },
      orderAttribution: {
        findUnique: vi.fn(async (a: { where: Parameters<typeof ak>[0] }) => attrs.get(ak(a.where)) ?? null),
        upsert: vi.fn(
          async (a: {
            where: Parameters<typeof ak>[0];
            create: {
              shopId: string;
              orderGid: string;
              source: string;
              refId: string;
              revenueMinor: bigint;
              currency: string;
            };
          }) => {
            if (!attrs.has(ak(a.where))) attrs.set(ak(a.where), { ...a.create, createdAt: new Date() });
          },
        ),
        update: vi.fn(async (a: { where: Parameters<typeof ak>[0]; data: { revenueMinor: bigint } }) => {
          Object.assign(attrs.get(ak(a.where))!, a.data);
        }),
      },
      eventDaily: {
        upsert: vi.fn(
          async (a: {
            where: Parameters<typeof ek>[0];
            create: { count: number };
            update: { count: { increment: number } };
          }) => {
            const k = ek(a.where);
            const cur = events.get(k);
            if (cur) cur.count += a.update.count.increment;
            else events.set(k, { count: a.create.count });
          },
        ),
      },
    },
  };
});
vi.mock("../../app/db.server", () => ({ default: mem.db }));

import { recordEvents } from "../../app/services/analytics/events.server";
import { recordOrderPaid, recordRefund } from "../../app/services/analytics/attribution.server";
import { computeKpis, csvCell, lastDays } from "../../app/services/analytics/metrics";
import { line, order } from "./helpers";

beforeEach(() => {
  mem.totals.clear();
  mem.attrs.clear();
  mem.events.clear();
});

const orders = [
  order(1, "255.00", [
    line(1, "200.00", 1, { discount: "30.00", props: { _bundle_id: "b1" } }),
    line(2, "100.00", 1, { discount: "15.00", props: { _bundle_id: "b1" } }),
  ]),
  order(2, "510.00", [
    line(1, "400.00", 1, { discount: "60.00", props: { _bundle_id: "b1" } }),
    line(2, "200.00", 1, { discount: "30.00", props: { _bundle_id: "b1" } }),
  ]),
  order(3, "549.10", [
    line(1, "499.00", 1, { discount: "49.90", props: { _upsell_id: "u1" } }),
    line(2, "100.00", 1),
  ]),
  order(4, "255.00", [line(1, "100.00", 3, { discount: "45.00" })], "Volume discount 15%"),
  order(5, "300.00", [line(1, "300.00", 1)]),
  order(6, "150.00", [line(1, "150.00", 1)]),
  order(7, "100.00", [line(1, "100.00", 1, { props: { _bundle_id: "b1" } })]), // forged: no discount applied
  order(8, "90.00", [line(1, "100.00", 1, { discount: "10.00", props: { _bundle_id: "zzz" } })]), // unknown id
  order(9, "255.00", [
    line(1, "200.00", 1, { discount: "30.00", props: { _bundle_id: "b1" } }),
    line(2, "100.00", 1, { discount: "15.00", props: { _bundle_id: "b1" } }),
  ]),
  order(10, "100.00", [line(1, "100.00", 1)]),
];
const refund = {
  order_id: 9,
  refund_line_items: [
    { subtotal: "170.00", line_item: line(1, "200.00", 1, { props: { _bundle_id: "b1" } }) },
  ],
};

async function run() {
  for (const o of orders) await recordOrderPaid("dev.myshopify.com", o);
  await recordRefund("dev.myshopify.com", refund);
}
const kpisNow = () =>
  computeKpis(
    [...mem.attrs.values()].map((a) => ({
      orderGid: a.orderGid,
      source: a.source as "BUNDLE",
      revenueMinor: Number(a.revenueMinor),
      day: a.createdAt.toISOString().slice(0, 10),
    })),
    [...mem.totals.values()].map((t) => ({ totalMinor: Number(t.totalMinor), touched: t.touched })),
    [],
    lastDays(new Date(), 30),
  );

describe("10 orders including a refund (hand-calculated)", () => {
  it("matches the hand calculation", async () => {
    await run();
    const k = kpisNow();
    // Attributed revenue: bundle 255.00 + 510.00 + (255.00 - 170.00 refund = 85.00) = 850.00; upsell 449.10; volume 255.00
    expect(k.attributedRevenueMinor).toBe(85000 + 44910 + 25500);
    expect(k.attributedRevenueMinor).toBe(155410);
    // Bundle orders: orders 1, 2 and 9 (orders 7 and 8 are forged / unknown)
    expect(k.bundleOrders).toBe(3);
    // Touched orders 1,2,3,4,9 ; untouched 5,6,7,8,10
    expect(k.orders).toEqual({ touched: 5, untouched: 5 });
    // AOV touched = (255 + 510 + 549.10 + 255 + 85) / 5 = 330.82 ; untouched = (300+150+100+90+100) / 5 = 148.00
    expect(k.aov.touchedMinor).toBe(33082);
    expect(k.aov.untouchedMinor).toBe(14800);
    // fewer than 20 orders per side: no lift is claimed
    expect(k.aov.enoughData).toBe(false);
    expect(k.aov.liftPercent).toBeNull();
  });
  it("a duplicate webhook delivery does not double count", async () => {
    await run();
    const before = JSON.stringify(
      [...mem.attrs.values()].map((a) => [a.orderGid, a.source, a.refId, String(a.revenueMinor)]).sort(),
    );
    const totalsBefore = [...mem.totals.values()].map((t) => String(t.totalMinor)).sort();
    for (const o of orders) await recordOrderPaid("dev.myshopify.com", o); // redelivered, even after the refund
    expect(
      JSON.stringify(
        [...mem.attrs.values()].map((a) => [a.orderGid, a.source, a.refId, String(a.revenueMinor)]).sort(),
      ),
    ).toBe(before);
    expect([...mem.totals.values()].map((t) => String(t.totalMinor)).sort()).toEqual(totalsBefore);
    expect(kpisNow().attributedRevenueMinor).toBe(155410); // refund not undone by the redelivery
  });
  it("refunds never push revenue or totals below zero, and ignore unknown orders", async () => {
    await recordOrderPaid("dev.myshopify.com", orders[0]);
    await recordRefund("dev.myshopify.com", {
      order_id: 1,
      refund_line_items: [
        { subtotal: "9999.00", line_item: line(1, "200.00", 1, { props: { _bundle_id: "b1" } }) },
      ],
    });
    expect([...mem.attrs.values()][0].revenueMinor).toBe(0n);
    expect([...mem.totals.values()][0].totalMinor).toBe(0n);
    expect(await recordRefund("dev.myshopify.com", { order_id: 404, refund_line_items: [] })).toBeNull();
  });
  it("enough orders on both sides produce a labelled AOV lift", () => {
    const touched = Array.from({ length: 20 }, () => ({ totalMinor: 120000, touched: true }));
    const untouched = Array.from({ length: 20 }, () => ({ totalMinor: 100000, touched: false }));
    const k = computeKpis([], [...touched, ...untouched], [], ["2026-11-14"]);
    expect(k.aov.enoughData).toBe(true);
    expect(k.aov.liftPercent).toBeCloseTo(20, 5);
  });
});

describe("events and formulas", () => {
  it("rolls beacon counts up per shop, day, type and ref, and ignores junk", async () => {
    const now = new Date("2026-11-14T10:00:00Z");
    await recordEvents(
      "shop1",
      {
        events: [
          { t: "upsell_viewed", r: "u1", n: 3 },
          { t: "upsell_added", r: "u1", n: 1 },
        ],
      },
      now,
    );
    await recordEvents("shop1", { events: [{ t: "upsell_viewed", r: "u1", n: 2 }] }, now);
    expect(await recordEvents("shop1", { events: [{ t: "hack", n: 1 }] }, now)).toBe(0);
    expect(await recordEvents("shop1", { events: [] }, now)).toBe(0);
    expect(await recordEvents("shop1", "nope", now)).toBe(0);
    const counts = [...mem.events.entries()].map(([k, v]) => [k.split("|").slice(2).join("|"), v.count]);
    expect(counts).toContainEqual(["UPSELL_VIEWED|u1", 5]);
    expect(counts).toContainEqual(["UPSELL_ADDED|u1", 1]);
  });
  it("upsell acceptance = added / viewed, null with no views", () => {
    const ev = (viewed: number, added: number) => [
      { eventType: "UPSELL_VIEWED", count: viewed },
      { eventType: "UPSELL_ADDED", count: added },
    ];
    expect(computeKpis([], [], ev(40, 10), []).upsellAcceptanceRate).toBe(0.25);
    expect(computeKpis([], [], [], []).upsellAcceptanceRate).toBeNull();
  });
  it("builds a zero-filled daily series", () => {
    const days = lastDays(new Date("2026-11-14T05:00:00Z"), 3);
    expect(days).toEqual(["2026-11-12", "2026-11-13", "2026-11-14"]);
    const k = computeKpis(
      [{ orderGid: "o", source: "BUNDLE", revenueMinor: 500, day: "2026-11-13" }],
      [],
      [],
      days,
    );
    expect(k.series.map((s) => s.revenueMinor)).toEqual([0, 500, 0]);
  });
  it("CSV cells neutralise spreadsheet formulas and quote special characters", () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(12.5)).toBe("12.5");
  });
});
