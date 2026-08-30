import type { Mandate, Offer, OfferInput, Operation, OperationSnapshot } from "./types";

export interface PolicyDecision {
  eligible: boolean;
  violations: string[];
}

/**
 * How many counter-offers the operator authorised. The opening quote is not a
 * counter, so a budget of two allows revisions 1, 2 and 3. Withholding
 * `negotiateRate` withholds haggling entirely: take the first price or leave it.
 */
export function counterBudget(mandate: Mandate): number {
  return mandate.negotiateRate ? mandate.maximumCounters : 0;
}

export function evaluateOffer(
  operation: Operation,
  mandate: Mandate,
  offer: Pick<OfferInput, "amount" | "currency" | "pickupDate" | "pickupTime" | "conditions">,
  revision = 1,
): PolicyDecision {
  const violations: string[] = [];

  if (revision - 1 > counterBudget(mandate)) {
    violations.push(mandate.negotiateRate ? "counter_limit_exhausted" : "rate_negotiation_not_authorized");
  }

  if (offer.currency !== mandate.currency) violations.push("currency_mismatch");
  if (offer.amount > mandate.maximumRate) violations.push("rate_above_mandate");
  if (offer.pickupDate !== operation.pickupDate) violations.push("pickup_day_outside_mandate");
  if (
    offer.pickupTime < operation.pickupWindowStart ||
    offer.pickupTime > operation.pickupWindowEnd
  ) {
    violations.push("pickup_time_outside_window");
  }
  if (!mandate.acceptAccessorials && (offer.conditions?.length ?? 0) > 0) {
    violations.push("unsupported_accessorial");
  }

  return { eligible: violations.length === 0, violations };
}

export function latestOffers(offers: Offer[]): Offer[] {
  const current = new Map<string, Offer>();
  for (const offer of offers.filter((item) => !item.supersededAt)) {
    const previous = current.get(offer.carrierId);
    if (!previous || offer.revision > previous.revision) current.set(offer.carrierId, offer);
  }
  return [...current.values()];
}

export function rankOffers(snapshot: Pick<OperationSnapshot, "offers" | "carriers">): Offer[] {
  const carrierNames = new Map(snapshot.carriers.map((carrier) => [carrier.id, carrier.name]));
  return latestOffers(snapshot.offers)
    .filter((offer) => offer.eligible)
    .sort((left, right) => {
      if (left.amount !== right.amount) return left.amount - right.amount;
      if (left.pickupTime !== right.pickupTime) return left.pickupTime.localeCompare(right.pickupTime);
      return (carrierNames.get(left.carrierId) ?? "").localeCompare(
        carrierNames.get(right.carrierId) ?? "",
      );
    });
}

export function winner(snapshot: Pick<OperationSnapshot, "offers" | "carriers">): Offer | null {
  return rankOffers(snapshot)[0] ?? null;
}

export function assertOfferBookable(snapshot: OperationSnapshot, offerId: string): Offer {
  const selected = snapshot.offers.find((offer) => offer.id === offerId);
  if (!selected) throw new Error("Offer not found");
  if (selected.supersededAt) throw new Error("Superseded offer cannot be booked");

  const expected = winner(snapshot);
  if (!expected || expected.id !== selected.id) throw new Error("Offer is not the current winner");
  if (!selected.eligible) throw new Error("Offer violates the human mandate");
  return selected;
}

/**
 * Whether a quote call may close the deal instead of hanging up and calling
 * back. Two calls per carrier is the safe sequence when the market is still
 * unknown, but it stops being safe and starts being slow once either condition
 * holds: the offer met the rate the operator said to take, or everyone else has
 * already answered and this is what the market produced.
 */
export function mayCloseOnQuote(
  snapshot: Pick<OperationSnapshot, "offers" | "carriers" | "calls" | "mandate">,
  offerId: string,
): { allowed: boolean; reason: string } {
  const offer = snapshot.offers.find((item) => item.id === offerId);
  if (!offer) return { allowed: false, reason: "offer_not_found" };
  if (!offer.eligible) return { allowed: false, reason: "offer_outside_mandate" };

  const standing = winner(snapshot);
  if (!standing || standing.id !== offer.id) return { allowed: false, reason: "not_the_standing_winner" };

  if (offer.amount <= snapshot.mandate.targetRate) {
    return { allowed: true, reason: "met_target_rate" };
  }

  const others = snapshot.carriers.filter((carrier) => carrier.id !== offer.carrierId);
  const settled = others.every((carrier) =>
    snapshot.calls.some(
      (call) =>
        call.carrierId === carrier.id &&
        call.mode === "QUOTE" &&
        ["COMPLETED", "FAILED"].includes(call.status),
    ),
  );
  return settled
    ? { allowed: true, reason: "market_settled" }
    : { allowed: false, reason: "market_still_open" };
}
