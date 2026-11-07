import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEvent,
  Conversation,
  CreativeProject,
  MemoryRecord,
  NoteRecord,
  ResearchRecord,
  SessionInfo,
  SnippetRecord,
  StoredFile,
  StoredUser,
  TaskRecord,
} from "../shared/types.js";

export interface SessionRecord extends SessionInfo {
  /** SHA-256 of the cookie token, so a leaked store cannot mint cookies. */
  tokenHash: string;
}

export interface Database {
  users: Map<string, StoredUser>;
  sessions: Map<string, SessionRecord>;
  conversations: Map<string, Conversation>;
  memories: Map<string, MemoryRecord>;
  tasks: Map<string, TaskRecord>;
  notes: Map<string, NoteRecord>;
  snippets: Map<string, SnippetRecord>;
  research: Map<string, ResearchRecord>;
  creative: Map<string, CreativeProject>;
  files: Map<string, StoredFile>;
  audit: AuditEvent[];
}

export function newId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createDatabase(): Database {
  return {
    users: new Map(),
    sessions: new Map(),
    conversations: new Map(),
    memories: new Map(),
    tasks: new Map(),
    notes: new Map(),
    snippets: new Map(),
    research: new Map(),
    creative: new Map(),
    files: new Map(),
    audit: [],
  };
}

/**
 * Every record carries `ownerId`. Reads always go through these helpers so a
 * request can only ever see rows belonging to the authenticated account.
 */
export function listOwned<T extends { ownerId: string; createdAt: string }>(
  collection: Map<string, T>,
  ownerId: string,
): T[] {
  const rows: T[] = [];
  for (const row of collection.values()) {
    if (row.ownerId === ownerId) rows.push(row);
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOwned<T extends { ownerId: string }>(
  collection: Map<string, T>,
  ownerId: string,
  id: string,
): T | undefined {
  const row = collection.get(id);
  if (!row || row.ownerId !== ownerId) return undefined;
  return row;
}

export function countOwned<T extends { ownerId: string }>(
  collection: Map<string, T>,
  ownerId: string,
): number {
  let total = 0;
  for (const row of collection.values()) {
    if (row.ownerId === ownerId) total += 1;
  }
  return total;
}

export function findByEmail(db: Database, email: string): StoredUser | undefined {
  const normalised = email.trim().toLowerCase();
  for (const user of db.users.values()) {
    if (user.email === normalised) return user;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Optional JSON snapshot persistence                                  */
/* ------------------------------------------------------------------ */

interface SerializedDatabase {
  users: StoredUser[];
  sessions: SessionRecord[];
  conversations: Conversation[];
  memories: MemoryRecord[];
  tasks: TaskRecord[];
  notes: NoteRecord[];
  snippets: SnippetRecord[];
  research: ResearchRecord[];
  creative: CreativeProject[];
  files: (Omit<StoredFile, "data"> & { data: string })[];
  audit: AuditEvent[];
}

export function snapshotPath(dataDir: string): string {
  return path.join(dataDir, "nova-data.json");
}

export function serialize(db: Database): SerializedDatabase {
  return {
    users: [...db.users.values()],
    sessions: [...db.sessions.values()],
    conversations: [...db.conversations.values()],
    memories: [...db.memories.values()],
    tasks: [...db.tasks.values()],
    notes: [...db.notes.values()],
    snippets: [...db.snippets.values()],
    research: [...db.research.values()],
    creative: [...db.creative.values()],
    files: [...db.files.values()].map((file) => ({ ...file, data: file.data.toString("base64") })),
    audit: db.audit,
  };
}

export function hydrate(db: Database, raw: SerializedDatabase): void {
  for (const user of raw.users ?? []) db.users.set(user.id, user);
  for (const session of raw.sessions ?? []) db.sessions.set(session.id, session);
  for (const row of raw.conversations ?? []) db.conversations.set(row.id, row);
  for (const row of raw.memories ?? []) db.memories.set(row.id, row);
  for (const row of raw.tasks ?? []) db.tasks.set(row.id, row);
  for (const row of raw.notes ?? []) db.notes.set(row.id, row);
  for (const row of raw.snippets ?? []) db.snippets.set(row.id, row);
  for (const row of raw.research ?? []) db.research.set(row.id, row);
  for (const row of raw.creative ?? []) db.creative.set(row.id, row);
  for (const file of raw.files ?? []) {
    db.files.set(file.id, { ...file, data: Buffer.from(file.data, "base64") });
  }
  db.audit = raw.audit ?? [];
}

export function loadDatabase(dataDir: string | null): Database {
  const db = createDatabase();
  if (!dataDir) return db;
  const file = snapshotPath(dataDir);
  try {
    if (!fs.existsSync(file)) return db;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as SerializedDatabase;
    hydrate(db, parsed);
  } catch (error) {
    console.error("[store] could not read data snapshot, starting empty:", error);
  }
  return db;
}

let persistTimer: NodeJS.Timeout | null = null;

/** Debounced atomic write of the whole store (small prototype dataset). */
export function schedulePersist(db: Database, dataDir: string | null): void {
  if (!dataDir) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const file = snapshotPath(dataDir);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(serialize(db)));
      fs.renameSync(tmp, file);
    } catch (error) {
      console.error("[store] snapshot write failed:", error);
    }
  }, 300);
  persistTimer.unref?.();
}

export function purgeExpiredSessions(db: Database): void {
  const now = Date.now();
  for (const [id, session] of db.sessions) {
    if (new Date(session.expiresAt).getTime() <= now) db.sessions.delete(id);
  }
}
