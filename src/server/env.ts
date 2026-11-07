import { randomBytes } from "node:crypto";
import path from "node:path";

const rawSecret = process.env.SESSION_SECRET?.trim();

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

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
  /** Public origin used to build OAuth redirect URIs (falls back to request host). */
  publicBaseUrl: optional(process.env.PUBLIC_BASE_URL)?.replace(/\/+$/, "") ?? null,
  geminiApiKey: optional(process.env.GEMINI_API_KEY),
  geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  geminiImageModel: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image",
  dataDir: optional(process.env.DATA_DIR),
  staticDir: path.resolve(process.cwd(), "dist/client"),
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
  /** Manual mobile-money receiving details; owners can change them in-app. */
  payments: {
    afrimoneyNumber: process.env.PAYMENT_AFRIMONEY_NUMBER?.trim() || "030676782",
    orangeMoneyNumber: process.env.PAYMENT_ORANGE_MONEY_NUMBER?.trim() || "076278673",
    accountName: process.env.PAYMENT_ACCOUNT_NAME?.trim() || "NOVA GEN 5.0",
  },
  /** Social sign-in credentials. Absent values disable the provider honestly. */
  oauth: {
    google: {
      clientId: optional(process.env.GOOGLE_CLIENT_ID),
      clientSecret: optional(process.env.GOOGLE_CLIENT_SECRET),
    },
    facebook: {
      clientId: optional(process.env.FACEBOOK_APP_ID),
      clientSecret: optional(process.env.FACEBOOK_APP_SECRET),
    },
  },
  /** Hard caps so a prototype deployment cannot be trivially exhausted. */
  limits: {
    messageChars: 8000,
    memoryChars: 4000,
    fileBytes: 1024 * 1024,
    conversationMessages: 200,
    recordsPerCollection: 500,
  },
};
