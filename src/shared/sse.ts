/**
 * Minimal, dependency-free server-sent events helpers.
 *
 * The server writes frames; the browser reads them with `fetch` +
 * `ReadableStream` so it can POST a body and still stream the response
 * (EventSource only supports GET).
 */

export function encodeSseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export interface ParsedSseFrame {
  event: string;
  data: string;
}

/**
 * Incremental SSE frame parser. Feed it arbitrary chunks; it returns the
 * complete frames found so far and the unconsumed remainder.
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): { frames: ParsedSseFrame[]; rest: string } {
  const combined = buffer + chunk;
  const parts = combined.split("\n\n");
  const rest = parts.pop() ?? "";
  const frames: ParsedSseFrame[] = [];

  for (const part of parts) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const rawLine of part.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (dataLines.length > 0) {
      frames.push({ event, data: dataLines.join("\n") });
    }
  }

  return { frames, rest };
}

/** Extracts the text payload of a Gemini streaming response chunk. */
export function extractGeminiText(payload: unknown): string {
  const candidates = (payload as { candidates?: unknown })?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts)) return "";
  let text = "";
  for (const part of parts) {
    const value = (part as { text?: unknown })?.text;
    if (typeof value === "string") text += value;
  }
  return text;
}
