import { useCallback, useEffect, useState } from "react";
import type { BookmarkRecord, BrowsingHistoryRecord, ReadPageResult } from "../../shared/types.js";
import { api, errorMessage, formatDateTime } from "../api.js";
import { Badge, Button, EmptyState, Input, Notice, Panel, PanelHeader } from "../components/ui.js";

interface SearchResult {
  title: string;
  url: string;
}

export function BrowserPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [url, setUrl] = useState("");
  const [page, setPage] = useState<ReadPageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [history, setHistory] = useState<BrowsingHistoryRecord[]>([]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const loadBookmarks = useCallback(async () => {
    try {
      const payload = await api<{ items: BookmarkRecord[] }>("/api/browser/bookmarks");
      setBookmarks(payload.items);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const payload = await api<{ items: BrowsingHistoryRecord[] }>("/api/browser/history");
      setHistory(payload.items);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadBookmarks();
    void loadHistory();
  }, [loadBookmarks, loadHistory]);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const payload = await api<{ results: SearchResult[]; notice: string; provider: string }>(
        "/api/browser/search",
        { method: "POST", body: JSON.stringify({ query: query.trim() }) },
      );
      setResults(payload.results);
      setSearchNotice(`${payload.notice} Provider: ${payload.provider}.`);
      void loadHistory();
    } catch (cause) {
      setSearchNotice(null);
      setError(errorMessage(cause));
    } finally {
      setSearching(false);
    }
  };

  const read = async (target?: string) => {
    const address = (target ?? url).trim();
    if (!address) return;
    setUrl(address);
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const payload = await api<{ page: ReadPageResult }>("/api/browser/read", {
        method: "POST",
        body: JSON.stringify({ url: address }),
      });
      setPage(payload.page);
      void loadHistory();
    } catch (cause) {
      setPage(null);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  const bookmark = async () => {
    if (!page) return;
    try {
      const payload = await api<{ item: BookmarkRecord }>("/api/browser/bookmarks", {
        method: "POST",
        body: JSON.stringify({ title: page.title || page.finalUrl, url: page.finalUrl, note: note.trim() }),
      });
      setBookmarks((current) => [payload.item, ...current]);
      setNote("");
      setNotice("Bookmarked.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const removeBookmark = async (item: BookmarkRecord) => {
    if (!window.confirm(`Remove the bookmark “${item.title}”?`)) return;
    try {
      await api(`/api/browser/bookmarks/${item.id}`, { method: "DELETE" });
      setBookmarks((current) => current.filter((row) => row.id !== item.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const clearHistory = async () => {
    if (!window.confirm("Clear your browsing history? Bookmarks are kept.")) return;
    try {
      await api("/api/browser/history", { method: "DELETE" });
      setHistory([]);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Reader</span>
          <h1>Browser</h1>
          <p>
            Search the public web and fetch readable page text through the NOVA server. Private and internal
            network addresses are refused on every redirect hop, so this is a reader — not an open proxy.
          </p>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="Browser error">
          {error}
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader title="Search" subtitle="DuckDuckGo public HTML endpoint · real links only" />
        <form className="toolbar" onSubmit={search}>
          <Input
            value={query}
            placeholder="Gemini API documentation"
            aria-label="Search query"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" icon="search" loading={searching} disabled={!query.trim()}>
            Search
          </Button>
        </form>
        {searchNotice ? <p className="muted small">{searchNotice}</p> : null}
        {results.length > 0 ? (
          <ul className="list">
            {results.map((result) => (
              <li key={result.url} className="list-row">
                <span className="list-body">
                  <strong>{result.title}</strong>
                  <span className="truncate">{result.url}</span>
                </span>
                <Button variant="quiet" type="button" onClick={() => void read(result.url)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="Open a page" subtitle="Readable text only" />
        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            void read();
          }}
        >
          <Input
            type="url"
            value={url}
            placeholder="https://example.com/article"
            aria-label="Page URL"
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" icon="browser" loading={loading} disabled={!url.trim()}>
            Read page
          </Button>
        </form>
        {notice ? <p className="muted small">{notice}</p> : null}
      </Panel>

      {page ? (
        <Panel>
          <PanelHeader
            title={page.title || page.finalUrl}
            subtitle={page.finalUrl}
            action={
              page.truncated ? <Badge tone="warning">Truncated</Badge> : <Badge tone="success">Complete</Badge>
            }
          />
          <div className="toolbar">
            <Input
              value={note}
              placeholder="Optional bookmark note"
              aria-label="Bookmark note"
              onChange={(event) => setNote(event.target.value)}
            />
            <Button type="button" variant="quiet" icon="plus" onClick={() => void bookmark()}>
              Save bookmark
            </Button>
          </div>
          <article className="reader">
            <p>{page.text}</p>
          </article>
          {page.links.length > 0 ? (
            <div className="link-grid">
              {page.links.slice(0, 20).map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener">
                  {link.label || link.href}
                </a>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : (
        <EmptyState
          icon="browser"
          title="No page loaded"
          description="Search or paste a public URL to extract readable text and links for your research."
        />
      )}

      <div className="split">
        <Panel>
          <PanelHeader
            title="Bookmarks"
            subtitle={`${bookmarks.length} saved`}
            action={<Badge tone="violet">{bookmarks.length}</Badge>}
          />
          {bookmarks.length === 0 ? (
            <EmptyState icon="bookmark" title="No bookmarks" description="Save a page you want to return to." />
          ) : (
            <ul className="list">
              {bookmarks.map((item) => (
                <li key={item.id} className="list-row">
                  <span className="list-body">
                    <strong>{item.title}</strong>
                    <span className="truncate">{item.url}</span>
                    {item.note ? <span className="muted small">{item.note}</span> : null}
                  </span>
                  <div className="row-actions">
                    <Button variant="quiet" type="button" onClick={() => void read(item.url)}>
                      Open
                    </Button>
                    <Button variant="danger" type="button" onClick={() => void removeBookmark(item)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent history"
            subtitle={`${history.length} visits`}
            action={
              <Button variant="quiet" type="button" onClick={() => void clearHistory()} disabled={history.length === 0}>
                Clear
              </Button>
            }
          />
          {history.length === 0 ? (
            <EmptyState icon="clock" title="No history" description="Pages you read appear here." />
          ) : (
            <ul className="list">
              {history.slice(0, 25).map((item) => (
                <li key={item.id} className="list-row">
                  <span className="list-body">
                    <strong>{item.title}</strong>
                    <span className="truncate">{item.url}</span>
                    <span className="muted small">{formatDateTime(item.updatedAt)}</span>
                  </span>
                  <Button variant="quiet" type="button" onClick={() => void read(item.url)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
