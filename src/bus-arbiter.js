let createBusAccessContextCore = null;
let busAccessActorRdyRepeatCore = 'rdy_repeat';
let busAccessActorOamDmaCore = 'oam_dma';
let busAccessActorDmcDmaCore = 'dmc_dma';
let busArbiterIoCpuBusMirrorCore = 'cpu_bus_mirror';
let busArbiterIoNoneCore = 'none';
if (typeof require !== 'undefined') {
  try {
    ({
      createBusAccessContext: createBusAccessContextCore,
      BUS_ACCESS_ACTOR_RDY_REPEAT: busAccessActorRdyRepeatCore,
      BUS_ACCESS_ACTOR_OAM_DMA: busAccessActorOamDmaCore,
      BUS_ACCESS_ACTOR_DMC_DMA: busAccessActorDmcDmaCore,
      BUS_ACCESS_IO_CPU_BUS_MIRROR: busArbiterIoCpuBusMirrorCore,
      BUS_ACCESS_IO_NONE: busArbiterIoNoneCore,
    } = require('./bus-access'));
  } catch (_err) {
    createBusAccessContextCore = null;
  }
}
if (!createBusAccessContextCore && typeof globalThis !== 'undefined' && globalThis.NESCoreBusAccess) {
  createBusAccessContextCore = globalThis.NESCoreBusAccess.createBusAccessContext;
  busAccessActorRdyRepeatCore = globalThis.NESCoreBusAccess.BUS_ACCESS_ACTOR_RDY_REPEAT;
  busAccessActorOamDmaCore = globalThis.NESCoreBusAccess.BUS_ACCESS_ACTOR_OAM_DMA;
  busAccessActorDmcDmaCore = globalThis.NESCoreBusAccess.BUS_ACCESS_ACTOR_DMC_DMA;
  busArbiterIoCpuBusMirrorCore = globalThis.NESCoreBusAccess.BUS_ACCESS_IO_CPU_BUS_MIRROR;
  busArbiterIoNoneCore = globalThis.NESCoreBusAccess.BUS_ACCESS_IO_NONE;
}
if (!createBusAccessContextCore) {
  throw new Error('Bus access core not found');
}

const BUS_ARBITER_OWNER_CPU = 0;

class BusArbiter {
  constructor(host) {
    this.host = host;
    this.cpuState = host && host.cpuState ? host.cpuState : null;
    this.pendingCpuSignalValid = false;
    this.pendingCpuSignalAddr = 0;
    this.pendingCpuSignalIsWrite = false;
    this.timeline = this.cpuState ? this.cpuState.timeline : {
      lastCpuAddressBus: 0,
      lastCpuBusWasWrite: false,
      lastCpuPutCycle: false,
      lastCpuBusCycle: 0,
    };
    this._cpuCycleTickContext = {
      busCycleCounter: 0,
      cpuAddress: 0,
      cpuRead: true,
      isWrite: false,
      isPutCycle: false,
      putCe: false,
      getCe: false,
    };
    this._rdyRepeatReadContext = {
      __normalizedBusAccess: true,
      actor: busAccessActorRdyRepeatCore,
      addr: 0,
      cpuAddressBus: 0,
      externalBusValue: null,
      currentCycle: 0,
      isPutCycle: false,
      ioReadMode: busArbiterIoCpuBusMirrorCore,
      ioWriteMode: busArbiterIoNoneCore,
      isWrite: false,
    };
    this._oamDmaReadContext = {
      __normalizedBusAccess: true,
      actor: busAccessActorOamDmaCore,
      addr: 0,
      cpuAddressBus: 0,
      externalBusValue: null,
      currentCycle: 0,
      isPutCycle: false,
      ioReadMode: busArbiterIoCpuBusMirrorCore,
      ioWriteMode: busArbiterIoNoneCore,
      isWrite: false,
    };
    this._dmcDmaReadContext = {
      __normalizedBusAccess: true,
      actor: busAccessActorDmcDmaCore,
      addr: 0,
      cpuAddressBus: 0,
      externalBusValue: null,
      currentCycle: 0,
      isPutCycle: false,
      ioReadMode: busArbiterIoCpuBusMirrorCore,
      ioWriteMode: busArbiterIoNoneCore,
      isWrite: false,
    };
  }

