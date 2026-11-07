import { Router } from "express";
import { z } from "zod";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { PageReadError, readPage } from "../services/pageReader.js";
import type { Database } from "../store.js";

const readSchema = z.object({ url: z.string().trim().min(4).max(2000) });

/**
 * Guarded page reader. Every hop is DNS-validated and private ranges are
 * refused, so this cannot be turned into an internal-network proxy.
 */
export function browserRoutes(db: Database, guards: AuthGuards): Router {
  const router = Router();
  router.use(guards.requireUser, guards.requireModule("browser"));

  router.post(
    "/read",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(readSchema, req.body);
      try {
        const page = await readPage(input.url);
        log(db, user, "browser.read", page.finalUrl.slice(0, 200));
        save(db);
        res.json({ page });
      } catch (error) {
        if (error instanceof PageReadError) {
          throw new HttpError(error.status, error.code, error.message);
        }
        throw error;
      }
    }),
  );

  return router;
}
