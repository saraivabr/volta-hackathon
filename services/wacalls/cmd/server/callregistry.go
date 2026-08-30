package main

import (
	"sync"

	"wacalls/internal/voip/call"
)

type activeCall struct {
	cm          *call.CallManager
	bridge      *Bridge
	agent       *RealtimeBridge
	voltaCallID string
	// peerCallID is the other leg of a live handoff. While it is set this call's
	// audio goes to that call instead of to the agent, in both directions.
	peerCallID string
	// bridgeTarget is the leg this call should be joined to once it is answered.
	bridgeTarget string
}

type callRegistry struct {
	mu    sync.Mutex
	calls map[string]*activeCall
}

func newCallRegistry() *callRegistry {
	return &callRegistry{calls: map[string]*activeCall{}}
}

func (r *callRegistry) add(callID string, ac *activeCall) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[callID] = ac
}

func (r *callRegistry) get(callID string) (*activeCall, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	return ac, ok
}

func (r *callRegistry) remove(callID string) (*activeCall, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok {
		return nil, false
	}
	delete(r.calls, callID)
	return ac, true
}

func (r *callRegistry) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.calls)
}

func (r *callRegistry) setBridge(callID string, b *Bridge) (*Bridge, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok {
		return nil, false
	}
	oldB := ac.bridge
	ac.bridge = b
	return oldB, true
}

func (r *callRegistry) setAgent(callID, voltaCallID string, agent *RealtimeBridge) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok {
		return false
	}
	ac.agent = agent
	ac.voltaCallID = voltaCallID
	return true
}

func (r *callRegistry) handoffToBridge(callID string, bridge *Bridge) (*Bridge, *RealtimeBridge, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok {
		return nil, nil, false
	}
	oldBridge := ac.bridge
	oldAgent := ac.agent
	ac.bridge = bridge
	ac.agent = nil
	return oldBridge, oldAgent, true
}

func (r *callRegistry) drain() []*activeCall {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*activeCall, 0, len(r.calls))
	for _, ac := range r.calls {
		out = append(out, ac)
	}
	r.calls = map[string]*activeCall{}
	return out
}

// markForBridge records that a freshly dialled leg should be joined to another
// one as soon as the person answers.
func (r *callRegistry) markForBridge(callID, targetCallID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok {
		return false
	}
	ac.bridgeTarget = targetCallID
	return true
}

func (r *callRegistry) pendingBridge(callID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok || ac.bridgeTarget == "" {
		return "", false
	}
	return ac.bridgeTarget, true
}

// link joins two live calls and detaches the agent from both. The agents are
// returned so the caller can close them outside the lock: the human is taking
// the conversation, and two voices on one line is worse than none.
func (r *callRegistry) link(aID, bID string) ([]*RealtimeBridge, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	a, okA := r.calls[aID]
	b, okB := r.calls[bID]
	if !okA || !okB {
		return nil, false
	}
	detached := []*RealtimeBridge{}
	for _, ac := range []*activeCall{a, b} {
		if ac.agent != nil {
			detached = append(detached, ac.agent)
			ac.agent = nil
		}
	}
	a.peerCallID, b.peerCallID = bID, aID
	a.bridgeTarget, b.bridgeTarget = "", ""
	return detached, true
}

// unlink clears the pairing from whichever side survives, and reports the leg
// that was still on the other end so it can be ended too.
func (r *callRegistry) unlink(callID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok || ac.peerCallID == "" {
		return "", false
	}
	peerID := ac.peerCallID
	ac.peerCallID = ""
	if peer, ok := r.calls[peerID]; ok {
		peer.peerCallID = ""
	}
	return peerID, true
}

func (r *callRegistry) peerOf(callID string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ac, ok := r.calls[callID]
	if !ok || ac.peerCallID == "" {
		return "", false
	}
	return ac.peerCallID, true
}
