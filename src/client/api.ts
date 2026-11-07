import { parseSseChunk } from "../shared/sse.js";
import type { ApiErrorBody, AssistantStreamEvent } from "../shared/types.js";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  return Boolean(value && typeof value === "object" && "error" in value);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network_error", "NOVA could not reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    if (isErrorBody(payload)) {
      throw new ApiError(response.status, payload.error.code, payload.error.message);
    }
    throw new ApiError(response.status, "request_failed", `The request failed (HTTP ${response.status}).`);
  }

  return payload as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

export interface StreamHandlers {
  onEvent: (event: AssistantStreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Streams an assistant reply. The server sends SSE frames over a POST response,
 * so `EventSource` cannot be used; we parse the body incrementally instead.
 */
export async function streamAssistant(
  body: { conversationId?: string; message: string },
  { onEvent, signal }: StreamHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/assistant/stream", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") return;
    onEvent({ type: "error", code: "network_error", message: "NOVA could not reach the server." });
    return;
  }

  if (!response.ok || !response.body) {
    let message = `The assistant request failed (HTTP ${response.status}).`;
    let code = "request_failed";
    try {
      const payload = (await response.json()) as unknown;
      if (isErrorBody(payload)) {
        message = payload.error.message;
        code = payload.error.code;
      }
    } catch {
      /* keep the generic message */
    }
    onEvent({ type: "error", code, message });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer, chunk);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        let data: unknown;
        try {
          data = JSON.parse(frame.data);
        } catch {
          continue;
        }
        if (frame.event === "meta" || frame.event === "delta" || frame.event === "done" || frame.event === "error") {
          onEvent({ type: frame.event, ...(data as object) } as AssistantStreamEvent);
        }
      }
    }
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      onEvent({ type: "error", code: "stream_failed", message: "The reply stream ended unexpectedly." });
    }
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelative(value: string): string {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "—";
  const diff = Date.now() - date;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
