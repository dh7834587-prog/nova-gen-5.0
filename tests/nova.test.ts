import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Integration tests against the real Express app with an in-memory database.
 * They assert the security and honesty guarantees NOVA claims: per-user
 * isolation, owner-only controls, manual payment approval, no fake AI output
 * and no server-side request forgery.
 */

process.env.OWNER_EMAIL = "owner@nova.test";
process.env.SESSION_SECRET = "nova-test-session-secret-0123456789";
process.env.DATA_DIR = path.join(os.tmpdir(), "nova-gen-test-data");
process.env.GEMINI_API_KEY = "";

const { createApp } = await import("../src/server/app.js");
const { createDatabase } = await import("../src/server/store.js");

let base = "";
let server: import("node:http").Server;

type Reply = { status: number; body: any; text: string; cookies: string[] };

function client() {
  let cookie = "";
  return async (pathName: string, init: RequestInit = {}): Promise<Reply> => {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(`${base}${pathName}`, { ...init, headers });
    const setCookies = response.headers.getSetCookie();
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      if (pair.startsWith("nova_session=")) cookie = pair;
    }
    const text = await response.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: response.status, body, text, cookies: setCookies };
  };
}

const PASSWORD = "NovaTest!2026";

const register = (call: ReturnType<typeof client>, name: string, email: string) =>
  call("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password: PASSWORD }),
  });

/**
 * Tests share one in-memory database, so an account created by an earlier
 * test is reused by signing in instead of failing with a duplicate email.
 */
const accounts = new Map<string, ReturnType<typeof client>>();

