import type { Mandate, Offer, OfferInput, Operation, OperationSnapshot } from "./types";

export interface PolicyDecision {
  eligible: boolean;
  violations: string[];
}

export function evaluateOffer(
  operation: Operation,
  mandate: Mandate,
  offer: Pick<OfferInput, "amount" | "currency" | "pickupDate" | "pickupTime" | "conditions">,
): PolicyDecision {
  const violations: string[] = [];

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

