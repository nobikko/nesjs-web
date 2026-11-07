// Unified CPU DMA arbiter for OAM DMA and DMC DMA.
// MiSTer-first implementation: the core control flow is driven by
// src/mister-dma-controller.js state transitions.
let MisterDmaControllerCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ MisterDmaController: MisterDmaControllerCore } = require('./mister-dma-controller'));
  } catch (_err) {
    MisterDmaControllerCore = null;
  }
}
if (!MisterDmaControllerCore && typeof globalThis !== 'undefined' && globalThis.NESCoreMisterDmaController) {
  MisterDmaControllerCore = globalThis.NESCoreMisterDmaController.MisterDmaController;
}
if (!MisterDmaControllerCore) {
  throw new Error('Mister DMA controller core not found');
}

let oamDmaPublishCpuExternalBusValueCore = null;
let oamDmaPublishCpuInternalBusValueCore = null;
if (typeof require !== 'undefined') {
  try {
    ({
      publishCpuExternalBusValue: oamDmaPublishCpuExternalBusValueCore,
      publishCpuInternalBusValue: oamDmaPublishCpuInternalBusValueCore,
    } = require('./cpu-bus-publication'));
  } catch (_err) {
    oamDmaPublishCpuExternalBusValueCore = null;
    oamDmaPublishCpuInternalBusValueCore = null;
  }
}
if (
  (!oamDmaPublishCpuExternalBusValueCore || !oamDmaPublishCpuInternalBusValueCore) &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCoreCpuBusPublication
) {
  oamDmaPublishCpuExternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuExternalBusValue;
  oamDmaPublishCpuInternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuInternalBusValue;
}
if (!oamDmaPublishCpuExternalBusValueCore || !oamDmaPublishCpuInternalBusValueCore) {
  throw new Error('CpuBusPublication core not found');
}

const OAM_DMA_ENGINE_OWNER_CPU = 0;
const OAM_DMA_ENGINE_OWNER_OAM_DMA = 1;
const OAM_DMA_ENGINE_OWNER_DMC_DMA = 2;

class OamDmaEngine {
  constructor(host) {
    this.host = host;
    this.mister = new MisterDmaControllerCore();
    this.state = host && host.cpuState ? host.cpuState.dma : {
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
    };
    this.lastMisterOutput = null;
    this.dmcReadArmed = false;
    this.shadowLastDmaData = 0;
    // Saved context from last onCpuCycleTick for late DMC trigger injection.
    this._lastTickDmcTrigger = false;
    this._apuDmaSignalsSnapshot = { trigger: false, addr: 0 };
    this.reset();
  }

  reset() {
    const state = this.state;
    state.pendingPage = null;
    state.oamWaitingStart = false;
    state.oamActive = false;
    state.oamPage = 0;
    state.oamOffset = 0;
    state.oamReadPending = false;
    state.oamReadValue = 0;
    state.dmcActive = false;
    state.lastCpuAddress = 0;
    state.recentRdyLowCycles = 0;
    state.cpuReadCycle = false;
    state.spriteTriggerPending = false;
    state.misterPauseCpu = false;
    state.misterSprState = 0;
    state.misterDmcState = 0;
    this.lastMisterOutput = null;
    this.dmcReadArmed = false;
    this.shadowLastDmaData = 0;
    this.mister.reset();
    this.captureApuDmaLatch();
    this._syncState();
  }

  request(page) {
    const p = page & 0xff;
    this.state.pendingPage = p;
    this.state.oamPage = p;
    this.state.oamOffset = 0;
    this.state.oamReadPending = false;
    this.state.oamReadValue = 0;
    this.state.spriteTriggerPending = true;
    this._syncState();
  }

  onExternalCpuBusCycle(affectRecentRdyLow = true) {
    if (affectRecentRdyLow && this.state.recentRdyLowCycles > 0) {
      this.state.recentRdyLowCycles -= 1;
    }
  }

