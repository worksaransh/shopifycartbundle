import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { deleteBundles, setBundlesStatus } from "../services/bundles/service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    select: { id: true, syncStatus: true, syncError: true },
  });
  if (!shop) return { bundles: [], q, syncStatus: "IDLE" as const, syncError: null };

  const bundles = await db.bundle.findMany({
    where: { shopId: shop.id, ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const stats = await db.orderAttribution.groupBy({
    by: ["refId"],
    where: { shopId: shop.id, source: "BUNDLE" },
    _count: { _all: true },
    _sum: { revenueMinor: true },
  });
  const byRef = new Map(stats.map((s) => [s.refId, s]));
  return {
    q,
    syncStatus: shop.syncStatus,
    syncError: shop.syncError,
    bundles: bundles.map((b) => ({
      id: b.id,
      title: b.title,
      type: b.type,
      status: b.status,
      products: ((b.items ?? []) as unknown[]).length,
      orders: byRef.get(b.id)?._count._all ?? 0,
      revenueMinor: String(byRef.get(b.id)?._sum.revenueMinor ?? 0),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const ids = form.getAll("ids").map(String).filter(Boolean);
  const intent = String(form.get("intent"));
  if (ids.length === 0) return { ok: false, message: "Select at least one bundle first." };
  const result =
    intent === "delete"
      ? await deleteBundles(session.shop, ids)
      : await setBundlesStatus(session.shop, ids, intent === "activate" ? "ACTIVE" : "PAUSED");
  return {
    ok: result.synced,
    message: result.synced
      ? `${result.changed} bundle${result.changed === 1 ? "" : "s"} updated.`
      : `Saved, but not live yet: ${result.syncMessage}`,
  };
};

export default function Bundles() {
  const { bundles, q } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const submit = useSubmit();
  const bulk = (intent: "activate" | "pause" | "delete") => {
    const fd = new FormData();
    fd.set("intent", intent);
    selected.forEach((id) => fd.append("ids", id));
    submit(fd, { method: "post" });
    setSelected([]);
  };
  const loading = nav.state === "loading" && nav.location?.pathname === "/app/bundles";

  return (
    <s-page heading="Bundles">
      <s-button slot="primary-action" variant="primary" href="/app/bundles/new">
        Create bundle
      </s-button>

      {result && (
        <s-banner tone={result.ok ? "success" : "critical"} heading={result.ok ? "Done" : "Not live yet"}>
          {result.message}
        </s-banner>
      )}

      {loading ? (
        <s-section>
          <s-stack gap="base">
            <s-spinner accessibilityLabel="Loading bundles" />
            <s-text>Loading bundles…</s-text>
          </s-stack>
        </s-section>
      ) : bundles.length === 0 ? (
        <s-section heading={q ? "No bundles match your search" : "Create your first bundle"}>
          <s-stack gap="base">
            <s-paragraph>
              {q
                ? "Try a different word, or clear the search."
                : "Sell two or more products together at a better price. It takes about a minute."}
            </s-paragraph>
            <s-button variant="primary" href="/app/bundles/new">
              Create bundle
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <Form method="get">
            <s-box padding="base">
              <s-search-field
                label="Search bundles"
                labelAccessibilityVisibility="exclusive"
                name="q"
                value={q}
                placeholder="Search by name"
              />
            </s-box>
          </Form>
          {selected.length > 0 && (
            <s-box padding="base">
              <s-button-group>
                <s-button slot="secondary-actions" onClick={() => bulk("activate")}>
                  Activate ({selected.length})
                </s-button>
                <s-button slot="secondary-actions" onClick={() => bulk("pause")}>
                  Pause ({selected.length})
                </s-button>
                <s-button slot="secondary-actions" tone="critical" onClick={() => bulk("delete")}>
                  Delete ({selected.length})
                </s-button>
              </s-button-group>
            </s-box>
          )}
          <s-table>
            <s-table-header-row>
              <s-table-header>Select</s-table-header>
              <s-table-header>Name</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Products</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Orders</s-table-header>
              <s-table-header>Revenue</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {bundles.map((b) => (
                <s-table-row key={b.id}>
                  <s-table-cell>
                    <s-checkbox
                      label={`Select ${b.title}`}
                      checked={selected.includes(b.id)}
                      onChange={() => toggle(b.id)}
                    />
                  </s-table-cell>
                  <s-table-cell>{b.title}</s-table-cell>
                  <s-table-cell>{b.type === "FIXED" ? "Fixed" : "Mix and match"}</s-table-cell>
                  <s-table-cell>{b.products}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={b.status === "ACTIVE" ? "success" : "neutral"}>
                      {b.status === "ACTIVE" ? "Active" : b.status === "PAUSED" ? "Paused" : "Draft"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{b.orders}</s-table-cell>
                  <s-table-cell>
                    {Number(b.revenueMinor) === 0 ? "-" : (Number(b.revenueMinor) / 100).toFixed(2)}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  return boundary.error(error);
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
