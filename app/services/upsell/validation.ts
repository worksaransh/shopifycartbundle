import { z } from "zod";

const productGid = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/, "Pick a product from the list.");
const collectionGid = z
  .string()
  .regex(/^gid:\/\/shopify\/Collection\/\d+$/, "Pick a collection from the list.");
const handle = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "Pick a product from the list.");

export const upsellInputSchema = z
  .object({
    triggerType: z.enum(["PRODUCT", "COLLECTION"]),
    triggerGids: z
      .array(z.string())
      .min(1, "Pick at least one product or collection that triggers the offer.")
      .max(20, "Pick at most 20 triggers. Use a collection instead."),
    offerGids: z
      .array(productGid)
      .min(1, "Pick at least one product to offer.")
      .max(3, "Offer at most 3 products."),
    offerHandles: z.array(handle).min(1).max(3),
    discountPercent: z
      .number()
      .int("Percent must be a whole number.")
      .min(0)
      .max(90, "Percent off can be at most 90.")
      .optional(),
    maxOffers: z.number().int().min(1, "Show at least 1 offer.").max(3, "Show at most 3 offers."),
    hideIfInCart: z.boolean(),
    layout: z.enum(["CAROUSEL", "STACKED"]),
  })
  .superRefine((u, ctx) => {
    const add = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const kind = u.triggerType === "PRODUCT" ? productGid : collectionGid;
    if (u.triggerGids.some((g) => !kind.safeParse(g).success))
      add(`Pick ${u.triggerType === "PRODUCT" ? "products" : "a collection"} from the list.`, [
        "triggerGids",
      ]);
    if (u.offerHandles.length !== u.offerGids.length) add("Pick the offered products again.", ["offerGids"]);
    if (u.maxOffers > u.offerGids.length)
      add("Max offers cannot be more than the products you offer.", ["maxOffers"]);
    if (u.triggerType === "PRODUCT" && u.offerGids.some((g) => u.triggerGids.includes(g)))
      add("A product cannot be offered on its own page. Remove it from the offers.", ["offerGids"]);
  });

export type UpsellInput = z.infer<typeof upsellInputSchema>;
