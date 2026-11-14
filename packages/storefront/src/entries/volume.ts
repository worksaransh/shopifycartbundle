import { createBeacon } from "../beacon";
import { initAllVolumeTables } from "../volume-table";

const run = () => {
  const url = document.querySelector<HTMLElement>("[data-bk-volume]")?.dataset.beacon;
  initAllVolumeTables(document, { beacon: createBeacon(url) });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
