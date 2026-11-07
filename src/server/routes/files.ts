import { Router } from "express";
import { z } from "zod";
import type { FileRecord } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { env } from "../env.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { countOwned, getOwned, listOwned, newId, nowIso, type Database } from "../store.js";

const uploadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  mimeType: z.string().trim().min(1).max(120).default("application/octet-stream"),
  data: z.string().min(1),
});

function toRecord(file: FileRecord): FileRecord {
  return {
    id: file.id,
    ownerId: file.ownerId,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
  };
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "nova-file";
}

/**
 * Private per-account file storage. Files are scoped by ownerId, size-capped and
 * never served from a guessable public path.
 */
export function fileRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("files"));

  router.get("/", (_req, res) => {
    const user = currentUser(res);
    res.json({ items: listOwned(db.files, user.id).map(toRecord) });
  });

  router.post(
    "/",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(uploadSchema, req.body);

      if (countOwned(db.files, user.id) >= 100) {
        throw new HttpError(409, "file_limit", "This prototype allows 100 files per workspace.");
      }

      const base64 = input.data.includes(",") ? input.data.slice(input.data.indexOf(",") + 1) : input.data;
      if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) {
        throw new HttpError(400, "invalid_upload", "The uploaded data was not valid base64.");
      }
      const buffer = Buffer.from(base64, "base64");
      if (buffer.length === 0) {
        throw new HttpError(400, "invalid_upload", "That file is empty.");
      }
      if (buffer.length > env.limits.fileBytes) {
        throw new HttpError(
          413,
          "file_too_large",
          `Files are limited to ${Math.round(env.limits.fileBytes / 1024)} KB in this prototype.`,
        );
      }

      const file = {
        id: newId(),
        ownerId: user.id,
        name: input.name,
        mimeType: input.mimeType,
        size: buffer.length,
        createdAt: nowIso(),
        data: buffer,
      };
      db.files.set(file.id, file);
      log(db, user, "files.uploaded", `${file.name} (${file.size} bytes)`);
      save(db);
      res.status(201).json({ item: toRecord(file) });
    }),
  );

  router.get("/:id/download", (req, res) => {
    const user = currentUser(res);
    const file = getOwned(db.files, user.id, req.params.id);
    if (!file) throw new HttpError(404, "not_found", "That file does not exist.");

    res.setHeader("content-type", file.mimeType);
    res.setHeader("content-length", String(file.data.length));
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("content-disposition", `attachment; filename="${safeFileName(file.name)}"`);
    res.end(file.data);
  });

  router.delete("/:id", (req, res) => {
    const user = currentUser(res);
    const file = getOwned(db.files, user.id, req.params.id);
    if (!file) throw new HttpError(404, "not_found", "That file does not exist.");
    db.files.delete(file.id);
    log(db, user, "files.deleted", file.name);
    save(db);
    res.json({ ok: true });
  });

  return router;
}
