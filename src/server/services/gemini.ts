import { extractGeminiText, parseSseChunk } from "../../shared/sse.js";
import type { ProviderStatus } from "../../shared/types.js";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface ProviderConfig {
  apiKey: string | null;
  chatModel: string;
  imageModel: string;
}

export interface AiProvider {
  readonly info: ProviderStatus;
  streamChat(input: {
    system: string;
    turns: ChatTurn[];
    signal?: AbortSignal;
  }): AsyncGenerator<string, void, unknown>;
  generateImage(input: {
    prompt: string;
    aspectRatio?: string;
    signal?: AbortSignal;
  }): Promise<{ dataUrl: string; mimeType: string }>;
}

/** Raised when the deployment has no usable AI credential. */
export class ProviderNotConfiguredError extends Error {
  readonly code = "provider_not_configured";
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/** Raised when the upstream provider rejects or fails a request. */
export class ProviderRequestError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "ProviderRequestError";
    this.code = code;
    this.status = status;
  }
}

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const NOT_CONFIGURED_MESSAGE =
  "Live AI is not configured on this NOVA server. An owner must set GEMINI_API_KEY in the " +
  "environment before the assistant can answer. NOVA will not fabricate a response in the " +
  "meantime.";

function upstreamMessage(payload: unknown, fallback: string): string {
  const error = (payload as { error?: { message?: unknown } })?.error;
  const message = typeof error?.message === "string" ? error.message : null;
  return message ? `${fallback} (${message})` : fallback;
}

/**
 * Real Gemini client. The API key lives only in the server process: the browser
 * talks to /api/assistant/stream and never receives the credential.
 */
export function createGeminiProvider(config: ProviderConfig): AiProvider {
  const configured = Boolean(config.apiKey);
  const info: ProviderStatus = {
    configured,
    chatModel: config.chatModel,
    imageModel: config.imageModel,
    videoConfigured: false,
    reason: configured
      ? null
      : NOT_CONFIGURED_MESSAGE,
  };

  function requireKey(): string {
    if (!config.apiKey) throw new ProviderNotConfiguredError(NOT_CONFIGURED_MESSAGE);
    return config.apiKey;
  }

  async function assertOk(response: Response, action: string): Promise<void> {
    if (response.ok) return;
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new ProviderRequestError(
        "provider_unauthorised",
        upstreamMessage(payload, "Gemini rejected the configured API key."),
        502,
      );
    }
    if (status === 429) {
      throw new ProviderRequestError(
        "provider_rate_limited",
        upstreamMessage(payload, "Gemini rate limit or quota reached. Try again later."),
        429,
      );
    }
    throw new ProviderRequestError(
      "provider_error",
      upstreamMessage(payload, `Gemini could not complete the ${action} request.`),
      502,
    );
  }

  return {
    info,

    async *streamChat({ system, turns, signal }) {
      const apiKey = requireKey();
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(config.chatModel)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: turns.map((turn) => ({
              role: turn.role,
              parts: [{ text: turn.text }],
            })),
            generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
          }),
          signal,
        },
      );

      await assertOk(response, "assistant");
      const body = response.body;
      if (!body) throw new ProviderRequestError("provider_error", "Gemini returned an empty stream.");

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { frames, rest } = parseSseChunk(buffer, "");
        buffer = rest;
        for (const frame of frames) {
          let payload: unknown;
          try {
            payload = JSON.parse(frame.data);
          } catch {
            continue;
          }
          if ((payload as { error?: unknown }).error) {
            throw new ProviderRequestError(
              "provider_error",
              upstreamMessage(payload, "Gemini reported an error mid-stream."),
            );
          }
          const text = extractGeminiText(payload);
          if (text) yield text;
        }
      }
    },

    async generateImage({ prompt, aspectRatio, signal }) {
      const apiKey = requireKey();
      const imageConfig = aspectRatio ? { imageConfig: { aspectRatio } } : {};
      const response = await fetch(
        `${ENDPOINT}/${encodeURIComponent(config.imageModel)}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: imageConfig,
          }),
          signal,
        },
      );

      await assertOk(response, "image");

      const payload = (await response.json()) as {
        candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
      };
      const parts = payload.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data) {
          const mimeType = inline.mimeType ?? "image/png";
          return { dataUrl: `data:${mimeType};base64,${inline.data}`, mimeType };
        }
      }
      throw new ProviderRequestError(
        "provider_no_image",
        "The image model returned no image data for that prompt. Nothing was saved.",
      );
    },
  };
}

export const providerNotConfiguredMessage = NOT_CONFIGURED_MESSAGE;
