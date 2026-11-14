import { KEYS, NAMESPACE } from "@bundlekit/config-schema";
import type { GqlClient } from "./gql";
import { ShopifyApiError } from "./gql";
import {
  ACTIVATE_DISCOUNT,
  CREATE_RULE_DISCOUNT,
  DEACTIVATE_DISCOUNT,
  DISCOUNT_NODE_EXISTS,
} from "./queries";
import type { BuiltPack } from "./desired";

/** Must equal `handle` in extensions/bundlekit-discount/shopify.extension.toml. */
export const FUNCTION_HANDLE = "bundlekit-discount";

interface UserErrors {
  userErrors: { message: string }[];
}
const check = (what: string, e: UserErrors) => {
  if (e.userErrors.length)
    throw new ShopifyApiError(`${what} rejected: ${e.userErrors.map((x) => x.message).join("; ")}`, false);
};

/**
 * Ensures the shop's single automatic discount node exists and is switched on only when there are rules.
 * Returns the node GID (or null when there is nothing to create yet). Idempotent.
 *
 * combinesWith decision: our discount may combine with ORDER and SHIPPING discounts (a merchant's free-shipping or
 * order-percent code keeps working) but NOT with other PRODUCT discounts, so a merchant sale and a bundle never
 * compound on the same line by surprise. Recorded in docs/DECISIONS.md.
 */
export async function ensureRulePackNode(
  client: GqlClient,
  existingGid: string | null,
  pack: BuiltPack,
): Promise<string | null> {
  let gid = existingGid;
  if (gid) {
    const res = await client.request<{ discountNode: { id: string } | null }>(DISCOUNT_NODE_EXISTS, {
      id: gid,
    });
    if (!res.discountNode) gid = null; // merchant deleted it in the Shopify admin: recreate
  }

  if (!gid) {
    if (pack.empty) return null;
    const res = await client.request<{
      discountAutomaticAppCreate: UserErrors & { automaticAppDiscount: { discountId: string } | null };
    }>(CREATE_RULE_DISCOUNT, {
      discount: {
        title: "BundleKit discounts",
        functionHandle: FUNCTION_HANDLE,
        discountClasses: ["PRODUCT"],
        startsAt: new Date().toISOString(),
        combinesWith: { orderDiscounts: true, shippingDiscounts: true, productDiscounts: false },
        metafields: [{ namespace: NAMESPACE, key: KEYS.functionConfig, type: "json", value: pack.json }],
      },
    });
    check("discountAutomaticAppCreate", res.discountAutomaticAppCreate);
    const created = res.discountAutomaticAppCreate.automaticAppDiscount?.discountId;
    if (!created) throw new ShopifyApiError("Shopify did not return the new discount id", false);
    return created;
  }

  const toggle = pack.empty ? DEACTIVATE_DISCOUNT : ACTIVATE_DISCOUNT;
  const r = await client.request<Record<string, UserErrors>>(toggle, { id: gid });
  check(pack.empty ? "discountAutomaticDeactivate" : "discountAutomaticActivate", Object.values(r)[0]);
  return gid;
}
