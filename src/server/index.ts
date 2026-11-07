import { createApp } from "./app.js";
import { env } from "./env.js";

const { app } = createApp();

const server = app.listen(env.port, "0.0.0.0", () => {
  console.log(`[nova] NOVA GEN 5.0 listening on http://0.0.0.0:${env.port}`);
  if (!env.geminiApiKey) {
    console.log("[nova] GEMINI_API_KEY is not set: the assistant reports an honest unconfigured state.");
  }
  if (env.sessionSecretIsEphemeral) {
    console.log("[nova] SESSION_SECRET is not set: sessions will not survive a restart.");
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
