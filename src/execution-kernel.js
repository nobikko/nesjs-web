class ExecutionKernel {
  constructor(host) {
    this.host = host;
    const cpu = host && host.cpu ? host.cpu : null;
    this._sampleInternalCyclesFn = (cpu && typeof cpu.sampleInternalCycles === 'function')
      ? cpu.sampleInternalCycles.bind(cpu)
      : null;
    this._advancePpuIoBusDecayFn = (host && typeof host.advancePpuIoBusDecay === 'function')
      ? host.advancePpuIoBusDecay.bind(host)
      : null;
    this._runUntilNextVBlankResult = {
      cpuCycles: 0,
      frameAdvanced: false,
      frameCounter: 0,
    };
    this._cpuPowerOnHoldCycles = 0;
  }

  setCpuPowerOnHoldCycles(cycles) {
    const n = cycles | 0;
    this._cpuPowerOnHoldCycles = n > 0 ? n : 0;
  }

  _consumeCpuPowerOnHold(maxCycles) {
    const limit = maxCycles | 0;
    if (limit <= 0 || this._cpuPowerOnHoldCycles <= 0) return 0;
    const host = this.host;
    const ppu = host.ppuState;
    const clock = host.clock;
    const advancePpuIoBusDecayFn = this._advancePpuIoBusDecayFn;
    const used = this._cpuPowerOnHoldCycles < limit ? this._cpuPowerOnHoldCycles : limit;
    clock.advanceCpuInternalCycles(used);
    if (advancePpuIoBusDecayFn) {
      advancePpuIoBusDecayFn(used);
    } else {
      ppu.ioBusDecayCpu = Math.max(ppu.ioBusDecayHighCpu | 0, ppu.ioBusDecayLowCpu | 0);
    }
    this._cpuPowerOnHoldCycles -= used;
    return used;
  }

  step() {
    const host = this.host;
    const cpuState = host.cpuState;
    const ppu = host.ppuState;
    const cpu = host.cpu;
    const sampleInternalCyclesFn = this._sampleInternalCyclesFn;
    const holdUsed = this._consumeCpuPowerOnHold(0x7fffffff);
    if (holdUsed > 0) return holdUsed;
    const cpuCycles = cpu.step();
    const accessCycles = cpu.accessCycles || 0;
    const executedCpuCycles = cpuCycles >= accessCycles ? cpuCycles : accessCycles;
    const internalCycles = executedCpuCycles - accessCycles;
    host.clock.advanceCpuInternalCycles(internalCycles);
    if (internalCycles > 0 && sampleInternalCyclesFn) {
      sampleInternalCyclesFn(internalCycles);
    }
    let total = executedCpuCycles;

    if (cpuState.dmaStallCycles > 0) {
      const stall = cpuState.dmaStallCycles;
      cpuState.dmaStallCycles = 0;
      host.clock.advanceCpuStallCycles(stall);
      host.busArbiter.addCpuBusCycles(stall);
      total += stall;
    }

    const advancePpuIoBusDecayFn = this._advancePpuIoBusDecayFn;
    if (advancePpuIoBusDecayFn) {
      advancePpuIoBusDecayFn(total);
    } else {
      ppu.ioBusDecayCpu = Math.max(ppu.ioBusDecayHighCpu | 0, ppu.ioBusDecayLowCpu | 0);
    }

    return total;
  }

  runCpuCycles(maxCycles) {
    const host = this.host;
    const cpu = host.cpu;
    const cpuState = host.cpuState;
    const ppu = host.ppuState;
    const clock = host.clock;
    const busArbiter = host.busArbiter;
    const advancePpuIoBusDecayFn = this._advancePpuIoBusDecayFn;
    const sampleInternalCyclesFn = this._sampleInternalCyclesFn;
    let used = 0;
    if (maxCycles > 0) {
      used += this._consumeCpuPowerOnHold(maxCycles);
    }
    while (used < maxCycles && !cpu.stopped) {
      const cpuCycles = cpu.step();
      const accessCycles = cpu.accessCycles || 0;
      const executedCpuCycles = cpuCycles >= accessCycles ? cpuCycles : accessCycles;
      const internalCycles = executedCpuCycles - accessCycles;
      clock.advanceCpuInternalCycles(internalCycles);
      if (internalCycles > 0 && sampleInternalCyclesFn) {
        sampleInternalCyclesFn(internalCycles);
      }
      let total = executedCpuCycles;

      if (cpuState.dmaStallCycles > 0) {
        const stall = cpuState.dmaStallCycles;
        cpuState.dmaStallCycles = 0;
        clock.advanceCpuStallCycles(stall);
        busArbiter.addCpuBusCycles(stall);
        total += stall;
      }

      if (advancePpuIoBusDecayFn) {
        advancePpuIoBusDecayFn(total);
      } else {
        ppu.ioBusDecayCpu = Math.max(ppu.ioBusDecayHighCpu | 0, ppu.ioBusDecayLowCpu | 0);
      }

      used += total;
    }
    return used;
  }

  runUntilNextVBlank(maxCpuCycles = 120000) {
    const host = this.host;
    const cpu = host.cpu;
    const cpuState = host.cpuState;
    const ppu = host.ppuState;
    const clock = host.clock;
    const busArbiter = host.busArbiter;
    const advancePpuIoBusDecayFn = this._advancePpuIoBusDecayFn;
    const sampleInternalCyclesFn = this._sampleInternalCyclesFn;
    const startFrame = ppu.frameCounter;
    let used = 0;
    if (maxCpuCycles > 0) {
      used += this._consumeCpuPowerOnHold(maxCpuCycles);
    }
    while (used < maxCpuCycles && ppu.frameCounter === startFrame && !cpu.stopped) {
      const cpuCycles = cpu.step();
      const accessCycles = cpu.accessCycles || 0;
      const executedCpuCycles = cpuCycles >= accessCycles ? cpuCycles : accessCycles;
      const internalCycles = executedCpuCycles - accessCycles;
      clock.advanceCpuInternalCycles(internalCycles);
      if (internalCycles > 0 && sampleInternalCyclesFn) {
        sampleInternalCyclesFn(internalCycles);
      }
      let total = executedCpuCycles;

      if (cpuState.dmaStallCycles > 0) {
        const stall = cpuState.dmaStallCycles;
        cpuState.dmaStallCycles = 0;
        clock.advanceCpuStallCycles(stall);
        busArbiter.addCpuBusCycles(stall);
        total += stall;
      }

      if (advancePpuIoBusDecayFn) {
        advancePpuIoBusDecayFn(total);
      } else {
        ppu.ioBusDecayCpu = Math.max(ppu.ioBusDecayHighCpu | 0, ppu.ioBusDecayLowCpu | 0);
      }

      used += total;
    }
    const out = this._runUntilNextVBlankResult;
    out.cpuCycles = used;
    out.frameAdvanced = ppu.frameCounter !== startFrame;
    out.frameCounter = ppu.frameCounter;
    return out;
  }
}

const executionKernelExports = { ExecutionKernel };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = executionKernelExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreExecutionKernel = executionKernelExports;
}
