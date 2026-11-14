import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { currencyExponent, decimalToMinor } from "@bundlekit/pricing";
import { BUNDLE_CARD_CSS, renderBundleCard } from "@bundlekit/widgets";
import { authenticate } from "../shopify.server";
import { createBundle } from "../services/bundles/service.server";
import { bundleInputSchema, fieldErrors } from "../services/bundles/validation";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(`#graphql
    query WizardShop { shop { currencyCode } }`);
  const { data } = (await res.json()) as { data: { shop: { currencyCode: string } } };
  return { currency: data.shop.currencyCode };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("payload")));
  } catch {
    return {
      ok: false as const,
      errors: { form: "Something went wrong reading the form. Reload the page and try again." },
    };
  }
  const result = await createBundle(session.shop, payload);
  if (!result.ok) return result;
  // Saved. If sync failed the bundle is kept; the list page shows the failed-sync banner with Retry.
  throw redirect("/app/bundles");
};

type PickedItem = { gid: string; title: string; imageUrl?: string; priceMinor: number; quantity: number };
type DiscountType = "PERCENT" | "AMOUNT" | "FIXED_PRICE";

/** Shape of what shopify.resourcePicker returns that we use. */
interface PickerResource {
  id: string;
  title: string;
  images?: { originalSrc?: string }[];
  image?: { originalSrc?: string } | null;
  variants?: { price?: string }[];
}

const STEPS = ["Type", "Products", "Discount"] as const;

