import type { Entitlement, UsageLimits, UsageRecord, UsageSummary } from "../../shared/types.js";
import type { Database } from "../store.js";
import { nowIso } from "../store.js";

/**
 * Honest daily metering. Limits come from the active plan, are enforced on the
 * server before any provider call, and reset at UTC midnight.
 */
export function dayKey(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

const LIMITS: Record<string, UsageLimits> = {
  free: { chatMessages: 25, images: 2, research: 3 },
  "premium-monthly": { chatMessages: 500, images: 50, research: 50 },
  "premium-yearly": { chatMessages: 800, images: 100, research: 100 },
  custom: { chatMessages: 2000, images: 200, research: 200 },
};

const UNLIMITED: UsageLimits = {
  chatMessages: Number.MAX_SAFE_INTEGER,
  images: Number.MAX_SAFE_INTEGER,
  research: Number.MAX_SAFE_INTEGER,
};

export function limitsFor(entitlement: Entitlement): UsageLimits {
  if (entitlement.planId === "custom" && !entitlement.aiAllowed) return UNLIMITED;
  return LIMITS[entitlement.planId] ?? LIMITS.free;
}

export function usageRecord(db: Database, userId: string): UsageRecord {
  const key = `${userId}:${dayKey()}`;
  const existing = db.usage.get(key);
  if (existing) return existing;
  const fresh: UsageRecord = {
    userId,
    day: dayKey(),
    chatMessages: 0,
    images: 0,
    research: 0,
    updatedAt: nowIso(),
  };
  db.usage.set(key, fresh);
  return fresh;
}

export function usageSummary(
  db: Database,
  userId: string,
  entitlement: Entitlement,
): UsageSummary {
  const record = usageRecord(db, userId);
  const limits = limitsFor(entitlement);
  return {
    day: record.day,
    used: {
      chatMessages: record.chatMessages,
      images: record.images,
      research: record.research,
    },
    limits,
    unlimited: limits.chatMessages === UNLIMITED.chatMessages,
  };
}

export class QuotaExceededError extends Error {
  readonly code = "usage_limit_reached";
  readonly status = 429;
  constructor(readonly metric: keyof UsageLimits, readonly limit: number) {
    super(
      `You have used today's allowance of ${limit} ${metric === "chatMessages" ? "AI messages" : metric}. ` +
        `Upgrade your plan or continue tomorrow — your saved work is never deleted.`,
    );
    this.name = "QuotaExceededError";
  }
}

/** Throws before work starts so a user never loses a prompt to a silent cap. */
export function assertQuota(
  db: Database,
  userId: string,
  entitlement: Entitlement,
  metric: keyof UsageLimits,
): void {
  const limits = limitsFor(entitlement);
  if (limits[metric] === UNLIMITED[metric]) return;
  const record = usageRecord(db, userId);
  if (record[metric] >= limits[metric]) {
    throw new QuotaExceededError(metric, limits[metric]);
  }
}

export function consume(
  db: Database,
  userId: string,
  metric: keyof UsageLimits,
  amount = 1,
): void {
  const record = usageRecord(db, userId);
  record[metric] += amount;
  record.updatedAt = nowIso();
  // Keep the map bounded: drop rows older than 30 days.
  const cutoff = dayKey(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  for (const [key, row] of db.usage) {
    if (row.day < cutoff) db.usage.delete(key);
  }
}
