import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SnippetRecord } from "../../shared/types.js";
import { api, errorMessage, formatDateTime } from "../api.js";
import { Badge, Button, EmptyState, Field, Input, Notice, Panel, PanelHeader, Select, TextArea } from "../components/ui.js";

type AssistTask = "explain" | "debug" | "generate" | "review";

const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "html",
  "css",
  "sql",
  "bash",
  "json",
  "rust",
  "go",
  "php",
  "java",
  "plain text",
];

const KEYWORDS: Record<string, string[]> = {
  typescript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "interface", "type", "import", "export", "from", "async", "await", "new", "throw", "try", "catch", "extends", "implements", "null", "undefined", "true", "false", "void", "public", "private", "readonly"],
  javascript: ["const", "let", "var", "function", "return", "if", "else", "for", "while", "class", "import", "export", "from", "async", "await", "new", "throw", "try", "catch", "null", "undefined", "true", "false", "typeof", "of", "in"],
  python: ["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with", "try", "except", "raise", "None", "True", "False", "lambda", "yield", "async", "await", "pass", "not", "and", "or", "in"],
  rust: ["fn", "let", "mut", "pub", "struct", "enum", "impl", "use", "mod", "match", "if", "else", "for", "while", "loop", "return", "async", "await", "Some", "None", "Ok", "Err", "true", "false"],
  go: ["func", "package", "import", "type", "struct", "interface", "var", "const", "return", "if", "else", "for", "range", "go", "defer", "chan", "nil", "true", "false"],
  php: ["function", "class", "public", "private", "protected", "return", "if", "else", "foreach", "for", "while", "new", "echo", "namespace", "use", "null", "true", "false", "static"],
  java: ["class", "public", "private", "protected", "static", "void", "return", "if", "else", "for", "while", "new", "import", "package", "final", "null", "true", "false", "extends", "implements"],
  sql: ["select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join", "left", "right", "inner", "group", "order", "by", "limit", "create", "table", "primary", "key", "and", "or", "not", "null"],
  bash: ["if", "then", "else", "fi", "for", "do", "done", "while", "function", "echo", "export", "local", "return", "case", "esac"],
  css: ["important", "media", "supports", "root", "hover", "focus"],
};

/**
 * Deliberately small, dependency-free highlighter.
 *
 * It only ever renders React text nodes, so untrusted code can never inject
 * markup, and it keeps the bundle free of heavyweight editor libraries.
 */
