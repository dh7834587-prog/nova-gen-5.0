import type { NextFunction, Request, Response } from "express";
import { canAccessModule, findModuleById } from "../../shared/modules.js";
import type { StoredUser } from "../../shared/types.js";
import { HttpError } from "../http.js";
import type { Database, SessionRecord } from "../store.js";
import { readSessionCookie, resolveSession } from "./sessions.js";

export interface AuthGuards {
  attachUser: (req: Request, res: Response, next: NextFunction) => void;
  requireUser: (req: Request, res: Response, next: NextFunction) => void;
  requireOwner: (req: Request, res: Response, next: NextFunction) => void;
  requireModule: (moduleId: string) => (req: Request, res: Response, next: NextFunction) => void;
}

/**
 * Server-side authorisation. The client hides modules it cannot use, but these
 * guards are the actual boundary: every mutating and reading endpoint runs
 * through them.
 */
export function createAuthGuards(db: Database): AuthGuards {
  function attachUser(req: Request, res: Response, next: NextFunction): void {
    const token = readSessionCookie(req);
    const session: SessionRecord | null = resolveSession(db, token);
    if (session) {
      const user = db.users.get(session.userId);
      if (user && user.status === "active") {
        res.locals.user = user;
        res.locals.session = session;
        res.locals.sessionToken = token;
      }
    }
    next();
  }

  function requireUser(_req: Request, res: Response, next: NextFunction): void {
    if (!res.locals.user) {
      next(new HttpError(401, "unauthenticated", "Sign in to continue."));
      return;
    }
    next();
  }

  function requireOwner(_req: Request, res: Response, next: NextFunction): void {
    const user = res.locals.user as StoredUser | undefined;
    if (!user) {
      next(new HttpError(401, "unauthenticated", "Sign in to continue."));
      return;
    }
    if (user.role !== "owner") {
      next(new HttpError(403, "forbidden", "Only the workspace owner can open this module."));
      return;
    }
    next();
  }

  function requireModule(moduleId: string) {
    return (_req: Request, res: Response, next: NextFunction): void => {
      const user = res.locals.user as StoredUser | undefined;
      if (!user) {
        next(new HttpError(401, "unauthenticated", "Sign in to continue."));
        return;
      }
      const module = findModuleById(moduleId);
      if (!module) {
        next(new HttpError(404, "unknown_module", "That module does not exist."));
        return;
      }
      if (!canAccessModule(user, module)) {
        next(
          new HttpError(403, "module_disabled", `Your account does not have access to ${module.title}.`),
        );
        return;
      }
      next();
    };
  }

  return { attachUser, requireUser, requireOwner, requireModule };
}
