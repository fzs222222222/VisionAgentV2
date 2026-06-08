import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export type AuthSession = {
  userId: number;
  username: string;
  expiresAt: number;
};

const SESSION_COOKIE_NAME = "visionagent_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_KEY_LENGTH = 64;

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "visionagent-dev-secret";
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, hashedPassword: string) {
  const [salt, expected] = hashedPassword.split(":");
  if (!salt || !expected) return false;

  const actual = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createSessionCookieValue(input: { userId: number; username: string }) {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const payload = JSON.stringify({
    userId: input.userId,
    username: input.username,
    expiresAt,
  });
  const encodedPayload = toBase64Url(payload);
  const signature = createHmac("sha256", getAuthSecret()).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

export function parseSessionCookieValue(value: string | undefined | null): AuthSession | null {
  if (!value) return null;

  const [encodedPayload, signature] = value.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = createHmac("sha256", getAuthSecret()).update(encodedPayload).digest("base64url");
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length || !timingSafeEqual(expectedBuffer, signatureBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fromBase64Url(encodedPayload)) as AuthSession;
    if (
      !parsed ||
      !Number.isInteger(parsed.userId) ||
      parsed.userId < 1 ||
      typeof parsed.username !== "string" ||
      !parsed.username.trim() ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt <= Date.now()
    ) {
      return null;
    }

    return {
      userId: parsed.userId,
      username: parsed.username.trim(),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function getSessionCookieName() {
  return SESSION_COOKIE_NAME;
}

