import { Router } from "express";
import { z } from "zod";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "../auth/passwords.js";
import { destroySession, destroyUserSessions } from "../auth/sessions.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentSession, currentUser, HttpError, log, parseBody, save, toPublicUser } from "../http.js";
import type { Database } from "../store.js";

const passwordSchema = z.object({
  currentPassword: z.string().max(200).default(""),
  newPassword: z.string().min(1, "Enter a new password.").max(200),
});

const preferencesSchema = z.object({
  accent: z.enum(["violet", "purple", "indigo"]).optional(),
  compactNav: z.boolean().optional(),
});

export function accountRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser);

  router.get("/sessions", (_req, res) => {
    const user = currentUser(res);
    const active = currentSession(res);
    const sessions = [...db.sessions.values()]
      .filter((session) => session.userId === user.id)
      .map((session) => ({
        id: session.id,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        userAgent: session.userAgent,
        current: session.id === active?.id,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ sessions });
  });

  router.delete("/sessions", (_req, res) => {
    const user = currentUser(res);
    destroyUserSessions(db, user.id);
    log(db, user, "account.sessions_revoked", "All sessions signed out");
    save(db);
    res.json({ ok: true, message: "Every session was signed out. Sign in again to continue." });
  });

  router.delete("/sessions/:id", (req, res) => {
    const user = currentUser(res);
    const session = db.sessions.get(req.params.id);
    if (!session || session.userId !== user.id) {
      throw new HttpError(404, "not_found", "That session does not exist.");
    }
    destroySession(db, session.id);
    save(db);
    res.json({ ok: true });
  });

  router.patch(
    "/password",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(passwordSchema, req.body);

      if (user.passwordHash) {
        const valid = await verifyPassword(input.currentPassword, {
          hash: user.passwordHash,
          salt: user.passwordSalt,
        });
        if (!valid) {
          throw new HttpError(403, "invalid_password", "Your current password is incorrect.");
        }
      }

      const policy = checkPasswordPolicy(input.newPassword);
      if (!policy.ok) {
        throw new HttpError(400, "weak_password", policy.message ?? "Choose a stronger password.");
      }

      const digest = await hashPassword(input.newPassword);
      user.passwordHash = digest.hash;
      user.passwordSalt = digest.salt;
      log(db, user, "account.password_changed", "Password updated from Settings");
      save(db);
      res.json({ user: toPublicUser(user), message: "Password updated." });
    }),
  );

  router.patch("/preferences", (req, res) => {
    const user = currentUser(res);
    const input = parseBody(preferencesSchema, req.body);
    if (input.accent !== undefined) user.preferences.accent = input.accent;
    if (input.compactNav !== undefined) user.preferences.compactNav = input.compactNav;
    save(db);
    res.json({ user: toPublicUser(user) });
  });

  return router;
}
