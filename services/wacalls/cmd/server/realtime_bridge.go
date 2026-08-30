package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"wacalls/internal/voip/call"
	"wacalls/internal/voip/core"
)

type realtimeToken struct {
	Value     string `json:"value"`
	ExpiresAt int64  `json:"expiresAt"`
}

type realtimeEvent struct {
	Type       string `json:"type"`
	Delta      string `json:"delta"`
	Transcript string `json:"transcript"`
	ItemID     string `json:"item_id"`
	ResponseID string `json:"response_id"`
	Session    struct {
		ID string `json:"id"`
	} `json:"session"`
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

type RealtimeBridge struct {
	config          serviceConfig
	voltaCallID     string
	providerID      string
	callManager     *call.CallManager
	log             *slog.Logger
	ctx             context.Context
	cancel          context.CancelFunc
	conn            *websocket.Conn
	writeMu         sync.Mutex
	stateMu         sync.Mutex
	uplink          *linearResampler
	downlink        *linearResampler
	playback        *pcmPacer
	recorder        *pcmTimelineRecorder
	sessionReady    bool
	callActive      bool
	greeted         bool
	dropOutput      atomic.Bool
	responseActive  atomic.Bool
	silenceTimeouts atomic.Int32
	closed          atomic.Bool
}

func NewRealtimeBridge(parent context.Context, config serviceConfig, voltaCallID, providerID string, cm *call.CallManager, log *slog.Logger) *RealtimeBridge {
	ctx, cancel := context.WithCancel(parent)
	bridge := &RealtimeBridge{
		config:      config,
		voltaCallID: voltaCallID,
		providerID:  providerID,
		callManager: cm,
		log:         log.With("volta_call_id", voltaCallID, "whatsapp_call_id", providerID),
		ctx:         ctx,
		cancel:      cancel,
		uplink:      newLinearResampler(16_000, 24_000),
		downlink:    newLinearResampler(24_000, 16_000),
		recorder:    newPCMTimelineRecorder(16_000),
	}
	bridge.playback = newPCMPacer(ctx, 16_000, 20*time.Millisecond, 60*time.Millisecond, 30*time.Second, func(frame []float32) {
		bridge.recorder.Write(frame)
		cm.FeedCapturedPCM(frame)
	})
	bridge.playback.Start(20 * time.Millisecond)
	return bridge
}

func (b *RealtimeBridge) Start() error {
	token, err := b.fetchToken()
	if err != nil {
		return err
	}
	endpoint := "wss://api.openai.com/v1/realtime?model=" + url.QueryEscape(b.config.model)
	conn, response, err := websocket.Dial(b.ctx, endpoint, &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token.Value}},
	})
	if err != nil {
		if response != nil {
			return fmt.Errorf("openai websocket dial failed (%d): %w", response.StatusCode, err)
		}
		return fmt.Errorf("openai websocket dial failed: %w", err)
	}
	conn.SetReadLimit(16 << 20)
	b.conn = conn
	b.report("stream.started", "WhatsApp PCM bridge opened", "")
	go b.readLoop()
	return nil
}

func (b *RealtimeBridge) fetchToken() (realtimeToken, error) {
	body, _ := json.Marshal(map[string]string{"callId": b.voltaCallID, "transport": "whatsapp"})
	request, err := http.NewRequestWithContext(b.ctx, http.MethodPost, b.config.voltaBaseURL+"/api/openai/realtime/token", bytes.NewReader(body))
	if err != nil {
		return realtimeToken{}, err
	}
	request.Header.Set("Authorization", "Bearer "+b.config.relaySecret)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return realtimeToken{}, fmt.Errorf("realtime token request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return realtimeToken{}, fmt.Errorf("realtime token request returned %d", response.StatusCode)
	}
	var token realtimeToken
	if err := json.NewDecoder(response.Body).Decode(&token); err != nil || token.Value == "" {
		return realtimeToken{}, fmt.Errorf("invalid realtime token response")
	}
	return token, nil
}

func (b *RealtimeBridge) readLoop() {
	defer b.Close()
	for {
		_, payload, err := b.conn.Read(b.ctx)
		if err != nil {
			if !b.closed.Load() {
				b.report("relay.error", "OpenAI realtime socket closed", err.Error())
			}
			return
		}
		var event realtimeEvent
		if err := json.Unmarshal(payload, &event); err != nil {
			continue
		}
		switch event.Type {
		case "session.created":
			b.stateMu.Lock()
			b.sessionReady = true
			b.maybeGreetLocked()
			b.stateMu.Unlock()
			b.report("session.created", "GPT Realtime session established", event.Session.ID)
		case "response.created":
			b.responseActive.Store(true)
			b.dropOutput.Store(false)
		case "input_audio_buffer.speech_started":
			b.silenceTimeouts.Store(0)
			b.dropOutput.Store(true)
			b.playback.Clear()
			if b.responseActive.CompareAndSwap(true, false) {
				_ = b.send(map[string]string{"type": "response.cancel"})
			}
		case "response.output_audio.delta", "response.audio.delta":
			if !b.dropOutput.Load() {
				b.writeModelAudio(event.Delta)
			}
		case "response.done":
			b.responseActive.Store(false)
			b.report("response.done", "GPT Realtime turn completed", "")
		case "input_audio_buffer.timeout_triggered":
			count := b.silenceTimeouts.Add(1)
			if count == 1 {
				b.createResponse("Hay silencio. Pregunta brevemente: ¿Sigue ahí?")
			} else if count == 3 {
				b.createResponse("Sigue el silencio. Haz un último intento breve para confirmar si la persona continúa en la llamada.")
			} else if count >= 6 {
				b.createResponse("Despídete brevemente porque no hubo respuesta y explica que no se creó ningún compromiso nuevo.")
				go func() {
					select {
					case <-time.After(3 * time.Second):
						_ = b.callManager.EndCall(context.Background(), core.EndCallReasonUserEnded)
					case <-b.ctx.Done():
					}
				}()
			}
		case "error":
			if strings.Contains(event.Error.Message, "Cancellation failed: no active response found") {
				continue
			}
			b.report("relay.error", event.Error.Message, "")
		case "conversation.item.input_audio_transcription.completed":
			b.reportTranscript("COUNTERPARTY", event.ItemID, event.Transcript)
		case "response.output_audio_transcript.done", "response.audio_transcript.done":
			b.reportTranscript("AGENT", event.ItemID, event.Transcript)
		}
	}
}

