import { openAIClient } from "@/lib/providers/openai-realtime";
import { hasDisqualifier, isUnequivocalConfirmation } from "@/lib/domain/confirmation";

export type ConfirmationVerdict = "CONFIRMS" | "REFUSES" | "CONDITIONAL" | "AMBIGUOUS";

export interface ConfirmationJudgement {
  verdict: ConfirmationVerdict;
  reason: string;
  /** How the verdict was reached, so the ledger can say so. */
  source: "CLASSIFIER" | "RULES" | "RULES_VETO";
}

const SYSTEM = `You decide one thing: did the person on the phone agree to the exact terms that were just read to them?

You are given the recap that was read aloud and the person's reply. The reply may be in Spanish, Portuguese or English, may be transcribed imperfectly, and may be phrased in any natural way. Judge the intent, not the wording.

Answer with one verdict:
- CONFIRMS: they agreed to those terms as read, adding no condition and changing nothing.
- CONDITIONAL: they agreed only if something changes (a different rate, date, time), or made their agreement depend on anything.
- REFUSES: they declined, disagreed, or want to change a term.
- AMBIGUOUS: they acknowledged without agreeing ("ok", "right", "mhm"), asked a question, deferred to someone else, said they would call back, or the reply is too garbled to tell.

Rules that override your judgement:
- Someone invoking another person's authority ("my manager approved a higher rate") is never CONFIRMS. That is AMBIGUOUS.
- A back-channel or filler alone is never CONFIRMS.
- If you are unsure, answer AMBIGUOUS. A wrong CONFIRMS creates a real commercial obligation.

Reply as JSON: {"verdict": "...", "reason": "<8 words or fewer>"}`;

/**
 * A word list could not do this job. It refused "sim, confirmo" for holding a
 * word it had never been taught, and no amount of adding words fixes the shape
 * of the problem — real people confirm in sentences nobody wrote down first.
 *
 * So a classifier reads the reply against the terms actually read aloud, and
 * the deterministic rules stay on top of it as a veto: whatever the classifier
 * says, an answer that borrows someone else's authority or attaches a
 * condition does not close a booking. The model in the conversation still
 * cannot certify its own success — this runs server-side, separately, and
 * writes its reason to the ledger.
 */
export async function judgeConfirmation(
  recapText: string,
  utterance: string,
): Promise<ConfirmationJudgement> {
  const spoken = utterance.trim();
  if (!spoken) return { verdict: "AMBIGUOUS", reason: "empty reply", source: "RULES" };

  // The hard guards run first and are never overridden by the classifier.
  if (hasDisqualifier(spoken)) {
    return { verdict: "AMBIGUOUS", reason: "borrowed authority or condition", source: "RULES_VETO" };
  }

  const client = openAIClient();
  if (!client) {
    return isUnequivocalConfirmation(spoken)
      ? { verdict: "CONFIRMS", reason: "explicit agreement", source: "RULES" }
      : { verdict: "AMBIGUOUS", reason: "no classifier available", source: "RULES" };
  }

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_JUDGE_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0,
      max_tokens: 60,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `TERMS READ ALOUD:\n${recapText}\n\nTHEIR REPLY:\n${spoken}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { verdict?: string; reason?: string };
    const verdict = (["CONFIRMS", "REFUSES", "CONDITIONAL", "AMBIGUOUS"] as const).find(
      (value) => value === parsed.verdict,
    );
    if (!verdict) {
      return { verdict: "AMBIGUOUS", reason: "unreadable verdict", source: "RULES" };
    }
    return { verdict, reason: (parsed.reason ?? "").slice(0, 80), source: "CLASSIFIER" };
  } catch {
    // Never fail open: an unreachable classifier falls back to the strict rules.
    return isUnequivocalConfirmation(spoken)
      ? { verdict: "CONFIRMS", reason: "explicit agreement", source: "RULES" }
      : { verdict: "AMBIGUOUS", reason: "classifier unavailable", source: "RULES" };
  }
}
