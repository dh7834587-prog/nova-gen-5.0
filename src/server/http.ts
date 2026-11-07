import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import type { PublicUser, StoredUser } from "../shared/types.js";
import { recordAudit } from "./services/audit.js";
import { schedulePersist, type Database, type SessionRecord } from "./store.js";
import { env } from "./env.js";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    permissions: user.permissions,
    preferences: user.preferences,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

/** Wraps an async handler so rejections reach the error middleware. */
export function asyncHandler<T extends Request>(
  handler: (req: T, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req as T, res, next).catch(next);
  };
}

export function parseBody<S extends ZodType>(schema: S, body: unknown): S["_output"] {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = (result.error as ZodError).issues[0];
    const path = first?.path.join(".") ?? "body";
    throw new HttpError(400, "invalid_request", `${path}: ${first?.message ?? "invalid value"}`);
  }
  return result.data;
}

export function currentUser(res: Response): StoredUser {
  const user = res.locals.user as StoredUser | undefined;
  if (!user) throw new HttpError(401, "unauthenticated", "Sign in to continue.");
  return user;
}

export function currentSession(res: Response): SessionRecord | undefined {
  return res.locals.session as SessionRecord | undefined;
}

export function save(db: Database): void {
  schedulePersist(db, env.dataDir);
}

export function log(
  db: Database,
  user: StoredUser | null,
  action: string,
  detail?: string,
): void {
  recordAudit(db, {
    actorId: user?.id ?? null,
    actorEmail: user?.email ?? "anonymous",
    action,
    ...(detail ? { detail } : {}),
  });
}
