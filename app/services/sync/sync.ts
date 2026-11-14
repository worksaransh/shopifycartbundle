import { MAX_SYNC_PRODUCTS } from "@bundlekit/config-schema";
import {
  buildDesired,
  collectionGidsOf,
  TooManyProductsError,
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
}

export async function resolveShopGid(client: GqlClient): Promise<string> {
  return (await client.request<{ shop: { id: string } }>(SHOP_ID)).shop.id;
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
): Promise<{ desired: Desired; shopGid: string }> {
  const shopGid = await resolveShopGid(client);
  const collections = await resolveCollectionProducts(client, collectionGidsOf(state));
  return { desired: buildDesired(state, shopGid, collections), shopGid };
}

/** Writes every desired metafield and removes ones that no longer apply. Idempotent. */
export async function syncShop(client: GqlClient, state: SyncState): Promise<SyncReport> {
  const { desired } = await computeDesired(client, state);
  const set = await setMetafields(client, desired.metafields);
  const deleted = await deleteMetafields(
    client,
    staleRefs(desired.metafields, state.syncedProductGids, desired.productGids),
  );
  return { set, deleted, productGids: desired.productGids };
}
