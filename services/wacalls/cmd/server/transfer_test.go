package main

import "testing"

// The registry is what makes a WhatsApp transfer possible at all: the protocol
// has no primitive for it, so two legs are held and paired here.
func TestRegistryPairsTwoCallsAndDetachesAgents(t *testing.T) {
	reg := newCallRegistry()
	reg.add("carrier", &activeCall{agent: &RealtimeBridge{}})
	reg.add("human", &activeCall{})

	if !reg.markForBridge("human", "carrier") {
		t.Fatal("could not mark the dialled leg for bridging")
	}
	if target, ok := reg.pendingBridge("human"); !ok || target != "carrier" {
		t.Fatalf("pending bridge = %q, %v; want carrier", target, ok)
	}

	detached, ok := reg.link("human", "carrier")
	if !ok {
		t.Fatal("link failed")
	}
	if len(detached) != 1 {
		t.Fatalf("detached %d agents, want 1 — the agent must leave the line", len(detached))
	}

	carrier, _ := reg.get("carrier")
	human, _ := reg.get("human")
	if carrier.peerCallID != "human" || human.peerCallID != "carrier" {
		t.Fatalf("pairing is not symmetric: carrier=%q human=%q", carrier.peerCallID, human.peerCallID)
	}
	if carrier.agent != nil {
		t.Fatal("agent still attached to the bridged call")
	}
	if _, stillPending := reg.pendingBridge("human"); stillPending {
		t.Fatal("bridge target should be cleared once the link is made")
	}
}

func TestRegistryRefusesToLinkAMissingLeg(t *testing.T) {
	reg := newCallRegistry()
	reg.add("carrier", &activeCall{})
	if _, ok := reg.link("carrier", "nobody"); ok {
		t.Fatal("linked to a call that does not exist")
	}
}

// Whoever hangs up ends the conversation for both, so unlink has to report the
// leg left on the other end.
func TestUnlinkClearsBothSidesAndNamesThePeer(t *testing.T) {
	reg := newCallRegistry()
	reg.add("carrier", &activeCall{})
	reg.add("human", &activeCall{})
	reg.link("human", "carrier")

	peer, bridged := reg.unlink("carrier")
	if !bridged || peer != "human" {
		t.Fatalf("unlink = %q, %v; want human, true", peer, bridged)
	}
	human, _ := reg.get("human")
	if human.peerCallID != "" {
		t.Fatal("the surviving leg is still pointing at a call that ended")
	}
	if _, again := reg.unlink("carrier"); again {
		t.Fatal("unlink reported a bridge twice")
	}
}

func TestPeerOfReportsOnlyLiveBridges(t *testing.T) {
	reg := newCallRegistry()
	reg.add("solo", &activeCall{})
	if _, ok := reg.peerOf("solo"); ok {
		t.Fatal("an unbridged call reported a peer")
	}
	if _, ok := reg.peerOf("missing"); ok {
		t.Fatal("a call that does not exist reported a peer")
	}
}
