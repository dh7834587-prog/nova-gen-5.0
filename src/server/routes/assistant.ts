import { Router } from "express";
import { z } from "zod";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import { encodeSseEvent } from "../../shared/sse.js";
import type {
  AssistantStreamEvent,
  ChatMessage,
  Conversation,
  ConversationSummary,
  Entitlement,
} from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { env } from "../env.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import type { AiProvider } from "../services/gemini.js";
import {
  buildSystemPrompt,
  conversationTurns,
  looksLikeSecret,
  novaChat,
  retrieveMemories,
  titleFor,
} from "../services/novaChat.js";
import { assertQuota, usageSummary } from "../services/usage.js";
import { getOwned, listOwned, newId, nowIso, type Database } from "../store.js";

const streamSchema = z.object({
  conversationId: z.string().trim().min(1).max(80).optional(),
  message: z.string().trim().min(1, "Type a message first.").max(env.limits.messageChars),
});

const createSchema = z.object({ title: z.string().trim().max(120).optional() });
const renameSchema = z.object({ title: z.string().trim().min(1, "A title is required.").max(120) });

function summarise(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    messageCount: conversation.messages.length,
    preview: (last?.content ?? "").slice(0, 140),
  };
}

function entitlementFor(db: Database, userId: string): Entitlement {
  const subscription = db.subscriptions.get(userId) ?? createTrialSubscription(userId);
  db.subscriptions.set(userId, subscription);
  return computeEntitlement(subscription);
}

export function conversationRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("messages"));

  router.get("/", (_req, res) => {
    const user = currentUser(res);
    res.json({ items: listOwned(db.conversations, user.id).map(summarise) });
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(createSchema, req.body);
      const timestamp = nowIso();
      const conversation: Conversation = {
        id: newId(),
        ownerId: user.id,
        title: input.title || "New conversation",
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: [],
      };
      db.conversations.set(conversation.id, conversation);
      save(db);
      res.status(201).json({ item: conversation });
    }),
  );

  router.get("/:id", (req, res) => {
    const user = currentUser(res);
    const conversation = getOwned(db.conversations, user.id, String(req.params.id));
    if (!conversation) throw new HttpError(404, "not_found", "That conversation does not exist.");
    res.json({ item: conversation });
  });

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const conversation = getOwned(db.conversations, user.id, String(req.params.id));
      if (!conversation) throw new HttpError(404, "not_found", "That conversation does not exist.");
      const input = parseBody(renameSchema, req.body);
      const previous = conversation.title;
      conversation.title = input.title;
      conversation.updatedAt = nowIso();
      log(db, user, "assistant.conversation_renamed", `${previous} → ${input.title}`);
      save(db);
      res.json({ item: conversation });
    }),
  );

  router.delete("/:id", (req, res) => {
    const user = currentUser(res);
    const conversation = getOwned(db.conversations, user.id, String(req.params.id));
    if (!conversation) throw new HttpError(404, "not_found", "That conversation does not exist.");
    db.conversations.delete(conversation.id);
    log(db, user, "assistant.conversation_deleted", conversation.title);
    save(db);
    res.json({ ok: true });
  });

  return router;
}

export function assistantRoutes(db: Database, provider: AiProvider, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("assistant"));

  router.get("/usage", (_req, res) => {
    const user = currentUser(res);
    res.json({ usage: usageSummary(db, user.id, entitlementFor(db, user.id)) });
  });

  router.post(
    "/stream",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(streamSchema, req.body);

      const entitlement = entitlementFor(db, user.id);
      if (!entitlement.aiAllowed) {
        throw new HttpError(
          402,
          "subscription_required",
          entitlement.reason ?? "Your AI access is not active. Choose a plan to continue.",
        );
      }

      // Quota is checked before the stream opens so the client gets a real
      // HTTP status instead of a half-open SSE connection.
      assertQuota(db, user.id, entitlement, "chatMessages");

      res.status(200);
      res.setHeader("content-type", "text/event-stream; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("connection", "keep-alive");
      res.setHeader("x-accel-buffering", "no");
      res.flushHeaders?.();

      const send = (event: AssistantStreamEvent): void => {
        res.write(encodeSseEvent(event.type, event));
      };

      const fail = (code: string, message: string): void => {
        send({ type: "error", code, message });
        res.end();
      };

      if (!provider.info.configured) {
        fail(
          "provider_not_configured",
          provider.info.reason ??
            "Live AI is not configured on this server. Set GEMINI_API_KEY to enable the assistant.",
        );
        return;
      }

      let conversation: Conversation;
      if (input.conversationId) {
        const existing = getOwned(db.conversations, user.id, input.conversationId);
        if (!existing) {
          fail("not_found", "That conversation no longer exists.");
          return;
        }
        conversation = existing;
      } else {
        const timestamp = nowIso();
        conversation = {
          id: newId(),
          ownerId: user.id,
          title: titleFor(input.message),
          createdAt: timestamp,
          updatedAt: timestamp,
          messages: [],
        };
        db.conversations.set(conversation.id, conversation);
      }

      if (conversation.messages.length >= env.limits.conversationMessages) {
        fail(
          "conversation_full",
          "This conversation reached its message limit. Start a new conversation to continue.",
        );
        return;
      }

      if (looksLikeSecret(input.message)) {
        fail(
          "secret_detected",
          "That message looks like it contains a password, API key or PIN. NOVA never sends credentials to an AI provider — remove it and try again.",
        );
        return;
      }

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content: input.message,
        createdAt: nowIso(),
      };
      conversation.messages.push(userMessage);
      conversation.updatedAt = userMessage.createdAt;
      if (conversation.messages.length === 1) conversation.title = titleFor(input.message);
      save(db);

      send({
        type: "meta",
        conversationId: conversation.id,
        title: conversation.title,
        model: provider.info.chatModel,
      });

      const controller = new AbortController();
      req.on("close", () => controller.abort());

      const memories = retrieveMemories(db, user.id, input.message);
      const system = buildSystemPrompt({ user, memories });
      if (memories.length > 0) {
        send({
          type: "meta",
          conversationId: conversation.id,
          title: conversation.title,
          model: provider.info.chatModel,
        });
      }

      let answer = "";
      try {
        const result = await novaChat(
          {
            db,
            provider,
            user,
            conversation,
            turns: conversationTurns(conversation),
            system,
            signal: controller.signal,
          },
          (chunk) => {
            answer += chunk;
            send({ type: "delta", text: chunk });
          },
        );
        answer = result.answer;
      } catch (error) {
        if (controller.signal.aborted) {
          res.end();
          return;
        }
        const message =
          error instanceof Error ? error.message : "The AI provider could not complete the request.";
        const code = (error as { code?: string }).code ?? "provider_error";
        log(db, user, "assistant.provider_error", message.slice(0, 200));
        save(db);
        fail(code, message);
        return;
      }

      const assistantMessage: ChatMessage = {
        id: newId(),
        role: "assistant",
        content: answer,
        createdAt: nowIso(),
        model: provider.info.chatModel,
      };
      conversation.messages.push(assistantMessage);
      conversation.updatedAt = assistantMessage.createdAt;
      log(db, user, "assistant.reply", `${conversation.title} (${answer.length} chars)`);
      save(db);

      send({
        type: "done",
        conversationId: conversation.id,
        title: conversation.title,
        message: assistantMessage,
      });
      res.end();
    }),
  );

  return router;
}
