import type { ResearchRecord } from "../../shared/types.js";
import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";

const STATUS_TONE: Record<ResearchRecord["status"], "neutral" | "violet" | "success"> = {
  queued: "neutral",
  reading: "violet",
  done: "success",
};

export function ResearchPage() {
  return (
    <RecordBoard<ResearchRecord>
      path="/api/records/research"
      eyebrow="Desk"
      title="Research Centre"
      description="Track sources, summaries and open questions. Use the Browser module to fetch page text, then store the reading list here."
      createLabel="Add source"
      formIntro="A source can be a link, a book or a raw note. Status tracks whether you have read it."
      emptyTitle="No sources yet"
      emptyDescription="Add a link or a summary to start a private reading list."
      searchText={(item) => `${item.title} ${item.url} ${item.summary} ${item.tags.join(" ")}`}
      fields={[
        { name: "title", label: "Source title", type: "text", placeholder: "Gemini API docs" },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "queued", label: "Queued" },
            { value: "reading", label: "Reading" },
            { value: "done", label: "Done" },
          ],
        },
        { name: "url", label: "URL", type: "text", placeholder: "https://…", span: true },
        { name: "tags", label: "Tags", type: "tags", placeholder: "ai, api", hint: "Comma separated" },
        { name: "summary", label: "Summary", type: "textarea", placeholder: "Key findings…", span: true },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
          </header>
          <p className="record-body">{item.summary || "No summary yet."}</p>
          {item.url ? (
            <a className="record-link" href={item.url} target="_blank" rel="noreferrer noopener">
              {item.url}
            </a>
          ) : null}
          {item.tags.length > 0 ? (
            <div className="tag-row">
              {item.tags.map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    />
  );
}
