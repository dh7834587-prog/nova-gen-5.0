import { Router } from "express";
import { z } from "zod";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import type { Entitlement } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { ProviderRequestError, type AiProvider } from "../services/gemini.js";
import type { Database } from "../store.js";

const promptSchema = z.object({ prompt: z.string().trim().min(3, "Describe the image first.").max(1000) });

function entitlementFor(db: Database, userId: string): Entitlement {
  const subscription = db.subscriptions.get(userId) ?? createTrialSubscription(userId);
  db.subscriptions.set(userId, subscription);
  return computeEntitlement(subscription);
}

export function generationRoutes(db: Database, provider: AiProvider, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser);

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
        const image = await provider.generateImage({ prompt: input.prompt });
        log(db, user, "images.generated", input.prompt.slice(0, 120));
        save(db);
        res.json({ image, prompt: input.prompt, model: provider.info.imageModel });
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
