package main

import (
	"encoding/binary"
	"testing"
)

func TestPCMTimelineRecorderProducesWAV(t *testing.T) {
	recorder := newPCMTimelineRecorder(16_000)
	recorder.Write(make([]float32, 320))
	wav := recorder.WAV()
	if string(wav[:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatalf("invalid WAV header: %q %q", wav[:4], wav[8:12])
	}
	if got := binary.LittleEndian.Uint32(wav[24:28]); got != 16_000 {
		t.Fatalf("sample rate = %d, want 16000", got)
	}
	if len(wav) <= 44 {
		t.Fatal("WAV contains no PCM data")
	}
}
