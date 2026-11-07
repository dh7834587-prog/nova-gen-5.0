import type { SnippetRecord } from "../../shared/types.js";
import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";

export function CodePage() {
  return (
    <RecordBoard<SnippetRecord>
      path="/api/records/code"
      eyebrow="Workspace"
      title="Coding Lab"
      description="Keep snippets, experiments and implementation notes beside your assistant transcripts. NOVA does not execute code — it stores and reviews it."
      createLabel="New snippet"
      formIntro="Paste code you want to keep. Everything is scoped to your account."
      emptyTitle="No snippets saved"
      emptyDescription="Save a reusable function, a query or a snippet you want the assistant to reference later."
      searchText={(item) => `${item.title} ${item.language} ${item.description} ${item.code}`}
      fields={[
        { name: "title", label: "Title", type: "text", placeholder: "Owner-scoped query helper" },
        { name: "language", label: "Language", type: "text", placeholder: "typescript" },
        { name: "description", label: "Description", type: "text", placeholder: "What does it do?", span: true },
        { name: "code", label: "Code", type: "textarea", placeholder: "export function…", span: true },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            <Badge tone="violet">{item.language}</Badge>
          </header>
          {item.description ? <p className="record-body">{item.description}</p> : null}
          <pre className="code-block">
            <code>{item.code}</code>
          </pre>
        </>
      )}
    />
  );
}
