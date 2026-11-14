import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { formatMoney } from "@bundlekit/widgets";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { computeKpis, lastDays, MIN_ORDERS_FOR_AOV } from "../services/analytics/metrics";
import { loadKpis } from "../services/analytics/metrics.server";
import { syncShopMetafields } from "../services/sync/repo.server";

interface SetupFlags {
  embedConfirmed?: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = [7, 30, 90].includes(asked) ? asked : 30;
  const month = new Date().toISOString().slice(0, 7);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });

  if (!shop) {
    return {
      days,
      month,
      domain: session.shop,
      currency: "USD",
      kpis: computeKpis([], [], [], lastDays(new Date(), days)),
      syncStatus: "IDLE" as const,
      syncError: null as string | null,
      embedConfirmed: false,
      bundleCount: 0,
      shippingBarOn: false,
    };
  }

  const settings = (shop.settings ?? {}) as { setup?: SetupFlags; shippingBar?: { enabled?: boolean } };
  const [bundleCount, { kpis, currency }] = await Promise.all([
    db.bundle.count({ where: { shopId: shop.id } }),
    loadKpis(shop.id, days),
  ]);
  return {
    days,
    month,
    domain: session.shop,
    currency,
    kpis,
    syncStatus: shop.syncStatus,
    syncError: shop.syncError,
    embedConfirmed: settings.setup?.embedConfirmed === true,
    bundleCount,
    shippingBarOn: settings.shippingBar?.enabled === true,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const intent = String((await request.formData()).get("intent"));

  if (intent === "retry-sync") {
    const result = await syncShopMetafields(session.shop);
    return { ok: result.ok };
  }
  if (intent === "confirm-embed") {
    const shop = await db.shop.findUnique({
      where: { domain: session.shop },
      select: { id: true, settings: true },
    });
    if (!shop) return { ok: false };
    const settings = (shop.settings ?? {}) as Record<string, unknown>;
    await db.shop.update({
      where: { id: shop.id },
      data: {
        settings: { ...settings, setup: { ...((settings.setup as SetupFlags) ?? {}), embedConfirmed: true } },
      },
    });
    return { ok: true };
  }
  return { ok: false };
};

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <s-stack direction="inline" gap="base" alignItems="start">
      <s-badge tone={done ? "success" : "neutral"}>{done ? "Done" : "To do"}</s-badge>
      <s-stack gap="small">
        <s-text type="strong">{title}</s-text>
        {children}
      </s-stack>
    </s-stack>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack gap="small">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
        {hint && <s-text>{hint}</s-text>}
      </s-stack>
    </s-box>
  );
}

