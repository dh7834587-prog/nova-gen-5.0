import { Router } from "express";
import { z, type ZodType } from "zod";
import type { AuthGuards } from "../auth/middleware.js";
import { env } from "../env.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { countOwned, getOwned, listOwned, newId, nowIso, type Database } from "../store.js";
import { looksLikeSecret } from "../services/novaChat.js";

/**
 * Shared CRUD router for the record-based modules. Every read and write goes
 * through the owner-scoped store helpers, so a user can never address another
 * user's row even with a guessed id.
 */
interface OwnedRow {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

interface CollectionOptions<T extends OwnedRow> {
  moduleId: string;
  collection: Map<string, T>;
  createSchema: ZodType;
  updateSchema: ZodType;
  build: (input: any, ownerId: string) => T;
  apply: (row: T, input: any) => void;
  describe: (row: T) => string;
}

function collectionRouter<T extends OwnedRow>(
  db: Database,
  guards: AuthGuards,
  options: CollectionOptions<T>,
): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule(options.moduleId));

  router.get("/", (req, res) => {
    const user = currentUser(res);
    const items = listOwned(options.collection, user.id);
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
    if (!rawQuery) {
      res.json({ items });
      return;
    }
    // Simple local search across the user's own rows; nothing leaves the server.
    const filtered = items.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(rawQuery),
    );
    res.json({ items: filtered, query: rawQuery });
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(options.createSchema, req.body);
      if (countOwned(options.collection, user.id) >= env.limits.recordsPerCollection) {
        throw new HttpError(
          409,
          "collection_full",
          "This module reached its record limit for the prototype. Delete something first.",
        );
      }
      const row = options.build(input, user.id);
      options.collection.set(row.id, row);
      log(db, user, `${options.moduleId}.created`, options.describe(row));
      save(db);
      res.status(201).json({ item: row });
    }),
  );

  router.patch(
    "/:id",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const row = getOwned(options.collection, user.id, String(req.params.id));
      if (!row) throw new HttpError(404, "not_found", "That record does not exist.");
      const input = parseBody(options.updateSchema, req.body);
      options.apply(row, input);
      row.updatedAt = nowIso();
      save(db);
      res.json({ item: row });
    }),
  );

  router.delete("/:id", (req, res) => {
    const user = currentUser(res);
    const row = getOwned(options.collection, user.id, String(req.params.id));
    if (!row) throw new HttpError(404, "not_found", "That record does not exist.");
    options.collection.delete(row.id);
    log(db, user, `${options.moduleId}.deleted`, options.describe(row));
    save(db);
    res.json({ ok: true });
  });

  return router;
}

const stamp = () => nowIso();

const tagsSchema = z.array(z.string().trim().min(1).max(24)).max(8).default([]);

