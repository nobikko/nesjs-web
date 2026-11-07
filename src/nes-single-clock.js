function resolveCore(requirePath, globalNamespace, exportName, label) {
  let resolved = null;
  if (typeof require !== 'undefined') {
    try {
      const mod = require(requirePath);
      resolved = mod && mod[exportName];
    } catch (_err) {
      resolved = null;
    }
  }
  if (!resolved && typeof globalThis !== 'undefined' && globalThis[globalNamespace]) {
    resolved = globalThis[globalNamespace][exportName];
  }
  if (!resolved) {
    throw new Error(`${label} core not found`);
  }
  return resolved;
}

const CpuRuntimeStateCore = resolveCore('./cpu-runtime-state', 'NESCoreCpuRuntimeState', 'CpuRuntimeState', 'CpuRuntimeState');
const CPU6502Core = resolveCore('./cpu6502', 'NESCoreCPU6502', 'CPU6502', 'CPU6502');
const ControllerBusCore = resolveCore('./controller-bus', 'NESCoreControllerBus', 'ControllerBus', 'ControllerBus');
const ApuFrameSequencerCore = resolveCore('./apu-frame-sequencer', 'NESCoreApuFrameSequencer', 'ApuFrameSequencer', 'ApuFrameSequencer');
const ApuDomainCore = resolveCore('./apu-domain', 'NESCoreApuDomain', 'ApuDomain', 'ApuDomain');
const OamDmaEngineCore = resolveCore('./oam-dma-engine', 'NESCoreOamDmaEngine', 'OamDmaEngine', 'OamDmaEngine');
const BusArbiterCore = resolveCore('./bus-arbiter', 'NESCoreBusArbiter', 'BusArbiter', 'BusArbiter');
const CpuMemoryMapCore = resolveCore('./cpu-memory-map', 'NESCoreCpuMemoryMap', 'CpuMemoryMap', 'CpuMemoryMap');
const PpuAddressSpaceCore = resolveCore('./ppu-address-space', 'NESCorePpuAddressSpace', 'PpuAddressSpace', 'PpuAddressSpace');
const PpuTimingStateCore = resolveCore('./ppu-timing-state', 'NESCorePpuTimingState', 'PpuTimingState', 'PpuTimingState');
const PpuAddressSequencerCore = resolveCore('./ppu-address-sequencer', 'NESCorePpuAddressSequencer', 'PpuAddressSequencer', 'PpuAddressSequencer');
const PpuIoPipelineCore = resolveCore('./ppu-io-pipeline', 'NESCorePpuIoPipeline', 'PpuIoPipeline', 'PpuIoPipeline');
const PpuBackgroundPipelineCore = resolveCore('./ppu-background-pipeline', 'NESCorePpuBackgroundPipeline', 'PpuBackgroundPipeline', 'PpuBackgroundPipeline');
const PpuSpritePipelineCore = resolveCore('./ppu-sprite-pipeline', 'NESCorePpuSpritePipeline', 'PpuSpritePipeline', 'PpuSpritePipeline');
const PpuDotEngineCore = resolveCore('./ppu-dot-engine', 'NESCorePpuDotEngine', 'PpuDotEngine', 'PpuDotEngine');
const MasterClockDomainCore = resolveCore('./master-clock-domain', 'NESCoreMasterClock', 'MasterClockDomain', 'MasterClockDomain');
const ExecutionKernelCore = resolveCore('./execution-kernel', 'NESCoreExecutionKernel', 'ExecutionKernel', 'ExecutionKernel');
const createMapperCore = resolveCore('./mapper-core', 'NESCoreMapper', 'createMapper', 'Mapper');
const MapperBaseCore = resolveCore('./mapper-base', 'NESCoreMapperBase', 'MapperBase', 'MapperBase');
const NES_SINGLE_CLOCK_OWNER_CPU = 0;
const NES_POWER_ON_CPU_HOLD_CYCLES = 29780;
const NES_DEFAULT_ENABLE_POWER_ON_CPU_HOLD = false;

let InterruptControllerCore = null;
let irqLineApuCore = 0x01;
let irqLineExternalCore = 0x02;
if (typeof require !== 'undefined') {
  try {
    ({
      InterruptController: InterruptControllerCore,
      IRQ_LINE_APU: irqLineApuCore,
      IRQ_LINE_EXTERNAL: irqLineExternalCore,
    } = require('./interrupt-controller'));
  } catch (_err) {
    InterruptControllerCore = null;
  }
}
if (!InterruptControllerCore && typeof globalThis !== 'undefined' && globalThis.NESCoreInterruptController) {
  InterruptControllerCore = globalThis.NESCoreInterruptController.InterruptController;
  irqLineApuCore = globalThis.NESCoreInterruptController.IRQ_LINE_APU;
  irqLineExternalCore = globalThis.NESCoreInterruptController.IRQ_LINE_EXTERNAL;
}
if (!InterruptControllerCore) {
  throw new Error('InterruptController core not found');
}

