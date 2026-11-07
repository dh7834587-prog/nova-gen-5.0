import type { NextFunction, Request, Response } from "express";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Small fixed-window limiter for the API surface.
 *
 * It is intentionally dependency-free: NOVA must run on free infrastructure.
 * State is per-process, which is enough to blunt brute-force login attempts and
 * runaway client loops on a single instance.
 */
export function createRateLimiter(options: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max } = options;
  const keyOf = options.key ?? ((req: Request) => req.ip ?? "unknown");

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = keyOf(req);
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      if (buckets.size > 5000) {
        for (const [staleKey, stale] of buckets) {
          if (stale.resetAt <= now) buckets.delete(staleKey);
        }
      }
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("retry-after", String(retryAfter));
      res.status(429).json({
        error: {
          code: "rate_limited",
          message: `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
        },
      });
      return;
    }
    next();
  };
}

/** Tighter limiter keyed by submitted email so one attacker cannot spray logins. */
export function emailRateLimiter(windowMs: number, max: number) {
  return createRateLimiter({
    windowMs,
    max,
    key: (req) => {
      const body = req.body as { email?: unknown } | undefined;
      const email = typeof body?.email === "string" ? body.email.toLowerCase().slice(0, 120) : "";
      return email || req.ip || "unknown";
    },
  });
}
