import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSeedSnapshot } from "@/lib/domain/seed";
import type { OperationSnapshot } from "@/lib/domain/types";
import { BaseSnapshotStore } from "./base";

export class SupabaseVoltaStore extends BaseSnapshotStore {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    super();
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  protected async readSnapshot(operationId = "op-2041") {
    const { data, error } = await this.client
      .from("volta_state")
      .select("snapshot, version")
      .eq("operation_id", operationId)
      .maybeSingle();
    if (error) throw new Error(`Supabase read failed: ${error.message}`);
    if (!data) {
      const seed = createSeedSnapshot();
      const { error: insertError } = await this.client.from("volta_state").insert({
        operation_id: seed.operation.id,
        snapshot: seed,
        version: seed.version,
      });
      if (!insertError) return seed;
      const { data: raced, error: racedError } = await this.client
        .from("volta_state")
        .select("snapshot, version")
        .eq("operation_id", operationId)
        .single();
      if (racedError) throw new Error(`Supabase initialization failed: ${racedError.message}`);
      return { ...(raced.snapshot as OperationSnapshot), version: raced.version as number };
    }
    return { ...(data.snapshot as OperationSnapshot), version: data.version as number };
  }

  protected async writeSnapshot(snapshot: OperationSnapshot, expectedVersion: number) {
    const { data, error } = await this.client
      .from("volta_state")
      .update({ snapshot, version: snapshot.version, updated_at: new Date().toISOString() })
      .eq("operation_id", snapshot.operation.id)
      .eq("version", expectedVersion)
      .select("operation_id");
    if (error) throw new Error(`Supabase write failed: ${error.message}`);
    const written = (data?.length ?? 0) === 1;
    if (written && snapshot.events.length) {
      const { error: ledgerError } = await this.client.from("volta_ledger_events").upsert(
        snapshot.events.map((event) => ({
          id: event.id,
          operation_id: event.operationId,
          call_id: event.callId,
          event_type: event.type,
          severity: event.severity,
          summary: event.summary,
          payload: event.payload,
          occurred_at: event.occurredAt,
        })),
        { onConflict: "id", ignoreDuplicates: true },
      );
      if (ledgerError) {
        console.error(JSON.stringify({ level: "error", message: "Ledger append failed", error: ledgerError.message }));
      }
    }
    return written;
  }

  protected async seedSnapshot() {
    return createSeedSnapshot();
  }
}
