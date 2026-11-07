import { randomToken, sha256 } from "../auth/passwords.js";
import type { PendingAuthToken, StoredUser } from "../../shared/types.js";
import { newId, nowIso, type AuthTokenRecord, type Database } from "../store.js";

/**
 * One-time tokens for password reset and email verification.
 *
 * NOVA is built to run on free infrastructure, so no mail provider is bundled.
 * Instead of pretending an email was sent, reset/verification links are
 * delivered manually by the owner from the Owner Control Centre. Only the
 * SHA-256 hash of each token is stored; the raw value exists once, in the
 * response to the owner who generated it.
 */

const TTL_MS: Record<AuthTokenRecord["purpose"], number> = {
  password_reset: 1000 * 60 * 60, // 1 hour
  email_verification: 1000 * 60 * 60 * 24, // 24 hours
};

function prune(db: Database): void {
  const now = Date.now();
  for (const [id, record] of db.authTokens) {
    if (record.usedAt || new Date(record.expiresAt).getTime() <= now) {
      // Keep used/expired rows for one day so the owner audit view stays useful.
      if (new Date(record.expiresAt).getTime() + 86_400_000 <= now) db.authTokens.delete(id);
    }
  }
}

export function createAuthToken(
  db: Database,
  user: StoredUser,
  purpose: AuthTokenRecord["purpose"],
): { token: string; expiresAt: string } {
  prune(db);
  // Invalidate older unused tokens for the same purpose so only the newest works.
  for (const [id, record] of db.authTokens) {
    if (record.userId === user.id && record.purpose === purpose && !record.usedAt) {
      record.usedAt = nowIso();
      db.authTokens.set(id, record);
    }
  }
  const id = newId();
  const secret = randomToken(32);
  const token = `${id}.${secret}`;
  const expiresAt = new Date(Date.now() + TTL_MS[purpose]).toISOString();
  const record: AuthTokenRecord = {
    id,
    userId: user.id,
    email: user.email,
    purpose,
    tokenHash: sha256(token),
    createdAt: nowIso(),
    expiresAt,
    usedAt: null,
  };
  db.authTokens.set(id, record);
  return { token, expiresAt };
}

export function consumeAuthToken(
  db: Database,
  purpose: AuthTokenRecord["purpose"],
  token: string,
): StoredUser | null {
  const separator = token.indexOf(".");
  if (separator <= 0) return null;
  const id = token.slice(0, separator);
  const record = db.authTokens.get(id);
  if (!record || record.purpose !== purpose || record.usedAt) return null;
  if (new Date(record.expiresAt).getTime() <= Date.now()) return null;
  if (record.tokenHash !== sha256(token)) return null;

  const user = db.users.get(record.userId);
  if (!user) return null;
  record.usedAt = nowIso();
  db.authTokens.set(record.id, record);
  return user;
}

/** Owner-facing queue. Links are intentionally absent: only minted once. */
export function listPendingTokens(db: Database): PendingAuthToken[] {
  prune(db);
  const rows: PendingAuthToken[] = [];
  for (const record of db.authTokens.values()) {
    if (record.usedAt) continue;
    if (new Date(record.expiresAt).getTime() <= Date.now()) continue;
    rows.push({
      id: record.id,
      email: record.email,
      purpose: record.purpose,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      link: null,
    });
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revokeAuthTokens(db: Database, userId: string): void {
  for (const [id, record] of db.authTokens) {
    if (record.userId === userId && !record.usedAt) {
      record.usedAt = nowIso();
      db.authTokens.set(id, record);
    }
  }
}
