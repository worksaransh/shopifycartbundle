import db from "../db.server";

/** Uptime check: 200 when the app and database answer, 503 otherwise. No secrets, no shop data. */
export const loader = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
};
