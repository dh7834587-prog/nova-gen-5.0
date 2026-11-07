import { Router } from "express";
import { accessibleModuleIds } from "../../shared/modules.js";
import { computeEntitlement, createTrialSubscription } from "../../shared/plans.js";
import type { Conversation, DashboardResponse, DashboardStats } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { currentUser, toPublicUser } from "../http.js";
import type { AiProvider } from "../services/gemini.js";
import { listOwned, type Database } from "../store.js";

function summarise(conversation: Conversation) {
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

export function dashboardRoutes(db: Database, provider: AiProvider, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("dashboard"));

  router.get("/", (_req, res) => {
    const user = currentUser(res);
    const tasks = listOwned(db.tasks, user.id);
    const files = listOwned(db.files, user.id);

    const stats: DashboardStats = {
      conversations: listOwned(db.conversations, user.id).length,
      memories: listOwned(db.memories, user.id).length,
      tasksOpen: tasks.filter((task) => task.status !== "done").length,
      tasksDone: tasks.filter((task) => task.status === "done").length,
      notes: listOwned(db.notes, user.id).length,
      snippets: listOwned(db.snippets, user.id).length,
      research: listOwned(db.research, user.id).length,
      creative: listOwned(db.creative, user.id).length,
      files: files.length,
      fileBytes: files.reduce((total, file) => total + file.size, 0),
    };

    const subscription = db.subscriptions.get(user.id) ?? createTrialSubscription(user.id);
    db.subscriptions.set(user.id, subscription);

    const payload: DashboardResponse = {
      user: toPublicUser(user),
      stats,
      provider: provider.info,
      recentActivity: db.audit.filter((event) => event.actorId === user.id).slice(0, 8),
      recentConversations: listOwned(db.conversations, user.id).slice(0, 5).map(summarise),
      recentProjects: listOwned(db.creative, user.id).slice(0, 4),
      accessibleModules: accessibleModuleIds(user),
      entitlement: computeEntitlement(subscription),
    };
    res.json(payload);
  });

  return router;
}
