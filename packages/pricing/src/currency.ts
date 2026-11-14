/** ISO 4217 minor-unit exponents that are not 2. Everything else defaults to 2. */
const ZERO = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const THREE = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(code: string): number {
  const c = code.toUpperCase();
  return ZERO.has(c) ? 0 : THREE.has(c) ? 3 : 2;
}
