import type { TaskRecord } from "../../shared/types.js";
import { RecordBoard } from "../components/Records.js";
import { Badge } from "../components/ui.js";

const STATUS_TONE: Record<TaskRecord["status"], "neutral" | "violet" | "success"> = {
  todo: "neutral",
  doing: "violet",
  done: "success",
};

const PRIORITY_TONE: Record<TaskRecord["priority"], "neutral" | "warning" | "danger"> = {
  low: "neutral",
  normal: "neutral",
  high: "danger",
};

export function ProductivityPage() {
  return (
    <RecordBoard<TaskRecord>
      path="/api/records/tasks"
      eyebrow="Focus"
      title="Productivity Centre"
      description="Tasks and priorities that stay in your private workspace. Open and completed counts feed the home dashboard."
      createLabel="New task"
      formIntro="Keep tasks small and concrete. Due dates are optional and stored as plain dates."
      emptyTitle="No tasks yet"
      emptyDescription="Add the next thing you want to move forward, then work through it here."
      searchText={(item) => `${item.title} ${item.notes} ${item.status} ${item.priority}`}
      fields={[
        { name: "title", label: "Task", type: "text", placeholder: "Review NOVA launch brief" },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "todo", label: "To do" },
            { value: "doing", label: "In progress" },
            { value: "done", label: "Done" },
          ],
        },
        {
          name: "priority",
          label: "Priority",
          type: "select",
          options: [
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
          ],
        },
        { name: "dueDate", label: "Due date", type: "date" },
        { name: "notes", label: "Notes", type: "textarea", placeholder: "Context, links, next step…", span: true },
      ]}
      renderItem={(item) => (
        <>
          <header className="record-head">
            <h3>{item.title}</h3>
            <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
          </header>
          {item.notes ? <p className="record-body">{item.notes}</p> : null}
          <div className="tag-row">
            <Badge tone={PRIORITY_TONE[item.priority]}>{item.priority} priority</Badge>
            {item.dueDate ? <span className="tag">Due {item.dueDate}</span> : null}
          </div>
        </>
      )}
    />
  );
}
