import "server-only";
import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "volta_session";

/**
 * A judge has to be able to watch this run without being able to steer it. The
 * viewer code is the one published in the readme — it opens every panel, the
 * ledger and the recordings, and it cannot dial a phone, rewrite the mandate or
 * reset an operation mid-demo. The operator code stays with the team.
 */
export type Role = "operator" | "viewer";

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

export function verifyAccessCode(code: string): Role | null {
  const operator =
    process.env.DEMO_ACCESS_CODE ?? (process.env.NODE_ENV === "production" ? "" : "volta");
  const viewer = process.env.DEMO_VIEWER_CODE ?? "";
  // Both are compared, always, so a wrong code takes the same time either way.
  const isOperator = operator.length > 0 && constantTimeEqual(code, operator);
  const isViewer = viewer.length > 0 && constantTimeEqual(code, viewer);
  if (isOperator) return "operator";
  return isViewer ? "viewer" : null;
}

export async function issueSession(role: Role): Promise<string> {
  return new SignJWT({ role, scope: "op-2041" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(`volta-demo-${role}`)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

/** The role this request carries, or null when it carries no valid session. */
export async function sessionRole(token?: string | null): Promise<Role | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.scope !== "op-2041") return null;
    return payload.role === "operator" || payload.role === "viewer" ? payload.role : null;
  } catch {
    return null;
  }
}

export async function verifySession(token?: string | null): Promise<boolean> {
  return (await sessionRole(token)) !== null;
}

export async function currentRole(): Promise<Role | null> {
  const jar = await cookies();
  return sessionRole(jar.get(SESSION_COOKIE)?.value);
}

/** Any valid session. Use for reads: a judge must see everything. */
export async function requireSession(): Promise<Role> {
  const role = await currentRole();
  if (!role) throw new Error("UNAUTHORIZED");
  return role;
}

/** Use for anything that dials, spends, rewrites the mandate or resets state. */
export async function requireOperator(): Promise<void> {
  if ((await currentRole()) !== "operator") throw new Error("UNAUTHORIZED");
}
