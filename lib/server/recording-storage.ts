import "server-only";

import { createClient } from "@supabase/supabase-js";

const bucket = "volta-recordings";

function storageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase recording storage is not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function uploadRecording(path: string, body: ArrayBuffer, contentType: string) {
  const { error } = await storageClient().storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Recording upload failed: ${error.message}`);
  return `supabase://${path}`;
}

export async function downloadRecording(source: string) {
  const path = source.replace(/^supabase:\/\//, "");
  const { data, error } = await storageClient().storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Recording download failed: ${error?.message ?? "missing object"}`);
  return { bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || "audio/wav" };
}