/** Daily attributed revenue bars. Inline SVG with a text summary, so it is not colour-only or image-only. */
function Chart({
  series,
  currency,
  locale,
}: {
  series: { day: string; revenueMinor: number }[];
  currency: string;
  locale: string;
}) {
  const max = Math.max(1, ...series.map((s) => s.revenueMinor));
  const w = 600;
  const h = 120;
  const bar = w / series.length;
  const total = series.reduce((n, s) => n + s.revenueMinor, 0);
  const summary = `Attributed revenue per day, ${series[0]?.day} to ${series[series.length - 1]?.day}. Total ${formatMoney(total, currency, locale)}.`;
  return (
    <svg
      role="img"
      aria-label={summary}
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      style={{ maxInlineSize: "100%" }}
    >
      <title>{summary}</title>
      {series.map((s, i) => {
        const bh = Math.round((s.revenueMinor / max) * (h - 8));
        return (
          <rect
            key={s.day}
            x={i * bar + 1}
            y={h - bh}
            width={Math.max(1, bar - 2)}
            height={bh}
            fill="#1a6b4f"
          >
            <title>{`${s.day}: ${formatMoney(s.revenueMinor, currency, locale)}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const busy = fetcher.state !== "idle";
  const doneCount = [d.embedConfirmed, d.bundleCount > 0, d.shippingBarOn].filter(Boolean).length;
  const locale = typeof navigator === "undefined" ? "en" : navigator.language;
  const k = d.kpis;
  const money = (n: number) => formatMoney(n, d.currency, locale);
  const noData = k.orders.touched + k.orders.untouched === 0 && k.upsellViewed === 0;
  const aovLine =
    k.aov.touchedMinor === null
      ? "No orders yet"
      : `${money(k.aov.touchedMinor)} with BundleKit${k.aov.untouchedMinor !== null ? ` vs ${money(k.aov.untouchedMinor)} without` : ""}`;

  return (
    <s-page heading="BundleKit">
      {d.syncStatus === "FAILED" && (
        <s-banner tone="critical" heading="Your changes are not live on your store yet">
          <s-paragraph>{d.syncError ?? "Syncing to your store failed. Press Retry."}</s-paragraph>
          <s-button
            variant="primary"
            onClick={() => fetcher.submit({ intent: "retry-sync" }, { method: "post" })}
            {...(busy ? { loading: true } : {})}
          >
            Retry
          </s-button>
        </s-banner>
      )}

      <s-section heading={`Set up BundleKit (${doneCount} of 3 done)`}>
        <s-stack gap="base">
          <Step done={d.embedConfirmed} title="Turn on the app embed in your theme">
            {!d.embedConfirmed && (
              <s-stack direction="inline" gap="base">
                <s-button
                  href={`https://${d.domain}/admin/themes/current/editor?context=apps`}
                  target="_blank"
                >
                  Open theme editor
                </s-button>
                <s-button
                  onClick={() => fetcher.submit({ intent: "confirm-embed" }, { method: "post" })}
                  {...(busy ? { loading: true } : {})}
                >
                  I did this
                </s-button>
              </s-stack>
            )}
          </Step>
          <Step done={d.bundleCount > 0} title="Create your first bundle">
            {d.bundleCount === 0 && (
              <s-button variant="primary" href="/app/bundles/new">
                Create bundle
              </s-button>
            )}
          </Step>
          <Step done={d.shippingBarOn} title="Set your free-shipping bar">
            {!d.shippingBarOn && <s-button href="/app/settings">Open settings</s-button>}
          </Step>
        </s-stack>
      </s-section>

      <s-section heading="Results">
        <s-stack gap="base">
          <s-select
            label="Period"
            value={String(d.days)}
            onChange={(e: Event) => navigate(`?days=${(e.currentTarget as HTMLSelectElement).value}`)}
          >
            <s-option value="7">Last 7 days</s-option>
            <s-option value="30">Last 30 days</s-option>
            <s-option value="90">Last 90 days</s-option>
          </s-select>

          {noData ? (
            <s-paragraph>
              No results yet. Orders that use a bundle, volume discount or upsell appear here within a minute
              of payment.
            </s-paragraph>
          ) : (
            <>
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
                <Kpi
                  label="Attributed revenue"
                  value={money(k.attributedRevenueMinor)}
                  hint="After discounts and refunds"
                />
                <Kpi label="Bundle orders" value={String(k.bundleOrders)} />
                <Kpi
                  label="Upsell acceptance"
                  value={
                    k.upsellAcceptanceRate === null
                      ? "No data"
                      : `${Math.round(k.upsellAcceptanceRate * 100)}%`
                  }
                  hint={`${k.upsellAdded} added of ${k.upsellViewed} shown`}
                />
                <Kpi
                  label="Average order value"
                  value={
                    k.aov.enoughData && k.aov.liftPercent !== null
                      ? `${k.aov.liftPercent >= 0 ? "+" : ""}${k.aov.liftPercent.toFixed(1)}%`
                      : "Not enough data yet"
                  }
                  hint={
                    k.aov.enoughData
                      ? aovLine
                      : `Need ${MIN_ORDERS_FOR_AOV} orders with and without BundleKit. ${aovLine}`
                  }
                />
              </s-grid>
              <s-text>
                The average-order-value comparison shows a correlation, not proof of lift: shoppers who pick a
                bundle may already spend more.
              </s-text>
              <Chart series={k.series} currency={d.currency} locale={locale} />
              <s-link href={`/app/attribution.csv?month=${d.month}`} target="_blank">
                Download this month&apos;s attribution (CSV)
              </s-link>
            </>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
