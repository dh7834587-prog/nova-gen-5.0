# NOVA GEN 5.0

A futuristic personal AI operating system: a dark black / deep-navy workspace with purple
and violet highlights, 15 modules, per-user private data, manual mobile-money billing and
an owner control centre.

Stack: Express 5 + zod (server, TypeScript), React 19 + Vite 8 (client), vitest (tests).
The server is bundled with the Vite SSR build, so production runs a single Node process.

## Modules

Home · AI Assistant · AI Messages · Memory Centre · Creative Studio · Image Generation ·
Video Generation · Coding Lab · Research Centre · File Manager · Browser · Productivity ·
Subscription Plans · Settings · Owner Control Centre.

## Run locally

```bash
npm install
npm run dev          # client (5173) + API server (3000) with reload
npm run build        # dist/client + dist/server
npm start            # serves dist/client and /api on $PORT (default 3000)
npm test             # integration tests against the real Express app
npm run typecheck
```

## Environment

Secrets are read on the server only and are never sent to the browser.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Enables real Gemini chat, research summaries and coding help. Without it every AI surface reports an honest "not configured" state. |
| `SESSION_SECRET` | Signs session cookies. Generated in memory per boot when unset (sessions then do not survive a restart). |
| `OWNER_EMAIL` | Email address that is granted the owner role on registration. The first account also becomes owner when this is unset. |
| `PORT` | HTTP port, default `3000`. The server binds `0.0.0.0`. |
| `DATA_DIR` | JSON data directory, default `./data`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Optional Google sign-in. |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Optional Facebook sign-in. |
| `IMAGE_PROVIDER_URL` / `IMAGE_PROVIDER_KEY` | Optional text-to-image provider. |
| `VIDEO_PROVIDER_URL` / `VIDEO_PROVIDER_KEY` | Optional text-to-video provider. |

Provider-backed features stay disabled and say so until their credentials are configured;
no surface fakes a generated image, video, AI reply or payment confirmation.

## Accounts and privacy

* Email registration, login, password reset and email verification use scrypt password
  hashing and signed, HTTP-only session cookies.
* Reset and verification links are generated server-side and delivered by the owner from
  the Owner Control Centre (no paid email service is required for the prototype).
* Every record is stored with an `ownerId` and every API read/write filters on the session
  user, so one workspace cannot read another's messages, memories, projects or files.
* The owner role is assigned on the server (`OWNER_EMAIL` or first account) — never through
  a public form. Owner routes reject members with 403.

## Billing

Plans: Free (3-day trial), Premium Le 70 monthly / Le 840 yearly, Custom (quoted).

1. The user picks a plan and a provider — Afrimoney `030676782` or Orange Money `076278673`.
2. The app shows the configured instructions; the user submits the transaction reference.
3. The submission is stored as `pending` and the subscription as `pending_approval`.
4. The owner verifies the transfer independently and approves or rejects it.
5. Only approval activates the subscription; quotas are enforced on the backend.

Custom plans follow the same rule: the user submits requirements, the owner sends a
quotation, the user accepts, and the owner activates. No PIN or OTP is ever collected.

## Security

* zod validation on every request body, per-route authorization guards.
* Fixed-window rate limiting (240 req/min per IP) plus a tighter per-email limiter on
  register / login / password-reset.
* Credential-shaped text is refused in memories and AI requests.
* The Browser/Research reader only fetches public http(s) URLs and blocks loopback,
  private, link-local and metadata addresses (SSRF protection).
* Audit log for authentication, billing, owner actions and destructive edits.
* Security headers on every response; destructive actions require confirmation in the UI.

## Tests

`npm test` boots the real Express app on an ephemeral port with an in-memory database and
asserts: owner/member role assignment, session requirements, cross-user isolation of
records, credential rejection in memories, owner-only endpoints, manual payment approval
(with member self-approval blocked), duplicate transaction references, the custom
quote → accept → activate flow, the honest "Gemini not configured" stream response and
SSRF rejection.

## PWA

`public/manifest.webmanifest`, maskable icons, a service worker with an offline fallback
page and an in-app install prompt make the app installable on Android, iPhone, tablets,
Chromebooks and desktop.
