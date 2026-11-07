import { useCallback, useEffect, useState } from "react";
import type { Conversation, ConversationSummary } from "../../shared/types.js";
import { api, errorMessage, formatDateTime } from "../api.js";
import { useRouter } from "../router.js";
import { Badge, Button, EmptyState, Notice, Panel, PanelHeader } from "../components/ui.js";

export function MessagesPage() {
  const { navigate } = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [open, setOpen] = useState<Conversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const payload = await api<{ items: ConversationSummary[] }>("/api/conversations");
      setItems(payload.items);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const preview = async (id: string) => {
    if (open?.id === id) {
      setOpen(null);
      return;
    }
    try {
      const payload = await api<{ item: Conversation }>(`/api/conversations/${id}`);
      setOpen(payload.item);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const remove = async (id: string) => {
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
      if (open?.id === id) setOpen(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Archive</span>
          <h1>AI Messages</h1>
          <p>Every transcript is scoped to your account and can be deleted permanently.</p>
        </div>
        <div className="page-head-action">
          <Button icon="plus" onClick={() => navigate("/app/assistant")}>
            New conversation
          </Button>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="Could not load transcripts">
          {error}
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader title="Transcripts" subtitle={`${items.length} stored conversation(s)`} />
        {loading ? (
          <div className="skeleton-list" aria-hidden="true">
            <div className="skeleton" />
            <div className="skeleton" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="chat"
            title="No transcripts yet"
            description="Conversations you start in the AI Assistant appear here."
          />
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="transcript-row">
                  <button type="button" className="list-row" onClick={() => void preview(item.id)}>
                    <span className="list-body">
                      <strong>{item.title}</strong>
                      <span>{item.preview || "No messages yet"}</span>
                    </span>
                    <span className="list-meta">
                      <Badge tone="violet">{item.messageCount} msg</Badge>
                      {formatDateTime(item.updatedAt)}
                    </span>
                  </button>
                  <div className="record-actions">
                    <Button variant="quiet" onClick={() => void remove(item.id)} type="button">
                      Delete
                    </Button>
                  </div>
                </div>
                {open?.id === item.id ? (
                  <div className="transcript">
                    {open.messages.map((message) => (
                      <div key={message.id} className={`transcript-line transcript-${message.role}`}>
                        <span>{message.role === "user" ? "You" : "NOVA"}</span>
                        <p>{message.content}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
