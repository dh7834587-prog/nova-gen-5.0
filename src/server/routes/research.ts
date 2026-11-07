import { Router } from "express";
import { z } from "zod";
import type { AuthGuards } from "../auth/middleware.js";
import { env } from "../env.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { PageReadError, readPage } from "../services/pageReader.js";
import type { AiProvider } from "../services/gemini.js";
import { buildSystemPrompt, looksLikeSecret, novaComplete, retrieveMemories } from "../services/novaChat.js";
import { assertQuota, QuotaExceededError } from "../services/usage.js";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import { nowIso, type Database } from "../store.js";

const investigateSchema = z.object({
  url: z.string().trim().min(4).max(2000),
  question: z.string().trim().min(3).max(600),
});

const searchSchema = z.object({ query: z.string().trim().min(2).max(200) });

function unwrapResultUrl(href: string): string | null {
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.hostname.endsWith("duckduckgo.com")) {
      return parsed.searchParams.get("uddg");
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Research Centre backend.
 *
 * Sources are fetched live through the SSRF-guarded page reader and handed to
 * the model as untrusted evidence. The response always separates the fetched
 * source from the AI explanation so a generated summary is never presented as a
 * verified fact.
 */
export function researchRoutes(db: Database, guards: AuthGuards, provider: AiProvider): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("research"));

  router.post(
    "/search",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(searchSchema, req.body);
      try {
        const page = await readPage(
          `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`,
        );
        const seen = new Set<string>();
        const results: { title: string; url: string }[] = [];
        for (const link of page.links) {
          const target = unwrapResultUrl(link.href);
          if (!target || seen.has(target)) continue;
          seen.add(target);
          results.push({ title: link.label || target, url: target });
          if (results.length >= 12) break;
        }
        log(db, user, "research.search", input.query.slice(0, 120));
        save(db);
        res.json({
          query: input.query,
          provider: "duckduckgo-html",
          results,
          notice:
            results.length === 0
              ? "No readable results came back from the public search endpoint."
              : "Live results from DuckDuckGo's public HTML endpoint.",
        });
      } catch (error) {
        if (error instanceof PageReadError) {
          throw new HttpError(error.status, error.code, `Search unavailable: ${error.message}`);
        }
        throw error;
      }
    }),
  );

  router.post(
    "/investigate",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(investigateSchema, req.body);
      if (!user.permissions.aiAccess) {
        throw new HttpError(403, "ai_disabled", "AI access is disabled for this account.");
      }
      if (looksLikeSecret(input.question)) {
        throw new HttpError(
          400,
          "secret_in_request",
          "That request looks like it contains a password, key or PIN. Remove it first.",
        );
      }
      try {
        const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
        assertQuota(db, user.id, computeEntitlement(subscription), "research");
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          throw new HttpError(429, "quota_exceeded", error.message);
        }
        throw error;
      }

      let page;
      try {
        page = await readPage(input.url);
      } catch (error) {
        if (error instanceof PageReadError) {
          throw new HttpError(error.status, error.code, error.message);
        }
        throw error;
      }

      const memories = retrieveMemories(db, user.id, input.question);
      const system = buildSystemPrompt({
        user,
        memories,
        sources: [
          {
            title: page.title || page.finalUrl,
            url: page.finalUrl,
            excerpt: page.text.slice(0, env.limits.messageChars),
          },
        ],
        task:
          "Summarise the fetched source for a research note. Clearly separate what the source says " +
          "from your own explanation. If the source does not answer the question, say so.",
      });

      let answer: string;
      let model: string;
      try {
        const result = await novaComplete({
          db,
          provider,
          user,
          turns: [{ role: "user", text: input.question }],
          system,
          metric: "research",
        });
        answer = result.answer;
        model = result.model;
      } catch (error) {
        const err = error as { code?: string; status?: number; message?: string };
        throw new HttpError(err.status ?? 502, err.code ?? "provider_error", err.message ?? "The AI provider failed.");
      }

      log(db, user, "research.investigated", `${page.finalUrl} — ${input.question}`.slice(0, 200));
      save(db);

      res.json({
        question: input.question,
        source: {
          title: page.title || page.finalUrl,
          url: page.finalUrl,
          excerpt: page.text.slice(0, 4000),
          truncated: page.truncated,
          fetchedAt: nowIso(),
        },
        summary: answer,
        generatedBy: model,
        notice:
          "The source block is the page NOVA actually fetched. The summary is AI-generated " +
          "commentary and may be wrong; check the source before relying on it.",
      });
    }),
  );

  return router;
}