  onCpuCycleTick(ctx) {
    const sig = ctx || {};
    if (typeof sig.putCe !== 'boolean' || typeof sig.getCe !== 'boolean') {
      throw new Error('DMA tick requires explicit putCe/getCe phase signals');
    }
    const putCe = !!sig.putCe;
    const getCe = !!sig.getCe;
    const ce = !!(putCe || getCe);
    const dmcTrigger = this._getLatchedDmcTrigger();
    const cpuRead = !!sig.cpuRead;
    const isPutCycle = !!sig.isPutCycle;
    // Save tick context for late DMC trigger injection.
    this._lastTickDmcTrigger = dmcTrigger;
    const out = this.mister.tick({
      ce,
      putCycle: isPutCycle,
      putCe,
      getCe,
      spriteTrigger: !!this.state.spriteTriggerPending,
      dmcTrigger,
      cpuRead,
      dataFromCpu: this.state.oamPage & 0xff,
      dmaDataToRam: this.shadowLastDmaData & 0xff,
      dmcDmaAddr: this._getLatchedDmcAddr(),
    });
    if (ce) {
      this.state.spriteTriggerPending = false;
    }
    this.lastMisterOutput = out;
    if (out.dmcAck) {
      this.dmcReadArmed = true;
    }
    this.state.misterSprState = out.sprState & 0x03;
    this.state.misterDmcState = out.dmcState & 0x01;
    this._syncState();
  }

  hadRecentRDYLow() {
    return this.state.recentRdyLowCycles > 0;
  }

  isCpuRdyLow() {
    // In MiSTer nes.v, T65 Rdy is wired as ~pause_cpu.
    return !!this.state.misterPauseCpu;
  }

  _publishExternalBusValue(value) {
    return oamDmaPublishCpuExternalBusValueCore(this.host, value & 0xff);
  }

  _publishInternalBusValue(value) {
    return oamDmaPublishCpuInternalBusValueCore(this.host, value & 0xff);
  }

  _readApuDmaSignalsCurrent() {
    const out = this._apuDmaSignalsSnapshot;
    if (!(this.host && this.host.apu)) {
      out.trigger = false;
      out.addr = 0;
      return out;
    }
    if (typeof this.host.apu.getDmcDmaSnapshot === 'function') {
      const snap = this.host.apu.getDmcDmaSnapshot();
      out.trigger = !!(snap && snap.trigger);
      out.addr = ((snap && snap.addr) == null ? 0 : snap.addr) & 0xffff;
      return out;
    }
    out.trigger = !!(
      this.host.apu.hasPendingDmcDma &&
      this.host.apu.hasPendingDmcDma()
    );
    out.addr = (this.host.apu.dmcCurrentAddress == null ? 0 : this.host.apu.dmcCurrentAddress) & 0xffff;
    return out;
  }

  captureApuDmaLatch() {
    const sig = this._readApuDmaSignalsCurrent();
    this.state.apuDmcTriggerLatched = !!sig.trigger;
    this.state.apuDmcAddrLatched = sig.addr & 0xffff;
  }

  // MiSTer RTL: dmc_trigger is a combinational wire from the APU to the DMA
  // controller.  In our sequential code the DMA controller ticks before the
  // APU, so it sees a stale (false) trigger.  After the APU tick + latch
  // capture, call this to retroactively apply the state transition that the
  // MiSTer DMA controller would have made if it had seen the trigger.
  lateApplyDmcTrigger() {
    // In MiSTer RTL, dmc_trigger is a combinational wire:
    //   pause_cpu = spr_state[0] || dmc_trigger || dmc_state[0]
    // Since JS ticks APU after DMA, the DMA controller computed pauseCpu with
    // a stale trigger value.  Retroactively correct pauseCpu when the trigger
    // changed in either direction:
    //   false→true: new DMA request appears (stall must begin immediately)
    //   true→false: DMA ack clears request (stall must end immediately)
    const newTrigger = this._getLatchedDmcTrigger();
    if (!!newTrigger === !!this._lastTickDmcTrigger) return;  // no change
    this._recomputePauseCpuWithTrigger(newTrigger);
  }

