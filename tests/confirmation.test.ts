import { describe, expect, it } from "vitest";
import { isUnequivocalConfirmation } from "@/lib/domain/confirmation";

describe("canonical booking confirmation", () => {
  it.each(["Sí", "Confirmo", "Sí, confirmo", "Sí, confirmo todos los términos.", "De acuerdo"]) (
    "accepts an unequivocal answer: %s",
    (answer) => expect(isUnequivocalConfirmation(answer)).toBe(true),
  );

  it.each([
    "Sí, pero son 9.300",
    "Sí, espera, me equivoqué",
    "Correcto, excepto el horario",
    "No confirmo",
    "Creo que sí",
  ])("blocks a qualified or contradictory answer: %s", (answer) => {
    expect(isUnequivocalConfirmation(answer)).toBe(false);
  });
});