function normalizeCartridge(input) {
  const src = input || {};
  const mapper = (typeof src.mapper === 'number') ? (src.mapper & 0xffff) : 0;
  const mirroring = src.mirroring || 'horizontal';
  const prgSource = src.prgRom || src.prg || new Uint8Array(0x4000);
  const chrSource = src.chrRom || src.chr || null;
  const prgRom = (prgSource instanceof Uint8Array)
    ? new Uint8Array(prgSource)
    : new Uint8Array(prgSource || []);
  let chrBanks;
  let chrRom;
  if (typeof src.chrBanks === 'number') {
    chrBanks = src.chrBanks | 0;
  } else if (src.chrRom || src.chr) {
    chrBanks = Math.max(1, ((chrSource.length / 0x2000) | 0));
  } else {
    chrBanks = 0;
  }
  if (chrSource) {
    chrRom = (chrSource instanceof Uint8Array)
      ? new Uint8Array(chrSource)
      : new Uint8Array(chrSource);
  } else {
    chrRom = new Uint8Array(0x2000);
  }
  if (chrBanks <= 0 && chrRom.length < 0x2000) {
    const chrRam = new Uint8Array(0x2000);
    chrRam.set(chrRom.subarray(0, Math.min(chrRom.length, 0x2000)));
    chrRom = chrRam;
  }
  const prgBanks = (typeof src.prgBanks === 'number')
    ? (src.prgBanks | 0)
    : Math.max(1, ((prgRom.length / 0x4000) | 0));

  return {
    ...src,
    mapper,
    mirroring,
    prgBanks,
    chrBanks: chrBanks <= 0 ? 0 : chrBanks,
    prgRom,
    chrRom,
    prg: prgRom,
    chr: chrRom,
    mapperOptions: src.mapperOptions || {},
  };
}

class NES {
  constructor(cartridge) {
    this.cartridge = normalizeCartridge(cartridge);
    this.mapper = createMapperCore(this.cartridge);
    this.mapperHooks = this._resolveMapperHooks(this.mapper);
    if (typeof this.mapper.chrBank !== 'number') {
      this.mapper.chrBank = 0;
    }

    this.ram = new Uint8Array(0x800);
    this.vram = new Uint8Array(0x1000);
    this.palette = new Uint8Array(0x20);

    this.cpuState = new CpuRuntimeStateCore();
    this.ppuState = new PpuTimingStateCore();
    this.controllers = new ControllerBusCore(this);
    this.interrupts = new InterruptControllerCore(this);
    this.apu = new ApuDomainCore(this, ApuFrameSequencerCore);
    this.oamDma = new OamDmaEngineCore(this);
    this.busArbiter = new BusArbiterCore(this);
    this.cpuMemory = new CpuMemoryMapCore(this);
    this.ppuAddressSpace = new PpuAddressSpaceCore(this);
    this.ppuAddressSequencer = new PpuAddressSequencerCore(this);
    this.ppuIoPipeline = new PpuIoPipelineCore(this);
    this.ppuBackgroundPipeline = new PpuBackgroundPipelineCore(this);
    this.ppuSpritePipeline = new PpuSpritePipelineCore(this);
    this.ppuDotEngine = new PpuDotEngineCore(this);
    this.clock = new MasterClockDomainCore(this);
    this.cpu = new CPU6502Core(this);
    this.execution = new ExecutionKernelCore(this);
    this._cpuServiceLinesSnapshot = { nmi: false, irq: false };
    this._cpuPollLinesSnapshot = { nmi: false, irq: false };
    this.frontendAdapters = [];
    // Performance defaults: phase callbacks only on CPU CE edges.
    this.onCpuPhaseTickEveryHalf = true;
    this.performanceFastMode = false;
    this._fastDirectDomains = true;
    // Skip per-master callback object dispatch when mapper does not override
    // master-clock/cart-ce hooks.
    this.useInlineMasterClockTick = !(this.mapperHooks && (
      this.mapperHooks.onMasterClockTick || this.mapperHooks.onCartCe
    ));
    this._runtimeHooks = null;
    this._refreshRuntimeHooks();
    this._coldBootPending = true;
    this._enablePowerOnCpuHold = !!(
      this.cartridge &&
      (this.cartridge.enablePowerOnCpuHold || this.cartridge.powerOnCpuHold)
    );

    this.state = {
      cpu: this.cpuState,
      ppu: this.ppuState,
      dma: this.cpuState.dma,
      bus: this.cpuState.bus,
      interrupt: this.cpuState.interrupts,
      phase: this.cpuState.phase,
      clock: {
        master: 0,
        sub: 0,
      },
      apu: this.apu,
    };

    this.reset();
  }