  _recomputePauseCpuWithTrigger(dmcTrigger) {
    const pauseCpu = this.mister.pauseCpu(dmcTrigger);
    if (this.lastMisterOutput) {
      this.lastMisterOutput.pauseCpu = pauseCpu;
    }
    this.state.misterPauseCpu = pauseCpu;
    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.pendingDmc = dmcTrigger || this.state.dmcActive;
    }
  }

  _getLatchedDmcTrigger() {
    return !!this.state.apuDmcTriggerLatched;
  }

  _getLatchedDmcAddr() {
    return this.state.apuDmcAddrLatched & 0xffff;
  }

  _computePauseCpuState() {
    const outPause = !!(this.lastMisterOutput && this.lastMisterOutput.pauseCpu);
    return !!outPause;
  }

  _syncState() {
    const state = this.state;
    const wasOamActive = !!state.oamActive;
    state.misterPauseCpu = this._computePauseCpuState();
    state.oamWaitingStart = this.state.misterSprState === 1;
    state.oamActive = (this.state.misterSprState & 0x02) !== 0;
    state.dmcActive = this.state.misterDmcState === 1;
    state.dmcPipelinePhase = 'mister';
    // RTL: the DMA controller's sprState transitions to 0 on the getCe that
    // reads the last byte.  The following putCe no longer has aoutEnable, so
    // the 256th $2004 write never fires.  Flush the pending byte here so that
    // all 256 bytes are transferred, matching real NES hardware.
    if (wasOamActive && !state.oamActive && state.oamReadPending) {
      this._performOamWrite(state.oamReadValue & 0xff);
    }
    if (!state.spriteTriggerPending && !state.oamWaitingStart && !state.oamActive) {
      state.pendingPage = null;
    }

    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.pendingDmc = this._getLatchedDmcTrigger() || state.dmcActive;
      this.host.cpuState.bus.pendingOam = state.pendingPage !== null || state.oamWaitingStart || state.oamActive;
    }
  }

  stopDmcTransfer() {
    this.mister.clearDmcState();
    this._syncState();
  }

  onCpuBusCycleStart(addr, isWrite, _busCycleCounter, _writeValue) {
    const state = this.state;
    state.lastCpuAddress = addr & 0xffff;
    state.cpuReadCycle = !isWrite;
    if (isWrite && (addr & 0xffff) === 0x4014) {
      this.request(_writeValue & 0xff);
    }
    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.address = state.lastCpuAddress;
      this.host.cpuState.bus.isWrite = !!isWrite;
    }
    this._syncState();
    return null;
  }

  _repeatCpuRead(busOps, contextHints = null) {
    const repeatRead = busOps && typeof busOps.repeatRead === 'function'
      ? busOps.repeatRead
      : ((addr, hints) => this.host.cpuRead(addr, this.host.busArbiter.createRdyRepeatReadContext(addr, hints)));
    const value = repeatRead(this.state.lastCpuAddress, contextHints || null);
    if (typeof value === 'number') {
      this.shadowLastDmaData = value & 0xff;
    }
  }

  _advanceDmaCycle(busOps) {
    const advanceBusCycle = busOps && typeof busOps.advanceBusCycle === 'function'
      ? busOps.advanceBusCycle
      : (() => {});
    advanceBusCycle();
    this.state.recentRdyLowCycles = 3;
  }

  _performDmcRead(addr, contextHints = null) {
    const readAddr = addr == null
      ? this._getLatchedDmcAddr()
      : (addr & 0xffff);
    if (!this.dmcReadArmed) {
      return false;
    }
    const acked = !!(
      this.host &&
      this.host.apu &&
      this.host.apu.ackDmcDma &&
      this.host.apu.ackDmcDma()
    );
    if (!acked) {
      this.dmcReadArmed = false;
      return false;
    }
    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.owner = OAM_DMA_ENGINE_OWNER_DMC_DMA;
      this.host.cpuState.bus.paused = true;
      this.host.cpuState.bus.address = readAddr;
      this.host.cpuState.bus.isWrite = false;
    }
    if (this.host && this.host.apu && this.host.apu.performDmcSampleFetch) {
      this.host.apu.performDmcSampleFetch(contextHints || null);
      this.shadowLastDmaData = this.host.apu.dmcLastFetchedByte & 0xff;
    }
    this.dmcReadArmed = false;
    return true;
  }

  _performOamRead(addr, contextHints = null) {
    const state = this.state;
    // Keep OAM DMA source progression tied to bytes actually committed to OAM
    // (offset), not transient controller address phases. Under DMC contention,
    // controller-side address phase can advance before the first valid read/write
    // pair; deriving from offset prevents 1-byte skew/rotation.
    const srcAddr = (((state.oamPage & 0xff) << 8) | (state.oamOffset & 0xff)) & 0xffff;
    if (state.oamReadPending) {
      // Read latch still holds an unread byte; drop speculative/extra read slots
      // and wait for the matching write slot.
      return false;
    }
    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.owner = OAM_DMA_ENGINE_OWNER_OAM_DMA;
      this.host.cpuState.bus.paused = true;
      this.host.cpuState.bus.address = srcAddr;
      this.host.cpuState.bus.isWrite = false;
    }
    state.oamReadValue = this.host.cpuRead(
      srcAddr,
      this.host.busArbiter.createOamDmaReadContext(srcAddr, contextHints || null)
    ) & 0xff;
    this.shadowLastDmaData = state.oamReadValue & 0xff;
    state.oamReadPending = true;
  }

  _performOamWrite(dataToRam) {
    const state = this.state;
    if (!state.oamReadPending) {
      // No valid OAM DMA read latch yet. Keep this as an alignment/dummy slot
      // instead of writing stale data into $2004.
      return false;
    }
    const value = state.oamReadValue & 0xff;
    const ppu = this.host.ppuState;
    if (this.host && this.host.cpuState) {
      this.host.cpuState.bus.owner = OAM_DMA_ENGINE_OWNER_OAM_DMA;
      this.host.cpuState.bus.paused = true;
      this.host.cpuState.bus.address = 0x2004;
      this.host.cpuState.bus.isWrite = true;
    }
    this._publishInternalBusValue(value);
    if (
      this.host &&
      this.host.ppuSpritePipeline &&
      typeof this.host.ppuSpritePipeline.writeOamData === 'function'
    ) {
      // Route DMA writes through the same $2004 path used by CPU writes so
      // rendering-time OAM corruption behavior has a single owner.
      this.host.ppuSpritePipeline.writeOamData(value);
    } else {
      ppu.oamPrimary[(ppu.oamAddr + state.oamOffset) & 0xff] = value;
      ppu.oamAddr = (ppu.oamAddr + 1) & 0xff;
    }
    state.oamReadValue = value;
    state.oamReadPending = false;
    state.oamOffset = (state.oamOffset + 1) & 0xff;
    this.shadowLastDmaData = value;
    this._publishExternalBusValue(value & 0xff);
    return true;
  }

  _selectStallAction(out) {
    if (!out || !out.aoutEnable) {
      return { kind: 'repeat_cpu_read' };
    }
    if (!!out.read) {
      if (!!out.dmcAck) {
        return { kind: 'dmc_read', addr: out.aout & 0xffff };
      }
      return { kind: 'oam_read', addr: out.aout & 0xffff };
    }
    return { kind: 'oam_write', value: out.dataToRam & 0xff };
  }

  _publishBusStateForStall(out) {
    if (!(this.host && this.host.cpuState)) return;
    const bus = this.host.cpuState.bus;
    bus.paused = true;
    if (out && out.dmcAck) bus.owner = OAM_DMA_ENGINE_OWNER_DMC_DMA;
    else if (out && out.aoutEnable) bus.owner = OAM_DMA_ENGINE_OWNER_OAM_DMA;
    else bus.owner = OAM_DMA_ENGINE_OWNER_CPU;
    bus.address = (out && out.aoutEnable)
      ? (out.aout & 0xffff)
      : (this.state.lastCpuAddress & 0xffff);
    bus.isWrite = !!(out && out.aoutEnable && !out.read);
    bus.openBusReadValue = null;
  }

  _executeStallAction(action, busOps, contextHints = null) {
    const act = action || { kind: 'repeat_cpu_read' };
    if (act.kind === 'dmc_read') {
      if (!this._performDmcRead(act.addr & 0xffff, contextHints || null)) {
        this._repeatCpuRead(busOps, contextHints || null);
      }
      return;
    }
    if (act.kind === 'oam_read') {
      this._performOamRead(act.addr & 0xffff, contextHints || null);
      return;
    }
    if (act.kind === 'oam_write') {
      this._performOamWrite(act.value & 0xff);
      return;
    }
    this._repeatCpuRead(busOps, contextHints || null);
  }

  _apuIoSideEffectsAlreadyHandledByCpuRead(action, cpuAddressBus) {
    if (!this.state.cpuReadCycle) return false;
    if (!action) return false;
    const apuCs = (cpuAddressBus & 0xffe0) === 0x4000;
    if (!apuCs) return false;
    if (action.kind === 'repeat_cpu_read') {
      const regSelCpu = cpuAddressBus & 0x1f;
      return regSelCpu === 0x15 || regSelCpu === 0x16 || regSelCpu === 0x17;
    }
    if (action.kind === 'oam_read') {
      const regSel = (action.addr & 0xffff) & 0x1f;
      return regSel === 0x15 || regSel === 0x16 || regSel === 0x17;
    }
    return false;
  }

  _applyControllerClockSideEffects(out, action, contextHints = null) {
    if (!(this.host && this.host.controllers)) return;
    if (!this.state.cpuReadCycle) return;
    const controllers = this.host.controllers;
    const cpuAddressBus = this.state.lastCpuAddress & 0xffff;
    const apuCs = (cpuAddressBus & 0xffe0) === 0x4000;
    if (!apuCs) return;

    if (this._apuIoSideEffectsAlreadyHandledByCpuRead(action, cpuAddressBus)) {
      // Read-side APU/IO effects are applied by IoRegisterMap read handlers.
      return;
    }

    const dmaAoutEnabled = !!(out && out.aoutEnable);
    const effectiveAddr = dmaAoutEnabled
      ? (out.aout & 0xffff)
      : cpuAddressBus;
    const regSel = effectiveAddr & 0x1f;
    const ctx = contextHints || null;
    if (
      regSel === 0x15 &&
      this.host &&
      this.host.apu &&
      typeof this.host.apu.read4015 === 'function'
    ) {
      const externalBus = this.host.cpuState
        ? (this.host.cpuState.openBus & 0xff)
        : 0;
      this.host.apu.read4015(externalBus, ctx && ctx.isPutCycle != null ? !!ctx.isPutCycle : false);
      return;
    }
    if (regSel === 0x16 && typeof controllers.pulseClock4016 === 'function') {
      controllers.pulseClock4016(ctx);
      return;
    }
    if (regSel === 0x17 && typeof controllers.pulseClock4017 === 'function') {
      controllers.pulseClock4017(ctx);
    }
  }

  _contextHintsForCurrentStall(out) {
    if (!(this.host && this.host.cpuState)) {
      return null;
    }
    return {
      isPutCycle: out ? !out.read : null,
      currentCycle: this.host.cpuState.busCycleCounter >>> 0,
    };
  }

  consumeCpuRDYStallCycle(busOps) {
    // Stall entry is governed by the latest MiSTer controller output.
    if (!this.state.misterPauseCpu) {
      this.dmcReadArmed = false;
      this._syncState();
      return false;
    }

    const out = this.lastMisterOutput;
    if (!out) {
      this._publishBusStateForStall(null);
      this._executeStallAction({ kind: 'repeat_cpu_read' }, busOps, this._contextHintsForCurrentStall(null));
      this._advanceDmaCycle(busOps);
      this._syncState();
      return true;
    }

    this._publishBusStateForStall(out);

    const action = this._selectStallAction(out);
    const contextHints = this._contextHintsForCurrentStall(out);
    this._executeStallAction(action, busOps, contextHints);
    this._applyControllerClockSideEffects(out, action, contextHints);

    this._advanceDmaCycle(busOps);
    this._syncState();
    return true;
  }

}

const oamDmaEngineExports = { OamDmaEngine };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = oamDmaEngineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreOamDmaEngine = oamDmaEngineExports;
}