export default function NewBundle() {
  const { currency } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const saving = useNavigation().state === "submitting";
  const exp = currencyExponent(currency);

  const [step, setStep] = useState(0);
  const [type, setType] = useState<"FIXED" | "MIX_MATCH">("FIXED");
  const [items, setItems] = useState<PickedItem[]>([]);
  const [title, setTitle] = useState("");
  const [badge, setBadge] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("PERCENT");
  const [discountText, setDiscountText] = useState("15");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const dirty = items.length > 0 || title !== "" || badge !== "";

  // Unsaved-changes guard
  useEffect(() => {
    if (!dirty || saving) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, saving]);

  const effectiveTitle =
    title.trim() ||
    (type === "FIXED"
      ? items
          .map((i) => i.title)
          .join(" + ")
          .slice(0, 80)
      : (items[0]?.title.slice(0, 80) ?? ""));

  /** Merchant-typed discount -> the integer the server stores (percent, or minor units of the shop currency). */
  const discountValue = useMemo(() => {
    const t = discountText.trim();
    if (discountType === "PERCENT") return /^\d+$/.test(t) ? Number(t) : NaN;
    try {
      return decimalToMinor(t, exp);
    } catch {
      return NaN;
    }
  }, [discountText, discountType, exp]);

  const input = {
    type,
    title: effectiveTitle,
    ...(badge.trim() ? { badge: badge.trim() } : {}),
    discountType,
    discountValue: Number.isFinite(discountValue) ? discountValue : 0,
    items: items.map((i) =>
      type === "FIXED"
        ? { productGid: i.gid, quantity: i.quantity }
        : { collectionGid: i.gid, quantity: i.quantity },
    ),
  };
  const parsed = bundleInputSchema.safeParse(input);
  const errors: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);
  if (!Number.isFinite(discountValue))
    errors.discountValue =
      discountType === "PERCENT"
        ? "Enter a whole number from 1 to 90."
        : "Enter an amount like 150 or 149.50.";
  const serverErrors = actionData && !actionData.ok ? actionData.errors : {};
  const show = (k: string) => (touched[k] ? (errors[k] ?? serverErrors[k]) : serverErrors[k]);

  async function pick() {
    const kind = type === "FIXED" ? "product" : "collection";
    const selection = (await shopify.resourcePicker({
      type: kind,
      multiple: type === "FIXED",
      action: "select",
    })) as PickerResource[] | undefined;
    if (!selection?.length) return;
    const next: PickedItem[] = selection.map((r) => {
      let priceMinor = 0;
      try {
        priceMinor = decimalToMinor(r.variants?.[0]?.price ?? "0", exp);
      } catch {
        priceMinor = 0;
      }
      return {
        gid: r.id,
        title: r.title,
        imageUrl: r.images?.[0]?.originalSrc ?? r.image?.originalSrc,
        priceMinor,
        quantity: type === "FIXED" ? 1 : 3,
      };
    });
    setItems((cur) =>
      type === "FIXED" ? [...cur.filter((c) => !next.some((n) => n.gid === c.gid)), ...next] : next,
    );
    setTouched((t) => ({ ...t, items: true }));
  }

  const setQty = (gid: string, q: number) =>
    setItems((cur) =>
      cur.map((i) => (i.gid === gid ? { ...i, quantity: Math.max(1, Math.min(99, q || 1)) } : i)),
    );
  const remove = (gid: string) => setItems((cur) => cur.filter((i) => i.gid !== gid));

  const previewHtml = useMemo(() => {
    if (type !== "FIXED" || items.length === 0 || !Number.isFinite(discountValue)) return "";
    return renderBundleCard({
      id: "preview",
      title: effectiveTitle || "Your bundle",
      badge: badge.trim() || undefined,
      items: items.map((i) => ({
        title: i.title,
        imageUrl: i.imageUrl,
        quantity: i.quantity,
        unitPriceMinor: i.priceMinor,
        productId: i.gid,
      })),
      discountType,
      discountValue: discountValue,
      currency,
      locale: typeof navigator === "undefined" ? "en" : navigator.language,
      labels: {
        bundlePrice: "Bundle price",
        save: "Save {percent}%",
        add: "Add bundle to cart",
        priceAtCheckout: "Price at checkout",
      },
    });
  }, [type, items, effectiveTitle, badge, discountType, discountValue, currency]);

  function next() {
    setTouched((t) => ({ ...t, items: true }));
    if (step === 1 && errors.items) return;
    setStep((s) => Math.min(2, s + 1));
  }
  function save() {
    setTouched({ items: true, title: true, discountValue: true, badge: true });
    if (!parsed.success || !Number.isFinite(discountValue)) return;
    const fd = new FormData();
    fd.set("payload", JSON.stringify(parsed.data));
    submit(fd, { method: "post" });
  }

  return (
    <s-page heading="Create bundle">
      <s-button slot="breadcrumb-actions" href="/app/bundles">
        Bundles
      </s-button>

      {serverErrors.form && (
        <s-banner tone="critical" heading="Could not save">
          {serverErrors.form}
        </s-banner>
      )}

      <s-section heading={`Step ${step + 1} of 3: ${STEPS[step]}`}>
        <s-stack gap="base">
          {step === 0 && (
            <>
              <s-paragraph>What kind of bundle do you want to sell?</s-paragraph>
              <s-choice-list
                label="Bundle type"
                name="type"
                onChange={(e: Event) => {
                  const v = (e.currentTarget as HTMLElement & { values?: string[] }).values?.[0];
                  if (v === "FIXED" || v === "MIX_MATCH") {
                    setType(v);
                    setItems([]);
                  }
                }}
              >
                <s-choice value="FIXED" selected={type === "FIXED"}>
                  Fixed bundle: 2 or more specific products sold together
                </s-choice>
                <s-choice value="MIX_MATCH" selected={type === "MIX_MATCH"}>
                  Mix and match: shoppers pick any N from a collection
                </s-choice>
              </s-choice-list>
            </>
          )}

          {step === 1 && (
            <>
              <s-paragraph>
                {type === "FIXED"
                  ? "Pick at least 2 products."
                  : "Pick the collection shoppers choose from, then how many they pick."}
              </s-paragraph>
              <s-button onClick={pick}>
                {items.length ? "Change selection" : type === "FIXED" ? "Pick products" : "Pick collection"}
              </s-button>
              {items.map((i) => (
                <s-stack key={i.gid} direction="inline" gap="base" alignItems="center">
                  <s-text>{i.title}</s-text>
                  <s-number-field
                    label={type === "FIXED" ? "Quantity" : "Items to pick"}
                    min={type === "FIXED" ? 1 : 2}
                    max={99}
                    value={String(i.quantity)}
                    onInput={(e: Event) => setQty(i.gid, Number((e.currentTarget as HTMLInputElement).value))}
                  />
                  <s-button tone="critical" variant="tertiary" onClick={() => remove(i.gid)}>
                    Remove
                  </s-button>
                </s-stack>
              ))}
              {show("items") && <s-text tone="critical">{show("items")}</s-text>}
            </>
          )}

          {step === 2 && (
            <>
              <s-select
                label="Discount type"
                value={discountType}
                onChange={(e: Event) => {
                  setDiscountType((e.currentTarget as HTMLSelectElement).value as DiscountType);
                  setDiscountText("");
                }}
              >
                <s-option value="PERCENT">Percent off</s-option>
                <s-option value="AMOUNT">{`Amount off (${currency})`}</s-option>
                <s-option value="FIXED_PRICE">{`Fixed bundle price (${currency})`}</s-option>
              </s-select>
              <s-text-field
                label={discountType === "PERCENT" ? "Percent off (1 to 90)" : `Amount in ${currency}`}
                value={discountText}
                error={show("discountValue")}
                onInput={(e: Event) => setDiscountText((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => setTouched((t) => ({ ...t, discountValue: true }))}
              />
              <s-text-field
                label="Title"
                details="Leave empty to use the product names."
                value={title}
                placeholder={effectiveTitle}
                error={show("title")}
                onInput={(e: Event) => setTitle((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              />
              <s-text-field
                label="Badge text (optional)"
                value={badge}
                error={show("badge")}
                onInput={(e: Event) => setBadge((e.currentTarget as HTMLInputElement).value)}
                onBlur={() => setTouched((t) => ({ ...t, badge: true }))}
              />
            </>
          )}

          <s-stack direction="inline" gap="base">
            {step > 0 && <s-button onClick={() => setStep((s) => s - 1)}>Back</s-button>}
            {step < 2 ? (
              <s-button variant="primary" onClick={next}>
                Next
              </s-button>
            ) : (
              <s-button variant="primary" onClick={save} {...(saving ? { loading: true } : {})}>
                Save and activate
              </s-button>
            )}
          </s-stack>
        </s-stack>
      </s-section>

      <s-section heading="Preview">
        {type === "MIX_MATCH" ? (
          <s-paragraph>
            {items[0]
              ? `Shoppers pick ${items[0].quantity} from "${items[0].title}" and get the discount.`
              : "Pick a collection to see how it reads."}
          </s-paragraph>
        ) : previewHtml ? (
          <>
            <style>{BUNDLE_CARD_CSS}</style>
            {/* Output of renderBundleCard: every merchant string is HTML-escaped there. */}
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </>
        ) : (
          <s-paragraph>
            The preview appears once you pick products and a valid discount. If it stays empty, the discount
            may not lower the price.
          </s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (args) => boundary.headers(args);
