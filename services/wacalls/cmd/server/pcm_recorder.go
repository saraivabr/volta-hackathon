package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"sync"
	"time"
)

// mixGain attenuates each side before summing so a single speaker keeps
// headroom for the other one.
const mixGain = 0.72

type pcmTimelineRecorder struct {
	mu         sync.Mutex
	startedAt  time.Time
	sampleRate int
	samples    []float32
}

func newPCMTimelineRecorder(sampleRate int) *pcmTimelineRecorder {
	return newPCMTimelineRecorderAt(sampleRate, time.Now())
}

// newPCMTimelineRecorderAt pins the timeline origin so tests can place audio at
// a known offset — a call that rings before anyone speaks lands that far in.
func newPCMTimelineRecorderAt(sampleRate int, startedAt time.Time) *pcmTimelineRecorder {
	return &pcmTimelineRecorder{startedAt: startedAt, sampleRate: sampleRate}
}

func (r *pcmTimelineRecorder) Write(samples []float32) {
	if len(samples) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	start := int(time.Since(r.startedAt).Seconds() * float64(r.sampleRate))
	if start < 0 {
		start = 0
	}
	end := start + len(samples)
	if end > len(r.samples) {
		r.samples = append(r.samples, make([]float32, end-len(r.samples))...)
	}
	// Accumulate without clamping. Both sides land on one mono timeline and
	// overlap constantly during barge-in; clamping here would hard-clip that
	// exact moment, and the confirmation segment has to survive diarization.
	// The peak is resolved once, on serialization.
	for i, sample := range samples {
		r.samples[start+i] += sample * mixGain
	}
}

func (r *pcmTimelineRecorder) WAV() []byte {
	r.mu.Lock()
	defer r.mu.Unlock()
	dataSize := len(r.samples) * 2
	buf := bytes.NewBuffer(make([]byte, 0, 44+dataSize))
	buf.WriteString("RIFF")
	_ = binary.Write(buf, binary.LittleEndian, uint32(36+dataSize))
	buf.WriteString("WAVEfmt ")
	_ = binary.Write(buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(buf, binary.LittleEndian, uint32(r.sampleRate))
	_ = binary.Write(buf, binary.LittleEndian, uint32(r.sampleRate*2))
	_ = binary.Write(buf, binary.LittleEndian, uint16(2))
	_ = binary.Write(buf, binary.LittleEndian, uint16(16))
	buf.WriteString("data")
	_ = binary.Write(buf, binary.LittleEndian, uint32(dataSize))
	scale := 1.0
	if peak := r.peakLocked(); peak > 1 {
		scale = 1 / peak
	}
	for _, sample := range r.samples {
		value := int(math.Round(float64(sample) * scale * 32767))
		if value > 32767 {
			value = 32767
		} else if value < -32768 {
			value = -32768
		}
		_ = binary.Write(buf, binary.LittleEndian, int16(value))
	}
	return buf.Bytes()
}

// peakLocked returns the largest absolute sample. Callers must hold r.mu.
func (r *pcmTimelineRecorder) peakLocked() float64 {
	peak := 0.0
	for _, sample := range r.samples {
		if abs := math.Abs(float64(sample)); abs > peak {
			peak = abs
		}
	}
	return peak
}
