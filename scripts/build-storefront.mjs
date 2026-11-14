// Bundles the storefront modules into the theme extension's assets (vanilla JS, no framework) and writes the CSS.
// Usage: node scripts/build-storefront.mjs [--check]
//   --check  builds in memory and fails if the committed assets differ or a size budget is exceeded.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "extensions/bundlekit-theme/assets");

export const ENTRIES = {
  "bundlekit-bundle.js": "packages/storefront/src/entries/bundle.ts",
  "bundlekit-volume.js": "packages/storefront/src/entries/volume.ts",
  "bundlekit-cart.js": "packages/storefront/src/entries/cart.ts",
};
/** Budgets, gzipped bytes. Brief: total storefront JS under 30 KB gzipped; Shopify suggests <=10 KB per file. */
export const BUDGET = { perFile: 10 * 1024, total: 30 * 1024 };

export async function buildStorefront() {
  const files = {};
  for (const [name, entry] of Object.entries(ENTRIES)) {
    const res = await build({
      entryPoints: [path.join(root, entry)],
      bundle: true,
      minify: true,
      format: "iife",
      target: "es2019",
      write: false,
      legalComments: "none",
      logLevel: "silent",
    });
    files[name] = res.outputFiles[0].text;
  }
  const { STOREFRONT_CSS } = await import("../packages/widgets/src/styles.ts").catch(async () => {
    // plain node cannot load .ts: bundle the stylesheet module on the fly
    const r = await build({
      entryPoints: [path.join(root, "packages/widgets/src/styles.ts")],
      bundle: true,
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    return import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
  });
  files["bundlekit.css"] = STOREFRONT_CSS;
  const sizes = Object.fromEntries(Object.entries(files).map(([n, c]) => [n, gzipSync(c).length]));
  const totalJs = Object.entries(sizes)
    .filter(([n]) => n.endsWith(".js"))
    .reduce((a, [, b]) => a + b, 0);
  return { files, sizes, totalJs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const { files, sizes, totalJs } = await buildStorefront();
  console.log("gzipped bytes:", sizes, "total JS:", totalJs);
  const over = Object.entries(sizes)
    .filter(([n, s]) => n.endsWith(".js") && s > BUDGET.perFile)
    .map(([n]) => n);
  if (over.length || totalJs > BUDGET.total) {
    console.error("Size budget exceeded:", over, totalJs);
    process.exit(1);
  }
  if (check) {
    for (const [n, c] of Object.entries(files)) {
      const have = await readFile(path.join(outDir, n), "utf8").catch(() => null);
      if (have !== c) {
        console.error(`Stale or missing asset: ${n}. Run: npm run build:storefront`);
        process.exit(1);
      }
    }
  } else {
    await mkdir(outDir, { recursive: true });
    for (const [n, c] of Object.entries(files)) await writeFile(path.join(outDir, n), c);
  }
}
