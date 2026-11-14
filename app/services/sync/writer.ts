import { KEYS, NAMESPACE } from "@bundlekit/config-schema";
import type { GqlClient } from "./gql";
import { ShopifyApiError } from "./gql";
import { DELETE_METAFIELDS, SET_METAFIELDS } from "./queries";
import type { DesiredMetafield } from "./desired";

/** metafieldsSet and metafieldsDelete both accept at most 25 entries per call. */
export const BATCH = 25;

export interface MetafieldRef {
  ownerId: string;
  key: string;
}

const chunk = <T>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function setMetafields(client: GqlClient, items: readonly DesiredMetafield[]): Promise<number> {
  for (const part of chunk(items, BATCH)) {
    const res = await client.request<{
      metafieldsSet: { userErrors: { field?: string[]; message: string }[] };
    }>(SET_METAFIELDS, {
      metafields: part.map((m) => ({
        ownerId: m.ownerId,
        namespace: NAMESPACE,
        key: m.key,
        type: "json",
        value: m.value,
      })),
    });
    const errs = res.metafieldsSet.userErrors;
    if (errs.length)
      throw new ShopifyApiError(`metafieldsSet rejected: ${errs.map((e) => e.message).join("; ")}`, false);
  }
  return items.length;
}

export async function deleteMetafields(client: GqlClient, items: readonly MetafieldRef[]): Promise<number> {
  for (const part of chunk(items, BATCH)) {
    const res = await client.request<{ metafieldsDelete: { userErrors: { message: string }[] } }>(
      DELETE_METAFIELDS,
      {
        metafields: part.map((m) => ({ ownerId: m.ownerId, namespace: NAMESPACE, key: m.key })),
      },
    );
    const errs = res.metafieldsDelete.userErrors;
    if (errs.length)
      throw new ShopifyApiError(`metafieldsDelete rejected: ${errs.map((e) => e.message).join("; ")}`, false);
  }
  return items.length;
}

/** Product metafields to delete: every product we know about (before or after) that lacks a desired value for a key. */
export function staleRefs(
  desired: readonly DesiredMetafield[],
  previousProductGids: readonly string[],
  desiredProductGids: readonly string[],
): MetafieldRef[] {
  const have = new Set(desired.map((m) => `${m.ownerId}|${m.key}`));
  const out: MetafieldRef[] = [];
  for (const ownerId of new Set([...previousProductGids, ...desiredProductGids])) {
    for (const key of [KEYS.productBundles, KEYS.productVolume]) {
      if (!have.has(`${ownerId}|${key}`)) out.push({ ownerId, key });
    }
  }
  return out;
}