  _syncStateClock() {
    this.state.clock.master = this.clock.masterClock >>> 0;
    this.state.clock.sub = this.clock.subClock >>> 0;
  }

  _refreshRuntimeHooks() {
    const mapper = this.mapper;
    const mapperHooks = this.mapperHooks || {};
    const controllers = this.controllers;
    const busArbiter = this.busArbiter;
    const apu = this.apu;
    const interrupts = this.interrupts;
    const oamDma = this.oamDma;
    this._runtimeHooks = {
      controllers,
      controllersOnCpuPhaseTickFn: (
        controllers && typeof controllers.onCpuPhaseTick === 'function'
      ) ? controllers.onCpuPhaseTick.bind(controllers) : null,
      mapperOnCpuPhaseTickFn: (
        mapper &&
        mapperHooks.onCpuPhaseTick &&
        typeof mapper.onCpuPhaseTick === 'function'
      ) ? mapper.onCpuPhaseTick.bind(mapper) : null,
      busArbiterOnCpuCePhaseTickFn: (
        busArbiter && typeof busArbiter.onCpuCePhaseTick === 'function'
      ) ? busArbiter.onCpuCePhaseTick.bind(busArbiter) : null,
      busArbiterOnCpuPhaseTickFn: (
        busArbiter && typeof busArbiter.onCpuPhaseTick === 'function'
      ) ? busArbiter.onCpuPhaseTick.bind(busArbiter) : null,
      interruptsSampleCpuHalfPhaseFn: (
        interrupts && typeof interrupts.sampleCpuHalfPhase === 'function'
      ) ? interrupts.sampleCpuHalfPhase.bind(interrupts) : null,
      apuOnCpuPhaseTickFn: (
        apu && typeof apu.onCpuPhaseTick === 'function'
      ) ? apu.onCpuPhaseTick.bind(apu) : null,
      oamCaptureApuDmaLatchFn: (
        oamDma && typeof oamDma.captureApuDmaLatch === 'function'
      ) ? oamDma.captureApuDmaLatch.bind(oamDma) : null,
      oamLateApplyDmcTriggerFn: (
        oamDma && typeof oamDma.lateApplyDmcTrigger === 'function'
      ) ? oamDma.lateApplyDmcTrigger.bind(oamDma) : null,
      mapperOnMasterClockTickFn: (
        mapper &&
        mapperHooks.onMasterClockTick &&
        typeof mapper.onMasterClockTick === 'function'
      ) ? mapper.onMasterClockTick.bind(mapper) : null,
      mapperOnCartCeFn: (
        mapper &&
        mapperHooks.onCartCe &&
        typeof mapper.onCartCe === 'function'
      ) ? mapper.onCartCe.bind(mapper) : null,
    };
  }

  _resolveMapperHooks(mapper) {
    if (!mapper) {
      return {
        onCpuPhaseTick: false,
        onMasterClockTick: false,
        onCartCe: false,
        onPpuDotTick: false,
        onCpuBusAccess: false,
        onPpuAddressBus: false,
        onPpuAddressBusDirectPattern: false,
      };
    }
    const baseProto = MapperBaseCore && MapperBaseCore.prototype ? MapperBaseCore.prototype : null;
    const hasOverride = (name) => {
      if (!mapper || typeof mapper[name] !== 'function') return false;
      if (!baseProto || typeof baseProto[name] !== 'function') return true;
      return mapper[name] !== baseProto[name];
    };
    const hasPpuAddressBusOverride = hasOverride('onPpuAddressBus');
    const hasQualifiedA12RiseOverride = hasOverride('onQualifiedA12Rise');
    const needsPpuAddressBus = hasPpuAddressBusOverride || hasQualifiedA12RiseOverride;
    const canUseDirectPatternBus = !!(
      needsPpuAddressBus &&
      !hasPpuAddressBusOverride &&
      typeof mapper.onPpuAddressBusPattern === 'function'
    );
    return {
      onCpuPhaseTick: hasOverride('onCpuPhaseTick'),
      onMasterClockTick: hasOverride('onMasterClockTick'),
      onCartCe: hasOverride('onCartCe'),
      onPpuDotTick: hasOverride('onPpuDotTick'),
      onCpuBusAccess: hasOverride('onCpuBusAccess'),
      onPpuAddressBus: needsPpuAddressBus,
      onPpuAddressBusDirectPattern: canUseDirectPatternBus,
      // A12 edge qualification depends on observing low phases as well, which
      // includes non-pattern PPU bus traffic ($2000-$3FFF). Do not enable the
      // pattern-only shortcut here.
      onPpuAddressBusPatternOnly: false,
    };
  }

