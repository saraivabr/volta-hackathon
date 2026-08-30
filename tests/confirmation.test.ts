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

describe("confirmation vocabulary", () => {
  // Phrases a dispatcher actually says. Refusing these reads as a broken agent,
  // not a careful one, and the same matcher locates the audio evidence later.
  const accepted = [
    "Sí",
    "Sí señor",
    "Sí, correcto",
    "Claro que sí",
    "Correcto, procedemos",
    "De acuerdo",
    "De acuerdo, confirmado",
    "Confirmo todos los términos",
    "Exacto",
    "Perfecto, así queda",
    "Listo",
    "Órale, sale",
    "Sí, todo bien",
    "Afirmativo",
  ];
  for (const phrase of accepted) {
    it(`accepts "${phrase}"`, () => {
      expect(isUnequivocalConfirmation(phrase)).toBe(true);
    });
  }

  // Everything that is not consent, however affirmative it sounds.
  const rejected = [
    "Sí, pero cambia el horario",
    "Sí, aunque el precio sube",
    "Casi, corrijo el monto",
    "Creo que sí",
    "Quizás",
    "Sí, espera un momento",
    "No",
    "Sí, mi jefe ya aprobó diez mil quinientos",
    "Correcto, pero antes de firmar necesito otra cosa",
    "Sí, sin embargo la fecha cambia",
    "Sí, confirmo si me suben el precio",
    "Hola",
    "",
    "   ",
    "Sí, y también quiero que sepas que el camión sale a las once y el chofer pidió más tiempo",
  ];
  for (const phrase of rejected) {
    it(`rejects ${JSON.stringify(phrase)}`, () => {
      expect(isUnequivocalConfirmation(phrase)).toBe(false);
    });
  }
});
