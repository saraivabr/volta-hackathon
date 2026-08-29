package main

import (
	"encoding/binary"
	"math"
)

type linearResampler struct {
	inRate  float64
	outRate float64
	pos     float64
	last    float32
	hasLast bool
}

func newLinearResampler(inRate, outRate int) *linearResampler {
	return &linearResampler{inRate: float64(inRate), outRate: float64(outRate)}
}

func (r *linearResampler) Process(input []float32) []float32 {
	if len(input) == 0 {
		return nil
	}
	data := input
	if r.hasLast {
		data = make([]float32, len(input)+1)
		data[0] = r.last
		copy(data[1:], input)
	}
	if len(data) < 2 {
		r.last = data[0]
		r.hasLast = true
		return nil
	}
	step := r.inRate / r.outRate
	estimated := int(math.Ceil(float64(len(data)) / step))
	output := make([]float32, 0, estimated)
	for r.pos+1 < float64(len(data)) {
		index := int(r.pos)
		fraction := float32(r.pos - float64(index))
		output = append(output, data[index]+(data[index+1]-data[index])*fraction)
		r.pos += step
	}
	r.pos -= float64(len(data) - 1)
	r.last = data[len(data)-1]
	r.hasLast = true
	return output
}

func pcmFloat32ToInt16LE(input []float32) []byte {
	output := make([]byte, len(input)*2)
	for index, sample := range input {
		if math.IsNaN(float64(sample)) {
			sample = 0
		}
		if sample > 1 {
			sample = 1
		}
		if sample < -1 {
			sample = -1
		}
		value := int16(sample * 32767)
		if sample <= -1 {
			value = math.MinInt16
		}
		binary.LittleEndian.PutUint16(output[index*2:], uint16(value))
	}
	return output
}

func pcmInt16LEToFloat32(input []byte) []float32 {
	output := make([]float32, len(input)/2)
	for index := range output {
		value := int16(binary.LittleEndian.Uint16(input[index*2:]))
		output[index] = float32(value) / 32768
	}
	return output
}
