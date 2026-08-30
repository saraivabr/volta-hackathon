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

/**
 * Words that answer "sí o no". Back-channel — `okay`, `vale`, `listo` — is not
 * in here: people say it constantly while listening, and treating it as consent
 * once anchored audio evidence to somebody saying "Okay" eighty seconds into a
 * call nobody had confirmed.
 */
const AFFIRMATIVE = new Set([
  "si", "claro", "correcto", "correcta", "confirmo", "confirmado", "confirmada",
  "exacto", "exactamente", "deacuerdo", "afirmativo", "acepto", "aceptamos", "confirmamos",
]);

/** Words allowed around an affirmative without weakening it. */
const SUPPORTING = new Set([
  ...AFFIRMATIVE,
  "ok", "okay", "vale", "listo", "perfecto", "adelante", "sale", "orale", "sip",
  "senor", "senora", "senorita", "todo", "todos", "toda", "todas", "los", "las",
  "terminos", "termino", "condiciones", "bien", "esta", "estan", "es", "eso", "esos",
  "asi", "y", "muy", "gracias", "procedemos", "procedo", "cerrado", "trato", "hecho",
  "queda", "quedamos", "acepto", "aceptamos", "aprobado", "seguro", "claro que si",
  "que", "lo", "el", "la", "mismo", "tal", "cual",
]);

const MAX_WORDS = 10;

/**
 * A booking may only advance on an answer that is affirmative and nothing else.
 * Real dispatchers say "sí señor" and "perfecto, confirmo"; refusing those reads
 * as a broken agent, so the surrounding vocabulary is wide. What stays narrow is
 * the core: the answer has to contain an actual yes, carry no qualifier, and
 * stay short. Acknowledgement is not agreement, and a sentence long enough to
 * hold an argument is not consent.
 */
export function isUnequivocalConfirmation(value: string) {
  const normalized = normalize(value);
  if (!normalized || CONTRADICTION.test(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;
  if (!words.some((word) => AFFIRMATIVE.has(word))) return false;

  return words.every((word) => SUPPORTING.has(word));
}
