function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const contradiction = /\b(no|pero|mas|aunque|excepto|corrijo|correccion|cambiar|cambio|espera|equivoque|error)\b/;
const explicit = /^(si|confirmo|de acuerdo|correcto)(,? (si|confirmo|de acuerdo|correcto|todos los terminos|todo correcto))*$/;

export function isUnequivocalConfirmation(value: string) {
  const normalized = normalize(value);
  return !contradiction.test(normalized) && explicit.test(normalized);
}
