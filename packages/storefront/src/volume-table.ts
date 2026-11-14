import { resolveStrings, t } from "@bundlekit/widgets";
import type { Beacon } from "./beacon";
import { parseJson, safely } from "./util";

/**
 * Volume tier table. Server-rendered rows; this highlights the active tier from the product form quantity and lets
 * a shopper tap a row to set the quantity.
 *   root[data-bk-volume]        script[data-bk-strings]
 *   [data-bk-tier]              <button> with data-min data-percent
 * Quantity input: the product form's input[name=quantity]. If a theme has none, rows are still readable and tapping
 * does nothing (fails silently). We listen to input/change on the document so themes that swap the input still work.
 */
const QTY_SELECTOR =
  'form[action*="/cart/add"] input[name="quantity"], input[name="quantity"][form^="product-form"]';

export function activeTierIndex(mins: number[], qty: number): number {
  let best = -1;
  mins.forEach((m, i) => {
    if (m <= qty && (best === -1 || m > mins[best])) best = i;
  });
  return best;
}

export function initVolumeTable(root: HTMLElement, deps: { beacon?: Beacon } = {}): void {
  safely(() => {
    const strings = resolveStrings(
      parseJson<Record<string, string>>(root.querySelector("script[data-bk-strings]")),
    );
    const rows = [...root.querySelectorAll<HTMLButtonElement>("[data-bk-tier]")];
    if (rows.length === 0) return;
    const mins = rows.map((r) => Number(r.dataset.min));
    const doc = root.ownerDocument;
    const qtyInput = () => doc.querySelector<HTMLInputElement>(QTY_SELECTOR);

    const paint = () => {
      const qty = Number(qtyInput()?.value) || 1;
      const active = activeTierIndex(mins, qty);
      rows.forEach((row, i) => {
        const on = i === active;
        row.classList.toggle("bk-active", on);
        row.setAttribute("aria-pressed", String(on));
        const tag = row.querySelector<HTMLElement>("[data-bk-selected]");
        if (tag) tag.textContent = on ? t(strings["volume.selected"], { qty }) : "";
      });
    };

    for (const type of ["input", "change"])
      doc.addEventListener(type, (e) =>
        safely(() => (e.target as Element | null)?.matches?.("input[name='quantity']") && paint()),
      );
    rows.forEach((row, i) =>
      row.addEventListener("click", () =>
        safely(() => {
          const input = qtyInput();
          if (!input) return;
          input.value = String(mins[i]);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          deps.beacon?.track("tier_selected", `${mins[i]}`);
          paint();
        }),
      ),
    );
    paint();
  });
}

export function initAllVolumeTables(doc: Document, deps: { beacon?: Beacon } = {}): void {
  doc.querySelectorAll<HTMLElement>("[data-bk-volume]").forEach((el) => initVolumeTable(el, deps));
}
