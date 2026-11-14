import pino from "pino";

/** Paths whose values must never reach logs. Wildcards cover one nesting level. */
export const REDACT_PATHS = [
  "accessToken",
  "refreshToken",
  "access_token",
  "refresh_token",
  "id_token",
  "token",
  "password",
  "authorization",
  "email",
  "*.accessToken",
  "*.refreshToken",
  "*.access_token",
  "*.refresh_token",
  "*.id_token",
  "*.token",
  "*.authorization",
  "*.email",
  'headers["x-shopify-access-token"]',
  'headers["x-shopify-hmac-sha256"]',
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

export function createLogger(opts: { level?: string; destination?: pino.DestinationStream } = {}) {
  return pino(
    {
      level: opts.level ?? process.env.LOG_LEVEL ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
      base: { app: "bundlekit" },
    },
    opts.destination,
  );
}

export const logger = createLogger();
