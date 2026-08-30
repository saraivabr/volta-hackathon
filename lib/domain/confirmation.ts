function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.,!?¿¡;:]+/g, " ")
    .replace(/\bde acuerdo\b/g, "deacuerdo")
    .replace(/\bsin embargo\b/g, "sinembargo")
    .replace(/\btrato hecho\b/g, "tratohecho")
    .replace(/\bthat is right\b|\bthats right\b|\bthat's right\b/g, "correct")
    .replace(/\bgo ahead\b/g, "goahead")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Anything that walks back, qualifies, defers or borrows authority. Checked
 * first: one of these anywhere disqualifies the answer however affirmative the
 * rest sounds. The authority claims are here because "my manager already
 * approved it" is the single likeliest thing said to move a booking, and it is
 * not consent to the terms that were read.
 */
const CONTRADICTION = new RegExp(
  [
    "\\b(no|nao|pero|mas|porem|contudo|todavia|aunque|embora|excepto|exceto|salvo)\\b",
    "\\b(corrijo|correccion|correcao|cambiar|cambio|cambia|mudar|muda|trocar|alterar|ajustar)\\b",
    "\\b(espera|esperen|espere|aguarda|aguarde|equivoque|errei|error|erro)\\b",
    "\\b(casi|quase|quiza|quizas|talvez|acho|creo|penso|deberia|deveria|sinembargo)\\b",
    "\\b(antes de|primeiro|primero|depois|despues|mais tarde|luego)\\b",
    "\\b(jefe|chefe|patron|patrao|gerente|supervisor|director|diretor|dueno|dono|boss|manager)\\b",
    "\\b(aprobo|aprovou|autorizo|autorizou|libero|liberou|permitiu|permitio|approved|authorized|authorised)\\b",
    "\\b(not|dont|doesnt|cant|wont|but|however|except|unless|actually|instead)\\b",
    "\\b(change|changed|correction|wait|hold|maybe|almost|think|guess|should|would|need to|have to)\\b",
    "\\b(first|later|after|before|check|verify|call you back|get back)\\b",
  ].join("|"),
);

/** Conditionals only read as "if" when something follows them mid-answer. */
const CONDITIONAL = new Set(["si", "se", "caso", "cuando", "quando", "desde", "if", "when", "once"]);

/**
 * Saying one of these is confirming, whatever else surrounds it. A dispatcher
 * who says "confirmo, pode fechar" has confirmed; refusing them because
 * "fechar" was not on a list is how a working agent looks broken.
 */
const CONFIRMS = new RegExp(
  "\\b(confirmo|confirmado|confirmada|confirmamos|confirma|deacuerdo|correcto|correcta|correto|" +
    "correta|exacto|exactamente|exato|acepto|aceptamos|aceito|aceitamos|fechado|fechamos|combinado|" +
    "tratohecho|afirmativo|confirmed|confirm|correct|agreed|agree|accepted|goahead)\\b",
);

/** A bare yes, in either language the agent actually speaks. */
const BARE_YES = new Set(["si", "sim", "claro", "isso", "exato", "certo", "positivo", "yes", "yeah", "yep", "sure"]);

/** Words that may surround a bare yes without turning it into a sentence. */
const SUPPORTING = new Set([
  ...BARE_YES,
  "senor", "senora", "senorita", "senhor", "senhora", "sr", "sra",
  "todo", "todos", "toda", "todas", "tudo", "los", "las", "os", "as",
  "terminos", "termino", "termos", "condiciones", "condicoes",
  "bien", "bem", "esta", "estan", "e", "es", "eso", "esos", "isso", "asi", "assim",
  "y", "e", "muy", "muito", "gracias", "obrigado", "obrigada",
  "ok", "okay", "vale", "listo", "perfecto", "perfeito", "adelante", "beleza",
  "que", "lo", "el", "la", "o", "a", "mismo", "certinho",
  "all", "the", "terms", "that", "is", "it", "sir", "maam", "madam",
  "thanks", "thank", "you", "good", "great", "fine", "right",
]);

const MAX_WORDS = 12;

/**
 * A booking may only advance on an answer that agrees to the terms just read
 * and adds no condition to them. Three languages, because the counterparty
 * picks: the lane is Mexican, the carriers answering it are often Brazilian,
 * and a judge may well test in English.
 *
 * Two ways to qualify. Saying an explicit confirming word counts however the
 * sentence is built, because that is how people actually answer — the earlier
 * rule demanded every word come from a fixed list, which refused "sim,
 * confirmo" outright since the list held no Portuguese at all. A bare yes
 * counts too, but only while it stays a bare yes.
 *
 * What disqualifies either is the same: a walk-back, a hedge, a deferral, a
 * borrowed authority, or a conditional with something hanging off it.
 */
/**
 * The part of the judgement that no classifier may overrule: a walk-back, a
 * hedge, a deferral, a borrowed authority, or a conditional with something
 * hanging off it. These disqualify an answer however agreeable it sounds.
 */
export function hasDisqualifier(value: string) {
  const normalized = normalize(value);
  if (!normalized) return true;
  if (CONTRADICTION.test(normalized)) return true;
  const words = normalized.split(" ").filter(Boolean);
  for (let i = 1; i < words.length - 1; i += 1) {
    if (CONDITIONAL.has(words[i])) return true;
  }
  return false;
}

export function isUnequivocalConfirmation(value: string) {
  const normalized = normalize(value);
  if (!normalized || CONTRADICTION.test(normalized)) return false;

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_WORDS) return false;

  // "confirmo se subirem o preço" is a negotiation, not a yes.
  for (let i = 1; i < words.length - 1; i += 1) {
    if (CONDITIONAL.has(words[i])) return false;
  }

  if (CONFIRMS.test(normalized)) return true;
  return BARE_YES.has(words[0]) && words.every((word) => SUPPORTING.has(word));
}