  _captureIrqLinesFromSources() {
    if (!this.cpuState || !this.cpuState.interrupts) return;
    const irq = this.cpuState.interrupts;
    irq.apuIrqLatched = !!(this.apu && this.apu.isIrqAsserted && this.apu.isIrqAsserted());
    irq.externalIrqLatched = !!(this.mapper && this.mapper.isIrqAsserted && this.mapper.isIrqAsserted());
  }

  _syncIrqLines() {
    const irq = this.cpuState && this.cpuState.interrupts ? this.cpuState.interrupts : null;
    const apuIrq = !!(irq && irq.apuIrqLatched);
    const mapperIrq = !!(irq && irq.externalIrqLatched);
    this.interrupts.setIrqLine(irqLineApuCore, apuIrq);
    this.interrupts.setIrqLine(irqLineExternalCore, mapperIrq);
  }

  _isControllerPutCycle() {
    if (this.busArbiter && this.busArbiter.isControllerPutCycle) {
      try {
        return !!this.busArbiter.isControllerPutCycle();
      } catch (_err) {
        const phase = this.cpuState && this.cpuState.phase ? this.cpuState.phase : null;
        if (phase && typeof phase.getOrPut === 'boolean') {
          return !phase.getOrPut;
        }
        return !!(phase && phase.putCycle);
      }
    }
    const phase = this.cpuState && this.cpuState.phase ? this.cpuState.phase : null;
    if (phase && typeof phase.getOrPut === 'boolean') {
      return !phase.getOrPut;
    }
    return !!(phase && phase.putCycle);
  }

  refreshPpuIoBus(value, bitMask = 0xff) {
    const mask = bitMask & 0xff;
    if (mask === 0) return;
    const IO_BUS_DECAY_CPU_CYCLES = 1100000;
    const ppu = this.ppuState;
    ppu.ioBus = ((ppu.ioBus & (~mask & 0xff)) | (value & mask)) & 0xff;
    if ((mask & 0xe0) !== 0) {
      ppu.ioBusDecayHighCpu = IO_BUS_DECAY_CPU_CYCLES;
    }
    if ((mask & 0x1f) !== 0) {
      ppu.ioBusDecayLowCpu = IO_BUS_DECAY_CPU_CYCLES;
    }
    ppu.ioBusDecayCpu = Math.max(ppu.ioBusDecayHighCpu | 0, ppu.ioBusDecayLowCpu | 0);
  }

  queuePpu2007Read() {
    this.ppuIoPipeline.queue2007Read();
  }

  queuePpu2007Write() {
    this.ppuIoPipeline.queue2007Write();
  }

  _incrementPpuCoarseX() {
    this.ppuAddressSequencer.incrementCoarseX();
  }

  _incrementPpuY() {
    this.ppuAddressSequencer.incrementY();
  }

  _renderingAccessInProgress() {
    return this.ppuAddressSequencer.isRenderingAccessInProgress();
  }

  incrementPpuVAfterDataAccess() {
    this.ppuAddressSequencer.incrementVAfterDataAccess();
  }

  _latchPpuBusAddress(addr14) {
    this.ppuIoPipeline.latchBusAddress(addr14 & 0x3fff);
  }

  _resolveLatchedPpuBusAddress(addr14) {
    return this.ppuIoPipeline.resolveLatchedBusAddress(addr14 & 0x3fff);
  }

  ppuReadWithAle(addr, accessMeta = null) {
    return this.ppuIoPipeline.ppuReadWithAle(addr & 0x3fff, accessMeta);
  }

  ppuWriteWithAle(addr, value, accessMeta = null) {
    this.ppuIoPipeline.ppuWriteWithAle(addr & 0x3fff, value & 0xff, accessMeta);
  }

  incrementPpuCoarseX() {
    this._incrementPpuCoarseX();
  }

  incrementPpuY() {
    this._incrementPpuY();
  }

  copyPpuHorizontalBits() {
    this.ppuAddressSequencer.copyHorizontalBits();
  }

  copyPpuVerticalBits() {
    this.ppuAddressSequencer.copyVerticalBits();
  }

  clockPpuTimingState() {
    this.ppuIoPipeline.clockTimingState();
  }

  _processPpu2007DelayedOps() {
    this.ppuIoPipeline.process2007DelayedOps();
  }

  advancePpuIoBusDecay(cpuCycles) {
    this.ppuIoPipeline.advanceCpuIoBusDecay(cpuCycles | 0);
  }

  isPpuRenderingEnabled() {
    return (this.ppuState.mask & 0x18) !== 0;
  }

