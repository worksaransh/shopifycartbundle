import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { createUpsellRule, deleteUpsellRules, setUpsellStatus } from "../services/upsell/service.server";
import { upsellInputSchema } from "../services/upsell/validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, select: { id: true } });
  if (!shop) return { rules: [] };
  const rules = await db.upsellRule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    rules: rules.map((r) => ({
      id: r.id,
      status: r.status,
      trigger: `${r.triggerGids.length} ${r.triggerType === "PRODUCT" ? "product" : "collection"}${r.triggerGids.length === 1 ? "" : "s"}`,
      offers: r.offerHandles.join(", "),
      discount: r.discountPercent ? `${r.discountPercent}%` : "None",
      layout: r.layout === "CAROUSEL" ? "Carousel" : "Stacked",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = form.getAll("ids").map(String);
  const none = {} as Record<string, string>;
  if (intent === "create") {
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload")));
    } catch {
      return {
        ok: false,
        message: "Something went wrong reading the form. Reload the page and try again.",
        errors: none,
      };
    }
    const r = await createUpsellRule(session.shop, payload);
    if (!r.ok) return { ok: false, message: "Fix the highlighted fields.", errors: r.errors };
    return {
      ok: r.synced,
      message: r.synced ? "Upsell rule saved and live." : `Saved, but not live yet: ${r.syncMessage}`,
      errors: none,
    };
  }
  if (ids.length === 0) return { ok: false, message: "Select a rule first.", errors: none };
  const r =
    intent === "delete"
      ? await deleteUpsellRules(session.shop, ids)
      : await setUpsellStatus(session.shop, ids, intent === "activate" ? "ACTIVE" : "PAUSED");
  return {
    ok: r.synced,
    message: r.synced ? "Done." : `Saved, but not live yet: ${r.syncMessage}`,
    errors: none,
  };
};

interface Picked {
  id: string;
  title: string;
  handle?: string;
}

export default function Upsell() {
  const { rules } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";

  const [triggerType, setTriggerType] = useState<"PRODUCT" | "COLLECTION">("PRODUCT");
  const [triggers, setTriggers] = useState<Picked[]>([]);
  const [offers, setOffers] = useState<Picked[]>([]);
  const [percent, setPercent] = useState("");
  const [maxOffers, setMaxOffers] = useState("3");
  const [hideIfInCart, setHide] = useState(true);
  const [layout, setLayout] = useState<"CAROUSEL" | "STACKED">("STACKED");
  const [touched, setTouched] = useState(false);

  const input = {
    triggerType,
    triggerGids: triggers.map((t) => t.id),
    offerGids: offers.map((o) => o.id),
    offerHandles: offers.map((o) => o.handle ?? ""),
    ...(percent.trim() ? { discountPercent: /^\d+$/.test(percent.trim()) ? Number(percent) : NaN } : {}),
    maxOffers: Math.min(Number(maxOffers) || 1, Math.max(offers.length, 1)),
    hideIfInCart,
    layout,
  };
  const parsed = upsellInputSchema.safeParse(input);
  const errors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
  const err = (k: string) => (touched ? (errors[k] ?? result?.errors?.[k]) : result?.errors?.[k]);

  async function pick(kind: "trigger" | "offer") {
    const type = kind === "offer" || triggerType === "PRODUCT" ? "product" : "collection";
    const sel = (await shopify.resourcePicker({
      type,
      multiple: kind === "offer" ? 3 : type === "product",
      action: "select",
    })) as Picked[] | undefined;
    if (!sel?.length) return;
    const mapped = sel.map((s) => ({ id: s.id, title: s.title, handle: s.handle }));
    if (kind === "offer") setOffers(mapped.slice(0, 3));
    else setTriggers(mapped);
  }
  const act = (intent: string, id: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.append("ids", id);
    submit(fd, { method: "post" });
  };
  const save = () => {
    setTouched(true);
    if (!parsed.success) return;
    const fd = new FormData();
    fd.set("intent", "create");
    fd.set("payload", JSON.stringify(parsed.data));
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Cart upsell">
      {result && (
        <s-banner tone={result.ok ? "success" : "critical"} heading={result.ok ? "Done" : "Not saved"}>
          {result.message}
        </s-banner>
      )}

      <s-section heading="New upsell rule">
        <s-stack gap="base">
          <s-select
            label="When the cart has"
            value={triggerType}
            onChange={(e: Event) => {
              setTriggerType((e.currentTarget as HTMLSelectElement).value as "PRODUCT" | "COLLECTION");
              setTriggers([]);
            }}
          >
            <s-option value="PRODUCT">Specific products</s-option>
            <s-option value="COLLECTION">A collection</s-option>
          </s-select>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={() => pick("trigger")}>
              {triggers.length ? "Change trigger" : "Pick trigger"}
            </s-button>
            <s-text>{triggers.map((t) => t.title).join(", ")}</s-text>
          </s-stack>
          {err("triggerGids") && <s-text tone="critical">{err("triggerGids")}</s-text>}

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={() => pick("offer")}>
              {offers.length ? "Change offers" : "Pick up to 3 products to offer"}
            </s-button>
            <s-text>{offers.map((t) => t.title).join(", ")}</s-text>
          </s-stack>
          {(err("offerGids") || err("offerHandles")) && (
            <s-text tone="critical">{err("offerGids") ?? err("offerHandles")}</s-text>
          )}

          <s-text-field
            label="Discount on the offer (percent, optional)"
            details="Leave empty for no discount. The discount applies at checkout."
            value={percent}
            error={err("discountPercent")}
            onInput={(e: Event) => setPercent((e.currentTarget as HTMLInputElement).value)}
          />
          <s-select
            label="Offers shown at most"
            value={maxOffers}
            onChange={(e: Event) => setMaxOffers((e.currentTarget as HTMLSelectElement).value)}
          >
            <s-option value="1">1</s-option>
            <s-option value="2">2</s-option>
            <s-option value="3">3</s-option>
          </s-select>
          {err("maxOffers") && <s-text tone="critical">{err("maxOffers")}</s-text>}
          <s-select
            label="Layout"
            value={layout}
            onChange={(e: Event) =>
              setLayout((e.currentTarget as HTMLSelectElement).value as "CAROUSEL" | "STACKED")
            }
          >
            <s-option value="STACKED">Stacked</s-option>
            <s-option value="CAROUSEL">Carousel</s-option>
          </s-select>
          <s-checkbox
            label="Hide an offer that is already in the cart"
            checked={hideIfInCart}
            onChange={(e: Event) => setHide((e.currentTarget as HTMLInputElement).checked)}
          />
          <s-button variant="primary" onClick={save} {...(busy ? { loading: true } : {})}>
            Save and activate
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Your upsell rules">
        {rules.length === 0 ? (
          <s-paragraph>
            No upsell rules yet. Fill in the form above to add your first one. Offers are never pre-selected
            for shoppers.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Trigger</s-table-header>
              <s-table-header>Offers</s-table-header>
              <s-table-header>Discount</s-table-header>
              <s-table-header>Layout</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>{r.trigger}</s-table-cell>
                  <s-table-cell>{r.offers}</s-table-cell>
                  <s-table-cell>{r.discount}</s-table-cell>
                  <s-table-cell>{r.layout}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.status === "ACTIVE" ? "success" : "neutral"}>
                      {r.status === "ACTIVE" ? "Active" : "Paused"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button onClick={() => act(r.status === "ACTIVE" ? "pause" : "activate", r.id)}>
                        {r.status === "ACTIVE" ? "Pause" : "Resume"}
                      </s-button>
                      <s-button tone="critical" onClick={() => act("delete", r.id)}>
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
