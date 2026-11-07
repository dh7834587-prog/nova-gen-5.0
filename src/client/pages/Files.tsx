import { useCallback, useEffect, useRef, useState } from "react";
import type { FileRecord } from "../../shared/types.js";
import { api, errorMessage, formatBytes, formatDateTime } from "../api.js";
import { Button, EmptyState, Notice, Panel, PanelHeader } from "../components/ui.js";

const MAX_BYTES = 1_000_000;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

export function FilesPage() {
  const [items, setItems] = useState<FileRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
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

  const remove = async (id: string) => {
    try {
      await api(`/api/files/${id}`, { method: "DELETE" });
      setItems((current) => current.filter((item) => item.id !== id));
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
            Private per-account storage. Downloads require your session — there is no public path to a stored
            file.
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
                    <strong>{item.name}</strong>
                    <span>
                      {formatBytes(item.size)} · {item.mimeType}
                    </span>
                  </span>
                  <span className="list-meta">{formatDateTime(item.createdAt)}</span>
                  <div className="record-actions">
                    <a className="btn btn-quiet" href={`/api/files/${item.id}/download`}>
                      Download
                    </a>
                    <Button variant="quiet" type="button" onClick={() => void remove(item.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