  isPpuRenderingEnabledLatched() {
    const ppu = this.ppuState;
    if (ppu && typeof ppu.renderEnableShift === 'number') {
      return (ppu.renderEnableShift & 0x02) !== 0;
    }
    return this.isPpuRenderingEnabled();
  }

  isPpuRenderingEnabledDelayed() {
    const ppu = this.ppuState;
    if (ppu && typeof ppu.renderEnableShift === 'number') {
      return (ppu.renderEnableShift & 0x04) !== 0;
    }
    return this.isPpuRenderingEnabledLatched();
  }

  isPpuBgEnabledLatched() {
    const ppu = this.ppuState;
    if (ppu && typeof ppu.bgEnableShift === 'number') {
      return (ppu.bgEnableShift & 0x02) !== 0;
    }
    return (this.ppuState.mask & 0x08) !== 0;
  }

  isPpuObjEnabledLatched() {
    const ppu = this.ppuState;
    if (ppu && typeof ppu.objEnableShift === 'number') {
      return (ppu.objEnableShift & 0x02) !== 0;
    }
    return (this.ppuState.mask & 0x10) !== 0;
  }

  reset() {
    if (this._coldBootPending) {
      // Power-on state is not all-zero on real hardware; many titles expect
      // RAM garbage/non-zero bytes during early boot.
      this.ram.fill(0xff);
      this.vram.fill(0);
      this.palette.fill(0);
      this.palette[0] = 0x0f;
    }

    this.cpuState.reset();
    this.ppuState.reset();
    this.controllers.reset();
    this.interrupts.reset();
    this.apu.reset();
    this.oamDma.reset();
    this.busArbiter.reset();
    this.ppuBackgroundPipeline.reset();
    this.ppuSpritePipeline.reset();
    this.clock.reset();
    if (this.mapper && typeof this.mapper.reset === 'function') {
      this.mapper.reset();
    }

    this.interrupts.setPpuNmiOutput((this.ppuState.ctrl & 0x80) !== 0);
    this._captureIrqLinesFromSources();
    this._syncIrqLines();
    this.cpu.reset();
    if (this.execution && typeof this.execution.setCpuPowerOnHoldCycles === 'function') {
      const holdCycles = (
        this._coldBootPending &&
        (this._enablePowerOnCpuHold || NES_DEFAULT_ENABLE_POWER_ON_CPU_HOLD)
      ) ? NES_POWER_ON_CPU_HOLD_CYCLES : 0;
      this.execution.setCpuPowerOnHoldCycles(holdCycles);
    }
    this._coldBootPending = false;
    this._syncStateClock();
    this._notifyFrontendAdapters('onReset');
  }

  registerFrontendAdapter(adapter) {
    if (!adapter || this.frontendAdapters.includes(adapter)) return;
    this.frontendAdapters.push(adapter);
    if (typeof adapter.onAttach === 'function') {
      adapter.onAttach(this);
    }
  }

  unregisterFrontendAdapter(adapter) {
    const index = this.frontendAdapters.indexOf(adapter);
    if (index < 0) return;
    const removed = this.frontendAdapters.splice(index, 1)[0];
    if (removed && typeof removed.onDetach === 'function') {
      removed.onDetach(this);
    }
  }

  _notifyFrontendAdapters(method, ...args) {
    if (!this.frontendAdapters || this.frontendAdapters.length === 0) return;
    for (const adapter of this.frontendAdapters) {
      if (!adapter || typeof adapter[method] !== 'function') continue;
      adapter[method](this, ...args);
    }
  }

  publishCpuExternalBusValue(value) {
    const v = value & 0xff;
    this.cpuState.openBus = v;
    if (this.cpuState && this.cpuState.bus) {
      this.cpuState.bus.openBusData = v;
      this.cpuState.bus.openBusReadValue = v;
      this.cpuState.bus.externalDataBus = v;
      this.cpuState.bus.externalBusValue = v;
    }
    return v;
  }

  publishCpuInternalBusValue(value) {
    const v = value & 0xff;
    this.cpuState.openBus = v;
    if (this.cpuState && this.cpuState.bus) {
      this.cpuState.bus.openBusData = v;
      this.cpuState.bus.internalBusValue = v;
    }
    return v;
  }

  setController1(buttons) {
    this.controllers.setController1(buttons || {});
  }

  cpuRead(addr, context) {
    return this.cpuMemory.read(addr & 0xffff, context) & 0xff;
  }

