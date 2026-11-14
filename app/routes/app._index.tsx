import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { syncShopMetafields } from "../services/sync/repo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await db.shop.findUnique({
    where: { domain: session.shop },
    select: { syncStatus: true, syncError: true, metafieldSyncedAt: true },
  });
  return { syncStatus: shop?.syncStatus ?? "IDLE", syncError: shop?.syncError ?? null };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "retry-sync") {
    const result = await syncShopMetafields(session.shop);
    return { ok: result.ok };
  }
  return { ok: false };
};

// Phase 1: sync status only. Setup checklist and KPIs arrive in Phases 2, 6 and 7.
export default function Home() {
  const { syncStatus, syncError } = useLoaderData<typeof loader>();
  const busy = useNavigation().state !== "idle";

  return (
    <s-page heading="BundleKit">
      {syncStatus === "FAILED" && (
        <s-banner tone="critical" heading="Your changes are not live on your store yet">
          <s-paragraph>{syncError ?? "Syncing to your store failed. Press Retry."}</s-paragraph>
          <Form method="post">
            <input type="hidden" name="intent" value="retry-sync" />
            <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>
              Retry
            </s-button>
          </Form>
        </s-banner>
      )}
      <s-section>
        <s-stack gap="base">
          <s-heading>Welcome to BundleKit</s-heading>
          <s-paragraph>
            The app is installed. Bundles, volume discounts, cart upsells and the free-shipping bar will
            appear here as they are built.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
