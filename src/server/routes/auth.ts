import { Router } from "express";
import { z } from "zod";
import { accessibleModuleIds } from "../../shared/modules.js";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import type { StoredUser } from "../../shared/types.js";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "../auth/passwords.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  destroyUserSessions,
  readSessionCookie,
  setSessionCookie,
} from "../auth/sessions.js";
import { env } from "../env.js";
import {
  asyncHandler,
  currentUser,
  HttpError,
  log,
  parseBody,
  save,
  toPublicUser,
} from "../http.js";
import { consumeAuthToken, createAuthToken, revokeAuthTokens } from "../services/authTokens.js";
import {
  buildAuthorizeUrl,
  consumeOAuthState,
  createOAuthState,
  exchangeCode,
  isOAuthProvider,
  listAuthProviders,
  oauthRedirectUri,
  providerConfigured,
} from "../services/oauth.js";
import { findByEmail, hasOwner, newId, nowIso, type Database } from "../store.js";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(200)
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value), {
    message: "Enter a valid email address.",
  });

const registerSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(80),
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

function baseUrl(req: { protocol: string; get: (name: string) => string | undefined }): string {
  if (env.publicBaseUrl) return env.publicBaseUrl;
  const host = req.get("host") ?? `localhost:${env.port}`;
  return `${req.protocol}://${host}`;
}

/** The first account (or the configured owner email) becomes the owner. */
function resolveRole(email: string): "owner" | "member" {
  if (env.ownerEmail) return email === env.ownerEmail ? "owner" : "member";
  return hasOwnerFlag ? "member" : "owner";
}

let hasOwnerFlag = false;

