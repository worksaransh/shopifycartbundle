import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { currencyExponent, decimalToMinor, minorToDecimal } from "@bundlekit/pricing";
import { DEFAULT_STRINGS, STRING_KEYS } from "@bundlekit/widgets";
import pkg from "../../package.json";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { saveSettings, setKillSwitch } from "../services/settings/service.server";
import { contrastWarnings, settingsInputSchema } from "../services/settings/validation";

interface Stored {
  killSwitch?: boolean;
  shippingBar?: { enabled?: boolean; thresholdMinor?: string };
  colours?: { accent: string; text: string; background: string };
  strings?: Record<string, string>;
  cartSelector?: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const res = await admin.graphql(`#graphql
    query SettingsShop { shop { currencyCode } }`);
  const { data } = (await res.json()) as { data: { shop: { currencyCode: string } } };
  const shop = await db.shop.findUnique({ where: { domain: session.shop }, select: { settings: true } });
  const s = (shop?.settings ?? {}) as Stored;
  return {
    domain: session.shop,
    currency: data.shop.currencyCode,
    version: pkg.version,
    killSwitch: s.killSwitch === true,
    shippingEnabled: s.shippingBar?.enabled === true,
    thresholdMinor: s.shippingBar?.thresholdMinor ?? "0",
    colours: s.colours ?? { accent: "#1a6b4f", text: "#202223", background: "#ffffff" },
    strings: s.strings ?? {},
    cartSelector: s.cartSelector ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  if (form.get("intent") === "kill") {
    const r = await setKillSwitch(session.shop, form.get("on") === "true");
    return {
      ok: r.synced,
      message: r.synced ? "Saved." : `Saved, but not live yet: ${r.syncMessage}`,
      errors: {} as Record<string, string>,
    };
  }
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
  const r = await saveSettings(session.shop, payload);
  if (!r.ok) return { ok: false, message: "Fix the highlighted fields.", errors: r.errors };
  return {
    ok: r.synced,
    message: r.synced ? "Settings saved and live." : `Saved, but not live yet: ${r.syncMessage}`,
    errors: {} as Record<string, string>,
  };
};

export default function Settings() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const submit = useSubmit();
  const busy = useNavigation().state === "submitting";
  const exp = currencyExponent(d.currency);

  const [enabled, setEnabled] = useState(d.shippingEnabled);
  const [amount, setAmount] = useState(
    Number(d.thresholdMinor) > 0 ? minorToDecimal(Number(d.thresholdMinor), exp) : "",
  );
  const [colours, setColours] = useState(d.colours);
  const [strings, setStrings] = useState<Record<string, string>>(d.strings);
  const [selector, setSelector] = useState(d.cartSelector);

