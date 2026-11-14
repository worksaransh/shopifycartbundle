// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { activeTierIndex, initVolumeTable } from "../../packages/storefront/src/volume-table";

const html = (withQty = true) => `
${withQty ? `<form action="/cart/add"><input name="quantity" value="1"></form>` : ""}
<div data-bk-volume>
  ${[2, 3, 5].map((m, i) => `<button type="button" data-bk-tier data-min="${m}" data-percent="${[10, 15, 20][i]}"><span>Buy ${m}+</span><span data-bk-selected></span></button>`).join("")}
</div>`;
const setup = (withQty = true, beacon?: { track: () => void; once: () => void; flush: () => void }) => {
  document.body.innerHTML = html(withQty);
  initVolumeTable(document.querySelector<HTMLElement>("[data-bk-volume]")!, { beacon });
  return {
    qty: document.querySelector<HTMLInputElement>("input[name=quantity]"),
    rows: [...document.querySelectorAll<HTMLButtonElement>("[data-bk-tier]")],
  };
};
const active = (rows: HTMLElement[]) => rows.map((r) => r.classList.contains("bk-active"));
const type = (input: HTMLInputElement, v: number) => {
  input.value = String(v);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => (document.body.innerHTML = ""));

describe("volume table", () => {
  it("picks the highest satisfied tier (pure)", () => {
    expect(activeTierIndex([2, 3, 5], 1)).toBe(-1);
    expect(activeTierIndex([2, 3, 5], 2)).toBe(0);
    expect(activeTierIndex([2, 3, 5], 4)).toBe(1);
    expect(activeTierIndex([5, 2, 3], 9)).toBe(0); // order independent
  });
  it("highlights the active tier as the quantity changes, with aria-pressed", () => {
    const { qty, rows } = setup();
    expect(active(rows)).toEqual([false, false, false]);
    type(qty!, 3);
    expect(active(rows)).toEqual([false, true, false]);
    expect(rows[1].getAttribute("aria-pressed")).toBe("true");
    expect(rows[1].querySelector("[data-bk-selected]")!.textContent).toBe("3 selected");
    type(qty!, 7);
    expect(active(rows)).toEqual([false, false, true]);
    type(qty!, 1);
    expect(active(rows)).toEqual([false, false, false]);
  });
  it("tapping a row sets the quantity, fires input/change for the theme, and tracks tier_selected", () => {
    const beacon = { track: vi.fn(), once: vi.fn(), flush: vi.fn() };
    const { qty, rows } = setup(true, beacon);
    const events: string[] = [];
    qty!.addEventListener("input", () => events.push("input"));
    qty!.addEventListener("change", () => events.push("change"));
    rows[2].click();
    expect(qty!.value).toBe("5");
    expect(events).toEqual(["input", "change"]);
    expect(active(rows)).toEqual([false, false, true]);
    expect(beacon.track).toHaveBeenCalledWith("tier_selected", "5");
  });
  it("fails silently when the theme has no quantity input", () => {
    const { rows } = setup(false);
    expect(() => rows[0].click()).not.toThrow();
  });
});
