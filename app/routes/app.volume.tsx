import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import {
  createVolumeRule,
  deleteVolumeRules,
  setStackVolumeWithBundles,
  setVolumeStatus,
} from "../services/volume/service.server";
import { volumeInputSchema, volumeFieldErrors } from "../services/volume/validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    select: { id: true, settings: true },
  });
  if (!shop) return { rules: [], stacking: false };
  const rules = await db.volumeRule.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    stacking: (shop.settings as { stackVolumeWithBundles?: boolean } | null)?.stackVolumeWithBundles === true,
    rules: rules.map((r) => ({
      id: r.id,
      status: r.status,
      targetType: r.targetType,
      targets: r.targetGids.length,
      tiers: (r.tiers as { minQty: number; percentOff: number }[])
        .map((t) => `${t.minQty}+ → ${t.percentOff}%`)
        .join(", "),
      startsAt: r.startsAt?.toISOString().slice(0, 10) ?? null,
      endsAt: r.endsAt?.toISOString().slice(0, 10) ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const ids = form.getAll("ids").map(String);

  if (intent === "create") {
    let payload: unknown;
    try {
      payload = JSON.parse(String(form.get("payload")));
    } catch {
      return {
        ok: false,
        message: "Something went wrong reading the form. Reload the page and try again.",
        errors: {} as Record<string, string>,
      };
    }
    const r = await createVolumeRule(session.shop, payload);
    if (!r.ok) return { ok: false, message: "Fix the highlighted fields.", errors: r.errors };
    return {
      ok: r.synced,
      message: r.synced ? "Volume discount saved and live." : `Saved, but not live yet: ${r.syncMessage}`,
      errors: {} as Record<string, string>,
    };
  }
  if (intent === "stacking") {
    const r = await setStackVolumeWithBundles(session.shop, form.get("on") === "true");
    return {
      ok: r.synced,
      message: r.synced ? "Setting saved." : `Saved, but not live yet: ${r.syncMessage}`,
      errors: {} as Record<string, string>,
    };
  }
  if (ids.length === 0)
    return { ok: false, message: "Select a rule first.", errors: {} as Record<string, string> };
  const r =
    intent === "delete"
      ? await deleteVolumeRules(session.shop, ids)
      : await setVolumeStatus(session.shop, ids, intent === "activate" ? "ACTIVE" : "PAUSED");
  return {
    ok: r.synced,
    message: r.synced ? "Done." : `Saved, but not live yet: ${r.syncMessage}`,
    errors: {} as Record<string, string>,
  };
};

type Tier = { minQty: string; percentOff: string };
const DEFAULT_TIERS: Tier[] = [
  { minQty: "2", percentOff: "10" },
  { minQty: "3", percentOff: "15" },
];

interface PickerResource {
  id: string;
  title: string;
}

export default function Volume() {
  const { rules, stacking } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";

  const [targetType, setTargetType] = useState<"PRODUCT" | "COLLECTION">("PRODUCT");
  const [targets, setTargets] = useState<PickerResource[]>([]);
  const [tiers, setTiers] = useState<Tier[]>(DEFAULT_TIERS);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [touched, setTouched] = useState(false);

  const num = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s) : NaN);
  const input = {
    targetType,
    targetGids: targets.map((t) => t.id),
    tiers: tiers.map((t) => ({ minQty: num(t.minQty), percentOff: num(t.percentOff) })),
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
  };
  const parsed = volumeInputSchema.safeParse(input);
  const errors: Record<string, string> = parsed.success ? {} : volumeFieldErrors(parsed.error);
  const serverErrors = result?.errors ?? {};
  const err = (k: string) => (touched ? (errors[k] ?? serverErrors[k]) : serverErrors[k]);

  async function pick() {
    const sel = (await shopify.resourcePicker({
      type: targetType === "PRODUCT" ? "product" : "collection",
      multiple: targetType === "PRODUCT",
      action: "select",
    })) as PickerResource[] | undefined;
    if (sel?.length) setTargets(sel.map((s) => ({ id: s.id, title: s.title })));
  }
  const bulk = (intent: string, id: string) => {
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
  const setTier = (i: number, patch: Partial<Tier>) =>
    setTiers((cur) => cur.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  return (
    <s-page heading="Volume discounts">
      {result && (
        <s-banner tone={result.ok ? "success" : "critical"} heading={result.ok ? "Done" : "Not saved"}>
          {result.message}
        </s-banner>
      )}

      <s-section heading="New volume discount">
        <s-stack gap="base">
          <s-select
            label="Applies to"
            value={targetType}
            onChange={(e: Event) => {
              setTargetType((e.currentTarget as HTMLSelectElement).value as "PRODUCT" | "COLLECTION");
              setTargets([]);
            }}
          >
            <s-option value="PRODUCT">Specific products</s-option>
            <s-option value="COLLECTION">One collection</s-option>
          </s-select>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={pick}>
              {targets.length
                ? "Change selection"
                : targetType === "PRODUCT"
                  ? "Pick products"
                  : "Pick collection"}
            </s-button>
            <s-text>{targets.map((t) => t.title).join(", ")}</s-text>
          </s-stack>
          {err("targetGids") && <s-text tone="critical">{err("targetGids")}</s-text>}

          <s-heading>Tiers</s-heading>
          {tiers.map((t, i) => (
            <s-stack key={i} direction="inline" gap="base" alignItems="end">
              <s-text-field
                label={`Tier ${i + 1}: buy at least`}
                value={t.minQty}
                onInput={(e: Event) => setTier(i, { minQty: (e.currentTarget as HTMLInputElement).value })}
                onBlur={() => setTouched(true)}
              />
              <s-text-field
                label="Percent off"
                value={t.percentOff}
                onInput={(e: Event) =>
                  setTier(i, { percentOff: (e.currentTarget as HTMLInputElement).value })
                }
                onBlur={() => setTouched(true)}
              />
              {tiers.length > 2 && (
                <s-button
                  tone="critical"
                  variant="tertiary"
                  onClick={() => setTiers((c) => c.filter((_, j) => j !== i))}
                >
                  Remove
                </s-button>
              )}
            </s-stack>
          ))}
          {err("tiers") && <s-text tone="critical">{err("tiers")}</s-text>}
          {tiers.length < 5 && (
            <s-button
              onClick={() => {
                const last = tiers[tiers.length - 1];
                setTiers([
                  ...tiers,
                  { minQty: String((num(last.minQty) || 1) + 1), percentOff: last.percentOff },
                ]);
              }}
            >
              Add tier
            </s-button>
          )}

          <s-stack direction="inline" gap="base">
            <s-text-field
              label="Start date (optional)"
              placeholder="2026-12-01"
              value={startsAt}
              error={err("startsAt")}
              onInput={(e: Event) => setStartsAt((e.currentTarget as HTMLInputElement).value)}
            />
            <s-text-field
              label="End date (optional)"
              placeholder="2026-12-31"
              value={endsAt}
              error={err("endsAt")}
              onInput={(e: Event) => setEndsAt((e.currentTarget as HTMLInputElement).value)}
            />
          </s-stack>
          <s-text>Dates use your store&apos;s time zone and include both days.</s-text>

          {parsed.success && (
            <s-table>
              <s-table-header-row>
                <s-table-header>Preview: shopper buys</s-table-header>
                <s-table-header>Discount</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {parsed.data.tiers.map((t) => (
                  <s-table-row key={t.minQty}>
                    <s-table-cell>{t.minQty} or more</s-table-cell>
                    <s-table-cell>Save {t.percentOff}%</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}

          <s-button variant="primary" onClick={save} {...(busy ? { loading: true } : {})}>
            Save and activate
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Your volume discounts">
        {rules.length === 0 ? (
          <s-paragraph>No volume discounts yet. Fill in the form above and save your first one.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Applies to</s-table-header>
              <s-table-header>Tiers</s-table-header>
              <s-table-header>Dates</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rules.map((r) => (
                <s-table-row key={r.id}>
                  <s-table-cell>
                    {r.targetType === "PRODUCT"
                      ? `${r.targets} product${r.targets === 1 ? "" : "s"}`
                      : "Collection"}
                  </s-table-cell>
                  <s-table-cell>{r.tiers}</s-table-cell>
                  <s-table-cell>
                    {r.startsAt || r.endsAt ? `${r.startsAt ?? "any"} to ${r.endsAt ?? "any"}` : "Always"}
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={r.status === "ACTIVE" ? "success" : "neutral"}>
                      {r.status === "ACTIVE" ? "Active" : "Paused"}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small">
                      <s-button onClick={() => bulk(r.status === "ACTIVE" ? "pause" : "activate", r.id)}>
                        {r.status === "ACTIVE" ? "Pause" : "Resume"}
                      </s-button>
                      <s-button tone="critical" onClick={() => bulk("delete", r.id)}>
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

      <s-section heading="Bundles and volume discounts together">
        <s-stack gap="base">
          <s-paragraph>
            By default an item inside a complete bundle only gets the bundle price, not a volume discount on
            top. Turn this on to allow both.
          </s-paragraph>
          <s-button
            onClick={() => {
              const fd = new FormData();
              fd.set("intent", "stacking");
              fd.set("on", String(!stacking));
              submit(fd, { method: "post" });
            }}
          >
            {stacking ? "Turn off stacking" : "Turn on stacking"}
          </s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