  cpuWrite(addr, value, context) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    this.cpuMemory.write(a, v, context);
    this._notifyFrontendAdapters('onCpuWrite', a, v, context || null);
  }

  ppuRead(addr, accessMeta = null) {
    return this.ppuAddressSpace.read(addr & 0x3fff, accessMeta) & 0xff;
  }

  ppuWrite(addr, value, accessMeta = null) {
    this.ppuAddressSpace.write(addr & 0x3fff, value & 0xff, accessMeta);
  }

  mirrorNametableAddr(addr) {
    return this.ppuAddressSpace.mirrorNametableAddr(addr & 0x3fff) & 0x0fff;
  }

  onCpuPhaseTick(phase) {
    const hooks = this._runtimeHooks || (this._refreshRuntimeHooks(), this._runtimeHooks);
    const cpuCe = !!(phase && phase.cpuCe);
    const controllers = hooks.controllers;
    if (cpuCe && controllers && controllers.pendingOutputWrite && hooks.controllersOnCpuPhaseTickFn) {
      hooks.controllersOnCpuPhaseTickFn(phase);
    }
    if (hooks.mapperOnCpuPhaseTickFn) {
      hooks.mapperOnCpuPhaseTickFn(phase);
    }
    // Original order: DMA → IRQ → APU → latch.
    // MiSTer RTL: APU DMC request (dmc_trigger) is a combinational signal —
    // the DMA controller sees it on the same clock edge the APU asserts it.
    // In our sequential JS code the APU ticks AFTER the DMA controller, so
    // the DMA controller would see the trigger one cpuCe late (via the latch).
    // Fix: after the APU tick reveals a new trigger, retroactively apply the
    // MiSTer combinational state transition on the DMA controller.
    if (cpuCe) {
      if (hooks.busArbiterOnCpuCePhaseTickFn) {
        hooks.busArbiterOnCpuCePhaseTickFn(phase);
      } else if (hooks.busArbiterOnCpuPhaseTickFn) {
        hooks.busArbiterOnCpuPhaseTickFn(phase);
      }
    }
    this._syncIrqLines();
    const interrupts = this.interrupts;
    const cpu = this.cpu;
    const iFlag = !!(cpu && cpu.interruptIFlag);
    if (hooks.interruptsSampleCpuHalfPhaseFn) {
      hooks.interruptsSampleCpuHalfPhaseFn(phase, iFlag);
    } else {
      interrupts.sampleCpuPhase(iFlag, cpuCe);
    }
    if (hooks.apuOnCpuPhaseTickFn) {
      hooks.apuOnCpuPhaseTickFn(phase);
    }
    if (hooks.oamCaptureApuDmaLatchFn) {
      hooks.oamCaptureApuDmaLatchFn();
    }
    // Late injection: if APU tick just asserted dmcRequestPending, retroactively
    // update the DMA controller state that was computed with the stale (false)
    // trigger.  This models the MiSTer combinational dmc_trigger wire.
    if (hooks.oamLateApplyDmcTriggerFn) {
      hooks.oamLateApplyDmcTriggerFn();
    }
    this._captureIrqLinesFromSources();
    if (cpuCe) {
      this._syncStateClock();
    }
  }

  onMasterClockTick(tick) {
    if (tick && ((tick.subClock % 12) === 8)) {
      const ppu = this.ppuState;
      const currentCycle = (this.cpuState && typeof this.cpuState.busCycleCounter === 'number')
        ? (this.cpuState.busCycleCounter >>> 0)
        : 0;
      if (
        ppu &&
        ppu.statusReadMidValid === true &&
        ppu.statusReadMidCaptured !== true &&
        ((ppu.statusReadMidCycle >>> 0) === currentCycle)
      ) {
        // $2002 sprite flags are sampled near M2-low, after the first PPU tick
        // of the CPU bus cycle and before the second one.
        ppu.statusReadMidFlags = ppu.status & 0x60;
        ppu.statusReadMidCaptured = true;
      }
    }
    if (tick && !tick.cpuCe && this.cpuState && this.cpuState.bus) {
      const bus = this.cpuState.bus;
      const owner = bus.owner;
      const dmaOwnsBus = !!bus.paused || (owner !== NES_SINGLE_CLOCK_OWNER_CPU && owner !== 'cpu');
      if (dmaOwnsBus) {
        const readSource = (bus.openBusReadValue == null)
          ? (bus.externalDataBus == null ? (bus.externalBusValue & 0xff) : (bus.externalDataBus & 0xff))
          : (bus.openBusReadValue & 0xff);
        const nextOpenBusData = bus.isWrite
          ? (bus.internalBusValue & 0xff)
          : readSource;
        bus.openBusData = nextOpenBusData & 0xff;
        this.cpuState.openBus = bus.openBusData & 0xff;
      }
      if (bus.openBusReadValue != null) {
        bus.openBusReadValue = null;
      }
    }
    const hooks = this._runtimeHooks || (this._refreshRuntimeHooks(), this._runtimeHooks);
    if (hooks.mapperOnMasterClockTickFn) {
      hooks.mapperOnMasterClockTickFn(tick);
    }
    if (tick && tick.cartCe && hooks.mapperOnCartCeFn) {
      hooks.mapperOnCartCeFn(tick);
    }
  }

  onMasterClockTickInline(subClock, cpuCe) {
    const sub = subClock | 0;
    const cpuState = this.cpuState;
    if (sub === 8) {
      const ppu = this.ppuState;
      const currentCycle = (cpuState && typeof cpuState.busCycleCounter === 'number')
        ? (cpuState.busCycleCounter >>> 0)
        : 0;
      if (
        ppu &&
        ppu.statusReadMidValid === true &&
        ppu.statusReadMidCaptured !== true &&
        ((ppu.statusReadMidCycle >>> 0) === currentCycle)
      ) {
        ppu.statusReadMidFlags = ppu.status & 0x60;
        ppu.statusReadMidCaptured = true;
      }
    }
    if (!cpuCe) {
      const bus = cpuState.bus;
      const openBusReadValue = bus.openBusReadValue;
      const owner = bus.owner;
      const cpuOwnsBus = !bus.paused && (owner === NES_SINGLE_CLOCK_OWNER_CPU || owner === 'cpu');
      if (openBusReadValue == null && cpuOwnsBus) {
        return;
      }
      if (!cpuOwnsBus) {
        const readSource = (openBusReadValue == null)
          ? (bus.externalDataBus == null ? (bus.externalBusValue & 0xff) : (bus.externalDataBus & 0xff))
          : (openBusReadValue & 0xff);
        const nextOpenBusData = bus.isWrite
          ? (bus.internalBusValue & 0xff)
          : readSource;
        bus.openBusData = nextOpenBusData & 0xff;
        cpuState.openBus = bus.openBusData & 0xff;
      }
      if (openBusReadValue != null) {
        bus.openBusReadValue = null;
      }
    }
  }

  isNmiPending() {
    return this.interrupts.isNmiPending();
  }

  isIrqAsserted() {
    return this.interrupts.isIrqAsserted();
  }

  shouldServiceNmi() {
    return this.interrupts.shouldServiceNmi();
  }

  shouldServiceIrq() {
    return this.interrupts.shouldServiceIrq();
  }

  peekCpuServiceLines() {
    const out = this._cpuServiceLinesSnapshot;
    if (this.interrupts && typeof this.interrupts.snapshotForCpu === 'function') {
      return this.interrupts.snapshotForCpu();
    }
    out.nmi = this.shouldServiceNmi();
    out.irq = this.shouldServiceIrq();
    return out;
  }

  peekCpuPollLines() {
    const out = this._cpuPollLinesSnapshot;
    if (typeof this._syncIrqLines === 'function') {
      this._syncIrqLines();
    }
    if (this.interrupts && typeof this.interrupts.sampleIrqLine === 'function') {
      this.interrupts.sampleIrqLine();
    }
    const state = this.cpuState && this.cpuState.interrupts ? this.cpuState.interrupts : null;
    if (state) {
      out.nmi = !!(state.nmiEdgePending || state.nmiPendingCurrent || state.nmiPendingPrevious);
      out.irq = !!(state.irqLineCurrent || ((state.irqLines & 0xff) !== 0));
      return out;
    }
    out.nmi = this.interrupts && typeof this.interrupts.isNmiPending === 'function'
      ? !!this.interrupts.isNmiPending()
      : false;
    out.irq = this.interrupts && typeof this.interrupts.isIrqAsserted === 'function'
      ? !!this.interrupts.isIrqAsserted()
      : false;
    return out;
  }

  consumePendingNmi() {
    return this.interrupts.consumeNmi();
  }

  consumeNmi() {
    return this.interrupts.consumeNmi();
  }

  consumeIrq() {
    return this.interrupts.consumeIrq();
  }

  sampleCpuInterruptState(iFlagSet, cpuCe = true) {
    if (typeof this._syncIrqLines === 'function') {
      this._syncIrqLines();
    } else if (this.interrupts && typeof this.interrupts.setIrqLine === 'function') {
      const apuIrq = !!(this.apu && this.apu.isIrqAsserted && this.apu.isIrqAsserted());
      const mapperIrq = !!(this.mapper && this.mapper.isIrqAsserted && this.mapper.isIrqAsserted());
      this.interrupts.setIrqLine(irqLineApuCore, apuIrq);
      this.interrupts.setIrqLine(irqLineExternalCore, mapperIrq);
    }
    this.interrupts.sampleCpuPhase(!!iFlagSet, !!cpuCe);
  }

  cyclesToNextDmcFetch() {
    return this.apu.cyclesToNextDmcFetch();
  }

  onCpuWriteObserved(addr, value) {
    if (this.apu && this.apu.onCpuWriteObserved) {
      this.apu.onCpuWriteObserved(addr & 0xffff, value & 0xff);
    }
  }

  consumeCpuRDYStallCycle() {
    return this.busArbiter.consumeCpuRDYStallCycle();
  }

  hadRecentRDYLow() {
    return this.busArbiter.hadRecentRDYLow();
  }

  isCpuRdyLow() {
    return this.busArbiter.isCpuRdyLow();
  }

  _latchPpuStatusReadStart(busCycle) {
    const ppu = this.ppuState;
    ppu.statusReadStartValid = true;
    ppu.statusReadStartCycle = busCycle >>> 0;
    ppu.statusReadStartVblank = !!ppu.nmiOccurred;
    ppu.statusReadMidValid = true;
    ppu.statusReadMidCycle = busCycle >>> 0;
    ppu.statusReadMidFlags = ppu.status & 0x60;
    ppu.statusReadMidCaptured = false;
  }

  onCpuBusCycleStart(addr, isWrite, writeValue) {
    const a = addr & 0xffff;
    if (!isWrite && a >= 0x2000 && a < 0x4000 && (a & 0x0007) === 2) {
      const nextBusCycle = ((this.cpuState.busCycleCounter | 0) + 1) >>> 0;
      this._latchPpuStatusReadStart(nextBusCycle);
    }
    if (isWrite) {
      this.onCpuWriteObserved(addr, writeValue);
    }
    return this.busArbiter.onCpuBusCycleStart(addr, isWrite, writeValue);
  }

  advanceMasterClocks(masterClocks) {
    const used = this.clock.advanceMasterClocks(masterClocks | 0);
    this._syncStateClock();
    return used;
  }

  advanceCpuBusCycle() {
    this.clock.advanceCpuBusCycle();
    this._syncStateClock();
  }

  advanceCpuBusCycleWithAccess(accessFn) {
    const result = this.clock.advanceCpuBusCycleWithAccess(accessFn, 8);
    this._syncStateClock();
    return result;
  }

  advanceCpuBusCycleRead(addr) {
    const result = this.clock.advanceCpuBusCycleRead(addr & 0xffff);
    this._syncStateClock();
    return result & 0xff;
  }

  advanceCpuBusCycleWrite(addr, value) {
    this.clock.advanceCpuBusCycleWrite(addr & 0xffff, value & 0xff);
    this._syncStateClock();
  }

  advanceCpuBusCycleBeforeAccess() {
    // MiSTer nes.v aligns CPU-visible bus read/write strobes with ppu_tick==1,
    // i.e. after two PPU ticks in the 12-master-clock CPU cycle.
    this.clock.advanceMasterClocks(8);
    this._syncStateClock();
  }

  advanceCpuBusCycleAfterAccess() {
    this.clock.advanceMasterClocks(4);
    this._syncStateClock();
  }

  advanceCpuStallCycle() {
    this.clock.advanceCpuStallCycles(1);
    this._syncStateClock();
  }

  tickPPU(ppuCycles) {
    const count = ppuCycles | 0;
    if (count <= 0) return;
    this.ppuDotEngine.tick(count);
  }

  tickApu(cpuCycles) {
    const count = cpuCycles | 0;
    if (count <= 0) return;
    if (this.apu && typeof this.apu.isPhaseDriven === 'function' && this.apu.isPhaseDriven()) {
      return;
    }
    this.apu.tick(count);
    this._syncIrqLines();
  }

  onOamDmaBusCycle() {
    this.busArbiter.onOamDmaBusCycle();
  }

  step() {
    const used = this.execution.step();
    if (used > 0) {
      this._notifyFrontendAdapters('onCpuCyclesAdvanced', used | 0);
    }
    return used;
  }

  runCpuCycles(maxCycles) {
    const used = this.execution.runCpuCycles(maxCycles | 0);
    if (used > 0) {
      this._notifyFrontendAdapters('onCpuCyclesAdvanced', used | 0);
    }
    return used;
  }

  runUntilNextVBlank(maxCpuCycles = 120000) {
    const result = this.execution.runUntilNextVBlank(maxCpuCycles | 0);
    const used = (result && typeof result.cpuCycles === 'number') ? (result.cpuCycles | 0) : 0;
    if (used > 0) {
      this._notifyFrontendAdapters('onCpuCyclesAdvanced', used);
    }
    return result;
  }
}

const nesSingleClockExports = { NES };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = nesSingleClockExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreNesSingleClock = nesSingleClockExports;
}
