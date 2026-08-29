import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

function relaySecret(): string {
  const value = process.env.RELAY_SHARED_SECRET?.trim();
  if (!value) throw new Error("RELAY_SHARED_SECRET is not configured");
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function authorizeRelayRequest(request: Request): boolean {
  const provided = request.headers.get("authorization") ?? "";
  return secureEqual(provided, `Bearer ${relaySecret()}`);
}

export function createStreamAuthorization(callId: string): string {
  return createHmac("sha256", relaySecret()).update(callId).digest("base64url");
}
