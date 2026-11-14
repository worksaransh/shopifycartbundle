import { describe, expect, it } from "vitest";
import { buildAttributions, parseOrder, parseRefund } from "../../app/services/analytics/orders";
import { line, order } from "./helpers";

const known = { bundleIds: new Set(["b1"]), upsellIds: new Set(["u1"]) };
const attribs = (o: ReturnType<typeof order>) => buildAttributions(parseOrder(o)!, known);

describe("parseOrder / buildAttributions", () => {
  it("attributes a bundle line at price x qty minus its discount, in minor units", () => {
    const o = order(1, "255.00", [
      line(1, "200.00", 1, { discount: "30.00", props: { _bundle_id: "b1" } }),
      line(2, "100.00", 1, { discount: "15.00", props: { _bundle_id: "b1" } }),
    ]);
    expect(parseOrder(o)).toMatchObject({
      orderGid: "gid://shopify/Order/1",
      currency: "INR",
      totalMinor: 25500,
    });
    expect(attribs(o)).toEqual([{ source: "BUNDLE", refId: "b1", revenueMinor: 25500 }]);
  });
  it("ignores a forged or incomplete bundle: a property without a discount is not attribution", () => {
    expect(attribs(order(2, "100.00", [line(1, "100.00", 1, { props: { _bundle_id: "b1" } })]))).toEqual([]);
  });
  it("ignores ids that are not this shop's bundles or upsell rules", () => {
    expect(
      attribs(order(3, "90.00", [line(1, "100.00", 1, { discount: "10.00", props: { _bundle_id: "zzz" } })])),
    ).toEqual([]);
    expect(
      attribs(
        order(3, "90.00", [line(1, "100.00", 1, { discount: "10.00", props: { _upsell_id: "forged" } })]),
      ),
    ).toEqual([]);
  });
  it("attributes upsell lines and volume lines (by discount title)", () => {
    expect(
      attribs(order(4, "449.10", [line(1, "499.00", 1, { discount: "49.90", props: { _upsell_id: "u1" } })])),
    ).toEqual([{ source: "UPSELL", refId: "u1", revenueMinor: 44910 }]);
    expect(
      attribs(order(5, "255.00", [line(1, "100.00", 3, { discount: "45.00" })], "Volume discount 15%")),
    ).toEqual([{ source: "VOLUME", refId: "volume", revenueMinor: 25500 }]);
  });
  it("does not attribute a plain merchant discount", () => {
    expect(attribs(order(6, "90.00", [line(1, "100.00", 1, { discount: "10.00" })], "SUMMER10"))).toEqual([]);
  });
  it("uses the currency exponent (JPY has none) and skips malformed money instead of guessing", () => {
    const jpy = order(7, "1350", [line(1, "1500", 1, { discount: "150", props: { _bundle_id: "b1" } })]);
    jpy.currency = "JPY";
    expect(buildAttributions(parseOrder(jpy)!, known)[0].revenueMinor).toBe(1350);
    expect(parseOrder(order(8, "12.3.4", []))).toBeNull();
    expect(parseOrder({ admin_graphql_api_id: "x" })).toBeNull();
  });
  it("sums several lines of the same bundle into one row", () => {
    const o = order(9, "510.00", [
      line(1, "400.00", 1, { discount: "60.00", props: { _bundle_id: "b1" } }),
      line(2, "200.00", 1, { discount: "30.00", props: { _bundle_id: "b1" } }),
    ]);
    expect(attribs(o)).toEqual([{ source: "BUNDLE", refId: "b1", revenueMinor: 51000 }]);
  });
});

describe("parseRefund", () => {
  it("maps refunded lines to their source, and unattributed ones to null", () => {
    const r = parseRefund(
      {
        order_id: 9,
        refund_line_items: [
          { subtotal: "170.00", line_item: line(1, "200.00", 1, { props: { _bundle_id: "b1" } }) },
          { subtotal: "50.00", line_item: line(2, "50.00", 1) },
          { subtotal: "0.00", line_item: line(3, "10.00", 1) },
        ],
      },
      "INR",
      known,
    );
    expect(r).toEqual([
      { source: "BUNDLE", refId: "b1", amountMinor: 17000 },
      { source: null, refId: null, amountMinor: 5000 },
    ]);
  });
  it("returns nothing for malformed amounts", () => {
    expect(parseRefund({ refund_line_items: [{ subtotal: "x" }] }, "INR", known)).toEqual([]);
  });
});
