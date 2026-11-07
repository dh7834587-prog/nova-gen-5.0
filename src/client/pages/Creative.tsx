import type { CreativeProject } from "../../shared/types.js";
import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";

const MEDIUM_LABEL: Record<CreativeProject["medium"], string> = {
  image: "Image",
  video: "Video",
  text: "Text",
  mixed: "Mixed media",
};

const STATUS_TONE: Record<CreativeProject["status"], "neutral" | "violet" | "success"> = {
  draft: "neutral",
  active: "violet",
  archived: "success",
};

export function CreativePage() {
  return (
    <RecordBoard<CreativeProject>
      path="/api/records/creative"
      eyebrow="Studio"
      title="Creative Studio"
      description="Concept boards for image, video, text and mixed-media work. Briefs stay here so generated assets always have a source of intent."
      createLabel="New project"
      formIntro="Describe the intent, pick a medium, then move the project from draft to active when you start producing."
      emptyTitle="No creative projects"
      emptyDescription="Create a board with a brief to organise concepts before generating assets."
      searchText={(item) => `${item.title} ${item.brief} ${item.notes} ${item.medium}`}
      fields={[
        { name: "title", label: "Project title", type: "text", placeholder: "NOVA launch teaser" },
        {
          name: "medium",
          label: "Medium",
          type: "select",
          options: [
            { value: "image", label: "Image" },
            { value: "video", label: "Video" },
            { value: "text", label: "Text" },
            { value: "mixed", label: "Mixed media" },
          ],
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "draft", label: "Draft" },
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
          ],
        },
        { name: "brief", label: "Brief", type: "textarea", placeholder: "What should this project communicate?", span: true },
        { name: "notes", label: "Production notes", type: "textarea", placeholder: "References, palette, constraints…", span: true },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
          </header>
          <p className="record-body">{item.brief || "No brief yet."}</p>
          {item.notes ? <p className="record-sub">{item.notes}</p> : null}
          <div className="tag-row">
            <span className="tag">{MEDIUM_LABEL[item.medium]}</span>
          </div>
        </>
      )}
    />
  );
}
