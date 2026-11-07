import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ReadPageResult } from "../../shared/types.js";

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 4;

export class PageReadError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "PageReadError";
    this.code = code;
    this.status = status;
  }
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/**
 * Rejects loopback, link-local, private and otherwise internal addresses so the
 * page reader cannot be used as an SSRF proxy into the host network or cloud
 * metadata endpoints.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4ToNumber(address);
    if (value === null) return true;
    return BLOCKED_V4.some(([base, bits]) => {
      const baseValue = ipv4ToNumber(base);
      if (baseValue === null) return false;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) === (baseValue & mask);
    });
  }

  if (family === 6) {
    const normalised = address.toLowerCase();
    if (normalised === "::" || normalised === "::1") return true;
    // IPv4-mapped addresses must be judged on their IPv4 value.
    const mapped = normalised.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    if (normalised.startsWith("fe80")) return true;
    if (normalised.startsWith("fc") || normalised.startsWith("fd")) return true;
    if (normalised.startsWith("ff")) return true;
    return false;
  }

  return true;
}

function normaliseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PageReadError("invalid_url", "Enter a full web address, for example https://example.com.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PageReadError("invalid_url", "Only http and https addresses can be read.");
  }
  url.username = "";
  url.password = "";
  return url;
}

export async function assertPublicUrl(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) throw new PageReadError("invalid_url", "That address has no hostname.");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) {
    throw new PageReadError("blocked_address", "NOVA cannot read internal or local addresses.");
  }

  if (isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new PageReadError("blocked_address", "NOVA cannot read internal or local addresses.");
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new PageReadError("dns_failed", "That hostname could not be resolved.", 502);
  }
  if (addresses.length === 0) {
    throw new PageReadError("dns_failed", "That hostname could not be resolved.", 502);
  }
  for (const entry of addresses) {
    if (isBlockedAddress(entry.address)) {
      throw new PageReadError("blocked_address", "NOVA cannot read internal or local addresses.");
    }
  }
}

async function readLimited(response: Response): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) return { text: "", truncated: false };
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      text += decoder.decode(value, { stream: true });
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, truncated };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

export function extractReadable(html: string, baseUrl: string): {
  title: string;
  text: string;
  links: { href: string; label: string }[];
} {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const title = decodeEntities(
    (titleMatch?.[1] ?? h1Match?.[1] ?? "").replace(/\s+/g, " ").trim(),
  );

  const links: { href: string; label: string }[] = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const rawHref = match[1];
    const label = decodeEntities(match[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    if (!label) continue;
    let resolved: URL;
    try {
      resolved = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (seen.has(resolved.toString())) continue;
    seen.add(resolved.toString());
    links.push({ href: resolved.toString(), label: label.slice(0, 120) });
    if (links.length >= 40) break;
  }

  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n"),
  ).slice(0, 20000);

  return { title, text, links };
}

/**
 * Fetches a page with manual redirect handling so every hop is re-validated,
 * a byte cap, and a hard timeout.
 */
export async function readPage(rawUrl: string): Promise<ReadPageResult> {
  let current = normaliseUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          "user-agent": "NOVA-GEN-5.0 Page Reader (+https://appjet.dev)",
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PageReadError("fetch_failed", "That page could not be reached.", 502);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new PageReadError("upstream_error", "Redirect without a target.", 502);
      current = normaliseUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new PageReadError(
        "upstream_error",
        `The site responded with HTTP ${response.status}.`,
        502,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new PageReadError(
        "unsupported_content",
        `NOVA can only read text pages (received ${contentType || "an unknown type"}).`,
      );
    }

    const { text: body, truncated } = await readLimited(response);
    const extracted = extractReadable(body, current.toString());

    return {
      url: rawUrl,
      finalUrl: current.toString(),
      title: extracted.title || current.hostname,
      text: extracted.text,
      links: extracted.links,
      truncated,
    };
  }

  throw new PageReadError("too_many_redirects", "That address redirected too many times.");
}
