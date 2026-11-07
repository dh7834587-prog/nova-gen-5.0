import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";
import type { MemoryRecord } from "../../shared/types.js";

export function MemoryPage() {
  return (
    <RecordBoard<MemoryRecord>
      path="/api/records/memory"
      eyebrow="Context"
      title="Memory Centre"
      description="Durable facts you want NOVA to keep. Pinned and recent memories are offered to the assistant as context when it is configured."
      createLabel="Add memory"
      formIntro="Write short, factual statements. These are only visible to your account."
      emptyTitle="No memories yet"
      emptyDescription="Add a fact, preference or decision you want NOVA to remember across conversations."
      searchText={(item) => `${item.title} ${item.content} ${item.tags.join(" ")}`}
      fields={[
        { name: "title", label: "Title", type: "text", placeholder: "Project convention" },
        { name: "tags", label: "Tags", type: "tags", placeholder: "work, design", hint: "Comma separated, max 8" },
        { name: "content", label: "Memory", type: "textarea", placeholder: "What should NOVA remember?", span: true },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            {item.pinned ? <Badge tone="violet">Pinned</Badge> : null}
          </header>
          <p className="record-body">{item.content}</p>
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