  _getBusCycleCounter() {
    return this.cpuState.busCycleCounter >>> 0;
  }

  _setBusCycleCounter(value) {
    const next = value >>> 0;
    this.cpuState.busCycleCounter = next;
    return next;
  }

  reset() {
    this._setBusCycleCounter(0);
    this.pendingCpuSignalValid = false;
    this.pendingCpuSignalAddr = 0;
    this.pendingCpuSignalIsWrite = false;
    this.timeline.lastCpuAddressBus = 0;
    this.timeline.lastCpuBusWasWrite = false;
    this.timeline.lastCpuPutCycle = false;
    this.timeline.lastCpuBusCycle = 0;
  }

  _advanceBusCycle({ affectRecentRdyLow } = { affectRecentRdyLow: true }) {
    this._setBusCycleCounter(this._getBusCycleCounter() + 1);
    if (this.host.apu && this.host.apu.onExternalCpuBusCycle) {
      this.host.apu.onExternalCpuBusCycle();
    }
    if (this.host.oamDma && this.host.oamDma.onExternalCpuBusCycle) {
      this.host.oamDma.onExternalCpuBusCycle(affectRecentRdyLow);
    }
  }

  onCpuPhaseTick(phaseInput) {
    const phase = phaseInput;
    if (!phase || phase.cpuCe !== true) {
      return;
    }
    this.onCpuCePhaseTick(phase);
  }

  onCpuCePhaseTick(phase) {
    const hasSignal = this.pendingCpuSignalValid === true;
    const isWrite = hasSignal && this.pendingCpuSignalIsWrite === true;
    const cpuRead = hasSignal ? !isWrite : !this.timeline.lastCpuBusWasWrite;
    const cpuAddress = hasSignal
      ? (this.pendingCpuSignalAddr & 0xffff)
      : (this.timeline.lastCpuAddressBus & 0xffff);
    const oamDma = this.host.oamDma;
    if (oamDma && oamDma.onCpuCycleTick) {
      const ctx = this._cpuCycleTickContext;
      ctx.busCycleCounter = this.cpuState.busCycleCounter >>> 0;
      ctx.cpuAddress = cpuAddress;
      ctx.cpuRead = cpuRead;
      ctx.isWrite = isWrite;
      // DmaController.put_cycle in MiSTer is wired to odd_or_even.
      ctx.isPutCycle = !!phase.oddOrEven;
      ctx.putCe = !!phase.putCe;
      ctx.getCe = !!phase.getCe;
      oamDma.onCpuCycleTick(ctx);
    }
    // Hold CPU-cycle signal across both half phases and clear on CPU CE edge.
    if (hasSignal) {
      this.pendingCpuSignalValid = false;
    }
  }

  addCpuBusCycles(cycles) {
    const n = cycles | 0;
    if (n <= 0) return;
    this._setBusCycleCounter(this._getBusCycleCounter() + n);
  }

  isControllerPutCycle() {
    if (this.cpuState && this.cpuState.phase) {
      const phase = this.cpuState.phase;
      // The active CPU-cycle polarity is carried by getOrPut. putCycle/getCycle
      // fields are only refreshed on beginHalfTick(), so they may be stale
      // between CPU-CE edges (e.g. at CPU bus-cycle start subClock=0).
      if (typeof phase.getOrPut === 'boolean') {
        return !phase.getOrPut;
      }
      if (typeof phase.putCycle === 'boolean') {
        return !!phase.putCycle;
      }
    }
    throw new Error('CPU phase state not available');
  }

  onCpuBusCycleStart(addr, isWrite, writeValue = 0) {
    const nextBusCycle = (this._getBusCycleCounter() + 1) >>> 0;
    this.timeline.lastCpuAddressBus = addr & 0xffff;
    this.timeline.lastCpuBusWasWrite = !!isWrite;
    this.timeline.lastCpuBusCycle = nextBusCycle;
    try {
      this.timeline.lastCpuPutCycle = this.isControllerPutCycle();
    } catch (_err) {
      this.timeline.lastCpuPutCycle = false;
    }
    this.pendingCpuSignalValid = true;
    this.pendingCpuSignalAddr = this.timeline.lastCpuAddressBus;
    this.pendingCpuSignalIsWrite = !!isWrite;
    const cpuBus = this.host.cpuState.bus;
    cpuBus.owner = BUS_ARBITER_OWNER_CPU;
    cpuBus.paused = false;
    cpuBus.address = this.timeline.lastCpuAddressBus;
    cpuBus.isWrite = !!isWrite;
    cpuBus.openBusReadValue = null;
    const hook = this.host.oamDma.onCpuBusCycleStart(addr, isWrite, nextBusCycle, writeValue & 0xff);
    this._advanceBusCycle({ affectRecentRdyLow: true });
    return hook;
  }

