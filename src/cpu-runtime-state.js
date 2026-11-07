let CpuPhaseClockStateCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ CpuPhaseClockState: CpuPhaseClockStateCore } = require('./cpu-phase-clock-state'));
  } catch (_err) {
    CpuPhaseClockStateCore = null;
  }
}
if (!CpuPhaseClockStateCore && typeof globalThis !== 'undefined' && globalThis.NESCoreCpuPhaseClockState) {
  CpuPhaseClockStateCore = globalThis.NESCoreCpuPhaseClockState.CpuPhaseClockState;
}
if (!CpuPhaseClockStateCore) {
  throw new Error('CpuPhaseClockState core not found');
}

const CPU_RUNTIME_BUS_OWNER_CPU = 0;
const CPU_RUNTIME_BUS_OWNER_OAM_DMA = 1;
const CPU_RUNTIME_BUS_OWNER_DMC_DMA = 2;
const CPU_RUNTIME_BUS_OWNER_DMA_GENERIC = 3;

class CpuRuntimeState {
  constructor() {
    this.bus = {
      owner: CPU_RUNTIME_BUS_OWNER_CPU,
      paused: false,
      pendingDmc: false,
      pendingOam: false,
      address: 0,
      isWrite: false,
      openBusData: 0,
      openBusReadValue: null,
      externalDataBus: 0,
      externalBusValue: 0,
      internalBusValue: 0,
    };
    this.timeline = {
      lastCpuAddressBus: 0,
      lastCpuBusWasWrite: false,
      lastCpuPutCycle: false,
      lastCpuBusCycle: 0,
    };
    this.dma = {
      pendingPage: null,
      oamWaitingStart: false,
      oamActive: false,
      oamPage: 0,
      oamOffset: 0,
      oamReadPending: false,
      oamReadValue: 0,
      dmcActive: false,
      lastCpuAddress: 0,
      recentRdyLowCycles: 0,
      cpuReadCycle: false,
      spriteTriggerPending: false,
      misterPauseCpu: false,
      misterSprState: 0,
      misterDmcState: 0,
      dmcPipelinePhase: 'idle',
      apuDmcTriggerLatched: false,
      apuDmcAddrLatched: 0,
    };
    this.interrupts = {
      nmiOccurred: false,
      nmiEnabled: false,
      nmiLine: false,
      nmiLinePrevious: false,
      nmiEdgePending: false,
      nmiPendingCurrent: false,
      nmiPendingPrevious: false,
      irqLines: 0,
      irqLineCurrent: false,
      irqSampleCurrent: false,
      irqSamplePrevious: false,
      apuIrqLatched: false,
      externalIrqLatched: false,
    };
    this.phase = new CpuPhaseClockStateCore();
    this.reset();
  }

  reset() {
    this.openBus = 0;
    this.busCycleCounter = 0;
    this.dmaStallCycles = 0;
    this.cycleCounter = 0;
    this.phase.reset();
    this.bus.owner = CPU_RUNTIME_BUS_OWNER_CPU;
    this.bus.paused = false;
    this.bus.pendingDmc = false;
    this.bus.pendingOam = false;
    this.bus.address = 0;
    this.bus.isWrite = false;
    this.bus.openBusData = 0;
    this.bus.openBusReadValue = null;
    this.bus.externalDataBus = 0;
    this.bus.externalBusValue = 0;
    this.bus.internalBusValue = 0;
    this.timeline.lastCpuAddressBus = 0;
    this.timeline.lastCpuBusWasWrite = false;
    this.timeline.lastCpuPutCycle = false;
    this.timeline.lastCpuBusCycle = 0;
    this.dma.pendingPage = null;
    this.dma.oamWaitingStart = false;
    this.dma.oamActive = false;
    this.dma.oamPage = 0;
    this.dma.oamOffset = 0;
    this.dma.oamReadPending = false;
    this.dma.oamReadValue = 0;
    this.dma.dmcActive = false;
    this.dma.lastCpuAddress = 0;
    this.dma.recentRdyLowCycles = 0;
    this.dma.cpuReadCycle = false;
    this.dma.spriteTriggerPending = false;
    this.dma.misterPauseCpu = false;
    this.dma.misterSprState = 0;
    this.dma.misterDmcState = 0;
    this.dma.dmcPipelinePhase = 'idle';
    this.dma.apuDmcTriggerLatched = false;
    this.dma.apuDmcAddrLatched = 0;
    this.interrupts.nmiOccurred = false;
    this.interrupts.nmiEnabled = false;
    this.interrupts.nmiLine = false;
    this.interrupts.nmiLinePrevious = false;
    this.interrupts.nmiEdgePending = false;
    this.interrupts.nmiPendingCurrent = false;
    this.interrupts.nmiPendingPrevious = false;
    this.interrupts.irqLines = 0;
    this.interrupts.irqLineCurrent = false;
    this.interrupts.irqSampleCurrent = false;
    this.interrupts.irqSamplePrevious = false;
    this.interrupts.apuIrqLatched = false;
    this.interrupts.externalIrqLatched = false;
  }
}

const cpuRuntimeStateExports = { CpuRuntimeState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuRuntimeStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuRuntimeState = cpuRuntimeStateExports;
}
