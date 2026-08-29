import "server-only";
import { createClient } from "@supabase/supabase-js";

declare global {
  var __voltaWebhookReceipts: Set<string> | undefined;
}

const memoryReceipts = (globalThis.__voltaWebhookReceipts ??= new Set<string>());

export async function registerWebhookReceipt(provider: string, eventId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client
      .from("volta_webhook_receipts")
      .insert({ provider, provider_event_id: eventId });
    if (!error) return true;
    if (error.code === "23505") return false;
    throw new Error(`Webhook receipt failed: ${error.message}`);
  }
  const keyValue = `${provider}:${eventId}`;
  if (memoryReceipts.has(keyValue)) return false;
  memoryReceipts.add(keyValue);
  return true;
}

