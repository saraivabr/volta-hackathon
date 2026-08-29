package main

import (
	"context"
	"testing"
	"time"
)

func TestPCMPacerPrebuffersAndDrainsTwentyMillisecondFrames(t *testing.T) {
	pacer := newPCMPacer(context.Background(), 16_000, 20*time.Millisecond, 60*time.Millisecond, time.Second, func([]float32) {})
	pacer.Enqueue(make([]float32, 640))
	if frame := pacer.nextFrame(); frame != nil {
		t.Fatal("pacer started before reaching the prebuffer threshold")
	}
	pacer.Enqueue(make([]float32, 320))
	for i := 0; i < 3; i++ {
		if frame := pacer.nextFrame(); len(frame) != 320 {
			t.Fatalf("frame %d has %d samples, want 320", i, len(frame))
		}
	}
	if frame := pacer.nextFrame(); frame != nil {
		t.Fatal("pacer emitted a frame after the queue drained")
	}
}

func TestPCMPacerClearDropsQueuedSpeech(t *testing.T) {
	pacer := newPCMPacer(context.Background(), 16_000, 20*time.Millisecond, 60*time.Millisecond, time.Second, func([]float32) {})
	pacer.Enqueue(make([]float32, 1_600))
	pacer.Clear()
	if frame := pacer.nextFrame(); frame != nil {
		t.Fatal("pacer retained audio after clear")
	}
}
