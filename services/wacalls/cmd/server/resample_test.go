package main

import (
	"math"
	"testing"
)

func TestLinearResamplerRates(t *testing.T) {
	up := newLinearResampler(16_000, 24_000)
	down := newLinearResampler(24_000, 16_000)
	input := make([]float32, 16_000)
	for i := range input {
		input[i] = float32(math.Sin(2 * math.Pi * 440 * float64(i) / 16_000))
	}
	upSampled := up.Process(input)
	if len(upSampled) < 23_990 || len(upSampled) > 24_010 {
		t.Fatalf("unexpected 16k to 24k length: %d", len(upSampled))
	}
	downSampled := down.Process(upSampled)
	if len(downSampled) < 15_990 || len(downSampled) > 16_010 {
		t.Fatalf("unexpected 24k to 16k length: %d", len(downSampled))
	}
}

func TestPCMConversion(t *testing.T) {
	original := []float32{-1, -0.5, 0, 0.5, 1}
	restored := pcmInt16LEToFloat32(pcmFloat32ToInt16LE(original))
	for i := range original {
		if math.Abs(float64(original[i]-restored[i])) > 0.0001 {
			t.Fatalf("sample %d mismatch: %f != %f", i, original[i], restored[i])
		}
	}
}
