import { Router } from "express";
import { z } from "zod";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import { encodeSseEvent } from "../../shared/sse.js";
import type {
  AssistantStreamEvent,
  ChatMessage,
  Conversation,
  ConversationSummary,
} from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { env } from "../env.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import type { AiProvider, ChatTurn } from "../services/gemini.js";
import { getOwned, listOwned, newId, nowIso, type Database } from "../store.js";

const streamSchema = z.object({
  conversationId: z.string().trim().min(1).max(80).optional(),
  message: z.string().trim().min(1, "Type a message first.").max(env.limits.messageChars),
});

const createSchema = z.object({ title: z.string().trim().max(120).optional() });

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

function deriveTitle(message: string): string {
  const flat = message.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}…` : flat || "New conversation";
}

/** Recalled memories are injected as context so answers stay user-specific. */
function buildSystemPrompt(db: Database, userId: string, name: string): string {
  const memories = listOwned(db.memories, userId).slice(0, 8);
  const lines = [
    `You are NOVA, the assistant inside NOVA GEN 5.0, a personal AI operating system.`,
    `You are speaking with ${name}. Be concise, practical and honest about uncertainty.`,
    `Never claim to have performed actions you cannot perform, and never invent payments,`,
    `subscriptions or account changes. If something is not configured, say so plainly.`,
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  ];
  if (memories.length > 0) {
    lines.push("", "Saved memories from this user's Memory Centre:");
    for (const memory of memories) {
      lines.push(`- ${memory.title}: ${memory.content.slice(0, 400)}`);
    }
  }
  return lines.join("\n");
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
    asyncHandler(async (_req, res) => {
      const user = currentUser(res);
      const input = parseBody(createSchema, _req.body);
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
    const conversation = getOwned(db.conversations, user.id, req.params.id);
    if (!conversation) throw new HttpError(404, "not_found", "That conversation does not exist.");
    res.json({ item: conversation });
  });

  router.delete("/:id", (req, res) => {
    const user = currentUser(res);
    const conversation = getOwned(db.conversations, user.id, req.params.id);
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

  router.post(
    "/stream",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(streamSchema, req.body);

      const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
      db.subscriptions.set(user.id, subscription);
      const entitlement = computeEntitlement(subscription);
      if (!entitlement.aiAllowed) {
        throw new HttpError(
          402,
          "subscription_required",
          entitlement.reason ?? "Your AI access is not active. Choose a plan to continue.",
        );
      }

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
          title: deriveTitle(input.message),
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

      const userMessage: ChatMessage = {
        id: newId(),
        role: "user",
        content: input.message,
        createdAt: nowIso(),
      };
      conversation.messages.push(userMessage);
      conversation.updatedAt = userMessage.createdAt;
      if (conversation.messages.length === 1) conversation.title = deriveTitle(input.message);
      save(db);

      send({
        type: "meta",
        conversationId: conversation.id,
        title: conversation.title,
        model: provider.info.chatModel,
      });

      const controller = new AbortController();
      req.on("close", () => controller.abort());

      const turns: ChatTurn[] = conversation.messages
        .slice(-20)
        .map((message) => ({
          role: message.role === "user" ? "user" : "model",
          text: message.content,
        }));

      let answer = "";
      try {
        for await (const chunk of provider.streamChat({
          system: buildSystemPrompt(db, user.id, user.name),
          turns,
          signal: controller.signal,
        })) {
          answer += chunk;
          send({ type: "delta", text: chunk });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The AI provider could not complete the request.";
        const code =
          (error as { code?: string }).code ??
          (controller.signal.aborted ? "client_aborted" : "provider_error");
        if (controller.signal.aborted) {
          res.end();
          return;
        }
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
