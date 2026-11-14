import type { AdminLike } from "../../app/services/sync/gql";

export type Failure = "http429" | "http503" | "throttled" | "throw503" | "network" | "http401";

/** In-memory stand-in for the Admin GraphQL API: metafields, collections, and injectable failures. */
export class FakeShopify implements AdminLike {
  readonly shopGid = "gid://shopify/Shop/1";
  readonly store = new Map<string, string>(); // `${ownerId}|${key}` -> json string
  readonly collections = new Map<string, string[]>();
  readonly calls: { op: string; size: number }[] = [];
  /** discount nodes: gid -> status */
  readonly nodes = new Map<string, "ACTIVE" | "EXPIRED">();
  readonly createdDiscounts: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  private nextNode = 1;
  failures: Failure[] = [];
  userError: string | null = null;

  setCalls = () => this.calls.filter((c) => c.op === "set");
  keysOf = (owner: string) =>
    [...this.store.keys()].filter((k) => k.startsWith(`${owner}|`)).map((k) => k.split("|")[1]);

  private json(data: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(data), { status: 200, ...init });
  }

  async graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response> {
    const f = this.failures.shift();
    if (f === "http429") return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    if (f === "http503") return new Response("{}", { status: 503 });
    if (f === "http401") return new Response("{}", { status: 401 });
    if (f === "throw503") throw Object.assign(new Error("boom"), { response: { status: 503 } });
    if (f === "network") throw new TypeError("fetch failed");
    if (f === "throttled") {
      return this.json({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: {
          cost: { requestedQueryCost: 300, throttleStatus: { currentlyAvailable: 100, restoreRate: 100 } },
        },
      });
    }
    const v = (options?.variables ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (query.includes("query ShopId"))
      return this.json({ data: { shop: { id: this.shopGid, currencyCode: "INR" } } });

    if (query.includes("query DiscountNodeExists")) {
      return this.json({ data: { discountNode: this.nodes.has(v.id) ? { id: v.id } : null } });
    }
    if (query.includes("mutation CreateRuleDiscount")) {
      this.calls.push({ op: "createDiscount", size: 1 });
      const gid = `gid://shopify/DiscountAutomaticNode/${this.nextNode++}`;
      this.createdDiscounts.push(v.discount);
      this.nodes.set(gid, "ACTIVE");
      for (const m of v.discount.metafields ?? []) this.store.set(`${gid}|${m.key}`, m.value);
      return this.json({
        data: { discountAutomaticAppCreate: { automaticAppDiscount: { discountId: gid }, userErrors: [] } },
      });
    }
    if (query.includes("mutation ActivateDiscount") || query.includes("mutation DeactivateDiscount")) {
      const on = query.includes("mutation ActivateDiscount");
      this.calls.push({ op: on ? "activate" : "deactivate", size: 1 });
      this.nodes.set(v.id, on ? "ACTIVE" : "EXPIRED");
      const field = on ? "discountAutomaticActivate" : "discountAutomaticDeactivate";
      return this.json({ data: { [field]: { userErrors: [] } } });
    }
    if (query.includes("query ReadRulePack")) {
      const value = this.store.get(`${v.id}|fn`);
      return this.json({
        data: {
          discountNode: this.nodes.has(v.id) ? { id: v.id, metafield: value ? { value } : null } : null,
        },
      });
    }

    if (query.includes("mutation SetMetafields")) {
      this.calls.push({ op: "set", size: v.metafields.length });
      if (v.metafields.length > 25) throw new Error("fake: more than 25 metafields in one call");
      if (this.userError)
        return this.json({
          data: { metafieldsSet: { metafields: [], userErrors: [{ message: this.userError }] } },
        });
      for (const m of v.metafields) {
        if (m.namespace !== "$app:bundlekit" || m.type !== "json")
          throw new Error("fake: bad namespace/type");
        this.store.set(`${m.ownerId}|${m.key}`, m.value);
      }
      return this.json({ data: { metafieldsSet: { metafields: [], userErrors: [] } } });
    }

    if (query.includes("mutation DeleteMetafields")) {
      this.calls.push({ op: "delete", size: v.metafields.length });
      if (v.metafields.length > 25) throw new Error("fake: more than 25 identifiers in one call");
      for (const m of v.metafields) this.store.delete(`${m.ownerId}|${m.key}`);
      return this.json({ data: { metafieldsDelete: { deletedMetafields: [], userErrors: [] } } });
    }

    if (query.includes("query CollectionProducts")) {
      this.calls.push({ op: "collection", size: 0 });
      const all = this.collections.get(v.id);
      if (!all) return this.json({ data: { collection: null } });
      const start = v.after ? Number(v.after) : 0;
      const page = all.slice(start, start + 250);
      const end = start + page.length;
      return this.json({
        data: {
          collection: {
            products: {
              nodes: page.map((id) => ({ id })),
              pageInfo: { hasNextPage: end < all.length, endCursor: String(end) },
            },
          },
        },
      });
    }

    if (query.includes("query ReadShopConfig")) {
      const value = this.store.get(`${this.shopGid}|config`);
      const up = this.store.get(`${this.shopGid}|upsells`);
      return this.json({
        data: {
          shop: { id: this.shopGid, config: value ? { value } : null, upsells: up ? { value: up } : null },
        },
      });
    }

    if (query.includes("query ReadProductMetafields")) {
      this.calls.push({ op: "read", size: v.ids.length });
      const nodes = (v.ids as string[]).map((id) => {
        const b = this.store.get(`${id}|bundles`);
        const o = this.store.get(`${id}|volume`);
        return {
          __typename: "Product",
          id,
          bundles: b ? { value: b } : null,
          volume: o ? { value: o } : null,
        };
      });
      return this.json({ data: { nodes } });
    }
    throw new Error(`fake: unhandled query ${query.slice(0, 60)}`);
  }
}
