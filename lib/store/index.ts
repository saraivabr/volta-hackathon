import type { VoltaStore } from "./types";
import { MemoryVoltaStore } from "./memory";
import { SupabaseVoltaStore } from "./supabase";

declare global {
  var __voltaStore: VoltaStore | undefined;
}

export function getStore(): VoltaStore {
  if (globalThis.__voltaStore) return globalThis.__voltaStore;

  const forceDemo = process.env.VOLTA_DEMO_MODE === "true";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.__voltaStore =
    !forceDemo && url && serviceRoleKey
      ? new SupabaseVoltaStore(url, serviceRoleKey)
      : new MemoryVoltaStore();
  return globalThis.__voltaStore;
}

export type { VoltaStore } from "./types";

