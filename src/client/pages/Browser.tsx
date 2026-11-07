import { useState } from "react";
import type { ReadPageResult } from "../../shared/types.js";
import { api, errorMessage } from "../api.js";
import { Badge, Button, EmptyState, Input, Notice, Panel, PanelHeader } from "../components/ui.js";

export function BrowserPage() {
  const [url, setUrl] = useState("");
  const [page, setPage] = useState<ReadPageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const read = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await api<{ page: ReadPageResult }>("/api/browser/read", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      setPage(payload.page);
    } catch (cause) {
      setPage(null);
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Reader</span>
          <h1>Browser</h1>
          <p>
            Fetch public page text through the NOVA server. Private and internal network addresses are refused
            on every redirect hop, so this is a reader — not a proxy.
          </p>
        </div>
      </header>

      <Panel>
        <PanelHeader title="Open a page" subtitle="Readable text only" />
        <form className="toolbar" onSubmit={read}>
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
        {error ? (
          <Notice tone="danger" title="Page could not be read">
            {error}
          </Notice>
        ) : null}
      </Panel>

      {page ? (
        <Panel>
          <PanelHeader
            title={page.title || page.finalUrl}
            subtitle={page.finalUrl}
            action={page.truncated ? <Badge tone="warning">Truncated</Badge> : <Badge tone="success">Complete</Badge>}
          />
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
          description="Paste a public URL to extract its readable text and links for research."
        />
      )}
    </div>
  );
}
