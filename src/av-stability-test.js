(() => {
  const TWO_PI = Math.PI * 2;

  class FixedFrameLoop {
    constructor(updateFn, renderFn, targetFps = 30) {
      this.updateFn = updateFn;
      this.renderFn = renderFn;
      this.targetFps = 30;
      this.stepMs = 1000 / 30;
      this.setTargetFps(targetFps);

      this.running = false;
      this.rafId = 0;
      this.lastTs = 0;
      this.accMs = 0;
      this.renderedOnce = false;
      this.maxCatchupSteps = 6;
      this.maxDeltaMs = 250;

      this.updateCount = 0;
      this.renderCount = 0;
      this.dropCount = 0;

      this.fpsSampleTs = 0;
      this.fpsSampleFrames = 0;
      this.measuredFps = 0;

      this.deltaRing = new Float64Array(512);
      this.deltaRingIndex = 0;
      this.deltaRingCount = 0;
      this.deltaStatsTs = 0;
      this.avgDeltaCached = 0;
      this.p95DeltaCached = 0;

      this._boundLoop = (ts) => this._loop(ts);
    }

    setTargetFps(fps) {
      const v = Number(fps);
      const safe = Number.isFinite(v) ? Math.max(1, Math.min(240, v)) : 30;
      this.targetFps = safe;
      this.stepMs = 1000 / safe;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.lastTs = 0;
      this.accMs = 0;
      this.renderedOnce = false;
      this.rafId = requestAnimationFrame(this._boundLoop);
    }

    stop() {
      this.running = false;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
    }

    resetStats() {
      this.updateCount = 0;
      this.renderCount = 0;
      this.dropCount = 0;
      this.fpsSampleTs = 0;
      this.fpsSampleFrames = 0;
      this.measuredFps = 0;
      this.deltaRingIndex = 0;
      this.deltaRingCount = 0;
      this.deltaRing.fill(0);
      this.deltaStatsTs = 0;
      this.avgDeltaCached = 0;
      this.p95DeltaCached = 0;
    }

    _recordDelta(deltaMs) {
      this.deltaRing[this.deltaRingIndex] = deltaMs;
      this.deltaRingIndex = (this.deltaRingIndex + 1) % this.deltaRing.length;
      if (this.deltaRingCount < this.deltaRing.length) {
        this.deltaRingCount += 1;
      }
    }

    _loop(ts) {
      if (!this.running) return;
      if (!this.lastTs) {
        this.lastTs = ts;
        this.fpsSampleTs = ts;
      }

      let deltaMs = ts - this.lastTs;
      this.lastTs = ts;
      if (deltaMs < 0) deltaMs = 0;
      if (deltaMs > this.maxDeltaMs) deltaMs = this.maxDeltaMs;

      this._recordDelta(deltaMs);
      this.accMs += deltaMs;

      let steps = 0;
      while (this.accMs >= this.stepMs && steps < this.maxCatchupSteps) {
        this.updateFn(this.stepMs);
        this.updateCount += 1;
        this.accMs -= this.stepMs;
        steps += 1;
      }

      if (this.accMs >= this.stepMs) {
        this.dropCount += 1;
        this.accMs = this.stepMs * 0.5;
      }

      let didRender = false;
      if (steps > 0 || !this.renderedOnce) {
        const alpha = this.stepMs > 0 ? (this.accMs / this.stepMs) : 0;
        this.renderFn(alpha);
        this.renderCount += 1;
        this.renderedOnce = true;
        didRender = true;
      }

      if (didRender) this.fpsSampleFrames += 1;
      const fpsElapsed = ts - this.fpsSampleTs;
      if (fpsElapsed >= 1000) {
        this.measuredFps = (this.fpsSampleFrames * 1000) / fpsElapsed;
        this.fpsSampleFrames = 0;
        this.fpsSampleTs = ts;
      }

      this.rafId = requestAnimationFrame(this._boundLoop);
    }

    getStats() {
      const count = this.deltaRingCount | 0;
      const now = performance.now();
      if ((now - this.deltaStatsTs) >= 1000 || this.deltaStatsTs === 0) {
        let avgDelta = 0;
        let p95 = 0;
        if (count > 0) {
          const values = new Array(count);
          for (let i = 0; i < count; i += 1) values[i] = this.deltaRing[i];
          values.sort((a, b) => a - b);
          const sum = values.reduce((a, b) => a + b, 0);
          avgDelta = sum / count;
          const p95Index = Math.max(0, Math.min(count - 1, Math.floor((count - 1) * 0.95)));
          p95 = values[p95Index];
        }
        this.avgDeltaCached = avgDelta;
        this.p95DeltaCached = p95;
        this.deltaStatsTs = now;
      }
      return {
        running: this.running,
        targetFps: this.targetFps,
        measuredFps: this.measuredFps,
        avgDelta: this.avgDeltaCached,
        p95Delta: this.p95DeltaCached,
        updates: this.updateCount >>> 0,
        renders: this.renderCount >>> 0,
        drops: this.dropCount >>> 0,
      };
    }
  }

  class AudioStabilityEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.scriptNode = null;
      this.workletNode = null;
      this.backend = 'none';
      this.running = false;

      this.queue = null;
      this.queueMask = 0;
      this.queueRead = 0;
      this.queueWrite = 0;
      this.queueCount = 0;

      this.sampleRate = 48000;
      this.phase = 0;
      this.lfoPhase = 0;
      this.produced = 0;
      this.consumed = 0;
      this.underruns = 0;
      this.workletBuffered = 0;
      this.workletBufferedEstimate = 0;
      this.workletUnderruns = 0;
      this.workletProcessed = 0;
      this.workletEstimateTs = 0;
      this.pumpTimer = 0;
      this.scriptCallbackLastTs = 0;
      this.scriptLateCallbacks = 0;
      this.lastOutputSample = 0;
      this.holdSample = 0;
    }

    _initQueue(capacitySamples) {
      let cap = 1;
      const wanted = Math.max(8192, capacitySamples | 0);
      while (cap < wanted) cap <<= 1;
      this.queue = new Float32Array(cap);
      this.queueMask = cap - 1;
      this.queueRead = 0;
      this.queueWrite = 0;
      this.queueCount = 0;
    }

    _pushSample(v) {
      if (!this.queue) return;
      if (this.queueCount >= this.queue.length) {
        this.queueRead = (this.queueRead + 1) & this.queueMask;
        this.queueCount -= 1;
      }
      this.queue[this.queueWrite] = v;
      this.queueWrite = (this.queueWrite + 1) & this.queueMask;
      this.queueCount += 1;
      this.produced = (this.produced + 1) >>> 0;
    }

    _popSample() {
      if (!this.queue || this.queueCount <= 0) {
        this.underruns = (this.underruns + 1) >>> 0;
        return this.holdSample;
      }
      const v = this.queue[this.queueRead];
      this.queueRead = (this.queueRead + 1) & this.queueMask;
      this.queueCount -= 1;
      this.consumed = (this.consumed + 1) >>> 0;
      this.holdSample = v;
      return v;
    }

    _generateSamples(count) {
      const n = Math.max(0, count | 0);
      if (n <= 0) return;
      const sampleRate = this.sampleRate > 0 ? this.sampleRate : 48000;
      for (let i = 0; i < n; i += 1) {
        const lfo = Math.sin(this.lfoPhase) * 28;
        const freq = 220 + lfo;
        this.phase += (TWO_PI * freq) / sampleRate;
        this.lfoPhase += (TWO_PI * 0.33) / sampleRate;
        if (this.phase >= TWO_PI) this.phase -= TWO_PI;
        if (this.lfoPhase >= TWO_PI) this.lfoPhase -= TWO_PI;
        const main = Math.sin(this.phase) * 0.12;
        const sub = Math.sin(this.phase * 0.5) * 0.04;
        this._pushSample(main + sub);
      }
    }

    _dequeueChunk(maxSamples) {
      const n = Math.max(0, maxSamples | 0);
      if (n <= 0 || this.queueCount <= 0) return null;
      const take = Math.min(n, this.queueCount | 0);
      const out = new Float32Array(take);
      for (let i = 0; i < take; i += 1) out[i] = this._popSample();
      return out;
    }

    _fillSourceQueueTo(targetSamples) {
      const target = Math.max(0, targetSamples | 0);
      let guard = 0;
      while (this.queueCount < target && guard < 64) {
        this._generateSamples(512);
        guard += 1;
      }
    }

    _consumeTo(out) {
      const n = out.length | 0;
      for (let i = 0; i < n; i += 1) out[i] = this._popSample();
    }

    _applyDeClickRamp(out) {
      const n = out.length | 0;
      if (n <= 0) return;
      const prev = this.lastOutputSample;
      const first = out[0];
      const jump = Math.abs(first - prev);
      if (jump > 0.06) {
        const ramp = Math.min(64, n);
        for (let i = 0; i < ramp; i += 1) {
          const t = (i + 1) / ramp;
          out[i] = prev + (out[i] - prev) * t;
        }
      }
      this.lastOutputSample = out[n - 1];
    }

    _startPump() {
      if (!this.workletNode) return;
      if (this.pumpTimer) return;
      this.pumpTimer = setInterval(() => {
        if (!this.running) return;
        const sourceTarget = Math.max(2048, Math.floor(this.sampleRate * 0.20));
        const sourceLow = Math.floor(sourceTarget * 0.5);
        if (this.queueCount < sourceLow) this._fillSourceQueueTo(sourceTarget);

        const now = performance.now();
        if (this.workletEstimateTs > 0) {
          const dtSec = Math.max(0, (now - this.workletEstimateTs) / 1000);
          const consumedEstimate = dtSec * this.sampleRate;
          this.workletBufferedEstimate = Math.max(0, this.workletBufferedEstimate - consumedEstimate);
        }
        this.workletEstimateTs = now;

        const workletTarget = Math.max(1024, Math.floor(this.sampleRate * 0.05));
        let guard = 0;
        while (this.workletBufferedEstimate < workletTarget && guard < 4) {
          const chunk = this._dequeueChunk(512);
          if (!chunk || chunk.length <= 0) break;
          this.workletNode.port.postMessage(
            { type: 'push', buffer: chunk.buffer, length: chunk.length },
            [chunk.buffer],
          );
          this.workletBufferedEstimate += chunk.length;
          guard += 1;
        }
      }, 8);
    }

    _stopPump() {
      if (!this.pumpTimer) return;
      clearInterval(this.pumpTimer);
      this.pumpTimer = 0;
    }

    async start() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        this.backend = 'unsupported';
        return false;
      }

      if (!this.ctx) {
        this.ctx = new Ctx({ latencyHint: 'interactive', sampleRate: 48000 });
        this.sampleRate = this.ctx.sampleRate | 0;
        this._initQueue(Math.ceil(this.sampleRate * 2));
        this._fillSourceQueueTo(Math.max(4096, Math.floor(this.sampleRate * 0.20)));

        this.master = this.ctx.createGain();
        this.master.gain.value = 0.0;

        let workletReady = false;
        if (this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
          try {
            const url = new URL('src/nes-audio-worklet-processor.js', window.location.href).toString();
            await this.ctx.audioWorklet.addModule(url);
            this.workletNode = new AudioWorkletNode(this.ctx, 'nes-audio-worklet', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              processorOptions: { capacity: 131072 },
            });
            this.workletNode.port.onmessage = (event) => {
              const msg = event && event.data ? event.data : null;
              if (!msg || msg.type !== 'stats') return;
              this.workletBuffered = msg.buffered | 0;
              this.workletBufferedEstimate = this.workletBuffered;
              this.workletUnderruns = msg.underruns >>> 0;
              this.workletProcessed = msg.processed >>> 0;
              this.workletEstimateTs = performance.now();
            };
            this.workletNode.connect(this.master);
            this.backend = 'AudioWorklet';
            workletReady = true;
          } catch (_err) {
            this.workletNode = null;
            workletReady = false;
          }
        }

        if (!workletReady) {
          this.scriptNode = this.ctx.createScriptProcessor(1024, 0, 1);
          this.scriptNode.onaudioprocess = (event) => {
            const out = event.outputBuffer.getChannelData(0);
            if (!this.running) {
              out.fill(0);
              this.lastOutputSample = 0;
              return;
            }

            const now = performance.now();
            if (this.scriptCallbackLastTs > 0) {
              const deltaMs = now - this.scriptCallbackLastTs;
              const expectedMs = (out.length / Math.max(1, this.sampleRate)) * 1000;
              if (deltaMs > expectedMs * 1.8) {
                this.scriptLateCallbacks = (this.scriptLateCallbacks + 1) >>> 0;
              }
            }
            this.scriptCallbackLastTs = now;

            // ScriptProcessor fallback:
            // generate on callback demand to avoid timer-jitter induced pops.
            const low = out.length * 4;
            const target = out.length * 12;
            if (this.queueCount < low) {
              this._fillSourceQueueTo(target);
            }
            this._consumeTo(out);
            this._applyDeClickRamp(out);
          };
          this.scriptNode.connect(this.master);
          this.backend = 'ScriptProcessor';
        }

        this.master.connect(this.ctx.destination);
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      this.running = true;
      this._startPump();
      this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.02);
      return true;
    }

    stop() {
      this.running = false;
      this._stopPump();
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.01);
      }
      if (this.workletNode) {
        this.workletNode.port.postMessage({ type: 'reset' });
      }
    }

    resetStats() {
      this.produced = 0;
      this.consumed = 0;
      this.underruns = 0;
      this.workletBuffered = 0;
      this.workletBufferedEstimate = 0;
      this.workletUnderruns = 0;
      this.workletProcessed = 0;
      this.workletEstimateTs = 0;
      this.scriptCallbackLastTs = 0;
      this.scriptLateCallbacks = 0;
      this.lastOutputSample = 0;
      this.holdSample = 0;
      this.phase = 0;
      this.lfoPhase = 0;
      if (this.queue) {
        this.queueRead = 0;
        this.queueWrite = 0;
        this.queueCount = 0;
      }
      this._fillSourceQueueTo(Math.max(4096, Math.floor(this.sampleRate * 0.20)));
      if (this.workletNode) this.workletNode.port.postMessage({ type: 'reset' });
    }

    getStats() {
      return {
        running: this.running,
        backend: this.backend,
        sampleRate: this.sampleRate | 0,
        sourceBuffered: this.queueCount | 0,
        produced: this.produced >>> 0,
        consumed: this.consumed >>> 0,
        underruns: this.underruns >>> 0,
        workletBuffered: this.workletBuffered | 0,
        workletUnderruns: this.workletUnderruns >>> 0,
        workletProcessed: this.workletProcessed >>> 0,
        scriptLateCallbacks: this.scriptLateCallbacks >>> 0,
      };
    }
  }

  function classifyVideoQuality(stats) {
    if (!stats.running) return 'muted';
    const fpsError = Math.abs(stats.measuredFps - stats.targetFps);
    if (stats.measuredFps <= 0) return 'muted';
    if (fpsError <= 1.5 && stats.p95Delta <= 40) return 'ok';
    if (fpsError <= 4.0 && stats.p95Delta <= 60) return 'warn';
    return 'bad';
  }

  function classifyAudioQuality(stats) {
    if (!stats.running) return 'muted';
    const underrun = (stats.backend === 'AudioWorklet')
      ? stats.workletUnderruns
      : stats.underruns;
    if (underrun === 0) return 'ok';
    if (underrun < 32) return 'warn';
    return 'bad';
  }

  const canvas = document.getElementById('screen');
  const ctx = canvas && canvas.getContext
    ? canvas.getContext('2d', { alpha: false, desynchronized: true })
    : null;
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const resetBtn = document.getElementById('resetBtn');
  const fpsInput = document.getElementById('fpsInput');
  const statusLine = document.getElementById('statusLine');
  const videoLine = document.getElementById('videoLine');
  const audioLine = document.getElementById('audioLine');
  const evalLine = document.getElementById('evalLine');
  const criteriaLine = document.getElementById('criteriaLine');

  if (
    !canvas || !ctx || !startBtn || !stopBtn || !resetBtn || !fpsInput
    || !statusLine || !videoLine || !audioLine || !evalLine || !criteriaLine
  ) {
    return;
  }

  const audio = new AudioStabilityEngine();
  const sim = {
    tSec: 0,
    x: 0,
    dir: 1,
  };

  function updateSimulation(stepMs) {
    const dtSec = stepMs / 1000;
    sim.tSec += dtSec;
    sim.x += sim.dir * dtSec * 240;
    if (sim.x < 30) {
      sim.x = 30;
      sim.dir = 1;
    } else if (sim.x > (canvas.width - 30)) {
      sim.x = canvas.width - 30;
      sim.dir = -1;
    }
  }

  function renderSimulation(alpha) {
    const t = sim.tSec + (alpha * (1 / Math.max(1, loop.targetFps)));
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#05090f';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#233248';
    ctx.lineWidth = 1;
    for (let y = 0; y <= h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * TWO_PI * 0.5);
    const barY = Math.floor(h * (0.2 + 0.6 * pulse));
    ctx.fillStyle = '#2e6fae';
    ctx.fillRect(0, barY - 3, w, 6);

    ctx.beginPath();
    ctx.arc(sim.x, h * 0.5, 28, 0, TWO_PI);
    ctx.fillStyle = '#6dd7ff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#baf1ff';
    ctx.stroke();

    const audioStats = audio.getStats();
    const q = Math.max(0, Math.min(1, (audioStats.sourceBuffered / Math.max(1, audioStats.sampleRate * 0.2))));
    const meterW = Math.floor((w - 40) * q);
    ctx.fillStyle = '#15263b';
    ctx.fillRect(20, h - 34, w - 40, 14);
    ctx.fillStyle = q > 0.35 ? '#63d58a' : '#ff8e64';
    ctx.fillRect(20, h - 34, meterW, 14);
    ctx.strokeStyle = '#2a3e5c';
    ctx.strokeRect(20, h - 34, w - 40, 14);
  }

  const loop = new FixedFrameLoop(updateSimulation, renderSimulation, 30);
  const evalState = {
    active: false,
    startedAtMs: 0,
    warmupSec: 3,
    windowSec: 30,
    finalized: false,
    verdict: 'PENDING',
    reason: '',
    minFps: Number.POSITIVE_INFINITY,
    maxP95: 0,
    maxDrops: 0,
    maxUnderrun: 0,
    minSourceQ: Number.POSITIVE_INFINITY,
    maxSourceQ: 0,
    targetFpsAtStart: 30,
  };

  function setClass(el, cls) {
    el.className = `mono ${cls}`;
  }

  function resetEvaluation() {
    evalState.active = false;
    evalState.startedAtMs = 0;
    evalState.finalized = false;
    evalState.verdict = 'PENDING';
    evalState.reason = '';
    evalState.minFps = Number.POSITIVE_INFINITY;
    evalState.maxP95 = 0;
    evalState.maxDrops = 0;
    evalState.maxUnderrun = 0;
    evalState.minSourceQ = Number.POSITIVE_INFINITY;
    evalState.maxSourceQ = 0;
    evalState.targetFpsAtStart = loop.targetFps;
  }

  function beginEvaluation() {
    resetEvaluation();
    evalState.active = true;
    evalState.startedAtMs = performance.now();
    evalState.targetFpsAtStart = loop.targetFps;
  }

  function currentAudioUnderruns(a) {
    return (a.backend === 'AudioWorklet') ? (a.workletUnderruns >>> 0) : (a.underruns >>> 0);
  }

  function updateEvaluation(v, a, running) {
    if (!running || !evalState.active) {
      setClass(evalLine, 'muted');
      evalLine.textContent = 'EVAL idle';
      setClass(criteriaLine, 'muted');
      criteriaLine.textContent = 'Criteria: fps>=target-1.0, p95<=45ms, drops<=3, underruns<=4';
      return;
    }

    const now = performance.now();
    const elapsedSec = Math.max(0, (now - evalState.startedAtMs) / 1000);
    const totalEvalSec = evalState.warmupSec + evalState.windowSec;
      const underrun = currentAudioUnderruns(a);
      const lateCb = (a.backend === 'ScriptProcessor') ? (a.scriptLateCallbacks >>> 0) : 0;

      if (elapsedSec >= evalState.warmupSec && !evalState.finalized) {
        if (v.measuredFps > 0) {
        evalState.minFps = Math.min(evalState.minFps, v.measuredFps);
      }
      evalState.maxP95 = Math.max(evalState.maxP95, v.p95Delta);
        evalState.maxDrops = Math.max(evalState.maxDrops, v.drops);
        evalState.maxUnderrun = Math.max(evalState.maxUnderrun, underrun);
        evalState.maxUnderrun = Math.max(evalState.maxUnderrun, lateCb);
        evalState.minSourceQ = Math.min(evalState.minSourceQ, a.sourceBuffered);
        evalState.maxSourceQ = Math.max(evalState.maxSourceQ, a.sourceBuffered);
      }

    if (!evalState.finalized && elapsedSec >= totalEvalSec) {
      evalState.finalized = true;
      const minFps = Number.isFinite(evalState.minFps) ? evalState.minFps : 0;
      const fpsPass = minFps >= (evalState.targetFpsAtStart - 1.0);
      const p95Pass = evalState.maxP95 <= 45;
      const dropsPass = evalState.maxDrops <= 3;
      const underrunPass = evalState.maxUnderrun <= 4;
      const queuePass = evalState.minSourceQ >= 128;
      const pass = fpsPass && p95Pass && dropsPass && underrunPass && queuePass;
      evalState.verdict = pass ? 'PASS' : 'FAIL';
      const reasons = [];
      if (!fpsPass) reasons.push(`fpsMin=${minFps.toFixed(2)}`);
      if (!p95Pass) reasons.push(`p95Max=${evalState.maxP95.toFixed(2)}ms`);
      if (!dropsPass) reasons.push(`drops=${evalState.maxDrops}`);
      if (!underrunPass) reasons.push(`underruns=${evalState.maxUnderrun}`);
      if (!queuePass) reasons.push(`srcQMin=${evalState.minSourceQ}`);
      evalState.reason = reasons.length > 0 ? reasons.join(', ') : 'all criteria met';
    }

    if (!evalState.finalized) {
      if (elapsedSec < evalState.warmupSec) {
        const remain = Math.max(0, evalState.warmupSec - elapsedSec);
        setClass(evalLine, 'warn');
        evalLine.textContent = `EVAL warmup ${remain.toFixed(1)}s`;
      } else {
        const progress = Math.max(0, Math.min(1, (elapsedSec - evalState.warmupSec) / evalState.windowSec));
        const pct = Math.floor(progress * 100);
        setClass(evalLine, 'warn');
        evalLine.textContent = `EVAL running ${pct}%`;
      }
      setClass(criteriaLine, 'muted');
      criteriaLine.textContent =
        `Criteria: fps>=${(evalState.targetFpsAtStart - 1.0).toFixed(1)} `
        + `p95<=45ms drops<=3 underruns<=4 srcQ>=128`;
      return;
    }

    setClass(evalLine, evalState.verdict === 'PASS' ? 'ok' : 'bad');
    evalLine.textContent = `EVAL ${evalState.verdict} (${evalState.windowSec}s window)`;
    setClass(criteriaLine, evalState.verdict === 'PASS' ? 'ok' : 'bad');
    criteriaLine.textContent = `Result: ${evalState.reason}`;
  }

  function refreshStatus() {
    const v = loop.getStats();
    const a = audio.getStats();

    const videoClass = classifyVideoQuality(v);
    const audioClass = classifyAudioQuality(a);
    const running = loop.running || audio.running;

    setClass(statusLine, running ? 'ok' : 'muted');
    statusLine.textContent = running
      ? `Running | target=${v.targetFps}fps | backend=${a.backend}`
      : 'Idle';

    setClass(videoLine, videoClass);
    videoLine.textContent =
      `VIDEO fps=${v.measuredFps.toFixed(2)} avgDelta=${v.avgDelta.toFixed(2)}ms `
      + `p95=${v.p95Delta.toFixed(2)}ms updates=${v.updates} drops=${v.drops}`;

    const underrun = (a.backend === 'AudioWorklet') ? a.workletUnderruns : a.underruns;
    const outBuffered = (a.backend === 'AudioWorklet') ? a.workletBuffered : a.sourceBuffered;
    const late = (a.backend === 'ScriptProcessor') ? a.scriptLateCallbacks : 0;
    setClass(audioLine, audioClass);
    audioLine.textContent =
      `AUDIO sr=${a.sampleRate}Hz srcQ=${a.sourceBuffered} outQ=${outBuffered} `
      + `underruns=${underrun} lateCb=${late} prod=${a.produced} cons=${a.consumed}`;

    updateEvaluation(v, a, running);
  }

  async function startRuntime() {
    const fps = Number(fpsInput.value);
    loop.setTargetFps(fps);
    loop.resetStats();
    audio.resetStats();
    beginEvaluation();
    const ok = await audio.start();
    if (!ok) {
      evalState.active = false;
      setClass(statusLine, 'bad');
      statusLine.textContent = 'AudioContext unavailable on this browser/device';
      return;
    }
    loop.start();
    startBtn.disabled = true;
    stopBtn.disabled = false;
    refreshStatus();
  }

  function stopRuntime() {
    loop.stop();
    audio.stop();
    evalState.active = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    refreshStatus();
  }

  function resetStats() {
    loop.resetStats();
    audio.resetStats();
    resetEvaluation();
    refreshStatus();
  }

  startBtn.addEventListener('click', () => {
    startRuntime().catch((err) => {
      setClass(statusLine, 'bad');
      statusLine.textContent = `Start failed: ${err && err.message ? err.message : 'unknown error'}`;
      console.error(err);
    });
  });

  stopBtn.addEventListener('click', stopRuntime);
  resetBtn.addEventListener('click', resetStats);
  fpsInput.addEventListener('change', () => {
    const fps = Number(fpsInput.value);
    loop.setTargetFps(fps);
    refreshStatus();
  });

  setInterval(refreshStatus, 200);
  resetEvaluation();
  refreshStatus();
  renderSimulation(0);
})();
