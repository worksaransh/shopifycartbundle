import { z } from "zod";

/**
 * Wizard input. Used on the client (inline validation on blur) and the server (the only trusted check).
 * Messages say what is wrong and what to do (UX rule 9).
 */
const gid = (kind: "Product" | "Collection") =>
  z.string().regex(new RegExp(`^gid://shopify/${kind}/\\d+$`), `Pick a ${kind.toLowerCase()} from the list.`);

export const itemSchema = z
  .object({
    productGid: gid("Product").optional(),
    collectionGid: gid("Collection").optional(),
    handle: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Pick the product again.")
      .max(255)
      .optional(),
    quantity: z
      .number()
      .int("Quantity must be a whole number.")
      .min(1, "Quantity must be at least 1.")
      .max(99, "Quantity can be at most 99."),
  })
  .refine((i) => !!i.productGid !== !!i.collectionGid, "Each item must be one product or one collection.");

export const bundleInputSchema = z
  .object({
    type: z.enum(["FIXED", "MIX_MATCH"]),
    title: z
      .string()
      .trim()
      .min(1, "Give the bundle a title.")
      .max(80, "Title can be at most 80 characters."),
    badge: z.string().trim().max(40, "Badge text can be at most 40 characters.").optional(),
    discountType: z.enum(["PERCENT", "AMOUNT", "FIXED_PRICE"]),
    /** PERCENT: whole number 1-90. AMOUNT / FIXED_PRICE: minor units, > 0. */
    discountValue: z.number().int("Discount must be a whole number.").min(1, "Discount must be more than 0."),
    items: z.array(itemSchema),
  })
  .superRefine((b, ctx) => {
    const add = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    if (b.discountType === "PERCENT" && b.discountValue > 90)
      add("Percent off can be at most 90. Lower the discount.", ["discountValue"]);
    if (b.type === "FIXED") {
      const products = b.items.filter((i) => i.productGid);
      if (products.length < 2) add("Bundle needs at least 2 products. Add another product.", ["items"]);
      if (b.items.some((i) => i.collectionGid))
        add("A fixed bundle uses products, not collections. Remove the collection.", ["items"]);
      if (new Set(products.map((p) => p.productGid)).size !== products.length)
        add("The same product is listed twice. Raise its quantity instead.", ["items"]);
    } else {
      const colls = b.items.filter((i) => i.collectionGid);
      if (colls.length !== 1 || b.items.length !== 1)
        add("Mix-and-match needs exactly one collection. Pick one collection.", ["items"]);
      else if (colls[0].quantity < 2)
        add("Customers must pick at least 2 items. Raise the quantity.", ["items"]);
    }
  });

export type BundleInput = z.infer<typeof bundleInputSchema>;

/** First error per field path, for inline display. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const key = String(i.path[0] ?? "form");
    out[key] ??= i.message;
  }
  return out;
}
