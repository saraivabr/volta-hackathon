package main

import (
	"context"
	"sync"
	"time"
)

type pcmPacer struct {
	ctx              context.Context
	frameSamples     int
	prebufferSamples int
	maxSamples       int
	sink             func([]float32)

	mu      sync.Mutex
	queue   []float32
	head    int
	playing bool
}

func newPCMPacer(ctx context.Context, sampleRate int, interval, prebuffer, maxBuffer time.Duration, sink func([]float32)) *pcmPacer {
	return &pcmPacer{
		ctx:              ctx,
		frameSamples:     samplesFor(sampleRate, interval),
		prebufferSamples: samplesFor(sampleRate, prebuffer),
		maxSamples:       samplesFor(sampleRate, maxBuffer),
		sink:             sink,
	}
}

func samplesFor(sampleRate int, duration time.Duration) int {
	return int((time.Duration(sampleRate) * duration) / time.Second)
}

func (p *pcmPacer) Start(interval time.Duration) {
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-p.ctx.Done():
				return
			case <-ticker.C:
				if frame := p.nextFrame(); len(frame) > 0 {
					p.sink(frame)
				}
			}
		}
	}()
}

func (p *pcmPacer) Enqueue(samples []float32) {
	if len(samples) == 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	available := p.maxSamples - (len(p.queue) - p.head)
	if available <= 0 {
		return
	}
	if len(samples) > available {
		samples = samples[:available]
	}
	p.queue = append(p.queue, samples...)
}

func (p *pcmPacer) Clear() {
	p.mu.Lock()
	p.queue = nil
	p.head = 0
	p.playing = false
	p.mu.Unlock()
}

func (p *pcmPacer) nextFrame() []float32 {
	p.mu.Lock()
	defer p.mu.Unlock()
	available := len(p.queue) - p.head
	if !p.playing {
		if available < p.prebufferSamples {
			return nil
		}
		p.playing = true
	}
	if available < p.frameSamples {
		p.playing = false
		return nil
	}
	frame := append([]float32(nil), p.queue[p.head:p.head+p.frameSamples]...)
	p.head += p.frameSamples
	if p.head >= 8192 && p.head*2 >= len(p.queue) {
		p.queue = append([]float32(nil), p.queue[p.head:]...)
		p.head = 0
	}
	return frame
}
