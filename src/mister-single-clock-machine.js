let MisterSingleClockCpuCore = null;
let MisterSingleClockPpuCore = null;
let MisterSingleClockApuCore = null;
let MisterSingleClockDmaCore = null;

if (typeof require !== 'undefined') {
  try {
    ({ MisterSingleClockCpu: MisterSingleClockCpuCore } = require('./mister-single-clock-cpu'));
    ({ MisterSingleClockPpu: MisterSingleClockPpuCore } = require('./mister-single-clock-ppu'));
    ({ MisterSingleClockApu: MisterSingleClockApuCore } = require('./mister-single-clock-apu'));
    ({ MisterSingleClockDma: MisterSingleClockDmaCore } = require('./mister-single-clock-dma'));
  } catch (_err) {
    MisterSingleClockCpuCore = null;
    MisterSingleClockPpuCore = null;
    MisterSingleClockApuCore = null;
    MisterSingleClockDmaCore = null;
  }
}

if (!MisterSingleClockCpuCore && typeof globalThis !== 'undefined') {
  if (globalThis.NESCoreMisterSingleClockCpu) MisterSingleClockCpuCore = globalThis.NESCoreMisterSingleClockCpu.MisterSingleClockCpu;
  if (globalThis.NESCoreMisterSingleClockPpu) MisterSingleClockPpuCore = globalThis.NESCoreMisterSingleClockPpu.MisterSingleClockPpu;
  if (globalThis.NESCoreMisterSingleClockApu) MisterSingleClockApuCore = globalThis.NESCoreMisterSingleClockApu.MisterSingleClockApu;
  if (globalThis.NESCoreMisterSingleClockDma) MisterSingleClockDmaCore = globalThis.NESCoreMisterSingleClockDma.MisterSingleClockDma;
}

if (!MisterSingleClockCpuCore || !MisterSingleClockPpuCore || !MisterSingleClockApuCore || !MisterSingleClockDmaCore) {
  throw new Error('Mister single-clock domain modules not found');
}

class MisterSingleClockMachine {
  constructor(nes, bus) {
    this.nes = nes;
    this.bus = bus;
    this.cpu = new MisterSingleClockCpuCore();
    this.ppu = new MisterSingleClockPpuCore();
    this.apu = new MisterSingleClockApuCore();
    this.dma = new MisterSingleClockDmaCore();
  }

  reset() {
    const state = this.nes.state;
    state.clock.master = 0;
    state.clock.sub = 0;
    state.phase.reset();
    state.cpuCycleCounter = 0;
    this.ppu.reset(this.nes);
    this.apu.reset(this.nes);
    this.dma.reset(this.nes);
    this.cpu.reset(this.nes, this.bus);
  }

  _tickMasterOne() {
    const nes = this.nes;
    const state = nes.state;
    state.clock.master = (state.clock.master + 1) >>> 0;
    state.clock.sub += 1;

    // PPU dot domain: 4 master clocks per dot.
    if ((state.clock.sub % 4) === 0) {
      this.ppu.onMasterTick(nes);
    }

    // CPU half-cycle phase domain: 6 master clocks per half phase.
    if ((state.clock.sub % 6) === 0) {
      const phase = state.phase.beginHalfTick(state.clock.master, state.clock.sub);
      if (nes.controllers && typeof nes.controllers.onCpuPhaseTick === 'function') {
        nes.controllers.onCpuPhaseTick(phase);
      }
      this.apu.onCpuPhaseTick(nes, phase);
      this.dma.onCpuPhaseTick(nes, this.bus, phase);
      if (phase.cpuCe && this.dma.isCpuOwned(nes)) {
        this.cpu.onCpuCe(nes, this.bus, phase);
      }
      state.phase.commitHalfTick();
    }

    if (state.clock.sub >= 12) {
      state.clock.sub = 0;
      nes.cpuState.cycleCounter = (nes.cpuState.cycleCounter + 1) >>> 0;
      if (nes && typeof nes.advancePpuIoBusDecay === 'function') {
        nes.advancePpuIoBusDecay(1);
      } else if (state.ppu.ioBusDecayCpu > 0) {
        state.ppu.ioBusDecayCpu -= 1;
        if (state.ppu.ioBusDecayCpu <= 0) {
          state.ppu.ioBus = 0;
        }
      }
    }
  }

  advanceMasterClocks(masterClocks) {
    const count = masterClocks | 0;
    if (count <= 0) return 0;
    for (let i = 0; i < count; i += 1) {
      this._tickMasterOne();
    }
    return count;
  }

  runCpuCycles(maxCycles) {
    const limit = maxCycles | 0;
    if (limit <= 0) return 0;
    const start = this.nes.cpuState.cycleCounter >>> 0;
    while ((((this.nes.cpuState.cycleCounter >>> 0) - start) >>> 0) < (limit >>> 0)) {
      this._tickMasterOne();
      if (this.nes.cpu.stopped) break;
    }
    return (((this.nes.cpuState.cycleCounter >>> 0) - start) >>> 0);
  }

  runUntilNextVBlank(maxCpuCycles) {
    const limit = (maxCpuCycles == null ? 120000 : (maxCpuCycles | 0));
    const startFrame = this.nes.ppuState.frameCounter >>> 0;
    const used = this.runCpuCycles(limit);
    return {
      cpuCycles: used >>> 0,
      frameAdvanced: (this.nes.ppuState.frameCounter >>> 0) !== startFrame,
      frameCounter: this.nes.ppuState.frameCounter >>> 0,
    };
  }

  step() {
    const used = this.runCpuCycles(1);
    return used > 0 ? used : 1;
  }
}

const misterSingleClockMachineExports = { MisterSingleClockMachine };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockMachineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockMachine = misterSingleClockMachineExports;
}
