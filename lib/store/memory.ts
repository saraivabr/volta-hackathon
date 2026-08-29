import { createSeedSnapshot } from "@/lib/domain/seed";
import type { OperationSnapshot } from "@/lib/domain/types";
import { BaseSnapshotStore } from "./base";

declare global {
  var __voltaSnapshot: OperationSnapshot | undefined;
}

export class MemoryVoltaStore extends BaseSnapshotStore {
  protected async readSnapshot(operationId = "op-2041") {
    globalThis.__voltaSnapshot ??= createSeedSnapshot();
    if (globalThis.__voltaSnapshot.operation.id !== operationId) throw new Error("Operation not found");
    return globalThis.__voltaSnapshot;
  }

  protected async writeSnapshot(snapshot: OperationSnapshot, expectedVersion: number) {
    if (globalThis.__voltaSnapshot && globalThis.__voltaSnapshot.version !== expectedVersion) return false;
    globalThis.__voltaSnapshot = snapshot;
    return true;
  }

  protected async seedSnapshot() {
    return createSeedSnapshot();
  }
}
