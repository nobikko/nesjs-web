const FRAME_EVENT_A = 0x1061;
const FRAME_EVENT_B = 0x3603;
const FRAME_EVENT_C = 0x2cd3;
const FRAME_EVENT_D = 0x0a1f;
const FRAME_EVENT_E = 0x7185;

class ApuFrameSequencer {
  constructor() {
    this.reset();
  }

  reset() {
    this.frame = 0x7fff;
    this.frameInterrupt = false;
    this.frameInterruptBuffer = false;
    this.frameIrqVisible = false;
    this.frameIrqLine = false;
    this.frameIrqInternal = false;
    this.frameSeqMode = false;
    this.frameSeqMode2 = false;
    this.frameReset2 = false;
    this.w4017_1 = false;
    this.w4017_2 = false;
    this.getCycle = true;
    this.irqInhibit = true;
    this.pending4015ReadClear = false;
  }

  _lfsrStep(frameValue) {
    const frame = frameValue & 0x7fff;
    const feedback = (((frame >> 14) & 1) ^ ((frame >> 13) & 1)) | (frame === 0 ? 1 : 0);
    return (((frame & 0x3fff) << 1) | feedback) & 0x7fff;
  }

  _clockOneCpuCycle(aclk1, aclk2, onHalfFrameClock) {
    const cb = onHalfFrameClock;
    const frame = this.frame & 0x7fff;
    const seqMode = aclk1 ? this.frameSeqMode : this.frameSeqMode2;
    const frmA = frame === FRAME_EVENT_A;
    const frmB = frame === FRAME_EVENT_B;
    const frmC = frame === FRAME_EVENT_C;
    const frmD = frame === FRAME_EVENT_D && !seqMode;
    const frmE = frame === FRAME_EVENT_E;
    const setIrq = frmD && !this.frameSeqMode;
    const frameReset = frmD || frmE || !!this.w4017_2;
    const frameHalf = frmB || frmD || frmE || (this.w4017_2 && seqMode);
    this.frameIrqInternal = false;
    let nextFrameInterrupt = this.frameInterrupt;
    let nextFrameInterruptBuffer = this.frameInterruptBuffer;
    let nextFrame = frame;
    let nextW4017_1 = this.w4017_1;
    let nextW4017_2 = this.w4017_2;
    let nextFrameSeqMode2 = this.frameSeqMode2;
    let nextFrameReset2 = this.frameReset2;
    // The $4015-read clear latch only takes effect on the get→put
    // transition (aclk1=true, MiSTer "put" cycle).  A read during a
    // MiSTer "get" cycle (aclk1=false) defers the clear until the
    // next aclk1=true edge, matching FrameCounterIRQ test 7.
    if (aclk1 && this.pending4015ReadClear) {
      nextFrameInterrupt = false;
      nextFrameInterruptBuffer = false;
      this.pending4015ReadClear = false;
    }
    if (setIrq) {
      this.frameIrqInternal = true;
      nextFrameInterrupt = true;
      nextFrameInterruptBuffer = true;
    }
    if (aclk1) {
      nextFrame = this.frameReset2 ? 0x7fff : this._lfsrStep(frame);
      nextW4017_2 = this.w4017_1;
      nextW4017_1 = false;
      nextFrameSeqMode2 = this.frameSeqMode;
      nextFrameReset2 = false;
      if (!this.frameInterrupt) {
        nextFrameInterruptBuffer = false;
      }
    }
    if (aclk2 && frameReset) {
      nextFrameReset2 = true;
    }
    if (this.irqInhibit) {
      nextFrameInterrupt = false;
    }
    this.frame = nextFrame & 0x7fff;
    this.w4017_1 = nextW4017_1;
    this.w4017_2 = nextW4017_2;
    this.frameSeqMode2 = nextFrameSeqMode2;
    this.frameReset2 = nextFrameReset2;
    this.frameInterrupt = nextFrameInterrupt;
    this.frameInterruptBuffer = nextFrameInterruptBuffer;
    this.frameIrqVisible = this.frameInterruptBuffer;
    this.frameIrqLine = this.frameInterrupt && !this.irqInhibit;
    if (frameHalf && aclk2 && cb) {
      cb();
    }
    this.getCycle = !aclk1;
  }

  _apply4017WriteNow(value) {
    const v = value & 0xff;
    this.frameSeqMode = (v & 0x80) !== 0;
    this.irqInhibit = (v & 0x40) !== 0;
    this.w4017_1 = true;
    if (this.irqInhibit) {
      this.frameInterrupt = false;
      this.frameIrqLine = false;
    }
  }

  tick(cycles, onHalfFrameClock) {
    const count = cycles | 0;
    if (count <= 0) return;
    const cb = typeof onHalfFrameClock === 'function' ? onHalfFrameClock : null;
    for (let i = 0; i < count; i += 1) {
      const aclk1 = this.getCycle;
      const aclk2 = !aclk1;
      this._clockOneCpuCycle(aclk1, aclk2, cb);
    }
  }

  onCpuPhaseTick(phase, onHalfFrameClock) {
    if (!phase || !phase.cpuCe) return;
    const aclk1 = phase.aclk1;
    const aclk2 = phase.aclk1Delayed;
    if (!aclk1 && !aclk2) return;
    const cb = typeof onHalfFrameClock === 'function' ? onHalfFrameClock : null;
    this._clockOneCpuCycle(aclk1, aclk2, cb);
  }

  on4015Read(isPutCycle) {
    const putCycle = !!isPutCycle;
    // MiSTer-equivalent same-boundary visibility:
    // if $4015 is read on a put cycle where frm_d/set_irq will assert later
    // in the same CPU cycle, bit6 is already observable as set.
    const setIrqThisCycle = putCycle
      && ((this.frame & 0x7fff) === FRAME_EVENT_D)
      && !this.frameSeqMode2
      && !this.frameSeqMode;
    const visible = !!this.frameInterruptBuffer || !!setIrqThisCycle;
    this.pending4015ReadClear = true;
    return visible;
  }

  on4017Write(value, _isPutCycle, _onHalfFrameClock) {
    this._apply4017WriteNow(value & 0xff);
  }

  isIrqAsserted() {
    return !this.irqInhibit && this.frameIrqLine;
  }

  isIrqVisible() {
    return !!this.frameIrqVisible;
  }

  isIrqInternalPulse() {
    return !!this.frameIrqInternal;
  }

  isIrqLineAsserted() {
    return !!this.frameIrqLine;
  }
}

const apuFrameSequencerExports = { ApuFrameSequencer };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = apuFrameSequencerExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreApuFrameSequencer = apuFrameSequencerExports;
}