export function authRoutes(db: Database): Router {
  const router = Router();

  router.get("/providers", (_req, res) => {
    res.json({ providers: listAuthProviders() });
  });

  router.post(
    "/register",
    asyncHandler(async (req, res) => {
      const input = parseBody(registerSchema, req.body);
      const policy = checkPasswordPolicy(input.password);
      if (!policy.ok) {
        throw new HttpError(400, "weak_password", policy.message ?? "Choose a stronger password.");
      }
      if (findByEmail(db, input.email)) {
        throw new HttpError(409, "email_taken", "An account with that email already exists.");
      }

      hasOwnerFlag = hasOwner(db);
      const role = resolveRole(input.email);
      const digest = await hashPassword(input.password);
      const timestamp = nowIso();
      const user: StoredUser = {
        id: newId(),
        email: input.email,
        name: input.name,
        role,
        status: "active",
        permissions: { modules: "all", aiAccess: true },
        preferences: { accent: "violet", compactNav: false },
        createdAt: timestamp,
        lastLoginAt: timestamp,
        passwordHash: digest.hash,
        passwordSalt: digest.salt,
      };
      db.users.set(user.id, user);
      const subscription = createTrialSubscription(user.id);
      db.subscriptions.set(user.id, subscription);

      const { token } = createSession(db, user.id, req.get("user-agent") ?? "");
      setSessionCookie(req, res, token);
      log(db, user, "auth.register", `${user.email} created a ${role} account`);
      save(db);

      res.status(201).json({
        user: toPublicUser(user),
        entitlement: computeEntitlement(subscription),
        accessibleModules: accessibleModuleIds(user),
      });
    }),
  );

  router.post(
    "/login",
    asyncHandler(async (req, res) => {
      const input = parseBody(loginSchema, req.body);
      const user = findByEmail(db, input.email);
      if (!user) {
        throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      if (!user.passwordHash) {
        throw new HttpError(
          409,
          "password_not_set",
          "This account signs in with Google or Facebook. Add a password in Settings to enable email sign-in.",
        );
      }
      const valid = await verifyPassword(input.password, {
        hash: user.passwordHash,
        salt: user.passwordSalt,
      });
      if (!valid) {
        log(db, user, "auth.login_failed", `Failed password attempt for ${user.email}`);
        save(db);
        throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
      }
      if (user.status === "suspended") {
        throw new HttpError(403, "account_suspended", "This account is suspended. Contact the owner.");
      }

      user.lastLoginAt = nowIso();
      const { token } = createSession(db, user.id, req.get("user-agent") ?? "");
      setSessionCookie(req, res, token);
      log(db, user, "auth.login", `${user.email} signed in`);
      save(db);

      const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
      db.subscriptions.set(user.id, subscription);

      res.json({
        user: toPublicUser(user),
        entitlement: computeEntitlement(subscription),
        accessibleModules: accessibleModuleIds(user),
      });
    }),
  );

  router.post("/logout", (req, res) => {
    const token = readSessionCookie(req);
    const user = res.locals.user as StoredUser | undefined;
    destroySession(db, token);
    clearSessionCookie(req, res);
    if (user) log(db, user, "auth.logout", `${user.email} signed out`);
    save(db);
    res.json({ ok: true });
  });

  router.get("/me", (_req, res) => {
    const user = res.locals.user as StoredUser | undefined;
    if (!user) {
      res.json({ user: null, entitlement: null, accessibleModules: [], providers: listAuthProviders() });
      return;
    }
    const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
    db.subscriptions.set(user.id, subscription);
    res.json({
      user: toPublicUser(user),
      entitlement: computeEntitlement(subscription),
      accessibleModules: accessibleModuleIds(user),
      providers: listAuthProviders(),
    });
  });

  router.get("/oauth/:provider/start", (req, res) => {
    const provider = String(req.params.provider);
    if (!isOAuthProvider(provider)) {
      throw new HttpError(404, "unknown_provider", "Unknown sign-in provider.");
    }
    if (!providerConfigured(provider)) {
      const status = listAuthProviders().find((entry) => entry.provider === provider);
      throw new HttpError(
        503,
        "provider_not_configured",
        status?.reason ?? `${provider} sign-in is not configured on this server.`,
      );
    }
    const state = createOAuthState(provider);
    const redirect = oauthRedirectUri(baseUrl(req), provider);
    res.redirect(buildAuthorizeUrl(provider, state, redirect));
  });

  router.get(
    "/oauth/:provider/callback",
    asyncHandler(async (req, res) => {
      const provider = String(req.params.provider);
      if (!isOAuthProvider(provider)) {
        res.redirect("/?authError=Unknown%20sign-in%20provider.");
        return;
      }
      const code = typeof req.query.code === "string" ? req.query.code : "";
      const state = typeof req.query.state === "string" ? req.query.state : "";

      if (!code || !state || !consumeOAuthState(state, provider)) {
        res.redirect("/?authError=That%20sign-in%20attempt%20expired.%20Please%20try%20again.");
        return;
      }

      let identity: { providerUserId: string; email: string | null; name: string };
      try {
        identity = await exchangeCode(provider, code, oauthRedirectUri(baseUrl(req), provider));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Sign-in failed.";
        log(db, null, "auth.oauth_failed", `${provider}: ${message}`);
        save(db);
        res.redirect(`/?authError=${encodeURIComponent(message)}`);
        return;
      }

      if (!identity.email) {
        res.redirect(
          `/?authError=${encodeURIComponent(
            "That provider did not share an email address, so NOVA cannot create a private workspace for it.",
          )}`,
        );
        return;
      }

      let user = findByEmail(db, identity.email);
      let created = false;
      if (!user) {
        hasOwnerFlag = hasOwner(db);
        const timestamp = nowIso();
        user = {
          id: newId(),
          email: identity.email,
          name: identity.name.slice(0, 80),
          role: resolveRole(identity.email),
          status: "active",
          permissions: { modules: "all", aiAccess: true },
          preferences: { accent: "violet", compactNav: false },
          createdAt: timestamp,
          lastLoginAt: timestamp,
          passwordHash: "",
          passwordSalt: "",
        };
        db.users.set(user.id, user);
        db.subscriptions.set(user.id, createTrialSubscription(user.id));
        created = true;
      }

      if (user.status === "suspended") {
        res.redirect("/?authError=This%20account%20is%20suspended.%20Contact%20the%20owner.");
        return;
      }

      user.lastLoginAt = nowIso();
      const { token } = createSession(db, user.id, req.get("user-agent") ?? "");
      setSessionCookie(req, res, token);
      log(db, user, created ? "auth.oauth_signup" : "auth.oauth_login", `${user.email} via ${provider}`);
      save(db);
      res.redirect("/app");
    }),
  );

  router.patch(
    "/me",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(z.object({ name: z.string().trim().min(2).max(80) }), req.body);
      user.name = input.name;
      log(db, user, "account.profile_updated", `Name changed to ${input.name}`);
      save(db);
      res.json({ user: toPublicUser(user) });
    }),
  );

  /* ---------------------------------------------------------------- *
   * Password reset and email verification
   *
   * No mail provider is configured (free prototype), so NOVA never claims
   * an email was sent. Requests are queued for the owner, who mints a
   * one-time link in the Owner Control Centre and delivers it manually.
   * ---------------------------------------------------------------- */

  router.post(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      const input = parseBody(z.object({ email: emailSchema }), req.body);
      const user = findByEmail(db, input.email);
      if (user) {
        createAuthToken(db, user, "password_reset");
        log(db, null, "auth.reset_requested", `Password reset requested for ${user.email}`);
        save(db);
      }
      // Same response either way so the endpoint cannot enumerate accounts.
      res.status(202).json({
        ok: true,
        delivery: "manual",
        message:
          "If that email has a NOVA account, a reset request is now queued for the workspace owner. " +
          "No email service is configured on this server, so the owner delivers the one-time link.",
      });
    }),
  );

  router.post(
    "/reset-password",
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          token: z.string().trim().min(10).max(400),
          password: z.string().min(1).max(200),
        }),
        req.body,
      );
      const policy = checkPasswordPolicy(input.password);
      if (!policy.ok) {
        throw new HttpError(400, "weak_password", policy.message ?? "Choose a stronger password.");
      }
      const user = consumeAuthToken(db, "password_reset", input.token);
      if (!user) {
        throw new HttpError(400, "invalid_token", "That reset link is invalid or has expired.");
      }
      const digest = await hashPassword(input.password);
      user.passwordHash = digest.hash;
      user.passwordSalt = digest.salt;
      destroyUserSessions(db, user.id);
      revokeAuthTokens(db, user.id);
      log(db, user, "auth.password_reset", `${user.email} reset their password`);
      save(db);
      res.json({ ok: true, message: "Password updated. Sign in with your new password." });
    }),
  );

  router.post(
    "/verify-email",
    asyncHandler(async (req, res) => {
      const input = parseBody(z.object({ token: z.string().trim().min(10).max(400) }), req.body);
      const user = consumeAuthToken(db, "email_verification", input.token);
      if (!user) {
        throw new HttpError(400, "invalid_token", "That verification link is invalid or has expired.");
      }
      user.emailVerifiedAt = nowIso();
      log(db, user, "auth.email_verified", `${user.email} verified their email`);
      save(db);
      res.json({ ok: true, user: toPublicUser(user) });
    }),
  );

  return router;
}
