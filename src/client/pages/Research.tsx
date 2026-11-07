import { useCallback, useEffect, useState } from "react";
import type { ResearchRecord } from "../../shared/types.js";
import { api, errorMessage, formatDateTime } from "../api.js";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelHeader } from "../components/ui.js";

interface SearchResult {
  title: string;
  url: string;
}

interface InvestigateResponse {
  question: string;
  source: {
    title: string;
    url: string;
    excerpt: string;
    truncated: boolean;
    fetchedAt: string;
  };
  summary: string;
  generatedBy: string;
  notice: string;
}

function downloadReport(name: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function reportMarkdown(report: InvestigateResponse): string {
  return [
    `# Research report`,
    ``,
    `**Question:** ${report.question}`,
    ``,
    `**Verified source:** [${report.source.title}](${report.source.url})`,
    ``,
    `> ${report.source.excerpt.slice(0, 4000).replace(/\n{2,}/g, "\n\n> ")}`,
    ``,
    `## AI-generated summary (${report.generatedBy})`,
    ``,
    report.summary,
    ``,
    `---`,
    `Fetched ${report.source.fetchedAt}. The source block is the page NOVA actually downloaded. ` +
      `The summary is AI commentary and may be wrong — check the source before relying on it.`,
    ``,
  ].join("\n");
}

export function ResearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const [url, setUrl] = useState("");
  const [question, setQuestion] = useState("");
  const [report, setReport] = useState<InvestigateResponse | null>(null);
  const [investigating, setInvestigating] = useState(false);

  const [library, setLibrary] = useState<ResearchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const payload = await api<{ items: ResearchRecord[] }>("/api/records/research");
      setLibrary(payload.items);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setSearchNotice(null);
    setResults([]);
    try {
      const payload = await api<{ results: SearchResult[]; notice: string; provider: string }>(
        "/api/research/search",
        { method: "POST", body: JSON.stringify({ query: query.trim() }) },
      );
      setResults(payload.results);
      setSearchNotice(`${payload.notice} Provider: ${payload.provider}.`);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSearching(false);
    }
  };

  const investigate = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!url.trim()) {
      setError("Paste a public URL to read.");
      return;
    }
    if (question.trim().length < 4) {
      setError("Add the question you want answered from that source.");
      return;
    }
    setInvestigating(true);
    setError(null);
    setSavedNotice(null);
    try {
      const payload = await api<InvestigateResponse>("/api/research/investigate", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), question: question.trim() }),
      });
      setReport(payload);
    } catch (cause) {
      setReport(null);
      setError(errorMessage(cause));
    } finally {
      setInvestigating(false);
    }
  };

  const saveReport = async () => {
    if (!report) return;
    try {
      const payload = await api<{ item: ResearchRecord }>("/api/records/research", {
        method: "POST",
        body: JSON.stringify({
          title: report.source.title || report.source.url,
          url: report.source.url,
          summary: report.summary.slice(0, 6000),
          tags: ["web-research"],
          status: "done",
        }),
      });
      setLibrary((current) => [payload.item, ...current]);
      setSavedNotice("Saved to your research library.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const removeSaved = async (item: ResearchRecord) => {
    if (!window.confirm(`Delete “${item.title}” from your research library?`)) return;
    try {
      await api(`/api/records/research/${item.id}`, { method: "DELETE" });
      setLibrary((current) => current.filter((row) => row.id !== item.id));
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const exportLibrary = () => {
    const markdown = library
      .map(
        (item) =>
          `## ${item.title}\n\n${item.url ? `Source: ${item.url}\n\n` : ""}${item.summary}\n\n_Saved ${item.updatedAt}_\n`,
      )
      .join("\n---\n\n");
    downloadReport("nova-research-library.md", `# NOVA research library\n\n${markdown}`);
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Desk</span>
          <h1>Research Centre</h1>
          <p>
            Search the public web, fetch a page through the NOVA reader and separate what the source actually
            says from AI commentary. Nothing is saved unless you choose to keep it.
          </p>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="Research error">
          {error}
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader title="Search the web" subtitle="Live results from the public DuckDuckGo HTML endpoint" />
        <form className="toolbar" onSubmit={search}>
          <Input
            value={query}
            placeholder="Latest Gemini API model names"
            aria-label="Research query"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" loading={searching} disabled={!query.trim()} icon="search">
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
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => {
                    setUrl(result.url);
                    setQuery((current) => current || result.title);
                  }}
                >
                  Use source
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel>
        <PanelHeader title="Investigate a source" subtitle="Server-side fetch, then an AI summary with the source attached" />
        <form className="stack-tight" onSubmit={investigate}>
          <Field label="Source URL">
            <Input
              type="url"
              value={url}
              placeholder="https://example.com/report"
              onChange={(event) => setUrl(event.target.value)}
            />
          </Field>
          <Field label="Question">
            <Input
              value={question}
              placeholder="What does this page claim about pricing?"
              onChange={(event) => setQuestion(event.target.value)}
            />
          </Field>
          <div className="row-actions">
            <Button type="submit" loading={investigating} disabled={!url.trim()} icon="spark">
              Read and summarise
            </Button>
          </div>
        </form>
      </Panel>

      {report ? (
        <Panel>
          <PanelHeader
            title={report.source.title || report.source.url}
            subtitle={report.source.url}
            action={
              <div className="row-actions">
                <Button variant="quiet" type="button" onClick={saveReport}>
                  Save to library
                </Button>
                <Button
                  variant="quiet"
                  type="button"
                  onClick={() => downloadReport("nova-research-report.md", reportMarkdown(report))}
                >
                  Export report
                </Button>
              </div>
            }
          />
          {savedNotice ? <p className="muted small">{savedNotice}</p> : null}
          <div className="split">
            <div className="stack-tight">
              <Badge tone="success">Verified source text</Badge>
              <pre className="assist-text">{report.source.excerpt}</pre>
              <p className="muted small">
                Fetched {formatDateTime(report.source.fetchedAt)}
                {report.source.truncated ? " · page truncated" : ""}
              </p>
            </div>
            <div className="stack-tight">
              <Badge tone="violet">AI-generated summary</Badge>
              <pre className="assist-text">{report.summary}</pre>
              <p className="muted small">
                {report.notice} Model: {report.generatedBy}.
              </p>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          title="Saved research"
          subtitle={`${library.length} private item${library.length === 1 ? "" : "s"}`}
          action={
            <Button variant="quiet" type="button" onClick={exportLibrary} disabled={library.length === 0}>
              Export library
            </Button>
          }
        />
        {library.length === 0 ? (
          <EmptyState
            icon="research"
            title="Nothing saved yet"
            description="Investigate a source and save it, or keep your own notes here for later."
          />
        ) : (
          <ul className="list">
            {library.map((item) => (
              <li key={item.id} className="list-row">
                <span className="list-body">
                  <strong>{item.title}</strong>
                  <span className="truncate">{item.url || item.summary.slice(0, 120)}</span>
                  <span className="muted small">Saved {formatDateTime(item.updatedAt)}</span>
                </span>
                <div className="row-actions">
                  {item.url ? (
                    <a className="button button-quiet" href={item.url} target="_blank" rel="noreferrer noopener">
                      Open
                    </a>
                  ) : null}
                  <Button variant="danger" type="button" onClick={() => void removeSaved(item)}>
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
