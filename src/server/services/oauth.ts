import { randomToken } from "../auth/passwords.js";
import { env } from "../env.js";
import type { AuthProviderStatus, OAuthProvider } from "../../shared/types.js";

/**
 * Real OAuth 2.0 authorisation-code flow for Google and Facebook.
 *
 * NOVA ships with the flow fully implemented but no credentials, so the UI can
 * only offer a provider once the owner configures it. Until then the buttons
 * report "not configured" — there is no simulated social login anywhere.
 */

interface ProviderConfig {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string | null;
  clientSecret: string | null;
  fetchIdentity: (accessToken: string) => Promise<{
    providerUserId: string;
    email: string | null;
    name: string;
  }>;
}

export class OAuthError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

async function readJson(response: Response, action: string): Promise<unknown> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const detail = (payload as { error_description?: string; error?: { message?: string } }) ?? {};
    const message =
      detail.error_description ??
      (typeof detail.error === "object" ? detail.error?.message : undefined) ??
      `HTTP ${response.status}`;
    throw new OAuthError("oauth_exchange_failed", `${action} failed: ${message}`);
  }
  return payload;
}

const PROVIDERS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    clientId: env.oauth.google.clientId,
    clientSecret: env.oauth.google.clientSecret,
    async fetchIdentity(accessToken) {
      const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      const payload = (await readJson(response, "Google profile lookup")) as {
        sub?: string;
        email?: string;
        name?: string;
        given_name?: string;
      };
      if (!payload.sub) throw new OAuthError("oauth_no_identity", "Google returned no account id.");
      return {
        providerUserId: payload.sub,
        email: payload.email ? payload.email.toLowerCase() : null,
        name: payload.name || payload.given_name || "Google user",
      };
    },
  },
  facebook: {
    label: "Facebook",
    authorizeUrl: "https://www.facebook.com/v19.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v19.0/oauth/access_token",
    scope: "email public_profile",
    clientId: env.oauth.facebook.clientId,
    clientSecret: env.oauth.facebook.clientSecret,
    async fetchIdentity(accessToken) {
      const url = new URL("https://graph.facebook.com/v19.0/me");
      url.searchParams.set("fields", "id,name,email");
      url.searchParams.set("access_token", accessToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const payload = (await readJson(response, "Facebook profile lookup")) as {
        id?: string;
        email?: string;
        name?: string;
      };
      if (!payload.id) throw new OAuthError("oauth_no_identity", "Facebook returned no account id.");
      return {
        providerUserId: payload.id,
        email: payload.email ? payload.email.toLowerCase() : null,
        name: payload.name || "Facebook user",
      };
    },
  },
};

export function isOAuthProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "facebook";
}

export function providerConfigured(provider: OAuthProvider): boolean {
  const config = PROVIDERS[provider];
  return Boolean(config.clientId && config.clientSecret);
}

export function listAuthProviders(): AuthProviderStatus[] {
  return (Object.keys(PROVIDERS) as OAuthProvider[]).map((provider) => {
    const config = PROVIDERS[provider];
    const configured = Boolean(config.clientId && config.clientSecret);
    return {
      provider,
      label: config.label,
      configured,
      reason: configured
        ? null
        : `${config.label} sign-in is not configured on this NOVA server. An owner must set ` +
          `${provider === "google" ? "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET" : "FACEBOOK_APP_ID and FACEBOOK_APP_SECRET"}.`,
    };
  });
}

/** Short-lived, single-use CSRF state for the authorisation redirect. */
const pendingStates = new Map<string, { provider: OAuthProvider; expiresAt: number }>();

export function createOAuthState(provider: OAuthProvider): string {
  const state = randomToken(24);
  pendingStates.set(state, { provider, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

export function consumeOAuthState(state: string, provider: OAuthProvider): boolean {
  const entry = pendingStates.get(state);
  if (!entry) return false;
  pendingStates.delete(state);
  if (entry.provider !== provider) return false;
  return entry.expiresAt > Date.now();
}

export function buildAuthorizeUrl(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  const config = PROVIDERS[provider];
  if (!config.clientId) {
    throw new OAuthError("provider_not_configured", `${config.label} sign-in is not configured.`, 503);
  }
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", config.scope);
  url.searchParams.set("state", state);
  if (provider === "google") {
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}

export async function exchangeCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ providerUserId: string; email: string | null; name: string }> {
  const config = PROVIDERS[provider];
  if (!config.clientId || !config.clientSecret) {
    throw new OAuthError("provider_not_configured", `${config.label} sign-in is not configured.`, 503);
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    signal: AbortSignal.timeout(8000),
  });

  const tokenPayload = (await readJson(tokenResponse, `${config.label} token exchange`)) as {
    access_token?: string;
  };
  if (!tokenPayload.access_token) {
    throw new OAuthError("oauth_no_token", `${config.label} returned no access token.`);
  }

  return config.fetchIdentity(tokenPayload.access_token);
}

export function oauthRedirectUri(baseUrl: string, provider: OAuthProvider): string {
  return `${baseUrl}/api/auth/oauth/${provider}/callback`;
}
