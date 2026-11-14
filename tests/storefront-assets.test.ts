import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRINGS } from "@bundlekit/widgets";
import { BUDGET, buildStorefront } from "../scripts/build-storefront.mjs";

const assets = path.resolve(__dirname, "../extensions/bundlekit-theme");

describe("storefront assets", () => {
  it("stay within the size budgets (total JS < 30 KB gzipped, each file <= 10 KB)", async () => {
    const { sizes, totalJs } = await buildStorefront();
    for (const [name, size] of Object.entries(sizes as Record<string, number>)) {
      if (name.endsWith(".js")) expect(size, name).toBeLessThanOrEqual(BUDGET.perFile);
    }
    expect(totalJs).toBeLessThan(BUDGET.total);
  });
  it("committed assets are up to date with the source (run npm run build:storefront)", async () => {
    const { files } = await buildStorefront();
    for (const [name, code] of Object.entries(files as unknown as Record<string, string>)) {
      expect(await readFile(path.join(assets, "assets", name), "utf8"), name).toBe(code);
    }
  });
  it("Liquid locale file matches the shared default strings exactly", async () => {
    const locale = JSON.parse(await readFile(path.join(assets, "locales/en.default.json"), "utf8"));
    expect(locale).toEqual(DEFAULT_STRINGS);
  });
  it("bundles contain no network calls to a non-Shopify origin", async () => {
    const { files } = await buildStorefront();
    for (const [name, code] of Object.entries(files as unknown as Record<string, string>)) {
      if (name.endsWith(".js")) expect(code, name).not.toMatch(/https?:\/\/(?!schema\.org)/);
    }
  });
  it("every Liquid block has a schema and reads only $app:bundlekit metafields (no server calls at render)", async () => {
    for (const f of ["bundle", "volume", "app-embed"]) {
      const src = await readFile(path.join(assets, `blocks/${f}.liquid`), "utf8");
      expect(src, f).toMatch(/{% schema %}[\s\S]*{% endschema %}/);
      expect(src, f).toContain("$app:bundlekit");
      expect(src, f).not.toMatch(/<script[^>]+src=["']https?:/);
    }
  });
});