// createResponse asks the model to speak, unless it already is. The server VAD
// creates its own responses when the counterparty stops talking, so an
// unguarded create races it and the API rejects the call with "Conversation
// already has an active response in progress" — which ended a live call.
func (b *RealtimeBridge) createResponse(instructions string) {
	if !b.responseActive.CompareAndSwap(false, true) {
		return
	}
	_ = b.send(map[string]any{"type": "response.create", "response": map[string]any{
		"output_modalities": []string{"audio"},
		"instructions":      instructions,
	}})
}

func (b *RealtimeBridge) OnCallState(status CallStatus) {
	if status != StatusConnected {
		return
	}
	b.stateMu.Lock()
	b.callActive = true
	b.maybeGreetLocked()
	b.stateMu.Unlock()
	b.report("call.active", "WhatsApp call connected", "")
}

func (b *RealtimeBridge) maybeGreetLocked() {
	if !b.sessionReady || !b.callActive || b.greeted {
		return
	}
	b.greeted = true
	b.createResponse("Inicia ahora en español: identifícate como Volta, un agente de IA, informa que la llamada puede ser grabada y pregunta si puedes continuar.")
}

func (b *RealtimeBridge) WritePeerPCM(pcm []float32) {
	if b.closed.Load() || b.conn == nil {
		return
	}
	b.stateMu.Lock()
	ready := b.sessionReady && b.callActive
	resampled := b.uplink.Process(pcm)
	b.stateMu.Unlock()
	b.recorder.Write(pcm)
	if !ready || len(resampled) == 0 {
		return
	}
	encoded := base64.StdEncoding.EncodeToString(pcmFloat32ToInt16LE(resampled))
	if err := b.send(map[string]string{"type": "input_audio_buffer.append", "audio": encoded}); err != nil {
		b.log.Debug("failed to append peer audio", "err", err)
	}
}

func (b *RealtimeBridge) writeModelAudio(delta string) {
	decoded, err := base64.StdEncoding.DecodeString(delta)
	if err != nil || len(decoded) == 0 {
		return
	}
	b.stateMu.Lock()
	pcm := b.downlink.Process(pcmInt16LEToFloat32(decoded))
	b.stateMu.Unlock()
	if len(pcm) > 0 {
		b.playback.Enqueue(pcm)
	}
}

func (b *RealtimeBridge) send(event any) error {
	if b.conn == nil || b.closed.Load() {
		return fmt.Errorf("realtime bridge is closed")
	}
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}
	b.writeMu.Lock()
	defer b.writeMu.Unlock()
	return b.conn.Write(b.ctx, websocket.MessageText, payload)
}

func (b *RealtimeBridge) report(eventType, detail, sessionID string) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		payload, _ := json.Marshal(map[string]string{
			"callId": b.voltaCallID, "eventType": eventType, "detail": detail,
			"sessionId": sessionID, "providerCallId": b.providerID,
		})
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, b.config.voltaBaseURL+"/api/openai/realtime/relay-events", bytes.NewReader(payload))
		if err != nil {
			return
		}
		request.Header.Set("Authorization", "Bearer "+b.config.relaySecret)
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			response.Body.Close()
		}
	}()
}

func (b *RealtimeBridge) reportTranscript(speaker, itemID, transcript string) {
	transcript = strings.TrimSpace(transcript)
	if transcript == "" || itemID == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		payload, _ := json.Marshal(map[string]string{
			"callId": b.voltaCallID, "eventType": "transcript.final", "speaker": speaker,
			"itemId": itemID, "transcript": transcript, "providerCallId": b.providerID,
		})
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, b.config.voltaBaseURL+"/api/openai/realtime/relay-events", bytes.NewReader(payload))
		if err != nil {
			return
		}
		request.Header.Set("Authorization", "Bearer "+b.config.relaySecret)
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			response.Body.Close()
		}
	}()
}

func (b *RealtimeBridge) uploadRecording(wav []byte) {
	if len(wav) <= 44 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	endpoint := b.config.voltaBaseURL + "/api/whatsapp/recordings?callId=" + url.QueryEscape(b.voltaCallID)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(wav))
	if err != nil {
		return
	}
	request.Header.Set("Authorization", "Bearer "+b.config.relaySecret)
	request.Header.Set("Content-Type", "audio/wav")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		b.log.Error("recording upload failed", "err", err)
		return
	}
	response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		b.log.Error("recording upload rejected", "status", response.StatusCode)
	}
}

func (b *RealtimeBridge) close(reportStopped bool) {
	if !b.closed.CompareAndSwap(false, true) {
		return
	}
	if reportStopped {
		b.report("stream.stopped", "WhatsApp PCM bridge closed", "")
	}
	wav := b.recorder.WAV()
	b.cancel()
	if b.conn != nil {
		_ = b.conn.Close(websocket.StatusNormalClosure, "call ended")
	}
	go b.uploadRecording(wav)
}

func (b *RealtimeBridge) StopForHandoff() {
	b.close(false)
}

func (b *RealtimeBridge) Close() {
	b.close(true)
}
