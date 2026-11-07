let MisterSingleClockCpuPhaseClockStateCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ CpuPhaseClockState: MisterSingleClockCpuPhaseClockStateCore } = require('./cpu-phase-clock-state'));
  } catch (_err) {
    MisterSingleClockCpuPhaseClockStateCore = null;
  }
}
if (!MisterSingleClockCpuPhaseClockStateCore && typeof globalThis !== 'undefined' && globalThis.NESCoreCpuPhaseClockState) {
  MisterSingleClockCpuPhaseClockStateCore = globalThis.NESCoreCpuPhaseClockState.CpuPhaseClockState;
}
if (!MisterSingleClockCpuPhaseClockStateCore) {
  throw new Error('CpuPhaseClockState core not found');
}

const MISTER_STATE_BUS_OWNER_CPU = 0;

function createMisterSingleClockState() {
  return {
    clock: {
      master: 0,
      sub: 0,
    },
    phase: new MisterSingleClockCpuPhaseClockStateCore(),
    cpu: {
      a: 0,
      x: 0,
      y: 0,
      p: 0x24,
      sp: 0xfd,
      pc: 0,
      stopped: false,
      interruptIFlag: true,
      unsupportedOpcodeCount: 0,
      lastOpcode: 0xea,
    },
    ppu: {
      scanline: 0,
      dot: 0,
      frameCounter: 0,
      status: 0,
      mask: 0,
      ctrl: 0,
      v: 0,
      t: 0,
      fineX: 0,
      writeToggle: 0,
      ioBus: 0,
      ioBusDecayCpu: 0,
      oamAddr: 0,
      frameColor: null,
      frameBgOpaque: null,
      scanlineV: null,
      scanlineFineX: null,
      scanlinePpuCtrl: null,
      scanlineChrBank: null,
    },
    apu: {
      frameCounter: 0,
      status: 0,
    },
    dma: {
      engine: 'idle',
      pendingPage: null,
      sourceAddr: 0,
      index: 0,
      latch: 0,
      dmc: {
        pending: false,
        halt: false,
        dummy: false,
        align: false,
        get: false,
        abort: false,
      },
    },
    interrupt: {
      nmiLine: false,
      irqLine: false,
    },
    bus: {
      owner: MISTER_STATE_BUS_OWNER_CPU,
      address: 0,
      isWrite: false,
      openBus: 0,
      openBusData: 0,
      openBusReadValue: null,
      externalDataBus: 0,
      internalBusValue: 0,
      externalBusValue: 0,
      pendingDmc: false,
      pendingOam: false,
      paused: false,
    },
    cpuCycleCounter: 0,
  };
}

const misterSingleClockStateExports = { createMisterSingleClockState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockState = misterSingleClockStateExports;
}
