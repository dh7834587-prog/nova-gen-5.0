import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { accessibleModuleIds } from "../shared/modules.js";
import { createAuthGuards } from "./auth/middleware.js";
import { env } from "./env.js";
import { HttpError } from "./http.js";
import { accountRoutes } from "./routes/account.js";
import { assistantRoutes, conversationRoutes } from "./routes/assistant.js";
import { authRoutes } from "./routes/auth.js";
import { billingRoutes } from "./routes/billing.js";
import { browserRoutes } from "./routes/browser.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { fileRoutes } from "./routes/files.js";
import { generationRoutes } from "./routes/generation.js";
import { ownerRoutes } from "./routes/owner.js";
import { recordRoutes } from "./routes/records.js";
import { researchRoutes } from "./routes/research.js";
import { codeRoutes } from "./routes/code.js";
import { createRateLimiter, emailRateLimiter } from "./middleware/rateLimit.js";
import { createGeminiProvider, ProviderNotConfiguredError, ProviderRequestError } from "./services/gemini.js";
import { loadDatabase, purgeExpiredSessions, type Database } from "./store.js";

function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "content-security-policy",
    [
      "default-src 'self'",
      // Vite injects a small inline bootstrap; styles are inline for theme tokens.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  );
  next();
}

export interface NovaApp {
  app: express.Express;
  db: Database;
}

export function createApp(db: Database = loadDatabase(env.dataDir)): NovaApp {
  const provider = createGeminiProvider({
    apiKey: env.geminiApiKey,
    chatModel: env.geminiModel,
    imageModel: env.geminiImageModel,
  });
  const guards = createAuthGuards(db);

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      app: "NOVA GEN 5.0",
      version: "5.0.0",
      ai: provider.info.configured ? "configured" : "not_configured",
      sessionSecretEphemeral: env.sessionSecretIsEphemeral,
      persisted: Boolean(env.dataDir),
      time: new Date().toISOString(),
    });
  });

  app.use(guards.attachUser);

  // Broad API throttle plus a tighter limiter on credential endpoints.
  const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 240 });
  const authLimiter = emailRateLimiter(10 * 60_000, 12);
  app.use("/api", apiLimiter);
  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/forgot-password", authLimiter);

  app.use("/api/auth", authRoutes(db));
  app.use("/api/account", accountRoutes(db, guards));
  app.use("/api/dashboard", dashboardRoutes(db, provider, guards));
  app.use("/api/assistant", assistantRoutes(db, provider, guards));
  app.use("/api/conversations", conversationRoutes(db, guards));
  app.use("/api/records", recordRoutes(db, guards));
  app.use("/api/files", fileRoutes(db, guards));
  app.use("/api/browser", browserRoutes(db, guards));
  app.use("/api/research", researchRoutes(db, guards, provider));
  app.use("/api/code", codeRoutes(db, provider, guards));
  app.use("/api/generate", generationRoutes(db, provider, guards));
  app.use("/api/billing", billingRoutes(db, guards));
  app.use("/api/owner", ownerRoutes(db, guards));

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "Unknown API route." } });
  });

  // Serve the built client and fall back to index.html for client routes.
  const indexPath = path.join(env.staticDir, "index.html");
  if (fs.existsSync(indexPath)) {
    app.use(
      express.static(env.staticDir, {
        index: false,
        setHeaders: (res, filePath) => {
          if (/\/assets\//.test(filePath)) {
            res.setHeader("cache-control", "public, max-age=31536000, immutable");
          }
          // The service worker and manifest must always be revalidated so a new
          // release replaces the cached shell promptly.
          if (/\/(sw\.js|manifest\.webmanifest|offline\.html)$/.test(filePath)) {
            res.setHeader("cache-control", "no-cache");
          }
          if (/\/sw\.js$/.test(filePath)) {
            res.setHeader("service-worker-allowed", "/");
          }
        },
      }),
    );
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    app.get("/", (_req, res) => {
      res
        .status(503)
        .type("text/plain")
        .send("NOVA GEN 5.0 client build not found. Run `npm run build` before starting the server.");
    });
  }

  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
      });
      return;
    }
    if (error instanceof ProviderNotConfiguredError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof ProviderRequestError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    if (/request entity too large/i.test(message)) {
      res.status(413).json({ error: { code: "payload_too_large", message: "That upload is too large." } });
      return;
    }
    console.error("[nova] unhandled error:", error);
    res.status(500).json({
      error: { code: "server_error", message: "NOVA hit an unexpected error. Please try again." },
    });
  });

  purgeExpiredSessions(db);
  return { app, db };
}

export { accessibleModuleIds };
