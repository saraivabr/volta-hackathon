package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.mau.fi/whatsmeow/types"
	"wacalls/internal/voip/core"
)

func (s *server) doStartAgentCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.client.Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "whatsapp session is not paired"})
		return
	}
	var body struct {
		Phone       string `json:"phone"`
		VoltaCallID string `json:"volta_call_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone and volta_call_id are required"})
		return
	}
	if _, err := uuid.Parse(body.VoltaCallID); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "volta_call_id must be a UUID"})
		return
	}
	if !s.config.phoneAllowed(body.Phone) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "phone is not in WACALLS_ALLOWED_PHONES"})
		return
	}
	if max := s.sessions.maxCalls; max > 0 && sess.reg.count() >= max {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "max concurrent calls"})
		return
	}

	phone := normalizePhone(body.Phone)
	peer := types.NewJID(phone, types.DefaultUserServer)
	providerCallID, err := sess.startOutgoing(r.Context(), peer, false)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	active, ok := sess.reg.get(providerCallID)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "call registry failure"})
		return
	}
	agent := NewRealtimeBridge(s.sessions.appCtx, s.config, body.VoltaCallID, providerCallID, active.cm, s.log)
	if !sess.reg.setAgent(providerCallID, body.VoltaCallID, agent) {
		_ = active.cm.EndCall(r.Context(), core.EndCallReasonUserEnded)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to attach realtime bridge"})
		return
	}
	if err := agent.Start(); err != nil {
		_ = active.cm.EndCall(r.Context(), core.EndCallReasonUserEnded)
		sess.removeCall(providerCallID)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	owner := "volta:" + body.VoltaCallID
	s.broker.upsertCall(CallRecord{
		SessionID: sess.id, CallID: providerCallID, Owner: &owner, Direction: "outbound", Peer: peer.String(),
		StartedAt: time.Now().UnixMilli(), Status: StatusRinging,
	})
	agent.report("call.ringing", "WhatsApp call started", "")
	writeJSON(w, http.StatusOK, map[string]any{"call": map[string]string{
		"provider": "whatsapp", "callId": providerCallID, "voltaCallId": body.VoltaCallID,
	}})
}
