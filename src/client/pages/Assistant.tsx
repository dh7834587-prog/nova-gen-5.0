import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, Conversation, ConversationSummary } from "../../shared/types.js";
import { api, errorMessage, formatRelative, streamAssistant } from "../api.js";
import { useRouter } from "../router.js";
import { useSession } from "../session.js";
import { Icon } from "../components/Icons.js";
import { Badge, Button, EmptyState, Notice, Panel, Spinner, TextArea } from "../components/ui.js";

interface ConversationList {
  items: ConversationSummary[];
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`bubble ${isUser ? "bubble-user" : "bubble-nova"}`}>
      <span className="bubble-role">{isUser ? "You" : "NOVA"}</span>
      <div className="bubble-body">{message.content}</div>
      <span className="bubble-meta">
        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {message.model ? ` · ${message.model}` : ""}
      </span>
    </div>
  );
}

export function AssistantPage() {
  const { entitlement, user } = useSession();
  const { path } = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const loadList = useCallback(async () => {
    try {
      const payload = await api<ConversationList>("/api/conversations");
      setConversations(payload.items);
      return payload.items;
    } catch (cause) {
      setError(errorMessage(cause));
      return [];
    }
  }, []);

  const openConversation = useCallback(async (id: string) => {
    try {
      const payload = await api<{ item: Conversation }>(`/api/conversations/${id}`);
      setActive(payload.item);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const items = await loadList();
      const requested = new URLSearchParams(window.location.search).get("c");
      if (requested) await openConversation(requested);
      else if (items.length > 0) await openConversation(items[0].id);
    })();
  }, [loadList, openConversation, path]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.messages.length, streamingText]);

  const startNew = async () => {
    try {
      const payload = await api<{ item: Conversation }>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New conversation" }),
      });
      setActive(payload.item);
      setConversations((current) => [
        {
          id: payload.item.id,
          title: payload.item.title,
          createdAt: payload.item.createdAt,
          updatedAt: payload.item.updatedAt,
          messageCount: 0,
          preview: "",
        },
        ...current,
      ]);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || pending) return;

    let conversationId = active?.id;
    if (!conversationId) {
      try {
        const payload = await api<{ item: Conversation }>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ title: "New conversation" }),
        });
        conversationId = payload.item.id;
        setActive(payload.item);
      } catch (cause) {
        setError(errorMessage(cause));
        return;
      }
    }

    setPending(true);
    setStreamingText("");
    setError(null);
    setInput("");

    const optimistic: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };
    setActive((current) =>
      current ? { ...current, messages: [...current.messages, optimistic] } : current,
    );

    const controller = new AbortController();
    abortRef.current = controller;

    await streamAssistant(
      { conversationId, message },
      {
        signal: controller.signal,
        onEvent: (streamEvent) => {
          if (streamEvent.type === "meta") {
            setModel(streamEvent.model);
          } else if (streamEvent.type === "delta") {
            setStreamingText((current) => current + streamEvent.text);
          } else if (streamEvent.type === "done") {
            setActive((current) =>
              current
                ? {
                    ...current,
                    id: streamEvent.conversationId,
                    title: streamEvent.title,
                    messages: [...current.messages, streamEvent.message],
                  }
                : current,
            );
            setStreamingText("");
            setPending(false);
            void loadList();
          } else if (streamEvent.type === "error") {
            setError(streamEvent.message);
            setStreamingText("");
            setPending(false);
          }
        },
      },
    );

    abortRef.current = null;
    setPending(false);
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
    setStreamingText("");
  };

  const removeConversation = async (id: string) => {
    try {
      await api(`/api/conversations/${id}`, { method: "DELETE" });
      setConversations((current) => current.filter((item) => item.id !== id));
      if (active?.id === id) setActive(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const aiBlocked = entitlement ? !entitlement.aiAllowed : false;

  return (
    <div className="assistant-layout">
      <Panel className="conversation-panel">
        <div className="panel-head">
          <div>
            <h2>Conversations</h2>
            <p>Stored for this account only</p>
          </div>
        </div>
        <Button icon="plus" onClick={() => void startNew()} type="button">
          New conversation
        </Button>
        <ul className="conversation-list">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <div className={`conversation-item ${active?.id === conversation.id ? "is-active" : ""}`}>
                <button type="button" onClick={() => void openConversation(conversation.id)}>
                  <strong>{conversation.title}</strong>
                  <span>{conversation.preview || "No messages yet"}</span>
                  <em>
                    {conversation.messageCount} msg · {formatRelative(conversation.updatedAt)}
                  </em>
                </button>
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={() => void removeConversation(conversation.id)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          ))}
          {conversations.length === 0 ? <li className="muted small">No conversations yet.</li> : null}
        </ul>
      </Panel>

      <Panel className="chat-panel">
        <header className="chat-head">
          <div>
            <h2>{active?.title ?? "AI Assistant"}</h2>
            <p>
              {model ? `Model: ${model}` : "Gemini via the NOVA server"} · {user?.name ?? "you"}
            </p>
          </div>
          <Badge tone={entitlement?.aiAllowed ? "success" : "warning"}>
            {entitlement?.aiAllowed ? "Assistant enabled" : "Assistant locked"}
          </Badge>
        </header>

        {aiBlocked ? (
          <Notice tone="warning" title="Assistant access is not active">
            {entitlement?.reason ?? "Your plan does not include assistant access yet."} An owner must approve a
            plan or grant assistant access before messages can be sent.
          </Notice>
        ) : null}

        <div className="chat-scroll">
          {active && active.messages.length > 0 ? (
            active.messages.map((message) => <Bubble key={message.id} message={message} />)
          ) : (
            <EmptyState
              icon="spark"
              title="Start a conversation"
              description="Messages are sent to the NOVA server, which calls Gemini with a server-side key. If no key is configured you will see an explicit configuration error — never a fabricated answer."
            />
          )}
          {streamingText ? (
            <div className="bubble bubble-nova">
              <span className="bubble-role">NOVA</span>
              <div className="bubble-body">{streamingText}</div>
            </div>
          ) : null}
          {pending && !streamingText ? <Spinner label="NOVA is thinking…" /> : null}
          {error ? (
            <Notice tone="danger" title="Assistant error">
              {error}
            </Notice>
          ) : null}
          <div ref={endRef} />
        </div>

        <form className="composer" onSubmit={send}>
          <TextArea
            rows={2}
            value={input}
            placeholder="Ask NOVA anything…"
            aria-label="Message"
            disabled={pending || aiBlocked}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(event);
              }
            }}
          />
          <div className="composer-actions">
            {pending ? (
              <Button type="button" variant="ghost" onClick={stop}>
                Stop
              </Button>
            ) : null}
            <Button type="submit" icon="send" loading={pending} disabled={!input.trim() || aiBlocked}>
              Send
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
