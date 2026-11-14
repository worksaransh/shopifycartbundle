import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

// Phase 0: intentionally empty. Setup checklist and KPIs arrive in Phases 2, 6 and 7.
export default function Home() {
  return (
    <s-page heading="BundleKit">
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
