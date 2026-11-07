import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";
import type { MemoryRecord } from "../../shared/types.js";

const CATEGORY_LABELS: Record<MemoryRecord["category"], string> = {
  identity: "Identity",
  preference: "Preference",
  project: "Project",
  goal: "Goal",
  reference: "Reference",
  other: "Other",
};

export function MemoryPage() {
  return (
    <RecordBoard<MemoryRecord>
      path="/api/records/memory"
      eyebrow="Context"
      title="Memory Centre"
      description="Durable facts you choose to keep. Approved memories are offered to the assistant as context; pending ones are held back until you review them. Passwords, keys and payment PINs are rejected."
      createLabel="Add memory"
      formIntro="Write short, factual statements. New memories start approved — switch the review status to Pending if you want to check them later."
      emptyTitle="No memories yet"
      emptyDescription="Add a fact, preference or decision you want NOVA to remember across conversations."
      searchText={(item) =>
        `${item.title} ${item.content} ${item.tags.join(" ")} ${item.category} ${item.reviewStatus}`
      }
      fields={[
        { name: "title", label: "Title", type: "text", placeholder: "Project convention" },
        {
          name: "category",
          label: "Category",
          type: "select",
          options: (Object.keys(CATEGORY_LABELS) as MemoryRecord["category"][]).map((value) => ({
            value,
            label: CATEGORY_LABELS[value],
          })),
        },
        {
          name: "reviewStatus",
          label: "Review status",
          type: "select",
          hint: "Only approved memories reach the AI",
          options: [
            { value: "approved", label: "Approved" },
            { value: "pending", label: "Pending review" },
          ],
        },
        {
          name: "pinned",
          label: "Pinned",
          type: "boolean",
          hint: "Pinned memories are retrieved first",
          options: [
            { value: "false", label: "No" },
            { value: "true", label: "Yes" },
          ],
        },
        { name: "tags", label: "Tags", type: "tags", placeholder: "work, design", hint: "Comma separated, max 8" },
        {
          name: "content",
          label: "Memory",
          type: "textarea",
          placeholder: "What should NOVA remember?",
          span: true,
        },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            <div className="row-actions">
              <Badge tone="violet">{CATEGORY_LABELS[item.category] ?? "Other"}</Badge>
              {item.reviewStatus === "pending" ? <Badge tone="warning">Pending</Badge> : null}
              {item.pinned ? <Badge tone="success">Pinned</Badge> : null}
            </div>
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
