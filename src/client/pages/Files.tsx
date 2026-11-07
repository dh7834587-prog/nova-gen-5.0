import { useCallback, useEffect, useRef, useState } from "react";
import type { FileRecord } from "../../shared/types.js";
import { api, errorMessage, formatBytes, formatDateTime } from "../api.js";
import { Badge, Button, EmptyState, Input, Notice, Panel, PanelHeader } from "../components/ui.js";

const MAX_BYTES = 1_000_000;

type PreviewKind = "image" | "pdf" | "text";

interface PreviewState {
  file: FileRecord;
  kind: PreviewKind;
  text?: string;
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file from this device."));
    reader.readAsDataURL(file);
  });
}

function previewKind(mimeType: string): PreviewKind | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("text/") || /json|xml|javascript|typescript|csv|markdown/.test(mimeType)) {
    return "text";
  }
  return null;
}

export function FilesPage() {
  const [items, setItems] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await api<{ items: FileRecord[] }>("/api/files");
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

  const upload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`${file.name} is larger than the ${formatBytes(MAX_BYTES)} prototype limit.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const data = await readAsBase64(file);
      const payload = await api<{ item: FileRecord }>("/api/files", {
        method: "POST",
        body: JSON.stringify({ name: file.name, mimeType: file.type || "application/octet-stream", data }),
      });
      setItems((current) => [payload.item, ...current]);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (item: FileRecord) => {
    if (!window.confirm(`Delete “${item.name}”? This cannot be undone.`)) return;
    try {
      await api(`/api/files/${item.id}`, { method: "DELETE" });
      setItems((current) => current.filter((row) => row.id !== item.id));
      if (preview?.file.id === item.id) setPreview(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const startRename = (item: FileRecord) => {
    setRenaming(item.id);
    setRenameValue(item.name);
    setError(null);
  };

  const saveRename = async (item: FileRecord) => {
    const name = renameValue.trim();
    if (!name) {
      setError("Give the file a name.");
      return;
    }
    try {
      const payload = await api<{ item: FileRecord }>(`/api/files/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      setItems((current) => current.map((row) => (row.id === item.id ? payload.item : row)));
      setRenaming(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const openPreview = async (item: FileRecord) => {
    const kind = previewKind(item.mimeType);
    if (!kind) {
      setError("This file type has no in-app preview. Download it to open it locally.");
      return;
    }
    setError(null);
    if (kind !== "text") {
      setPreview({ file: item, kind });
      return;
    }
    try {
      const response = await fetch(`/api/files/${item.id}/preview`, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`Preview failed with status ${response.status}.`);
      const text = await response.text();
      setPreview({ file: item, kind, text });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const total = items.reduce((sum, item) => sum + item.size, 0);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <span className="eyebrow">Vault</span>
          <h1>File Manager</h1>
          <p>
            Private per-account storage. Downloads and previews require your session — there is no public path to a
            stored file.
          </p>
        </div>
        <div className="page-head-action">
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            onChange={(event) => void upload(event.target.files)}
          />
          <Button icon="plus" loading={uploading} onClick={() => inputRef.current?.click()} type="button">
            Upload file
          </Button>
        </div>
      </header>

      {error ? (
        <Notice tone="danger" title="File operation failed">
          {error}
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader
          title="Your files"
          subtitle={`${items.length} file(s) · ${formatBytes(total)} used · ${formatBytes(MAX_BYTES)} per file`}
        />
        {loading ? (
          <div className="skeleton-list" aria-hidden="true">
            <div className="skeleton" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon="files"
            title="No files yet"
            description="Upload a brief, a reference image or a document. Files stay attached to your account only."
            action={
              <Button variant="ghost" icon="plus" onClick={() => inputRef.current?.click()}>
                Upload file
              </Button>
            }
          />
        ) : (
          <ul className="list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="list-row list-row-static">
                  <span className="list-icon">
                    <span aria-hidden="true">▣</span>
                  </span>
                  <span className="list-body">
                    {renaming === item.id ? (
                      <span className="inline-form">
                        <Input
                          value={renameValue}
                          aria-label="New file name"
                          onChange={(event) => setRenameValue(event.target.value)}
                        />
                        <Button type="button" variant="quiet" onClick={() => void saveRename(item)}>
                          Save
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <strong>{item.name}</strong>
                    )}
                    <span>
                      {formatBytes(item.size)} · {item.mimeType}
                    </span>
                  </span>
                  <span className="list-meta">{formatDateTime(item.createdAt)}</span>
                  <div className="record-actions">
                    <Button variant="quiet" type="button" onClick={() => void openPreview(item)}>
                      Preview
                    </Button>
                    <Button variant="quiet" type="button" onClick={() => startRename(item)}>
                      Rename
                    </Button>
                    <a className="btn btn-quiet" href={`/api/files/${item.id}/download`}>
                      Download
                    </a>
                    <Button variant="danger" type="button" onClick={() => void remove(item)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {preview ? (
        <Panel>
          <PanelHeader
            title={preview.file.name}
            subtitle={`${preview.file.mimeType} · ${formatBytes(preview.file.size)}`}
            action={
              <div className="row-actions">
                <Badge tone="violet">Preview</Badge>
                <Button variant="ghost" type="button" onClick={() => setPreview(null)}>
                  Close
                </Button>
              </div>
            }
          />
          {preview.kind === "image" ? (
            <img
              className="preview-media"
              src={`/api/files/${preview.file.id}/preview`}
              alt={preview.file.name}
            />
          ) : preview.kind === "pdf" ? (
            <iframe
              className="preview-frame"
              title={preview.file.name}
              src={`/api/files/${preview.file.id}/preview`}
              sandbox=""
            />
          ) : (
            <pre className="preview-text">{preview.text ?? ""}</pre>
          )}
        </Panel>
      ) : null}
    </div>
  );
}
