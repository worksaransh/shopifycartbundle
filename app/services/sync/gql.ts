/**
 * Cost-aware Admin GraphQL client: retries throttling (HTTP 429, GraphQL THROTTLED) and 5xx / network
 * errors with exponential backoff + jitter, honouring Retry-After. Never retries 4xx or other GraphQL errors.
 * Throttling reference: https://shopify.dev/docs/api/usage/rate-limits (GraphQL Admin: THROTTLED error code).
 */
export interface AdminLike {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

export class ShopifyApiError extends Error {
  constructor(
    message: string,
    readonly retriable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export interface GqlOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (info: { attempt: number; delayMs: number; reason: string }) => void;
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"]);

function statusOf(e: unknown): number | undefined {
  const o = e as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } } | null;
  const s = o?.status ?? o?.statusCode ?? o?.response?.status;
  return typeof s === "number" ? s : undefined;
}

function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true; // fetch failed
  const code =
    (e as { code?: unknown; cause?: { code?: unknown } } | null)?.code ??
    (e as { cause?: { code?: unknown } })?.cause?.code;
  return typeof code === "string" && NETWORK_CODES.has(code);
}

interface GqlBody {
  data?: unknown;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost?: number;
      throttleStatus?: { currentlyAvailable?: number; restoreRate?: number };
    };
  };
}

export class GqlClient {
  private readonly o: Required<Omit<GqlOptions, "onRetry">> & Pick<GqlOptions, "onRetry">;
  constructor(
    private readonly admin: AdminLike,
    opts: GqlOptions = {},
  ) {
    this.o = {
      maxRetries: opts.maxRetries ?? 4,
      baseDelayMs: opts.baseDelayMs ?? 500,
      maxDelayMs: opts.maxDelayMs ?? 8000,
      sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: opts.random ?? Math.random,
      onRetry: opts.onRetry,
    };
  }

  private backoff(attempt: number, hintMs?: number): number {
    const exp = Math.min(this.o.maxDelayMs, this.o.baseDelayMs * 2 ** attempt);
    const jittered = exp * (0.75 + this.o.random() * 0.5);
    return Math.min(this.o.maxDelayMs, Math.max(hintMs ?? 0, jittered));
  }

  async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let lastReason = "";
    for (let attempt = 0; ; attempt++) {
      let hint: number | undefined;
      let retryReason: string | null = null;
      try {
        const res = await this.admin.graphql(query, { variables });
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get("retry-after"));
          hint = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
          retryReason = `HTTP ${res.status}`;
        } else if (res.status >= 400) {
          throw new ShopifyApiError(`Shopify returned HTTP ${res.status}`, false, res.status);
        } else {
          const body = (await res.json()) as GqlBody;
          if (body.errors?.length) {
            if (body.errors.some((e) => e.extensions?.code === "THROTTLED")) {
              const c = body.extensions?.cost;
              const need = (c?.requestedQueryCost ?? 0) - (c?.throttleStatus?.currentlyAvailable ?? 0);
              const rate = c?.throttleStatus?.restoreRate ?? 0;
              hint = need > 0 && rate > 0 ? Math.ceil((need / rate) * 1000) : undefined;
              retryReason = "THROTTLED";
            } else {
              throw new ShopifyApiError(body.errors.map((e) => e.message).join("; "), false, res.status);
            }
          } else {
            return body.data as T;
          }
        }
      } catch (e) {
        if (e instanceof ShopifyApiError) throw e;
        const status = statusOf(e);
        if (status !== undefined && (status === 429 || status >= 500)) retryReason = `HTTP ${status}`;
        else if (status === undefined && isNetworkError(e)) retryReason = "network error";
        else throw new ShopifyApiError(e instanceof Error ? e.message : "request failed", false, status);
      }
      lastReason = retryReason ?? lastReason;
      if (attempt >= this.o.maxRetries) {
        throw new ShopifyApiError(
          `Shopify kept failing (${lastReason}) after ${attempt + 1} attempts`,
          true,
          undefined,
        );
      }
      const delayMs = this.backoff(attempt, hint);
      this.o.onRetry?.({ attempt: attempt + 1, delayMs, reason: lastReason });
      await this.o.sleep(delayMs);
    }
  }
}
