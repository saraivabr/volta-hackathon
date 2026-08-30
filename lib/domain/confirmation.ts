function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,!?¿¡]+/g, " ")
    .replace(/\bde acuerdo\b/g, "deacuerdo")
    .replace(/\bsin embargo\b/g, "sinembargo")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anything that walks back, qualifies or reopens the terms. Checked first: one
 * of these anywhere in the answer disqualifies it however affirmative the rest
 * sounds.
 */
const CONTRADICTION =
  /\b(no|nao|pero|mas|aunque|excepto|salvo|corrijo|correccion|cambiar|cambio|cambia|espera|esperen|equivoque|error|casi|quiza|quizas|tal vez|creo|deberia|sinembargo|antes de|primero|si pero)\b/;

/** Words that can open an unqualified yes. */
const OPENERS = new Set([
  "si", "sip", "claro", "correcto", "correcta", "confirmo", "confirmado", "confirmada",
  "exacto", "exactamente", "perfecto", "deacuerdo", "afirmativo", "adelante", "listo",
  "ok", "okay", "vale", "sale", "orale",
]);

/** Words allowed to trail a yes without weakening it. */
const SUPPORTING = new Set([
  ...OPENERS,
  "senor", "senora", "senorita", "todo", "todos", "toda", "todas", "los", "las",
  "terminos", "termino", "condiciones", "bien", "esta", "estan", "es", "eso", "esos",
  "asi", "y", "muy", "gracias", "procedemos", "procedo", "cerrado", "trato", "hecho",
  "queda", "quedamos", "acepto", "aceptamos", "aprobado", "seguro", "claro que si",
  "que", "lo", "el", "la", "mismo", "tal", "cual",
]);

const MAX_WORDS = 10;

/**
 * A booking may only advance on an answer that is affirmative and nothing else.
 * Real dispatchers say "sí señor" and "correcto, procedemos"; refusing those
 * reads as a broken agent, so the vocabulary is wide. What stays narrow is the
 * shape: it must open on a yes, carry no qualifier, and stay short. Anything
 * longer is a sentence with an argument in it, and an argument is not consent.
 */
export function isUnequivocalConfirmation(value: string) {
  const normalized = normalize(value);
  if (!normalized || CONTRADICTION.test(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  if (!OPENERS.has(words[0])) return false;

  return words.every((word) => SUPPORTING.has(word));
}
