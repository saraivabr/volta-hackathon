package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"google.golang.org/protobuf/proto"
)

func (s *server) doSendMessage(sess *Session, w http.ResponseWriter, r *http.Request) {
	if sess.client.Store.ID == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "whatsapp session is not paired"})
		return
	}
	var body struct {
		Phone string `json:"phone"`
		Text  string `json:"text"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}
	body.Text = strings.TrimSpace(body.Text)
	if body.Text == "" || len(body.Text) > 2_000 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "text must contain 1 to 2000 characters"})
		return
	}
	if !s.config.phoneAllowed(body.Phone) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "phone is not in WACALLS_ALLOWED_PHONES"})
		return
	}
	to := types.NewJID(normalizePhone(body.Phone), types.DefaultUserServer)
	response, err := sess.client.SendMessage(r.Context(), to, &waE2E.Message{Conversation: proto.String(body.Text)})
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"messageId": string(response.ID), "status": "sent"})
}