function highlight(code: string, language: string): React.ReactNode[] {
  const keywords = new Set(KEYWORDS[language] ?? []);
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = tokenPattern.exec(code)) !== null) {
    if (match.index > lastIndex) nodes.push(code.slice(lastIndex, match.index));
    const token = match[0];
    let className = "";
    if (token.startsWith("//") || token.startsWith("#") || token.startsWith("/*")) className = "tok-comment";
    else if (/^["'`]/.test(token)) className = "tok-string";
    else if (/^\d/.test(token)) className = "tok-number";
    else if (keywords.has(token)) className = "tok-keyword";
    nodes.push(
      className ? (
        <span key={key++} className={className}>
          {token}
        </span>
      ) : (
        token
      ),
    );
    lastIndex = match.index + token.length;
  }
  if (lastIndex < code.length) nodes.push(code.slice(lastIndex));
  return nodes;
}

interface AssistResult {
  task: AssistTask;
  answer: string;
  model: string;
  notice: string;
}

export function CodePage() {
  const [items, setItems] = useState<SnippetRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("typescript");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showHighlight, setShowHighlight] = useState(true);

  const [task, setTask] = useState<AssistTask>("explain");
  const [question, setQuestion] = useState("");
  const [assistBusy, setAssistBusy] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assist, setAssist] = useState<AssistResult | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await api<{ items: SnippetRecord[] }>("/api/records/code");
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

  useEffect(() => {
    return () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const reset = () => {
    setSelectedId(null);
    setTitle("");
    setLanguage("typescript");
    setDescription("");
    setCode("");
    setDirty(false);
    setAssist(null);
    setAssistError(null);
  };

  const open = (item: SnippetRecord) => {
    setSelectedId(item.id);
    setTitle(item.title);
    setLanguage(item.language || "plain text");
    setDescription(item.description);
    setCode(item.code);
    setDirty(false);
    setAssist(null);
    setAssistError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError("Give the snippet a title before saving.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({ title, language, description, code });
      if (selectedId) {
        const payload = await api<{ item: SnippetRecord }>(`/api/records/code/${selectedId}`, {
          method: "PATCH",
          body,
        });
        setItems((current) => current.map((item) => (item.id === payload.item.id ? payload.item : item)));
      } else {
        const payload = await api<{ item: SnippetRecord }>("/api/records/code", { method: "POST", body });
        setItems((current) => [payload.item, ...current]);
        setSelectedId(payload.item.id);
      }
      setDirty(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: SnippetRecord) => {
    if (!window.confirm(`Delete “${item.title}”? This cannot be undone.`)) return;
    try {
      await api(`/api/records/code/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (selectedId === item.id) reset();
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const runAssist = async () => {
    setAssistBusy(true);
    setAssistError(null);
    setAssist(null);
    try {
      const payload = await api<AssistResult>("/api/code/assist", {
        method: "POST",
        body: JSON.stringify({ task, language, code, question }),
      });
      setAssist(payload);
    } catch (cause) {
      setAssistError(errorMessage(cause));
    } finally {
      setAssistBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Your browser blocked clipboard access. Select the text and copy manually.");
    }
  };

  const download = () => {
    const extension = language === "plain text" ? "txt" : language;
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(title || "snippet").replace(/[^\w.-]+/g, "-").toLowerCase()}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const lineCount = useMemo(() => Math.max(code.split("\n").length, 1), [code]);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>Coding Lab</h1>
          <p>
            Store snippets, review them with syntax highlighting and ask the configured Gemini model to
            explain, debug or extend your code. NOVA has no execution sandbox — it never runs what you paste.
          </p>
        </div>
        <div className="page-head-action">
          <Button variant="ghost" icon="plus" onClick={reset} type="button">
            New snippet
          </Button>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="Coding Lab error">
          {error}
        </Notice>
      ) : null}

      <div className="split">
        <Panel>
          <PanelHeader
            title="Snippet library"
            subtitle={`${items.length} saved · private to your account`}
            action={<Badge tone="violet">{items.length}</Badge>}
          />
          {loading ? (
            <div className="skeleton-list" aria-hidden="true">
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon="code"
              title="No snippets yet"
              description="Write code on the right and save it to build a private library the assistant can review."
            />
          ) : (
            <ul className="list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`list-row list-row-button ${selectedId === item.id ? "is-active" : ""}`.trim()}
                    onClick={() => open(item)}
                  >
                    <span className="list-body">
                      <strong>{item.title}</strong>
                      <span>
                        {item.language || "plain text"} · {formatDateTime(item.updatedAt)}
                      </span>
                    </span>
                    <Badge tone="neutral">{item.code.split("\n").length} lines</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="stack">
          <Panel>
            <PanelHeader
              title={selectedId ? "Edit snippet" : "New snippet"}
              subtitle="Saved to your private workspace"
              action={
                <div className="row-actions">
                  <Button
                    variant="quiet"
                    type="button"
                    onClick={() => setShowHighlight((value) => !value)}
                  >
                    {showHighlight ? "Edit mode" : "Highlight mode"}
                  </Button>
                  {selectedId ? (
                    <Button
                      variant="danger"
                      type="button"
                      onClick={() => {
                        const item = items.find((row) => row.id === selectedId);
                        if (item) void remove(item);
                      }}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              }
            />
            <form className="stack-tight" onSubmit={save}>
              <div className="form-grid">
                <Field label="Title">
                  <Input
                    value={title}
                    required
                    maxLength={120}
                    placeholder="Owner-scoped query helper"
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
                <Field label="Language">
                  <Select
                    value={language}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setDirty(true);
                    }}
                  >
                    {LANGUAGES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Description" hint="Optional note about intent">
                  <Input
                    value={description}
                    maxLength={400}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setDirty(true);
                    }}
                  />
                </Field>
              </div>

              <div className="code-editor">
                <div className="code-editor-bar">
                  <span className="muted small">
                    {lineCount} line{lineCount === 1 ? "" : "s"} · {code.length} chars
                    {dirty ? " · unsaved changes" : ""}
                  </span>
                  <div className="row-actions">
                    <Button variant="quiet" type="button" onClick={() => void copy(code)}>
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button variant="quiet" type="button" onClick={download} disabled={!code}>
                      Download
                    </Button>
                  </div>
                </div>
                {showHighlight ? (
                  <pre className="code-block code-block-tall" aria-label="Highlighted code preview">
                    <code>{code ? highlight(code, language) : "// Paste code here, then switch to edit mode."}</code>
                  </pre>
                ) : (
                  <TextArea
                    className="code-input"
                    rows={18}
                    spellCheck={false}
                    value={code}
                    placeholder={"export function greet(name: string) {\n  return `Hello, ${name}`;\n}"}
                    onChange={(event) => {
                      setCode(event.target.value);
                      setDirty(true);
                    }}
                  />
                )}
              </div>

              <div className="row-actions">
                <Button type="submit" loading={saving} icon="check">
                  {selectedId ? "Save changes" : "Save snippet"}
                </Button>
              </div>
            </form>
          </Panel>

          <Panel>
            <PanelHeader
              title="AI code assistant"
              subtitle="Runs on the server with your configured Gemini key"
            />
            <div className="form-grid">
              <Field label="Task">
                <Select value={task} onChange={(event) => setTask(event.target.value as AssistTask)}>
                  <option value="explain">Explain this code</option>
                  <option value="debug">Debug / find defects</option>
                  <option value="generate">Generate code</option>
                  <option value="review">Security &amp; quality review</option>
                </Select>
              </Field>
              <Field label="Your question" hint="Required for generation">
                <Input
                  value={question}
                  maxLength={600}
                  placeholder={task === "generate" ? "Write a debounce hook in TypeScript" : "What should NOVA focus on?"}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </Field>
            </div>
            <div className="row-actions">
              <Button
                type="button"
                icon="spark"
                loading={assistBusy}
                onClick={() => void runAssist()}
                disabled={task !== "generate" && code.trim().length < 8}
              >
                Ask NOVA
              </Button>
            </div>

            {assistError ? (
              <Notice tone="danger" title="Assistant unavailable">
                {assistError}
              </Notice>
            ) : null}

            {assist ? (
              <div className="assist-output">
                <div className="assist-output-head">
                  <Badge tone="violet">{assist.task}</Badge>
                  <span className="muted small">{assist.model}</span>
                  <Button variant="quiet" type="button" onClick={() => void copy(assist.answer)}>
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre className="assist-text">{assist.answer}</pre>
                <p className="muted small">{assist.notice}</p>
              </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
}
