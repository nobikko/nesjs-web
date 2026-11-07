class NesAudioWorkletProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) ? options.processorOptions : {};
    let cap = 1;
    const wanted = Math.max(4096, (opts.capacity | 0) || 65536);
    while (cap < wanted) cap <<= 1;
    this.capacity = cap;
    this.mask = cap - 1;
    this.buffer = new Float32Array(cap);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.underruns = 0;
    this.processed = 0;
    this.reportCounter = 0;
    this.hold = 0;

    this.port.onmessage = (event) => {
      const msg = event && event.data ? event.data : null;
      if (!msg || !msg.type) return;
      if (msg.type === 'reset') {
        this.read = 0;
        this.write = 0;
        this.count = 0;
        this.underruns = 0;
        this.processed = 0;
        this.reportCounter = 0;
        this.hold = 0;
        return;
      }
      if (msg.type === 'push' && msg.buffer) {
        const length = Math.max(0, msg.length | 0);
        if (length <= 0) return;
        const input = new Float32Array(msg.buffer, 0, length);
        for (let i = 0; i < input.length; i += 1) {
          if (this.count >= this.capacity) {
            this.read = (this.read + 1) & this.mask;
            this.count -= 1;
          }
          this.buffer[this.write] = input[i];
          this.write = (this.write + 1) & this.mask;
          this.count += 1;
        }
      }
    };
  }

  _reportStats() {
    this.port.postMessage({
      type: 'stats',
      buffered: this.count | 0,
      underruns: this.underruns >>> 0,
      processed: this.processed >>> 0,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    for (let i = 0; i < output.length; i += 1) {
      if (this.count > 0) {
        const sample = this.buffer[this.read];
        output[i] = sample;
        this.read = (this.read + 1) & this.mask;
        this.count -= 1;
        this.hold = sample;
      } else {
        output[i] = this.hold;
        this.underruns = (this.underruns + 1) >>> 0;
      }
    }
    this.processed = (this.processed + output.length) >>> 0;
    this.reportCounter += output.length;
    if (this.reportCounter >= 1024) {
      this.reportCounter = 0;
      this._reportStats();
    }
    return true;
  }
}

registerProcessor('nes-audio-worklet', NesAudioWorkletProcessor);
