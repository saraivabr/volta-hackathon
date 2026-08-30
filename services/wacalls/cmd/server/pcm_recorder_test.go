package main

import (
	"encoding/binary"
	"math"
	"testing"
	"time"
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

// tone fills a buffer with a fixed-amplitude signal so energy is measurable.
func sine(n int, freq float64, amplitude float64) []float32 {
	out := make([]float32, n)
	for i := range out {
		out[i] = float32(amplitude * math.Sin(2*math.Pi*freq*float64(i)/16000))
	}
	return out
}

func tone(n int, amplitude float32) []float32 {
	out := make([]float32, n)
	for i := range out {
		if i%2 == 0 {
			out[i] = amplitude
		} else {
			out[i] = -amplitude
		}
	}
	return out
}

func pcmEnergy(wav []byte, rate, fromSec, toSec int) float64 {
	var sum float64
	for i := 44 + fromSec*rate*2; i+1 < 44+toSec*rate*2 && i+1 < len(wav); i += 2 {
		v := float64(int16(binary.LittleEndian.Uint16(wav[i : i+2])))
		sum += v * v
	}
	return sum
}

// A call rings before it is answered. The recorder must place the conversation
// after the ring, keep the silence in front of it, and still produce audio the
// uploader will accept.
func TestRecorderPlacesAudioAfterRingingSilence(t *testing.T) {
	const rate = 16_000
	const ringSeconds = 30
	recorder := newPCMTimelineRecorderAt(rate, time.Now().Add(-ringSeconds*time.Second))
	recorder.Write(tone(rate*3, 0.5)) // three seconds of speech, once answered

	wav := recorder.WAV()
	if len(wav) <= 44 {
		t.Fatal("WAV carries no PCM; the uploader would silently skip it")
	}
	// The timeline is wall-clock based, so the offset can drift by a sample
	// between construction and the first write.
	wantBytes := (ringSeconds + 3) * rate * 2
	got := int(binary.LittleEndian.Uint32(wav[40:44]))
	if diff := got - wantBytes; diff < -20 || diff > 20 {
		t.Fatalf("data chunk = %d bytes, want ~%d", got, wantBytes)
	}
	if silence := pcmEnergy(wav, rate, 0, ringSeconds-1); silence != 0 {
		t.Fatalf("ringing window should be silent, got energy %v", silence)
	}
	if speech := pcmEnergy(wav, rate, ringSeconds, ringSeconds+3); speech == 0 {
		t.Fatal("no energy where the conversation should be")
	}
}

// Both sides are mixed into one mono timeline and overlap during barge-in.
// Summing them must not flat-top the waveform: a clipped sine loses its crest
// factor, and a flat-topped confirmation is worthless as diarized evidence.
func TestRecorderMixesBothSidesWithoutClipping(t *testing.T) {
	const rate = 16_000
	recorder := newPCMTimelineRecorderAt(rate, time.Now())
	recorder.Write(sine(rate, 440, 0.9)) // agent
	recorder.Write(sine(rate, 440, 0.9)) // counterparty, talking over it

	wav := recorder.WAV()
	var peak, sumSquares float64
	var n int
	for i := 44; i+1 < len(wav); i += 2 {
		v := math.Abs(float64(int16(binary.LittleEndian.Uint16(wav[i : i+2]))))
		if v > peak {
			peak = v
		}
		sumSquares += v * v
		n++
	}
	if n == 0 || peak == 0 {
		t.Fatal("no PCM written")
	}
	crest := peak / math.Sqrt(sumSquares/float64(n))
	// An undistorted sine sits at sqrt(2); hard clipping drives this toward 1.
	if crest < 1.30 {
		t.Fatalf("crest factor %.3f indicates clipping (undistorted sine is ~1.414)", crest)
	}
	if peak < 32000 {
		t.Fatalf("peak %.0f — normalisation should use the full scale", peak)
	}
}

// An unanswered call produces a header and nothing else. uploadRecording drops
// anything <= 44 bytes, so this is the contract that keeps empty calls out of
// the evidence bucket.
func TestRecorderEmitsHeaderOnlyWhenNobodyAnswers(t *testing.T) {
	recorder := newPCMTimelineRecorderAt(16_000, time.Now())
	if wav := recorder.WAV(); len(wav) != 44 {
		t.Fatalf("silent call produced %d bytes, want exactly the 44-byte header", len(wav))
	}
}
