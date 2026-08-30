const RING_SIZE = 16000 * 3;
class PlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ring = new Float32Array(RING_SIZE);
    this.read = 0;
    this.write = 0;
    this.available = 0;
    this.port.onmessage = (event) => {
      for (const sample of event.data) {
        this.ring[this.write] = sample;
        this.write = (this.write + 1) % RING_SIZE;
        if (this.available < RING_SIZE) this.available += 1;
        else this.read = (this.read + 1) % RING_SIZE;
      }
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!output) return true;
    for (let index = 0; index < output.length; index += 1) {
      output[index] = this.available ? this.ring[this.read] : 0;
      if (this.available) {
        this.read = (this.read + 1) % RING_SIZE;
        this.available -= 1;
      }
    }
    return true;
  }
}
registerProcessor("playback-processor", PlaybackProcessor);
