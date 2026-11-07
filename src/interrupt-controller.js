const IRQ_LINE_APU = 0x01;
const IRQ_LINE_EXTERNAL = 0x02;

class InterruptController {
  constructor(host = null) {
    this.host = host;
    this.state = host && host.cpuState ? host.cpuState.interrupts : null;
    this._cpuSnapshot = { nmi: false, irq: false };
    this.reset();
  }

  _s() {
    return this.state || this;
  }

  reset() {
    const state = this._s();
    state.nmiOccurred = false;
    state.nmiEnabled = false;
    state.nmiLine = false;
    state.nmiLinePrevious = false;
    state.nmiEdgePending = false;
    state.nmiPendingCurrent = false;
    state.nmiPendingPrevious = false;
    state.irqLines = 0;
    state.irqLineCurrent = false;
    state.irqSampleCurrent = false;
    state.irqSamplePrevious = false;
  }

  _raiseNmiEdge() {
    const state = this._s();
    state.nmiEdgePending = true;
  }

  _updatePpuNmiLine() {
    const state = this._s();
    state.nmiLine = !!(state.nmiOccurred && state.nmiEnabled);
  }

  setPpuVblank(asserted) {
    this._s().nmiOccurred = !!asserted;
    this._updatePpuNmiLine();
  }

  setPpuNmiOutput(asserted, suppressEdge = false) {
    const state = this._s();
    state.nmiEnabled = !!asserted;
    if (suppressEdge) {
      this._updatePpuNmiLine();
      // Treat current level as already sampled to suppress an immediate
      // synthetic edge when toggling output within the same boundary.
      state.nmiEdgePending = false;
      state.nmiLinePrevious = state.nmiLine;
      return;
    }
    const prevLine = !!state.nmiLine;
    this._updatePpuNmiLine();
    // Keep short-pulse visibility for $2000-enable induced rises while
    // avoiding global immediate-edge behavior on VBlank-start line updates.
    if (!prevLine && state.nmiLine) {
      state.nmiEdgePending = true;
    }
  }

  isNmiPending() {
    const state = this._s();
    return state.nmiPendingCurrent || state.nmiPendingPrevious;
  }

  hasNmiDelay() {
    const state = this._s();
    return state.nmiPendingCurrent && !state.nmiPendingPrevious;
  }

  clearNmi() {
    const state = this._s();
    state.nmiEdgePending = false;
    state.nmiPendingCurrent = false;
    state.nmiPendingPrevious = false;
    state.nmiLinePrevious = state.nmiLine;
  }

  suppressNmiEdge() {
    const state = this._s();
    state.nmiEdgePending = false;
    state.nmiLinePrevious = state.nmiLine;
    // Suppression should only cancel not-yet-latched edges. If CPU-visible
    // pending state is already latched, keep it serviceable.
    if (!state.nmiPendingPrevious) {
      state.nmiPendingCurrent = false;
    }
  }

  requestNmi(_delayInstructions = 0) {
    this._raiseNmiEdge();
  }

  sampleIrqLine() {
    const state = this._s();
    state.irqLineCurrent = ((state.irqLines & 0xff) !== 0);
    return state.irqLineCurrent;
  }

  _latchCpuCe(iFlagSet) {
    const state = this._s();
    state.nmiPendingPrevious = state.nmiPendingCurrent;
    const rising = !state.nmiLinePrevious && state.nmiLine;
    if (rising || state.nmiEdgePending) {
      state.nmiPendingCurrent = true;
    }
    state.nmiEdgePending = false;
    state.nmiLinePrevious = state.nmiLine;
    state.irqSamplePrevious = state.irqSampleCurrent;
    state.irqSampleCurrent = state.irqLineCurrent && !iFlagSet;
  }

  sampleCpuPhase(iFlagSet, cpuCe = true) {
    this.sampleIrqLine();
    if (!cpuCe) return;
    this._latchCpuCe(!!iFlagSet);
  }

  sampleCpuHalfPhase(phase, iFlagSet) {
    const cpuCe = !!(phase && phase.cpuCe);
    this.sampleCpuPhase(!!iFlagSet, cpuCe);
  }

  sampleCpuCycle(iFlagSet) {
    this.sampleCpuPhase(iFlagSet, true);
  }

  consumeNmi() {
    const state = this._s();
    if (!state.nmiPendingCurrent) return false;
    state.nmiEdgePending = false;
    state.nmiPendingCurrent = false;
    state.nmiPendingPrevious = false;
    return true;
  }

  shouldServiceNmi() {
    return this._s().nmiPendingPrevious;
  }

  shouldServiceIrq() {
    return this._s().irqSamplePrevious;
  }

  snapshotForCpu() {
    const out = this._cpuSnapshot;
    out.nmi = this.shouldServiceNmi();
    out.irq = this.shouldServiceIrq();
    return out;
  }

  setIrqLine(mask, asserted) {
    const state = this._s();
    const m = mask & 0xff;
    if (asserted) state.irqLines |= m;
    else state.irqLines &= ~m;
  }

  consumeIrq() {
    return this.shouldServiceIrq();
  }

  isIrqAsserted() {
    return (this._s().irqLines & 0xff) !== 0;
  }
}

const interruptControllerExports = {
  InterruptController,
  IRQ_LINE_APU,
  IRQ_LINE_EXTERNAL,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = interruptControllerExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreInterruptController = interruptControllerExports;
}
