import { z } from "zod";
import { DEFAULT_STRINGS, STRING_KEYS, meetsAA } from "@bundlekit/widgets";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a6b4f.");

export const settingsInputSchema = z
  .object({
    killSwitch: z.boolean(),
    shippingBar: z.object({
      enabled: z.boolean(),
      /** Minor units of the shop currency, as digits. */
      thresholdMinor: z.string().regex(/^\d{1,12}$/, "Enter an amount like 500 or 499.50."),
    }),
    colours: z.object({ accent: hex, text: hex, background: hex }),
    cartSelector: z
      .string()
      .trim()
      .max(120, "Selector can be at most 120 characters.")
      .regex(/^[^<>{}]*$/, "Enter a CSS selector like #cart-drawer .cart__items.")
      .optional(),
    strings: z.record(z.string(), z.string().max(200, "Each message can be at most 200 characters.")),
  })
  .superRefine((s, ctx) => {
    const add = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });
    if (s.shippingBar.enabled && Number(s.shippingBar.thresholdMinor) <= 0)
      add("Free-shipping amount must be more than 0.", ["shippingBar", "thresholdMinor"]);
    for (const k of Object.keys(s.strings)) {
      if (!(k in DEFAULT_STRINGS)) add(`Unknown message "${k}".`, ["strings", k]);
    }
    const progress = s.strings["shipping.progress"];
    if (progress && !progress.includes("{amount}"))
      add("The progress message needs {amount} so shoppers see what is left.", [
        "strings",
        "shipping.progress",
      ]);
  });

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/** Non-blocking warnings (contrast below WCAG AA 4.5:1). Colour is never the only signal; we still warn. */
export function contrastWarnings(c: { accent: string; text: string; background: string }): string[] {
  const out: string[] = [];
  if (!meetsAA(c.text, c.background))
    out.push("Text on background is below 4.5:1 contrast. Pick a darker text or lighter background.");
  if (!meetsAA("#ffffff", c.accent))
    out.push("White button text on the accent colour is below 4.5:1 contrast. Pick a darker accent.");
  return out;
}

export { STRING_KEYS };
