import "server-only";

declare global {
  var __voltaRateLimits: Map<string, number[]> | undefined;
}

const buckets = (globalThis.__voltaRateLimits ??= new Map<string, number[]>());

export function allowRequest(key: string, limit = 5, windowMs = 60_000): boolean {
  const current = Date.now();
  const recent = (buckets.get(key) ?? []).filter((timestamp) => current - timestamp < windowMs);
  if (recent.length >= limit) return false;
  recent.push(current);
  buckets.set(key, recent);
  return true;
}

