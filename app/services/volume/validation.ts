import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31.");
const productGid = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/, "Pick a product from the list.");
const collectionGid = z
  .string()
  .regex(/^gid:\/\/shopify\/Collection\/\d+$/, "Pick a collection from the list.");

export const tierInputSchema = z.object({
  minQty: z.number().int("Quantity must be a whole number.").min(2, "A tier starts at 2 or more items."),
  percentOff: z
    .number()
    .int("Percent must be a whole number.")
    .min(1, "Percent off must be at least 1.")
    .max(90, "Percent off can be at most 90."),
});

export const volumeInputSchema = z
  .object({
    targetType: z.enum(["PRODUCT", "COLLECTION"]),
    targetGids: z
      .array(z.string())
      .min(1, "Pick at least one product or collection.")
      .max(50, "Pick at most 50. Use a collection instead."),
    tiers: z.array(tierInputSchema).min(2, "Add at least 2 tiers.").max(5, "Use at most 5 tiers."),
    startsAt: date.optional(),
    endsAt: date.optional(),
  })
  .superRefine((v, ctx) => {
    const add = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    const kind = v.targetType === "PRODUCT" ? productGid : collectionGid;
    if (v.targetGids.some((g) => !kind.safeParse(g).success))
      add(`Pick ${v.targetType === "PRODUCT" ? "products" : "collections"} from the list.`, ["targetGids"]);
    if (v.targetType === "COLLECTION" && v.targetGids.length > 1)
      add("Pick one collection per rule.", ["targetGids"]);
    v.tiers.forEach((t, i) => {
      if (i > 0 && t.minQty <= v.tiers[i - 1].minQty)
        add(`Tier ${i + 1} must start above ${v.tiers[i - 1].minQty}. Raise the quantity.`, ["tiers"]);
      if (i > 0 && t.percentOff < v.tiers[i - 1].percentOff)
        add(`Tier ${i + 1} should not give less than tier ${i}. Raise the percent.`, ["tiers"]);
    });
    if (v.startsAt && v.endsAt && v.endsAt < v.startsAt)
      add("The end date is before the start date. Pick a later end date.", ["endsAt"]);
  });

export type VolumeInput = z.infer<typeof volumeInputSchema>;

export function volumeFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
}