  consumeCpuRDYStallCycle() {
    return this.host.oamDma.consumeCpuRDYStallCycle({
      advanceBusCycle: () => this._advanceBusCycle({ affectRecentRdyLow: false }),
      repeatRead: (addr, options) => this.host.cpuRead(addr, this.createRdyRepeatReadContext(addr, options || null)),
    });
  }

  hadRecentRDYLow() {
    return this.host.oamDma.hadRecentRDYLow();
  }

  isCpuRdyLow() {
    if (!this.host || !this.host.oamDma || typeof this.host.oamDma.isCpuRdyLow !== 'function') {
      return false;
    }
    return !!this.host.oamDma.isCpuRdyLow();
  }

  onOamDmaBusCycle() {
    this._advanceBusCycle({ affectRecentRdyLow: true });
    this.host.clock.advanceDmaCpuCycle();
  }

  createRdyRepeatReadContext(addr, options = null) {
    const opts = options;
    const ctx = this._rdyRepeatReadContext;
    const a = addr & 0xffff;
    ctx.addr = a;
    ctx.cpuAddressBus = (opts && opts.cpuAddressBus != null)
      ? (opts.cpuAddressBus & 0xffff)
      : (this.timeline.lastCpuAddressBus & 0xffff);
    ctx.isPutCycle = (opts && opts.isPutCycle != null)
      ? !!opts.isPutCycle
      : !!this.timeline.lastCpuPutCycle;
    ctx.currentCycle = (opts && opts.currentCycle != null)
      ? (opts.currentCycle >>> 0)
      : (this.timeline.lastCpuBusCycle >>> 0);
    ctx.externalBusValue = (opts && opts.externalBusValue != null)
      ? (opts.externalBusValue & 0xff)
      : null;
    return ctx;
  }

  createOamDmaReadContext(addr, options = null) {
    const opts = options;
    const ctx = this._oamDmaReadContext;
    const a = addr & 0xffff;
    ctx.addr = a;
    ctx.cpuAddressBus = (opts && opts.cpuAddressBus != null)
      ? (opts.cpuAddressBus & 0xffff)
      : (this.timeline.lastCpuAddressBus & 0xffff);
    ctx.isPutCycle = (opts && opts.isPutCycle != null)
      ? !!opts.isPutCycle
      : !!this.timeline.lastCpuPutCycle;
    ctx.currentCycle = (opts && opts.currentCycle != null)
      ? (opts.currentCycle >>> 0)
      : (this._getBusCycleCounter() >>> 0);
    ctx.externalBusValue = (opts && opts.externalBusValue != null)
      ? (opts.externalBusValue & 0xff)
      : null;
    return ctx;
  }

  createDmcDmaReadContext(addr, options = null) {
    const opts = options;
    const ctx = this._dmcDmaReadContext;
    const a = addr & 0xffff;
    ctx.addr = a;
    ctx.cpuAddressBus = (opts && opts.cpuAddressBus != null)
      ? (opts.cpuAddressBus & 0xffff)
      : (this.timeline.lastCpuAddressBus & 0xffff);
    ctx.isPutCycle = (opts && opts.isPutCycle != null)
      ? !!opts.isPutCycle
      : !!this.timeline.lastCpuPutCycle;
    ctx.currentCycle = (opts && opts.currentCycle != null)
      ? (opts.currentCycle >>> 0)
      : (this._getBusCycleCounter() >>> 0);
    ctx.externalBusValue = (opts && opts.externalBusValue != null)
      ? (opts.externalBusValue & 0xff)
      : null;
    return ctx;
  }
}

const busArbiterExports = { BusArbiter };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = busArbiterExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreBusArbiter = busArbiterExports;
}
