import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

export interface PasswordDigest {
  hash: string;
  salt: string;
}

/**
 * scrypt with a per-user random salt. Chosen because it is available in the
 * Node standard library — no paid service and no extra dependency.
 */
export async function hashPassword(password: string): Promise<PasswordDigest> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return { hash: derived.toString("base64"), salt: salt.toString("base64") };
}

export async function verifyPassword(
  password: string,
  digest: PasswordDigest,
): Promise<boolean> {
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(digest.salt, "base64");
    expected = Buffer.from(digest.hash, "base64");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return timingSafeEqual(derived, expected);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export interface PasswordPolicyResult {
  ok: boolean;
  message?: string;
}

/** Minimum viable policy: length beats composition rules. */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== "string" || password.length < 10) {
    return { ok: false, message: "Password must be at least 10 characters long." };
  }
  if (password.length > 200) {
    return { ok: false, message: "Password must be 200 characters or fewer." };
  }
  if (/^(.)\1+$/.test(password)) {
    return { ok: false, message: "Password must not repeat a single character." };
  }
  return { ok: true };
}