export function recordRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();

  router.use(
    "/memory",
    collectionRouter(db, guards, {
      moduleId: "memory",
      collection: db.memories,
      createSchema: z.object({
        title: z.string().trim().min(1).max(120),
        content: z.string().trim().min(1).max(env.limits.memoryChars),
        tags: tagsSchema,
        pinned: z.boolean().default(false),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(120).optional(),
        content: z.string().trim().min(1).max(env.limits.memoryChars).optional(),
        tags: tagsSchema.optional(),
        pinned: z.boolean().optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          content: input.content,
          tags: input.tags ?? [],
          pinned: input.pinned ?? false,
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.content !== undefined) row.content = input.content;
        if (input.tags !== undefined) row.tags = input.tags;
        if (input.pinned !== undefined) row.pinned = input.pinned;
      },
      describe: (row) => row.title,
    }),
  );

  router.use(
    "/creative",
    collectionRouter(db, guards, {
      moduleId: "creative",
      collection: db.creative,
      createSchema: z.object({
        title: z.string().trim().min(1).max(120),
        brief: z.string().trim().max(2000).default(""),
        medium: z.enum(["image", "video", "text", "mixed"]).default("image"),
        status: z.enum(["draft", "active", "archived"]).default("draft"),
        notes: z.string().trim().max(4000).default(""),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(120).optional(),
        brief: z.string().trim().max(2000).optional(),
        medium: z.enum(["image", "video", "text", "mixed"]).optional(),
        status: z.enum(["draft", "active", "archived"]).optional(),
        notes: z.string().trim().max(4000).optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          brief: input.brief ?? "",
          medium: input.medium ?? "image",
          status: input.status ?? "draft",
          notes: input.notes ?? "",
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.brief !== undefined) row.brief = input.brief;
        if (input.medium !== undefined) row.medium = input.medium;
        if (input.status !== undefined) row.status = input.status;
        if (input.notes !== undefined) row.notes = input.notes;
      },
      describe: (row) => row.title,
    }),
  );

  router.use(
    "/code",
    collectionRouter(db, guards, {
      moduleId: "code",
      collection: db.snippets,
      createSchema: z.object({
        title: z.string().trim().min(1).max(120),
        language: z.string().trim().min(1).max(32).default("typescript"),
        code: z.string().min(1).max(20000),
        description: z.string().trim().max(1000).default(""),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(120).optional(),
        language: z.string().trim().min(1).max(32).optional(),
        code: z.string().min(1).max(20000).optional(),
        description: z.string().trim().max(1000).optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          language: input.language ?? "typescript",
          code: input.code,
          description: input.description ?? "",
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.language !== undefined) row.language = input.language;
        if (input.code !== undefined) row.code = input.code;
        if (input.description !== undefined) row.description = input.description;
      },
      describe: (row) => row.title,
    }),
  );

  router.use(
    "/research",
    collectionRouter(db, guards, {
      moduleId: "research",
      collection: db.research,
      createSchema: z.object({
        title: z.string().trim().min(1).max(160),
        url: z.string().trim().max(2000).default(""),
        summary: z.string().trim().max(8000).default(""),
        tags: tagsSchema,
        status: z.enum(["queued", "reading", "done"]).default("queued"),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(160).optional(),
        url: z.string().trim().max(2000).optional(),
        summary: z.string().trim().max(8000).optional(),
        tags: tagsSchema.optional(),
        status: z.enum(["queued", "reading", "done"]).optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          url: input.url ?? "",
          summary: input.summary ?? "",
          tags: input.tags ?? [],
          status: input.status ?? "queued",
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.url !== undefined) row.url = input.url;
        if (input.summary !== undefined) row.summary = input.summary;
        if (input.tags !== undefined) row.tags = input.tags;
        if (input.status !== undefined) row.status = input.status;
      },
      describe: (row) => row.title,
    }),
  );

  router.use(
    "/tasks",
    collectionRouter(db, guards, {
      moduleId: "productivity",
      collection: db.tasks,
      createSchema: z.object({
        title: z.string().trim().min(1).max(160),
        notes: z.string().trim().max(2000).default(""),
        status: z.enum(["todo", "doing", "done"]).default("todo"),
        priority: z.enum(["low", "normal", "high"]).default("normal"),
        dueDate: z.string().trim().max(32).nullable().default(null),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(160).optional(),
        notes: z.string().trim().max(2000).optional(),
        status: z.enum(["todo", "doing", "done"]).optional(),
        priority: z.enum(["low", "normal", "high"]).optional(),
        dueDate: z.string().trim().max(32).nullable().optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          notes: input.notes ?? "",
          status: input.status ?? "todo",
          priority: input.priority ?? "normal",
          dueDate: input.dueDate ?? null,
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.notes !== undefined) row.notes = input.notes;
        if (input.status !== undefined) row.status = input.status;
        if (input.priority !== undefined) row.priority = input.priority;
        if (input.dueDate !== undefined) row.dueDate = input.dueDate;
      },
      describe: (row) => row.title,
    }),
  );

  router.use(
    "/notes",
    collectionRouter(db, guards, {
      moduleId: "productivity",
      collection: db.notes,
      createSchema: z.object({
        title: z.string().trim().min(1).max(160),
        body: z.string().trim().max(10000).default(""),
      }),
      updateSchema: z.object({
        title: z.string().trim().min(1).max(160).optional(),
        body: z.string().trim().max(10000).optional(),
      }),
      build: (input, ownerId) => {
        const at = stamp();
        return {
          id: newId(),
          ownerId,
          title: input.title,
          body: input.body ?? "",
          createdAt: at,
          updatedAt: at,
        };
      },
      apply: (row, input) => {
        if (input.title !== undefined) row.title = input.title;
        if (input.body !== undefined) row.body = input.body;
      },
      describe: (row) => row.title,
    }),
  );

  return router;
}
