import { randomBytes } from "node:crypto";
import path from "node:path";

const rawSecret = process.env.SESSION_SECRET?.trim();

/**
 * Central runtime configuration. Every value is optional: NOVA must boot on a
 * free host with zero paid services configured, and report honestly which
 * integrations are missing rather than pretending they exist.
 */
export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  /** Ephemeral secret means sessions do not survive a restart. */
  sessionSecret: rawSecret || randomBytes(48).toString("base64url"),
  sessionSecretIsEphemeral: !rawSecret,
  ownerEmail: process.env.OWNER_EMAIL?.trim().toLowerCase() || null,
  geminiApiKey: process.env.GEMINI_API_KEY?.trim() || null,
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image",
  dataDir: process.env.DATA_DIR?.trim() || null,
  staticDir: path.resolve(process.cwd(), "dist/client"),
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  /** Hard caps so a prototype deployment cannot be trivially exhausted. */
  limits: {
    messageChars: 8000,
    memoryChars: 4000,
    fileBytes: 1024 * 1024,
    conversationMessages: 200,
    recordsPerCollection: 500,
  },
};
