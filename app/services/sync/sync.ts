import { KEYS, MAX_SYNC_PRODUCTS } from "@bundlekit/config-schema";
import { ensureRulePackNode } from "./discount-node";
import {
  buildDesired,
  buildRulePack,
  collectionGidsOf,
  TooManyProductsError,
  type BuiltPack,
  type Desired,
  type SyncState,
} from "./desired";
import type { GqlClient } from "./gql";
import { COLLECTION_PRODUCTS, SHOP_ID } from "./queries";
import { deleteMetafields, setMetafields, staleRefs } from "./writer";

export interface SyncReport {
  set: number;
  deleted: number;
  productGids: string[];
  ruleDiscountGid: string | null;
}

export async function resolveShop(client: GqlClient): Promise<{ gid: string; currency: string }> {
  const { shop } = await client.request<{ shop: { id: string; currencyCode: string } }>(SHOP_ID);
  return { gid: shop.id, currency: shop.currencyCode };
}
/** Product ids of each collection, paginated. Stops early past the sync cap so a huge collection fails fast. */
export async function resolveCollectionProducts(
  client: GqlClient,
  gids: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const id of gids) {
    const products: string[] = [];
    let after: string | null = null;
    do {
      const res: {
        collection: {
          products: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
        } | null;
      } = await client.request(COLLECTION_PRODUCTS, { id, after });
      if (!res.collection) break; // deleted collection: contributes no products
      products.push(...res.collection.products.nodes.map((n) => n.id));
      if (products.length > MAX_SYNC_PRODUCTS) throw new TooManyProductsError(products.length);
      after = res.collection.products.pageInfo.hasNextPage
        ? res.collection.products.pageInfo.endCursor
        : null;
    } while (after);
    out.set(id, products);
  }
  return out;
}

export async function computeDesired(
  client: GqlClient,
  state: SyncState,
): Promise<{ desired: Desired; shopGid: string; pack: BuiltPack }> {
  const shop = await resolveShop(client);
  const collections = await resolveCollectionProducts(client, collectionGidsOf(state));
  return {
    desired: buildDesired(state, shop.gid, collections),
    shopGid: shop.gid,
    pack: buildRulePack(state, shop.currency),
  };
}

/** Writes every desired metafield, keeps the discount node in step, and removes metafields that no longer apply. Idempotent. */
export async function syncShop(client: GqlClient, state: SyncState): Promise<SyncReport> {
  const { desired, pack } = await computeDesired(client, state);
  const nodeGid = await ensureRulePackNode(client, state.ruleDiscountGid, pack);
  const all = nodeGid
    ? [...desired.metafields, { ownerId: nodeGid, key: KEYS.functionConfig, value: pack.json }]
    : desired.metafields;
  const set = await setMetafields(client, all);
  const deleted = await deleteMetafields(
    client,
    staleRefs(desired.metafields, state.syncedProductGids, desired.productGids),
  );
  return { set, deleted, productGids: desired.productGids, ruleDiscountGid: nodeGid };
}
