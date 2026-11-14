/**
 * Tiny DOM helpers. Everything here must be safe to call on any theme: no throws, no assumptions.
 */
export const gid = (kind: "Product" | "ProductVariant", n: number | string): string =>
  `gid://shopify/${kind}/${n}`;

/** Run `fn`; on any error do nothing (a widget must never break the page). */
export function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* widgets degrade to nothing */
  }
}

const SR_ONLY =
  "position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap";

/** A polite live region for status messages (cart updates, errors). Created once per root. */
export function liveRegion(root: HTMLElement): (message: string, opts?: { focus?: boolean }) => void {
  let node = root.querySelector<HTMLElement>("[data-bk-status]");
  if (!node) {
    node = root.ownerDocument.createElement("div");
    node.setAttribute("data-bk-status", "");
    node.style.cssText = SR_ONLY;
    root.appendChild(node);
  }
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  node.setAttribute("tabindex", "-1");
  const region = node;
  return (message, opts) => {
    region.textContent = "";
    // re-set on the next tick so screen readers announce repeated identical messages
    setTimeout(() => {
      region.textContent = message;
      if (opts?.focus) region.focus();
    }, 20);
  };
}

export const prefersReducedMotion = (win: Window = window): boolean =>
  !!win.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function parseJson<T>(node: Element | null): T | null {
  try {
    return node?.textContent ? (JSON.parse(node.textContent) as T) : null;
  } catch {
    return null;
  }
}
