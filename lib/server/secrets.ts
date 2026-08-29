import "server-only";

export function getOpenAIKey(): string | null {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  return null;
}

export function requireOpenAIKey(): string {
  const key = getOpenAIKey();
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

export function publicBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").trim().replace(/\/$/, "");
}
