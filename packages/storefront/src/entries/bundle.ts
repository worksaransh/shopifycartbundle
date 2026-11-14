import { createBeacon } from "../beacon";
import { initAllBundleBlocks } from "../bundle-block";

const run = () => {
  const url = document.querySelector<HTMLElement>("[data-bk-bundle]")?.dataset.beacon;
  initAllBundleBlocks(document, { beacon: createBeacon(url) });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
