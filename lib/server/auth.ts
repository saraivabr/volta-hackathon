import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "volta_session";

function secret(): Uint8Array {
  const value =
    process.env.SESSION_SECRET ??
    (process.env.NODE_ENV === "production" ? "" : "volta-local-session-secret-32-chars");
  if (value.length < 32) throw new Error("SESSION_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyAccessCode(code: string): boolean {
  const expected = process.env.DEMO_ACCESS_CODE ?? (process.env.NODE_ENV === "production" ? "" : "volta");
  return expected.length > 0 && constantTimeEqual(code, expected);
}

export async function issueSession(): Promise<string> {
  return new SignJWT({ role: "operator", scope: "op-2041" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("volta-demo-operator")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function verifySession(token?: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload.role === "operator" && payload.scope === "op-2041";
  } catch {
    return false;
  }
}

export async function requireOperator(): Promise<void> {
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) throw new Error("UNAUTHORIZED");
}

