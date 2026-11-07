import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "../api.js";
import { Button, EmptyState, Field, Input, Notice, Select, TextArea } from "./ui.js";

export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "tags" | "date";
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  hint?: string;
  span?: boolean;
}

interface Item {
  id: string;
  createdAt: string;
  updatedAt: string;
}

type Draft = Record<string, string>;

function toDraft<T>(fields: FieldSpec[], item?: T): Draft {
  const record = item as Record<string, unknown> | undefined;
  const draft: Draft = {};
  for (const field of fields) {
    const value = record?.[field.name];
    draft[field.name] =
      field.type === "tags"
        ? Array.isArray(value)
          ? value.join(", ")
          : ""
        : typeof value === "string"
          ? value
          : value === null || value === undefined
            ? ""
            : String(value);
  }
  return draft;
}

function toPayload(fields: FieldSpec[], draft: Draft): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (draft[field.name] ?? "").trim();
    if (field.type === "tags") {
      payload[field.name] = raw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 8);
      continue;
    }
    if (raw === "") continue;
    payload[field.name] = raw;
  }
  return payload;
}

/** Shared CRUD hook: every collection is owner-scoped by the server. */
export function useCollection<T extends Item>(path: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<{ items: T[] }>(path);
      setItems(payload.items);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (body: Record<string, unknown>) => {
      const payload = await api<{ item: T }>(path, { method: "POST", body: JSON.stringify(body) });
      setItems((current) => [payload.item, ...current]);
      return payload.item;
    },
    [path],
  );

  const update = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const payload = await api<{ item: T }>(path, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setItems((current) => current.map((item) => (item.id === id ? payload.item : item)));
      return payload.item;
    },
    [path],
  );

  const remove = useCallback(
    async (id: string) => {
      await api(`${path}/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
    },
    [path],
  );

  return { items, loading, error, reload, create, update, remove };
}

interface RecordBoardProps<T extends Item> {
  path: string;
  eyebrow: string;
  title: string;
  description: string;
  fields: FieldSpec[];
  emptyTitle: string;
  emptyDescription: string;
  renderItem: (item: T, actions: { edit: () => void; remove: () => void }) => ReactNode;
  searchText?: (item: T) => string;
  createLabel?: string;
  formIntro?: string;
}

/**
 * A reusable create/edit/delete board. Memory, creative, code, research and
 * productivity modules all share this component with different field specs.
 */
export function RecordBoard<T extends Item>({
  path,
  eyebrow,
  title,
  description,
  fields,
  emptyTitle,
  emptyDescription,
  renderItem,
  searchText,
  createLabel = "New entry",
  formIntro,
}: RecordBoardProps<T>) {
  const { items, loading, error, create, update, remove } = useCollection<T>(path);
  const [editing, setEditing] = useState<T | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => toDraft(fields));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openForm = (item?: T) => {
    setEditing(item ?? null);
    setDraft(toDraft(fields, item));
    setFormError(null);
    setOpen(true);
  };

  const closeForm = () => {
    setOpen(false);
    setEditing(null);
    setFormError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = toPayload(fields, draft);
      if (editing) await update(editing.id, payload);
      else await create(payload);
      closeForm();
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      (searchText ? searchText(item) : JSON.stringify(item)).toLowerCase().includes(needle),
    );
  }, [items, query, searchText]);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        <div className="page-head-action">
          <Button icon="plus" onClick={() => openForm()} type="button">
            {createLabel}
          </Button>
        </div>
      </header>

      {error ? <Notice tone="danger" title="Could not load this module">{error}</Notice> : null}

      {open ? (
        <form className="panel form-panel" onSubmit={submit}>
          <header className="panel-head">
            <div>
              <h2>{editing ? `Edit ${title.toLowerCase()} entry` : createLabel}</h2>
              {formIntro ? <p>{formIntro}</p> : null}
            </div>
          </header>
          <div className="form-grid">
            {fields.map((field) => (
              <div key={field.name} className={field.span ? "span-2" : undefined}>
                <Field label={field.label} hint={field.hint}>
                  {field.type === "textarea" ? (
                    <TextArea
                      rows={field.name === "code" ? 8 : 4}
                      value={draft[field.name] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                  ) : field.type === "select" ? (
                    <Select
                      value={draft[field.name] ?? ""}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <Input
                      type={field.type === "date" ? "date" : "text"}
                      value={draft[field.name] ?? ""}
                      placeholder={field.placeholder}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [field.name]: event.target.value }))
                      }
                    />
                  )}
                </Field>
              </div>
            ))}
          </div>
          {formError ? <Notice tone="danger">{formError}</Notice> : null}
          <div className="form-actions">
            <Button type="submit" loading={saving}>
              {editing ? "Save changes" : "Create"}
            </Button>
            <Button type="button" variant="ghost" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="toolbar">
        <Input
          type="search"
          placeholder={`Search ${title.toLowerCase()}…`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={`Search ${title}`}
        />
        <span className="toolbar-count">
          {items.length} {items.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      {loading ? (
        <div className="skeleton-list" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? "No matches" : emptyTitle}
          description={query ? "Try a different search term." : emptyDescription}
          action={
            query ? undefined : (
              <Button variant="ghost" icon="plus" onClick={() => openForm()}>
                {createLabel}
              </Button>
            )
          }
        />
      ) : (
        <div className="card-grid">
          {visible.map((item) => (
            <article key={item.id} className="panel record-card">
              {renderItem(item, {
                edit: () => openForm(item),
                remove: () => {
                  setBusyId(item.id);
                  void remove(item.id)
                    .catch((cause) => setFormError(errorMessage(cause)))
                    .finally(() => setBusyId(null));
                },
              })}
              <footer className="record-foot">
                <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                <div className="record-actions">
                  <Button variant="quiet" onClick={() => openForm(item)} type="button">
                    Edit
                  </Button>
                  <Button
                    variant="quiet"
                    onClick={() => {
                      setBusyId(item.id);
                      void remove(item.id).finally(() => setBusyId(null));
                    }}
                    type="button"
                    loading={busyId === item.id}
                  >
                    Delete
                  </Button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
