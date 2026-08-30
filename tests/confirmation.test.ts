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
    "Sí, todo bien",
    "Perfecto, confirmo",
    "Ok, confirmo",
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
    // Back-channel. People say these while listening, not to agree to terms.
    // Treating one as consent once anchored evidence to " Okay." eighty seconds
    // into a call whose commitment was still PROPOSED.
    "Okay",
    " Okay.",
    "Ok",
    "Vale",
    "Listo",
    "Perfecto",
    "Órale, sale",
    "Adelante",
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

/**
 * The agent speaks Spanish by mandate and follows the counterparty into
 * Portuguese when they answer in it, which is what the real transcripts show.
 * A matcher that only knows one of those languages refuses half the deals.
 */
describe("bilingual confirmation", () => {
  const accepted = [
    "Sim, confirmo",
    "Sim senhor",
    "Isso, confirmado",
    "Correto, pode registrar",
    "Confirmo, pode fechar",
    "Sim, está tudo certo",
    "Perfeito, confirmo",
    "Fechado",
    "Combinado, pode agendar",
    "Aceito os termos",
    "Sí, confirmo todos los términos",
    "Correcto, procedemos con eso",
    "De acuerdo, confirmado",
    "Exacto, así queda registrado",
    "Trato hecho",
  ];
  for (const phrase of accepted) {
    it(`accepts "${phrase}"`, () => {
      expect(isUnequivocalConfirmation(phrase)).toBe(true);
    });
  }

  const rejected = [
    // Borrowed authority: the likeliest thing said to move a booking.
    "Sim, meu chefe já aprovou dez mil e quinhentos",
    "Confirmo, o gerente autorizou o valor maior",
    "Sí, mi jefe ya aprobó el precio",
    // Conditions attached to the yes.
    "Confirmo se subirem o preço",
    "Sim, confirmo caso mudem o horário",
    "Correcto, si me suben la tarifa",
    // Walk-backs and hedges.
    "Sim, mas muda o horário",
    "Confirmo, porém preciso ajustar a data",
    "Acho que sim",
    "Talvez",
    "Quase, corrijo o valor",
    "Sim, espera um momento",
    // Deferrals.
    "Confirmo depois de falar com o motorista",
    "Sim, primeiro preciso checar",
    // Acknowledgement, not agreement.
    "Beleza",
    "Ok",
    "Perfeito",
    "Certo, vou verificar e te falo",
  ];
  for (const phrase of rejected) {
    it(`rejects "${phrase}"`, () => {
      expect(isUnequivocalConfirmation(phrase)).toBe(false);
    });
  }
});
