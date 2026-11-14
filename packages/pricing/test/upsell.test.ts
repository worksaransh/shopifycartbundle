import { describe, expect, it } from "vitest";
import { selectUpsellOffers, type UpsellRuleView } from "../src";

const rule = (
  id: string,
  triggers: string[],
  offers: string[],
  over: Partial<UpsellRuleView> = {},
): UpsellRuleView => ({
  id,
  triggerProductIds: triggers,
  offerIds: offers,
  maxOffers: 3,
  hideIfInCart: true,
  ...over,
});
const avail = (...ids: string[]) => new Map(ids.map((i) => [i, true]));

describe("selectUpsellOffers", () => {
  it("shows offers only when a trigger is in the cart", () => {
    const rules = [rule("r1", ["A"], ["X", "Y"])];
    expect(selectUpsellOffers(rules, new Set(["B"]), avail("X", "Y"))).toEqual([]);
    expect(selectUpsellOffers(rules, new Set(["A"]), avail("X", "Y"))).toEqual([
      { ruleId: "r1", productId: "X" },
      { ruleId: "r1", productId: "Y" },
    ]);
  });
  it("hides offers already in the cart, or keeps them when hideIfInCart is off", () => {
    const cart = new Set(["A", "X"]);
    expect(selectUpsellOffers([rule("r1", ["A"], ["X", "Y"])], cart, avail("X", "Y"))).toEqual([
      { ruleId: "r1", productId: "Y" },
    ]);
    expect(
      selectUpsellOffers([rule("r1", ["A"], ["X"], { hideIfInCart: false })], cart, avail("X")),
    ).toHaveLength(1);
  });
  it("skips unavailable or unknown offers", () => {
    expect(
      selectUpsellOffers(
        [rule("r1", ["A"], ["X", "Y"])],
        new Set(["A"]),
        new Map([
          ["X", false],
          ["Y", true],
        ]),
      ),
    ).toEqual([{ ruleId: "r1", productId: "Y" }]);
    expect(selectUpsellOffers([rule("r1", ["A"], ["X"])], new Set(["A"]), new Map())).toEqual([]);
  });
  it("caps per rule (maxOffers) and overall (3), and never repeats a product", () => {
    const r1 = rule("r1", ["A"], ["X", "Y", "Z"], { maxOffers: 1 });
    const r2 = rule("r2", ["A"], ["X", "P", "Q", "R"]);
    const got = selectUpsellOffers([r1, r2], new Set(["A"]), avail("X", "Y", "Z", "P", "Q", "R"));
    expect(got.map((o) => o.productId)).toEqual(["X", "P", "Q"]);
  });
});