  let thresholdMinor = "0";
  try {
    thresholdMinor = amount.trim() ? String(decimalToMinor(amount.trim(), exp)) : "0";
  } catch {
    thresholdMinor = "NaN";
  }
  const payload = {
    killSwitch: d.killSwitch,
    shippingBar: { enabled, thresholdMinor },
    colours,
    strings,
    ...(selector.trim() ? { cartSelector: selector.trim() } : {}),
  };
  const parsed = settingsInputSchema.safeParse(payload);
  const localErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) localErrors[i.path.join(".")] ??= i.message;
  const err = (k: string) => localErrors[k] ?? result?.errors?.[k];
  const warnings = contrastWarnings(colours);

  const save = () => {
    if (!parsed.success) return;
    const fd = new FormData();
    fd.set("payload", JSON.stringify(parsed.data));
    submit(fd, { method: "post" });
  };
  const kill = (on: boolean) => {
    const fd = new FormData();
    fd.set("intent", "kill");
    fd.set("on", String(on));
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Settings">
      {result && (
        <s-banner tone={result.ok ? "success" : "critical"} heading={result.ok ? "Done" : "Not saved"}>
          {result.message}
        </s-banner>
      )}

      <s-section heading="Emergency switch">
        <s-stack gap="base">
          <s-paragraph>
            {d.killSwitch
              ? "All BundleKit features are OFF on your storefront. Checkout is not affected."
              : "Turns every BundleKit widget off on your storefront in one click. Checkout discounts are not affected."}
          </s-paragraph>
          <s-button tone={d.killSwitch ? undefined : "critical"} onClick={() => kill(!d.killSwitch)}>
            {d.killSwitch ? "Turn features back on" : "Turn all features off"}
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Where to enable">
        <s-stack gap="base">
          <s-paragraph>
            Turn on the BundleKit app embed in your theme so the cart bar and upsells can show. Add the Bundle
            and Volume blocks on your product page template.
          </s-paragraph>
          <s-button href={`https://${d.domain}/admin/themes/current/editor?context=apps`} target="_blank">
            Open theme editor
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Free-shipping bar">
        <s-stack gap="base">
          <s-switch
            label="Show the free-shipping bar"
            checked={enabled}
            onChange={(e: Event) => setEnabled((e.currentTarget as HTMLInputElement).checked)}
          />
          <s-text-field
            label={`Free shipping from (${d.currency})`}
            details="Use the same amount as your free-shipping rate in Shopify. Carts in other currencies hide the bar."
            value={amount}
            error={enabled ? err("shippingBar.thresholdMinor") : undefined}
            onInput={(e: Event) => setAmount((e.currentTarget as HTMLInputElement).value)}
          />
          <s-text-field
            label="Progress message"
            details="Use {amount} where the amount left should appear."
            placeholder={DEFAULT_STRINGS["shipping.progress"]}
            value={strings["shipping.progress"] ?? ""}
            error={err("strings.shipping.progress")}
            onInput={(e: Event) =>
              setStrings({ ...strings, "shipping.progress": (e.currentTarget as HTMLInputElement).value })
            }
          />
          <s-text-field
            label="Success message"
            placeholder={DEFAULT_STRINGS["shipping.success"]}
            value={strings["shipping.success"] ?? ""}
            onInput={(e: Event) =>
              setStrings({ ...strings, "shipping.success": (e.currentTarget as HTMLInputElement).value })
            }
          />
        </s-stack>
      </s-section>

      <s-section heading="Colours">
        <s-stack gap="base">
          {(["accent", "text", "background"] as const).map((k) => (
            <s-color-field
              key={k}
              label={k === "accent" ? "Accent (buttons, bar)" : k === "text" ? "Text" : "Background"}
              value={colours[k]}
              error={err(`colours.${k}`)}
              onInput={(e: Event) =>
                setColours({ ...colours, [k]: (e.currentTarget as HTMLInputElement).value })
              }
            />
          ))}
          {warnings.map((w) => (
            <s-banner key={w} tone="warning">
              {w}
            </s-banner>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Cart location (advanced)">
        <s-text-field
          label="Cart container selector"
          details="Only needed if your theme's cart is not found automatically. Example: #cart-drawer .cart__items"
          value={selector}
          error={err("cartSelector")}
          onInput={(e: Event) => setSelector((e.currentTarget as HTMLInputElement).value)}
        />
      </s-section>

      <s-section heading="Storefront text">
        <s-stack gap="base">
          <s-paragraph>Leave a field empty to use the default. Keep it short and concrete.</s-paragraph>
          {STRING_KEYS.filter((k) => !k.startsWith("shipping.")).map((k) => (
            <s-text-field
              key={k}
              label={k}
              placeholder={DEFAULT_STRINGS[k]}
              value={strings[k] ?? ""}
              onInput={(e: Event) =>
                setStrings({ ...strings, [k]: (e.currentTarget as HTMLInputElement).value })
              }
            />
          ))}
        </s-stack>
      </s-section>

      <s-section>
        <s-stack gap="base">
          <s-button variant="primary" onClick={save} {...(busy ? { loading: true } : {})}>
            Save settings
          </s-button>
          <s-text>BundleKit version {d.version}. Need help? Contact your account manager.</s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
