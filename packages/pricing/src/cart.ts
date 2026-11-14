import { computeBundleDiscount } from "./bundle";
import { isPriceable, lineTotal } from "./lines";
import { percentOf } from "./money";
import { computeVolumeDiscount } from "./volume";
import type { BundleRule, Minor, PricingLine, VolumeRule } from "./types";

export interface UpsellDiscountRule {
  id: string;
  offerIds: readonly string[];
  percentOff: number;
}

export interface RulePackInput {
  bundles: readonly BundleRule[];
  volume: readonly VolumeRule[];
  upsells: readonly UpsellDiscountRule[];
  stackVolumeWithBundles: boolean;
}

export type DiscountSource = "BUNDLE" | "VOLUME" | "UPSELL";

/** One discount to apply to `quantity` units of a cart line, `amountMinor` in total. */
export interface Allocation {
  lineId: string;
  quantity: number;
  amountMinor: Minor;
  source: DiscountSource;
  refId: string;
  label: string;
}

export interface CartDiscounts {
  allocations: Allocation[];
  totalMinor: Minor;
}

/**
 * Every discount for a cart, with explicit conflict rules (also in docs/DECISIONS.md):
 *  1. Bundles first. A bundle only discounts units of a COMPLETE bundle.
 *  2. Volume tiers skip lines that belong to a complete bundle, unless stackVolumeWithBundles is on
 *     (then the volume discount is capped at what is left of the line after the bundle discount).
 *  3. A line receives at most ONE volume rule (first rule in pack order wins).
 *  4. Upsell discounts only apply to a line that carries a matching `_upsell_id`, whose product is one of the rule's
 *     offered products, and that has no bundle or volume discount already.
 * Per line, discounts never exceed the line total.
 */
export function computeCartDiscounts(pack: RulePackInput, lines: readonly PricingLine[]): CartDiscounts {
  const allocations: Allocation[] = [];
  const spent = new Map<string, number>(); // discount already given per line
  const bundled = new Set<string>();
  const byId = new Map(lines.map((l) => [l.id, l]));

  const add = (a: Allocation) => {
    const line = byId.get(a.lineId);
    if (!line) return;
    const room = lineTotal(line) - (spent.get(a.lineId) ?? 0);
    const amountMinor = Math.min(a.amountMinor, Math.max(0, room));
    if (amountMinor <= 0) return;
    spent.set(a.lineId, (spent.get(a.lineId) ?? 0) + amountMinor);
    allocations.push({ ...a, amountMinor });
  };

  for (const rule of pack.bundles) {
    const r = computeBundleDiscount(rule, lines);
    for (const [lineId, units] of Object.entries(r.coveredUnits)) if (units > 0) bundled.add(lineId);
    for (const d of r.lineDiscounts) {
      add({
        lineId: d.lineId,
        quantity: r.coveredUnits[d.lineId],
        amountMinor: d.amountMinor,
        source: "BUNDLE",
        refId: rule.id,
        label: rule.title ? `Bundle: ${rule.title}` : "Bundle discount",
      });
    }
  }

  const volumeLines = new Set<string>();
  for (const rule of pack.volume) {
    const exclude = new Set(volumeLines);
    if (!pack.stackVolumeWithBundles) bundled.forEach((id) => exclude.add(id));
    const r = computeVolumeDiscount(rule, lines, { excludeLineIds: exclude });
    for (const d of r.lineDiscounts) {
      const line = byId.get(d.lineId)!;
      volumeLines.add(d.lineId);
      const pct = r.tier?.percentOff ?? r.lineTiers[d.lineId]?.percentOff;
      add({
        lineId: d.lineId,
        quantity: line.quantity,
        amountMinor: d.amountMinor,
        source: "VOLUME",
        refId: rule.id,
        label: pct ? `Volume discount ${pct}%` : "Volume discount",
      });
    }
  }

  for (const line of lines) {
    if (!line.upsellId || !isPriceable(line) || spent.has(line.id)) continue;
    const rule = pack.upsells.find((u) => u.id === line.upsellId && u.offerIds.includes(line.productId));
    if (!rule || rule.percentOff < 1 || rule.percentOff > 90) continue;
    add({
      lineId: line.id,
      quantity: line.quantity,
      amountMinor: percentOf(lineTotal(line), rule.percentOff),
      source: "UPSELL",
      refId: rule.id,
      label: `Offer ${rule.percentOff}% off`,
    });
  }

  return { allocations, totalMinor: allocations.reduce((n, a) => n + a.amountMinor, 0) };
}
