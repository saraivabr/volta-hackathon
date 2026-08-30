import { describe, expect, it } from "vitest";
import { hasDisqualifier } from "@/lib/domain/confirmation";

/**
 * The veto runs before the classifier, so anything it rejects never gets a
 * second opinion. These are the phrasings a real operator tried on a live call
 * and could not get through with — they must reach the classifier.
 */
describe("the veto lets real confirmations through", () => {
  const mustReachClassifier = [
    "eu confirmo o recap",
    "eu confirmo o evento",
    "sim senhor",
    "sim, senhor, é assim, eu confirmo",
    "confirmo",
    "isso, pode confirmar",
    "sí, confirmo",
    "sí señor, confirmo todo",
    "yes, I confirm",
    "yes sir, that is confirmed",
    "confirmo o recap e pode fechar",
  ];
  for (const phrase of mustReachClassifier) {
    it(`does not veto "${phrase}"`, () => {
      expect(hasDisqualifier(phrase)).toBe(false);
    });
  }

  const mustBeVetoed = [
    "sim, meu chefe já aprovou dez mil",
    "confirmo se subirem o preço",
    "yes, my manager approved a higher rate",
    "sí, mi jefe ya aprobó el precio",
    "confirmo, mas muda o horário",
    "confirmo depois de falar com o motorista",
  ];
  for (const phrase of mustBeVetoed) {
    it(`vetoes "${phrase}"`, () => {
      expect(hasDisqualifier(phrase)).toBe(true);
    });
  }
});
