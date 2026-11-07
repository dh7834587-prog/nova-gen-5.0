import type { AuditEvent } from "../../shared/types.js";
import { newId, nowIso, schedulePersist, type Database } from "../store.js";
import { env } from "../env.js";

const MAX_AUDIT_EVENTS = 500;

/**
 * Append-only activity trail. Used by the dashboard "recent activity" feed and
 * the owner audit view. Owners see every actor; members only see their own.
 */
export function recordAudit(
  db: Database,
  entry: { actorId: string | null; actorEmail: string; action: string; detail?: string },
): AuditEvent {
  const event: AuditEvent = {
    id: newId(),
    at: nowIso(),
    actorId: entry.actorId,
    actorEmail: entry.actorEmail,
    action: entry.action,
    ...(entry.detail ? { detail: entry.detail } : {}),
  };
  db.audit.unshift(event);
  if (db.audit.length > MAX_AUDIT_EVENTS) db.audit.length = MAX_AUDIT_EVENTS;
  schedulePersist(db, env.dataDir);
  return event;
}

export function auditForUser(db: Database, userId: string, limit = 12): AuditEvent[] {
  return db.audit.filter((event) => event.actorId === userId).slice(0, limit);
}
