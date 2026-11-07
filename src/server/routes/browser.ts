import { Router } from "express";
import { z } from "zod";
import type { BookmarkRecord, BrowsingHistoryRecord } from "../../shared/types.js";
import type { AuthGuards } from "../auth/middleware.js";
import { asyncHandler, currentUser, HttpError, log, parseBody, save } from "../http.js";
import { PageReadError, readPage } from "../services/pageReader.js";
import { countOwned, getOwned, listOwned, newId, nowIso, type Database } from "../store.js";

const readSchema = z.object({ url: z.string().trim().min(4).max(2000) });
const searchSchema = z.object({ query: z.string().trim().min(2).max(200) });
const bookmarkSchema = z.object({
  title: z.string().trim().min(1).max(160),
  url: z.string().trim().min(4).max(2000),
  note: z.string().trim().max(600).default(""),
});

/** DuckDuckGo's HTML endpoint wraps outbound links in a redirect parameter. */
function unwrapResultUrl(href: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname.endsWith("duckduckgo.com")) {
    const target = parsed.searchParams.get("uddg");
    return target ?? null;
  }
  return parsed.toString();
}

function recordVisit(db: Database, ownerId: string, title: string, url: string): void {
  const existing = [...db.history.values()].find(
    (row) => row.ownerId === ownerId && row.url === url,
  );
  if (existing) {
    existing.title = title || existing.title;
    existing.updatedAt = nowIso();
    db.history.set(existing.id, existing);
    return;
  }
  if (countOwned(db.history, ownerId) >= 300) {
    const oldest = listOwned(db.history, ownerId).at(-1);
    if (oldest) db.history.delete(oldest.id);
  }
  const row: BrowsingHistoryRecord = {
    id: newId(),
    ownerId,
    title: title || url,
    url,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.history.set(row.id, row);
}

/**
 * Guarded page reader plus the user's own bookmark/history store. Every hop is
 * DNS-validated and private ranges are refused, so this cannot be turned into an
 * internal-network proxy. Search uses DuckDuckGo's public HTML endpoint: no API
 * key, no paid service, and results are real links rather than generated ones.
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
        recordVisit(db, user.id, page.title, page.finalUrl);
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

  router.post(
    "/search",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(searchSchema, req.body);
      const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
      try {
        const page = await readPage(endpoint);
        const seen = new Set<string>();
        const results: { title: string; url: string }[] = [];
        for (const link of page.links) {
          const target = unwrapResultUrl(link.href);
          if (!target || seen.has(target)) continue;
          seen.add(target);
          results.push({ title: link.label || target, url: target });
          if (results.length >= 12) break;
        }
        log(db, user, "browser.search", input.query.slice(0, 120));
        save(db);
        res.json({
          query: input.query,
          provider: "duckduckgo-html",
          results,
          notice:
            results.length === 0
              ? "The public search endpoint returned no readable results. Try a different query or open a known URL directly."
              : "Results are live links from DuckDuckGo's public HTML endpoint. NOVA does not invent sources.",
        });
      } catch (error) {
        if (error instanceof PageReadError) {
          throw new HttpError(
            error.status,
            error.code,
            `Search backend unavailable: ${error.message}`,
          );
        }
        throw error;
      }
    }),
  );

  router.get("/bookmarks", (_req, res) => {
    const user = currentUser(res);
    res.json({ items: listOwned(db.bookmarks, user.id) });
  });

  router.post(
    "/bookmarks",
    asyncHandler(async (req, res) => {
      const user = currentUser(res);
      const input = parseBody(bookmarkSchema, req.body);
      if (countOwned(db.bookmarks, user.id) >= 200) {
        throw new HttpError(409, "bookmark_limit", "Bookmark limit reached. Remove one first.");
      }
      const row: BookmarkRecord = {
        id: newId(),
        ownerId: user.id,
        title: input.title,
        url: input.url,
        note: input.note,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      db.bookmarks.set(row.id, row);
      log(db, user, "browser.bookmarked", input.url.slice(0, 200));
      save(db);
      res.status(201).json({ item: row });
    }),
  );

  router.delete("/bookmarks/:id", (req, res) => {
    const user = currentUser(res);
    const row = getOwned(db.bookmarks, user.id, String(req.params.id));
    if (!row) throw new HttpError(404, "not_found", "That bookmark does not exist.");
    db.bookmarks.delete(row.id);
    save(db);
    res.json({ ok: true });
  });

  router.get("/history", (_req, res) => {
    const user = currentUser(res);
    res.json({ items: listOwned(db.history, user.id).slice(0, 100) });
  });

  router.delete("/history", (_req, res) => {
    const user = currentUser(res);
    for (const row of listOwned(db.history, user.id)) db.history.delete(row.id);
    log(db, user, "browser.history_cleared");
    save(db);
    res.json({ ok: true });
  });

  return router;
}
