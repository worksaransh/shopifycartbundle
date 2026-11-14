import { KEYS } from "@bundlekit/config-schema";
import { computeDesired } from "./sync";
import type { GqlClient } from "./gql";
import type { SyncState } from "./desired";
import { READ_PRODUCT_METAFIELDS, READ_RULE_PACK, READ_SHOP_CONFIG } from "./queries";
import { ensureRulePackNode } from "./discount-node";
import { deleteMetafields, setMetafields, staleRefs, type MetafieldRef } from "./writer";

export interface ReconcileReport {
  checked: number;
  missing: number;
  changed: number;
  stale: number;
  repaired: boolean;
  productGids: string[];
  ruleDiscountGid: string | null;
}

/** Canonical JSON so key order or whitespace differences never count as drift. */
function normalise(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  try {
    const sort = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v as object)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([k, x]) => [k, sort(x)]),
            )
          : v;
    return JSON.stringify(sort(JSON.parse(raw)));
  } catch {
    return raw; // unparsable value counts as drift
  }
}

interface ProductNode {
  __typename: string;
  id?: string;
  bundles?: { value: string } | null;
  volume?: { value: string } | null;
}

/**
 * Compares DB-derived desired state with what Shopify actually holds, and repairs drift
 * (missing, changed, or stale metafields). Runs daily and on demand. Reads in chunks of 100 ids.
 * Only touches products we know about: previously synced products plus currently desired ones.
 */
export async function reconcileShop(
  client: GqlClient,
  state: SyncState,
  opts: { repair?: boolean } = {},
): Promise<ReconcileReport> {
  const repair = opts.repair ?? true;
  const { desired, shopGid, pack } = await computeDesired(client, state);
  // repair mode creates/activates the discount node first; report-only mode just reads the one we know about
  const nodeGid = repair
    ? await ensureRulePackNode(client, state.ruleDiscountGid, pack)
    : state.ruleDiscountGid;
  const wanted = nodeGid
    ? [...desired.metafields, { ownerId: nodeGid, key: KEYS.functionConfig, value: pack.json }]
    : desired.metafields;
  const want = new Map(wanted.map((m) => [`${m.ownerId}|${m.key}`, m]));

  const actual = new Map<string, string | null>();
  const shop = await client.request<{ shop: { id: string; config: { value: string } | null } }>(
    READ_SHOP_CONFIG,
  );
  actual.set(`${shopGid}|${KEYS.shopConfig}`, shop.shop.config?.value ?? null);

  if (nodeGid) {
    const node = await client.request<{
      discountNode: { id: string; metafield: { value: string } | null } | null;
    }>(READ_RULE_PACK, { id: nodeGid });
    actual.set(`${nodeGid}|${KEYS.functionConfig}`, node.discountNode?.metafield?.value ?? null);
  }

  const productIds = [...new Set([...state.syncedProductGids, ...desired.productGids])];
  for (let i = 0; i < productIds.length; i += 100) {
    const res = await client.request<{ nodes: (ProductNode | null)[] }>(READ_PRODUCT_METAFIELDS, {
      ids: productIds.slice(i, i + 100),
    });
    for (const n of res.nodes) {
      if (!n || n.__typename !== "Product" || !n.id) continue;
      actual.set(`${n.id}|${KEYS.productBundles}`, n.bundles?.value ?? null);
      actual.set(`${n.id}|${KEYS.productVolume}`, n.volume?.value ?? null);
    }
  }

  const toSet = [];
  let missing = 0;
  let changed = 0;
  for (const [k, m] of want) {
    const have = actual.get(k) ?? null;
    if (have === null) {
      missing++;
      toSet.push(m);
    } else if (normalise(have) !== normalise(m.value)) {
      changed++;
      toSet.push(m);
    }
  }
  const toDelete: MetafieldRef[] = staleRefs(
    desired.metafields,
    state.syncedProductGids,
    desired.productGids,
  ).filter((r) => (actual.get(`${r.ownerId}|${r.key}`) ?? null) !== null);

  if (repair) {
    await setMetafields(client, toSet);
    await deleteMetafields(client, toDelete);
  }
  return {
    checked: want.size + toDelete.length,
    missing,
    changed,
    stale: toDelete.length,
    repaired: repair && toSet.length + toDelete.length > 0,
    productGids: desired.productGids,
    ruleDiscountGid: nodeGid,
  };
}
