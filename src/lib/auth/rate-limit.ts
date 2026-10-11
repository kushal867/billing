import { db } from "@/lib/db";

/**
 * Fixed-window counter stored in PostgreSQL so it works across serverless instances.
 * Every call counts as one attempt. Returns allowed=false once `max` is exceeded.
 */
export async function hitRateLimit(key: string, opts: { max: number; windowMs: number }) {
  const rows = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart")
    VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" < now() - (${opts.windowMs} * interval '1 millisecond') THEN 1 ELSE "RateLimit"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimit"."windowStart" < now() - (${opts.windowMs} * interval '1 millisecond') THEN now() ELSE "RateLimit"."windowStart" END
    RETURNING "count", "windowStart"`;
  const { count, windowStart } = rows[0];
  const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + opts.windowMs - Date.now()) / 1000));
  return { allowed: count <= opts.max, retryAfterSec, count };
}

export async function resetRateLimit(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}