async function signIn(name: string, email: string) {
  const cached = accounts.get(email);
  if (cached) return cached;
  const call = client();
  accounts.set(email, call);
  const created = await register(call, name, email);
  if (created.status !== 201) {
    const login = await call("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.status).toBe(200);
  }
  return call;
}

beforeAll(async () => {
  const { app } = createApp(createDatabase());
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("authentication and workspace isolation", () => {
  it("registers the first account as owner and later accounts as members", async () => {
    const owner = client();
    const member = client();

    const ownerReply = await register(owner, "NOVA Owner", "owner@nova.test");
    expect(ownerReply.status).toBe(201);
    expect(ownerReply.body.user.role).toBe("owner");

    const memberReply = await register(member, "Test Member", "member@nova.test");
    expect(memberReply.status).toBe(201);
    expect(memberReply.body.user.role).toBe("member");
  });

  it("requires a session for private collections", async () => {
    const anonymous = client();
    const reply = await anonymous("/api/records/memory");
    expect(reply.status).toBe(401);
  });

  it("keeps each user's memories private", async () => {
    const owner = await signIn("NOVA Owner", "owner@nova.test");
    const member = await signIn("Test Member", "member@nova.test");

    const created = await member("/api/records/memory", {
      method: "POST",
      body: JSON.stringify({
        title: "Member private note",
        content: "Only the member should read this.",
        category: "project",
      }),
    });
    expect(created.status).toBe(201);
    const memoryId = created.body.item.id as string;

    const ownerList = await owner("/api/records/memory");
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.items.map((row: { id: string }) => row.id)).not.toContain(memoryId);

    const ownerPatch = await owner(`/api/records/memory/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Hijacked" }),
    });
    expect(ownerPatch.status).toBe(404);

    const memberList = await member("/api/records/memory");
    expect(memberList.body.items.map((row: { id: string }) => row.id)).toContain(memoryId);
  });

  it("rejects memories that look like credentials", async () => {
    const member = await signIn("Test Member", "member@nova.test");
    const reply = await member("/api/records/memory", {
      method: "POST",
      body: JSON.stringify({
        title: "Key",
        content: "api key: sk-live-abcdef123456",
      }),
    });
    expect(reply.status).toBe(400);
  });
});

describe("owner-only controls", () => {
  it("blocks members from the owner centre", async () => {
    const member = await signIn("Test Member", "member@nova.test");
    const reply = await member("/api/owner/overview");
    expect(reply.status).toBe(403);
  });
});

describe("manual mobile-money payments", () => {
  it("stays pending until the owner approves the transfer", async () => {
    const owner = await signIn("NOVA Owner", "owner@nova.test");
    const member = await signIn("Test Member", "member@nova.test");

    const submitted = await member("/api/billing/payments", {
      method: "POST",
      body: JSON.stringify({
        planId: "premium-monthly",
        method: "afrimoney",
        senderName: "Test Member",
        senderPhone: "030676782",
        reference: "AFRI-TEST-0001",
        note: "Monthly subscription",
      }),
    });
    expect(submitted.status).toBe(201);
    expect(submitted.body.item.status).toBe("pending");
    expect(submitted.body.entitlement.status).toBe("pending_approval");

    const paymentId = submitted.body.item.id as string;

    // A member cannot self-approve.
    const selfApprove = await member(`/api/owner/payments/${paymentId}/approve`, {
      method: "POST",
      body: JSON.stringify({ reviewNote: "approve me" }),
    });
    expect(selfApprove.status).toBe(403);

    const stillPending = await member("/api/auth/me");
    expect(stillPending.body.entitlement.status).toBe("pending_approval");

    const approved = await owner(`/api/owner/payments/${paymentId}/approve`, {
      method: "POST",
      body: JSON.stringify({ reviewNote: "Afrimoney transfer verified" }),
    });
    expect(approved.status).toBe(200);
    expect(approved.body.subscription.status).toBe("active");

    const active = await member("/api/auth/me");
    expect(active.body.entitlement.status).toBe("active");
    expect(active.body.entitlement.planId).toBe("premium-monthly");
  });

  it("rejects duplicate transaction references", async () => {
    const member = await signIn("Test Member", "member@nova.test");
    const payload = {
      planId: "premium-yearly",
      method: "orange_money",
      senderName: "Test Member",
      senderPhone: "076278673",
      reference: "OM-DUPLICATE-9",
      note: "",
    };
    const first = await member("/api/billing/payments", { method: "POST", body: JSON.stringify(payload) });
    expect(first.status).toBe(201);
    const second = await member("/api/billing/payments", { method: "POST", body: JSON.stringify(payload) });
    expect(second.status).toBe(409);
  });
});

describe("custom plan quotation workflow", () => {
  it("only activates after quote, acceptance and owner activation", async () => {
    const owner = await signIn("NOVA Owner", "owner@nova.test");
    const member = await signIn("Test Member", "member@nova.test");

    const brief = "I need a team workspace with 10 seats and priority research exports.";
    const submitted = await member("/api/billing/custom-requests", {
      method: "POST",
      body: JSON.stringify({ requirements: brief, scale: "team", durationPreference: "6 months" }),
    });
    expect(submitted.status).toBe(201);

    const listed = await member("/api/billing/custom-requests");
    const request = listed.body.items.find((row: { requirements: string }) => row.requirements === brief);
    expect(request).toBeDefined();

    const quoted = await owner(`/api/owner/custom-requests/${request.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        priceLabel: "Le 450",
        durationDays: 180,
        usageLimit: "10 seats · 3000 messages",
        note: "Includes priority support",
      }),
    });
    expect(quoted.status).toBe(200);
    expect(quoted.body.item.status).toBe("quoted");

    const afterQuote = await member("/api/auth/me");
    expect(afterQuote.body.entitlement.status).not.toBe("active");

    const accepted = await member(`/api/billing/custom-requests/${request.id}/accept`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.item.status).toBe("accepted");
    expect(accepted.body.entitlement.status).toBe("pending_approval");

    const activated = await owner(`/api/owner/custom-requests/${request.id}/activate`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(activated.status).toBe(200);
    expect(activated.body.subscription.planId).toBe("custom");
    expect(activated.body.subscription.status).toBe("active");
  });
});

describe("honest AI and safe outbound requests", () => {
  it("reports a missing Gemini key instead of inventing a reply", async () => {
    const member = await signIn("Test Member", "member@nova.test");
    const reply = await member("/api/assistant/stream", {
      method: "POST",
      body: JSON.stringify({ message: "Hello NOVA" }),
    });
    expect(reply.status).toBe(200);
    expect(reply.text).toContain("provider_not_configured");
    expect(reply.text).not.toContain("delta");
  });

  it("refuses to read loopback and private network addresses", async () => {
    const member = await signIn("Test Member", "member@nova.test");
    for (const url of ["http://127.0.0.1:3000/", "http://localhost/admin", "http://169.254.169.254/"]) {
      const reply = await member("/api/browser/read", {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      expect(reply.status).toBeGreaterThanOrEqual(400);
      expect(reply.text.toLowerCase()).not.toContain("root:");
    }
  });
});
