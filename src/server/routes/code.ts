import { Router } from "express";
import { z } from "zod";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import type { AiProvider } from "../services/gemini.js";
import {
  buildSystemPrompt,
  looksLikeSecret,
  novaComplete,
  retrieveMemories,
} from "../services/novaChat.js";
import { assertQuota, QuotaExceededError } from "../services/usage.js";
import type { Database } from "../store.js";

const MAX_CODE_CHARS = 20_000;

const assistSchema = z.object({
  task: z.enum(["explain", "debug", "generate", "review"]),
  language: z.string().trim().max(40).default("plain text"),
  code: z.string().trim().max(MAX_CODE_CHARS).default(""),
  question: z.string().trim().max(600).default(""),
});

const TASK_PROMPTS: Record<z.infer<typeof assistSchema>["task"], string> = {
  explain:
    "Explain the supplied code step by step for its author: purpose, control flow, notable " +
    "edge cases and any risky behaviour. Do not claim to have executed it.",
  debug:
    "Act as a debugging assistant. Identify the most likely defects in the supplied code, explain " +
    "why each would fail, and give a corrected version. State clearly that the code was not run " +
    "on this server, so the diagnosis is a review rather than an observed runtime result.",
  generate:
    "Write the code the author asks for, in the requested language. Return complete, runnable " +
    "code with brief notes about assumptions and required dependencies.",
  review:
    "Review the supplied code for correctness, security, readability and performance. Rank the " +
    "findings by severity and suggest concrete fixes.",
};

export function codeRoutes(db: Database, provider: AiProvider, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("code"));

  router.post(
    "/assist",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(assistSchema, req.body);

      if (!user.permissions.aiAccess) {
        throw new HttpError(403, "ai_disabled", "AI access is disabled for this account.");
      }
      if (!provider.info.configured) {
        throw new HttpError(
          503,
          "provider_not_configured",
          provider.info.reason ??
            "Live AI is not configured on this server. Set GEMINI_API_KEY to enable code assistance.",
        );
      }
      if (looksLikeSecret(input.code) || looksLikeSecret(input.question)) {
        throw new HttpError(
          400,
          "secret_in_request",
          "That text looks like it contains a key, password or token. Remove it before sending code to the AI.",
        );
      }
      if (input.task !== "generate" && input.code.trim().length < 8) {
        throw new HttpError(400, "code_required", "Add the code you want NOVA to look at.");
      }
      if (input.task === "generate" && input.question.trim().length < 8) {
        throw new HttpError(400, "question_required", "Describe what the code should do.");
      }

      const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
      db.subscriptions.set(user.id, subscription);
      try {
        assertQuota(db, user.id, computeEntitlement(subscription), "chatMessages");
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          throw new HttpError(429, "quota_exceeded", error.message);
        }
        throw error;
      }

      const system = buildSystemPrompt({
        user,
        memories: retrieveMemories(db, user.id, input.question || input.code.slice(0, 400)),
        task:
          `${TASK_PROMPTS[input.task]} You have no code execution sandbox: never claim that code was ` +
          "compiled, run or tested. Mention that limitation when it matters.",
      });

      const body = [
        `Language: ${input.language || "plain text"}`,
        input.question ? `Author question: ${input.question}` : null,
        input.code ? `Code:\n\`\`\`${input.language || ""}\n${input.code}\n\`\`\`` : null,
      ]
        .filter(Boolean)
        .join("\n\n");

      let answer: string;
      let model: string;
      try {
        const result = await novaComplete({
          db,
          provider,
          user,
          turns: [{ role: "user", text: body }],
          system,
        });
        answer = result.answer;
        model = result.model;
      } catch (error) {
        const err = error as { code?: string; status?: number; message?: string };
        throw new HttpError(
          err.status ?? 502,
          err.code ?? "provider_error",
          err.message ?? "The AI provider failed.",
        );
      }

      log(db, user, `code.${input.task}`, input.question.slice(0, 120) || input.code.slice(0, 120));
      save(db);
      res.json({
        task: input.task,
        answer,
        model,
        notice:
          "This is AI-generated guidance from the configured Gemini model. NOVA has no execution " +
          "sandbox, so review the code yourself before running it.",
      });
    }),
  );

  return router;
}
