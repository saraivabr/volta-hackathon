import { describe, expect, it } from "vitest";
import { isTranscriptionContextEcho } from "@/lib/domain/transcripts";

describe("transcript hygiene", () => {
  it("rejects the old transcription context echoed during silence", () => {
    expect(
      isTranscriptionContextEcho(
        "Llamada logística en español sobre tarifas MXN, fechas, horarios, Manzanillo, Guadalajara, transportistas y confirmación de recolección.",
      ),
    ).toBe(true);
  });

  it("keeps genuine logistics speech", () => {
    expect(isTranscriptionContextEcho("Cinco mil pesos, recolección a las once.")).toBe(false);
  });
});
