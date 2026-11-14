import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { syncShopMetafields } from "../services/sync/repo.server";

interface SetupFlags {
  embedConfirmed?: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({ where: { domain: session.shop } });
  if (!shop)
    return {
      syncStatus: "IDLE" as const,
      syncError: null,
      domain: session.shop,
      embedConfirmed: false,
      bundleCount: 0,
      shippingBarOn: false,
    };

  const settings = (shop.settings ?? {}) as { setup?: SetupFlags; shippingBar?: { enabled?: boolean } };
  const bundleCount = await db.bundle.count({ where: { shopId: shop.id } });
  return {
    domain: session.shop,
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

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const doneCount = [d.embedConfirmed, d.bundleCount > 0, d.shippingBarOn].filter(Boolean).length;

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
        <s-paragraph>
          Revenue, bundle orders and upsell results appear here after your first orders.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
