import { Router } from "express";
import { z } from "zod";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import type { Entitlement, GeneratedImage, GeneratedImageRecord } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { ProviderRequestError, type AiProvider } from "../services/gemini.js";
import { assertQuota, consume, QuotaExceededError } from "../services/usage.js";
import { getOwned, listOwned, newId, nowIso, type Database } from "../store.js";

const promptSchema = z.object({
  prompt: z.string().trim().min(3, "Describe the image first.").max(1000),
  aspectRatio: z.enum(["1:1", "3:4", "4:3", "9:16", "16:9"]).default("1:1"),
  style: z.string().trim().max(80).default(""),
});

function entitlementFor(db: Database, userId: string): Entitlement {
  const subscription = db.subscriptions.get(userId) ?? createTrialSubscription(userId);
  db.subscriptions.set(userId, subscription);
  return computeEntitlement(subscription);
}

function toSummary(image: GeneratedImageRecord): GeneratedImage {
  const { data: _data, ...rest } = image;
  return rest;
}

export function generationRoutes(db: Database, provider: AiProvider, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser);

  router.get("/images", guards.requireModule("images"), (_req, res) => {
    const user = currentUser(res);
    const items = listOwned(db.images, user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toSummary);
    res.json({ items });
  });

  router.get("/images/:id/data", (req, res) => {
    const user = currentUser(res);
    const image = getOwned(db.images, user.id, String(req.params.id));
    if (!image) throw new HttpError(404, "not_found", "That image does not exist.");
    res.setHeader("content-type", image.mimeType);
    res.setHeader("cache-control", "private, max-age=600");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(Buffer.from(image.data, "base64"));
  });

  router.delete("/images/:id", (req, res) => {
    const user = currentUser(res);
    const image = getOwned(db.images, user.id, String(req.params.id));
    if (!image) throw new HttpError(404, "not_found", "That image does not exist.");
    db.images.delete(image.id);
    log(db, user, "images.deleted", image.id);
    save(db);
    res.json({ ok: true });
  });

  router.post(
    "/image",
    guards.requireModule("images"),
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const entitlement = entitlementFor(db, user.id);
      if (!entitlement.aiAllowed) {
        throw new HttpError(
          402,
          "subscription_required",
          entitlement.reason ?? "Your AI access is not active. Choose a plan to continue.",
        );
      }
      if (!entitlement.features.imageGeneration) {
        throw new HttpError(
          403,
          "premium_feature",
          "Image generation is part of Premium. Upgrade from Subscription Plans to unlock it.",
        );
      }
      const input = parseBody(promptSchema, req.body);

      if (!provider.info.configured) {
        throw new HttpError(
          503,
          "provider_not_configured",
          provider.info.reason ??
            "Image generation is not configured on this server. Set GEMINI_API_KEY to enable it.",
        );
      }

      try {
        assertQuota(db, user, "images");
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          throw new HttpError(429, "quota_exceeded", error.message);
        }
        throw error;
      }

      const prompt = input.style ? `${input.prompt} (style: ${input.style})` : input.prompt;

      try {
        const image = await provider.generateImage({ prompt, aspectRatio: input.aspectRatio });
        const record: GeneratedImageRecord = {
          id: newId(),
          ownerId: user.id,
          prompt,
          mimeType: image.mimeType,
          model: provider.info.imageModel,
          createdAt: nowIso(),
          data: image.data,
        };
        db.images.set(record.id, record);
        consume(db, user.id, "images");
        log(db, user, "images.generated", prompt.slice(0, 120));
        save(db);
        res.json({
          image: toSummary(record),
          data: image.data,
          prompt,
          model: provider.info.imageModel,
        });
      } catch (error) {
        if (error instanceof ProviderRequestError) {
          throw new HttpError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  router.post("/video", guards.requireModule("video"), (_req, _res) => {
    throw new HttpError(
      503,
      "video_not_configured",
      "Video generation is not enabled on this NOVA server. The module, project boards and " +
        "pipeline are ready, but no video model is configured, so NOVA will not pretend to render one.",
    );
  });

  return router;
}
