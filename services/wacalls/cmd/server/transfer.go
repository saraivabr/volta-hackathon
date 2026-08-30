package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.mau.fi/whatsmeow/types"
)

// doTransferCall dials a third party and joins them to a call already in
// progress. WhatsApp has no transfer primitive, so the relay keeps both legs
// and crosses their audio; the original party never leaves the line, and the
// agent steps off it the moment the human answers.
func (s *server) doTransferCall(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.client.Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "whatsapp session is not paired"})
		return
	}
	callID := r.PathValue("id")
	var body struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Phone) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "phone is required"})
		return
	}
	if _, ok := sess.reg.get(callID); !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "call is not active"})
		return
	}
	if peerID, already := sess.reg.peerOf(callID); already {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "call is already bridged to " + peerID})
		return
	}

	peer := types.NewJID(normalizePhone(body.Phone), types.DefaultUserServer)
	dialedID, err := sess.transferCall(r.Context(), callID, peer)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"transfer": map[string]string{
			"callId":   callID,
			"dialedId": dialedID,
			"to":       peer.String(),
			"state":    "dialing",
		},
	})
}
