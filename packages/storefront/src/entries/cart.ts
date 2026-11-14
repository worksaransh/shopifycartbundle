import { createBeacon } from "../beacon";
import { initCartEmbed, type EmbedData } from "../cart-embed";
import { parseJson } from "../util";

const run = () => {
  const node = document.getElementById("bk-cart-config");
  const data = parseJson<EmbedData & { beacon?: string }>(node);
  if (!data) return;
  initCartEmbed(data, { beacon: createBeacon(data.beacon) });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
