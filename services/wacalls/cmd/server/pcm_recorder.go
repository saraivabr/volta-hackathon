package main

import (
	"bytes"
	"encoding/binary"
	"math"
	"sync"
	"time"
)

type pcmTimelineRecorder struct {
	mu         sync.Mutex
	startedAt  time.Time
	sampleRate int
	samples    []float32
}

func newPCMTimelineRecorder(sampleRate int) *pcmTimelineRecorder {
	return &pcmTimelineRecorder{startedAt: time.Now(), sampleRate: sampleRate}
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
	for i, sample := range samples {
		mixed := r.samples[start+i] + sample*0.72
		if mixed > 1 {
			mixed = 1
		} else if mixed < -1 {
			mixed = -1
		}
		r.samples[start+i] = mixed
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
	for _, sample := range r.samples {
		value := int(math.Round(float64(sample) * 32767))
		if value > 32767 {
			value = 32767
		} else if value < -32768 {
			value = -32768
		}
		_ = binary.Write(buf, binary.LittleEndian, int16(value))
	}
	return buf.Bytes()
}
