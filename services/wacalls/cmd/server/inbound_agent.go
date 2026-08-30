package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"wacalls/internal/voip/call"
	"wacalls/internal/voip/core"
)

func (s *Session) registerInboundCall(providerCallID, peer string) (string, error) {
	payload, _ := json.Marshal(map[string]string{"providerCallId": providerCallID, "peer": peer})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.mgr.config.voltaBaseURL+"/api/whatsapp/inbound", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	request.Header.Set("Authorization", "Bearer "+s.mgr.config.relaySecret)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Volta inbound registration returned %d", response.StatusCode)
	}
	var result struct {
		Data struct {
			CallID string `json:"callId"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil || result.Data.CallID == "" {
		return "", fmt.Errorf("invalid Volta inbound registration response")
	}
	return result.Data.CallID, nil
}

func (s *Session) activateInboundAgent(providerCallID, peer string, cm *call.CallManager) {
	voltaCallID, err := s.registerInboundCall(providerCallID, peer)
	if err != nil {
		s.log.Error("inbound call registration failed", "call_id", providerCallID, "err", err)
		_ = cm.RejectCall(context.Background(), providerCallID, core.EndCallReasonDeclined)
		return
	}
	agent := NewRealtimeBridge(s.mgr.appCtx, s.mgr.config, voltaCallID, providerCallID, cm, s.log)
	if !s.reg.setAgent(providerCallID, voltaCallID, agent) {
		_ = cm.RejectCall(context.Background(), providerCallID, core.EndCallReasonDeclined)
		return
	}
	if err := agent.Start(); err != nil {
		s.log.Error("inbound realtime bridge failed", "call_id", providerCallID, "err", err)
		_ = cm.RejectCall(context.Background(), providerCallID, core.EndCallReasonDeclined)
		return
	}
	owner := "volta:" + voltaCallID
	s.mgr.broker.upsertCall(CallRecord{
		SessionID: s.id, CallID: providerCallID, Owner: &owner, Direction: "inbound", Peer: peer,
		StartedAt: time.Now().UnixMilli(), Status: StatusRinging,
	})
	if err := cm.AcceptCall(context.Background(), providerCallID); err != nil {
		s.log.Error("inbound call accept failed", "call_id", providerCallID, "err", err)
		agent.Close()
		_ = cm.RejectCall(context.Background(), providerCallID, core.EndCallReasonDeclined)
	}
}
