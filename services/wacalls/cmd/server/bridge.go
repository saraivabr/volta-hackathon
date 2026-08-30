package main

import (
	"log/slog"
	"sync/atomic"

	"wacalls/internal/voip/media"

	"github.com/pion/webrtc/v4"
)

// pcmChannelLabel is the data channel the browser opens to carry raw 16 kHz mono
// Int16 LE PCM in both directions. The browser side must create it with this label.
const pcmChannelLabel = "pcm"

const (
	webRTCUDPPortMin = 50000
	webRTCUDPPortMax = 50100
)

// Bridge is the browser-leg adapter: it carries raw PCM between the browser and
// the CallManager over a WebRTC data channel. The call core only ever sees
// []float32 PCM, so it stays unaware of the transport (no Opus here anymore).
type Bridge struct {
	pc     *webrtc.PeerConnection
	dc     atomic.Pointer[webrtc.DataChannel]
	active atomic.Bool
	closed atomic.Bool
	log    *slog.Logger

	// OnBrowserPCM is invoked with decoded 16 kHz mono PCM captured from the browser mic.
	OnBrowserPCM func(pcm []float32)
	// OnDataChannelOpen runs only after the browser has applied the SDP answer and
	// the PCM channel is usable. Handoffs must wait for this boundary.
	OnDataChannelOpen func()
	// OnTerminalICE fires when the peer connection fails or closes.
	OnTerminalICE func()
}

func NewBridge(offerSDP string, log *slog.Logger) (*Bridge, string, error) {
	return newBridge(offerSDP, log, "")
}

func newBridge(offerSDP string, log *slog.Logger, publicIP string) (*Bridge, string, error) {
	settingEngine := webrtc.SettingEngine{}
	if err := settingEngine.SetEphemeralUDPPortRange(webRTCUDPPortMin, webRTCUDPPortMax); err != nil {
		return nil, "", err
	}
	if publicIP != "" {
		settingEngine.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	}
	pc, err := webrtc.NewAPI(webrtc.WithSettingEngine(settingEngine)).NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return nil, "", err
	}
	br := &Bridge{pc: pc, log: log}

	pc.OnDataChannel(func(dc *webrtc.DataChannel) {
		if dc.Label() != pcmChannelLabel {
			return
		}
		br.dc.Store(dc)
		dc.OnOpen(func() {
			if cb := br.OnDataChannelOpen; cb != nil {
				cb()
			}
		})
		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			if cb := br.OnBrowserPCM; cb != nil && len(msg.Data) > 0 {
				cb(media.PCMInt16LEToFloat32(msg.Data))
			}
		})
	})

	pc.OnICEConnectionStateChange(func(s webrtc.ICEConnectionState) {
		log.Debug("browser ice state", "state", s.String())
		if s == webrtc.ICEConnectionStateFailed || s == webrtc.ICEConnectionStateClosed {
			if br.OnTerminalICE != nil {
				br.OnTerminalICE()
			}
		}
	})

	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offerSDP}); err != nil {
		pc.Close()
		return nil, "", err
	}
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		pc.Close()
		return nil, "", err
	}
	gatherComplete := webrtc.GatheringCompletePromise(pc)
	if err := pc.SetLocalDescription(answer); err != nil {
		pc.Close()
		return nil, "", err
	}
	<-gatherComplete

	return br, pc.LocalDescription().SDP, nil
}

// WritePCM sends 16 kHz mono float32 PCM to the browser as Int16 LE over the data
// channel. It is a no-op until the channel is open.
func (b *Bridge) WritePCM(pcm []float32) error {
	dc := b.dc.Load()
	if dc == nil || len(pcm) == 0 {
		return nil
	}
	return dc.Send(media.PCMFloat32ToInt16LE(pcm))
}

func (b *Bridge) MarkActive() {
	b.active.Store(true)
}

func (b *Bridge) IsActive() bool {
	return b.active.Load()
}

func (b *Bridge) Close() {
	if b.closed.CompareAndSwap(false, true) && b.pc != nil {
		_ = b.pc.Close()
	}
}
