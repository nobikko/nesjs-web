let PpuRegisterBusCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ PpuRegisterBus: PpuRegisterBusCore } = require('./ppu-register-bus'));
  } catch (_err) {
    PpuRegisterBusCore = null;
  }
}
if (!PpuRegisterBusCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuRegisterBus) {
  PpuRegisterBusCore = globalThis.NESCorePpuRegisterBus.PpuRegisterBus;
}
if (!PpuRegisterBusCore) {
  throw new Error('PpuRegisterBus core not found');
}

let IoRegisterMapCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ IoRegisterMap: IoRegisterMapCore } = require('./io-register-map'));
  } catch (_err) {
    IoRegisterMapCore = null;
  }
}
if (!IoRegisterMapCore && typeof globalThis !== 'undefined' && globalThis.NESCoreIoRegisterMap) {
  IoRegisterMapCore = globalThis.NESCoreIoRegisterMap.IoRegisterMap;
}
if (!IoRegisterMapCore) {
  throw new Error('IoRegisterMap core not found');
}

let normalizeBusAccessContextCore = null;
let busAccessIoDirectCore = 'direct';
let busAccessIoCpuBusMirrorCore = 'cpu_bus_mirror';
let cpuMapBusAccessActorOamDmaCore = 'oam_dma';
let cpuMapBusAccessActorDmcDmaCore = 'dmc_dma';
if (typeof require !== 'undefined') {
  try {
    ({
      normalizeBusAccessContext: normalizeBusAccessContextCore,
      BUS_ACCESS_IO_DIRECT: busAccessIoDirectCore,
      BUS_ACCESS_IO_CPU_BUS_MIRROR: busAccessIoCpuBusMirrorCore,
      BUS_ACCESS_ACTOR_OAM_DMA: cpuMapBusAccessActorOamDmaCore,
      BUS_ACCESS_ACTOR_DMC_DMA: cpuMapBusAccessActorDmcDmaCore,
    } = require('./bus-access'));
  } catch (_err) {
    normalizeBusAccessContextCore = null;
  }
}
if (!normalizeBusAccessContextCore && typeof globalThis !== 'undefined' && globalThis.NESCoreBusAccess) {
  normalizeBusAccessContextCore = globalThis.NESCoreBusAccess.normalizeBusAccessContext;
  busAccessIoDirectCore = globalThis.NESCoreBusAccess.BUS_ACCESS_IO_DIRECT;
  busAccessIoCpuBusMirrorCore = globalThis.NESCoreBusAccess.BUS_ACCESS_IO_CPU_BUS_MIRROR;
  cpuMapBusAccessActorOamDmaCore = globalThis.NESCoreBusAccess.BUS_ACCESS_ACTOR_OAM_DMA;
  cpuMapBusAccessActorDmcDmaCore = globalThis.NESCoreBusAccess.BUS_ACCESS_ACTOR_DMC_DMA;
}
if (!normalizeBusAccessContextCore) {
  throw new Error('Bus access core not found');
}

let publishCpuExternalBusValueCore = null;
let publishCpuInternalBusValueCore = null;
if (typeof require !== 'undefined') {
  try {
    ({
      publishCpuExternalBusValue: publishCpuExternalBusValueCore,
      publishCpuInternalBusValue: publishCpuInternalBusValueCore,
    } = require('./cpu-bus-publication'));
  } catch (_err) {
    publishCpuExternalBusValueCore = null;
    publishCpuInternalBusValueCore = null;
  }
}
if (
  (!publishCpuExternalBusValueCore || !publishCpuInternalBusValueCore) &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCoreCpuBusPublication
) {
  publishCpuExternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuExternalBusValue;
  publishCpuInternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuInternalBusValue;
}
if (!publishCpuExternalBusValueCore || !publishCpuInternalBusValueCore) {
  throw new Error('CpuBusPublication core not found');
}

class CpuMemoryMap {
  constructor(host) {
    this.host = host;
    this.ppuRegisters = new PpuRegisterBusCore(host);
    this.ioRegisters = new IoRegisterMapCore(host);
    this._cpuDirectReadContext = {
      __normalizedBusAccess: true,
      actor: 'cpu',
      addr: 0,
      cpuAddressBus: 0,
      externalBusValue: null,
      currentCycle: 0,
      isPutCycle: false,
      ioReadMode: busAccessIoDirectCore,
      ioWriteMode: busAccessIoDirectCore,
      isWrite: false,
    };
    this._cpuDirectWriteContext = {
      __normalizedBusAccess: true,
      actor: 'cpu',
      addr: 0,
      cpuAddressBus: 0,
      externalBusValue: null,
      currentCycle: 0,
      isPutCycle: false,
      ioReadMode: busAccessIoDirectCore,
      ioWriteMode: busAccessIoDirectCore,
      isWrite: true,
    };
  }

  _cpu() {
    return this.host.cpuState;
  }

  _cpuBus() {
    return this.host.cpuState.bus;
  }

  _getOpenBus() {
    const cpu = this.host && this.host.cpuState ? this.host.cpuState : null;
    if (!cpu) return 0;
    if (cpu.bus && cpu.bus.openBusData != null) {
      return cpu.bus.openBusData & 0xff;
    }
    return cpu.openBus & 0xff;
  }

  _setOpenBus(value) {
    const v = value & 0xff;
    this.host.cpuState.openBus = v;
    if (this.host && this.host.cpuState && this.host.cpuState.bus) {
      this.host.cpuState.bus.openBusData = v;
    }
  }

  _setOpenBusReadValue(value) {
    if (!(this.host && this.host.cpuState && this.host.cpuState.bus)) return;
    if (value == null) {
      this.host.cpuState.bus.openBusReadValue = null;
      return;
    }
    this.host.cpuState.bus.openBusReadValue = value & 0xff;
  }

  _isDmaMirrorActor(ctx) {
    if (!ctx || ctx.ioReadMode !== busAccessIoCpuBusMirrorCore) return false;
    return ctx.actor === cpuMapBusAccessActorOamDmaCore || ctx.actor === cpuMapBusAccessActorDmcDmaCore;
  }

  _publishExternalBusValue(value) {
    const v = value & 0xff;
    return publishCpuExternalBusValueCore(this.host, v);
  }

  _publishInternalBusValue(value) {
    const v = value & 0xff;
    return publishCpuInternalBusValueCore(this.host, v);
  }

  _currentPutCycle() {
    if (this.host && typeof this.host._isControllerPutCycle === 'function') {
      try {
        return !!this.host._isControllerPutCycle();
      } catch (_err) {
        return false;
      }
    }
    return false;
  }

  _currentBusCycle() {
    const cpu = this._cpu();
    if (!cpu) return 0;
    if (cpu.timeline && typeof cpu.timeline.lastCpuBusCycle === 'number' && cpu.timeline.lastCpuBusCycle > 0) {
      return cpu.timeline.lastCpuBusCycle >>> 0;
    }
    if (typeof cpu.busCycleCounter === 'number') {
      return cpu.busCycleCounter >>> 0;
    }
    if (typeof cpu.cycleCounter === 'number') {
      return cpu.cycleCounter >>> 0;
    }
    return 0;
  }

  _withPhaseContext(context) {
    if (!context) {
      return {
        isPutCycle: this._currentPutCycle(),
        currentCycle: this._currentBusCycle(),
      };
    }
    if (context.__normalizedBusAccess === true) {
      if (context.currentCycle != null && context.isPutCycle != null) {
        return context;
      }
      return {
        ...context,
        isPutCycle: context.isPutCycle == null ? this._currentPutCycle() : !!context.isPutCycle,
        currentCycle: context.currentCycle == null ? this._currentBusCycle() : (context.currentCycle >>> 0),
      };
    }
    if (context.isPutCycle != null && context.currentCycle != null) {
      return context;
    }
    return {
      ...context,
      isPutCycle: context.isPutCycle == null ? this._currentPutCycle() : !!context.isPutCycle,
      currentCycle: context.currentCycle == null ? this._currentBusCycle() : (context.currentCycle >>> 0),
    };
  }

  _publishCpuReadResult(value) {
    return this._publishExternalBusValue(value & 0xff);
  }

  _isMapper4PrgRamFastPath(mapper) {
    const host = this.host;
    if (!host || !host.cartridge || (host.cartridge.mapper | 0) !== 4) return false;
    if (!mapper || !mapper.prgRam || typeof mapper.prgRamEnable !== 'boolean') return false;
    return true;
  }

  _prepareCpuDirectContext(addr, isWrite) {
    const a = addr & 0xffff;
    const ctx = isWrite ? this._cpuDirectWriteContext : this._cpuDirectReadContext;
    const arbiter = this.host && this.host.busArbiter ? this.host.busArbiter : null;
    const timeline = arbiter && arbiter.timeline ? arbiter.timeline : null;
    ctx.addr = a;
    ctx.cpuAddressBus = a;
    if (timeline) {
      const cycle = timeline.lastCpuBusCycle;
      ctx.currentCycle = (typeof cycle === 'number' && cycle > 0) ? (cycle >>> 0) : 0;
      ctx.isPutCycle = timeline.lastCpuPutCycle === true;
    } else {
      ctx.currentCycle = this._currentBusCycle();
      ctx.isPutCycle = this._currentPutCycle();
    }
    ctx.externalBusValue = null;
    return ctx;
  }

  _notifyMapperCpuBus(addr, isWrite, value, context) {
    const host = this.host;
    if (host.mapperHooks && !host.mapperHooks.onCpuBusAccess) return;
    const mapper = this.host.mapper;
    if (!mapper || typeof mapper.onCpuBusAccess !== 'function') return;
    const a = addr & 0xffff;
    if (a < 0x4020) return;
    const cpuState = this._cpu();
    const phase = cpuState && cpuState.phase && typeof cpuState.phase.snapshot === 'function'
      ? cpuState.phase.snapshot()
      : null;
    if (!phase) {
      throw new Error('CPU phase snapshot unavailable for mapper CPU bus hook');
    }
    mapper.onCpuBusAccess({
      addr: a,
      isWrite: !!isWrite,
      value: value & 0xff,
      putCe: !!phase.putCe,
      getCe: !!phase.getCe,
      context: context || null,
    });
  }

  _readWithoutIo(addr, context) {
    const host = this.host;
    const a = addr & 0xffff;
    if (a < 0x2000) {
      const value = host.ram[a & 0x7ff];
      this._publishExternalBusValue(value & 0xff);
      return value;
    }

    if (a < 0x4000) {
      return this.ppuRegisters.readRegister(a & 0x7, context);
    }

    if (a < 0x8000) {
      const openBus = this._getOpenBus();
      let value = openBus;
      if (a >= 0x4020 && host.mapper && typeof host.mapper.cpuReadLow === 'function') {
        const mapped = host.mapper.cpuReadLow(a, openBus);
        if (mapped !== null && mapped !== undefined) {
          value = mapped & 0xff;
        }
      }
      this._publishExternalBusValue(value & 0xff);
      this._notifyMapperCpuBus(a, false, value, null);
      return value;
    }

    const value = host.mapper.cpuRead(a);
    this._publishExternalBusValue(value & 0xff);
    this._notifyMapperCpuBus(a, false, value, null);
    return value;
  }

  _readIo(addr, context) {
    const a = addr & 0xffff;
    let ctx = context;
    if (!ctx || ctx.__normalizedBusAccess !== true) {
      ctx = normalizeBusAccessContextCore(this._withPhaseContext(context), a, false);
    }
    if (ctx.ioReadMode === busAccessIoDirectCore) {
      return this.ioRegisters.read(a, ctx);
    }
    if (ctx.ioReadMode === busAccessIoCpuBusMirrorCore) {
      const cpuBus = ctx.cpuAddressBus & 0xffff;
      if ((cpuBus & 0xffe0) !== 0x4000) return { handled: false, value: 0 };
      // MiSTer-style decode split:
      // - chip select from frozen CPU address bus high bits
      // - register select from current external bus low bits (DMA aout)
      // This matches nes.v where apu_cs is based on cpu_addr[15:5] while
      // joypad/io select uses addr[4:0] from the muxed external bus.
      const mirroredAddr = 0x4000 | (a & 0x1f);
      const hadMirrored = Object.prototype.hasOwnProperty.call(ctx, 'mirroredIoAddr');
      const prevMirrored = ctx.mirroredIoAddr;
      ctx.mirroredIoAddr = mirroredAddr & 0xffff;
      const io = this.ioRegisters.read(mirroredAddr, ctx);
      if (hadMirrored) {
        ctx.mirroredIoAddr = prevMirrored;
      } else {
        delete ctx.mirroredIoAddr;
      }
      return io;
    }
    return { handled: false, value: 0 };
  }

  read(addr, context) {
    const host = this.host;
    const a = addr & 0xffff;
    let ctx = context;
    if (ctx == null) {
      ctx = this._prepareCpuDirectContext(a, false);
    } else if (ctx.__normalizedBusAccess !== true) {
      ctx = normalizeBusAccessContextCore(this._withPhaseContext(context), a, false);
    }
    if (ctx.ioReadMode !== busAccessIoDirectCore) {
      const baseValue = this._readWithoutIo(a, ctx);
      const hadExternal = Object.prototype.hasOwnProperty.call(ctx, 'externalBusValue');
      const prevExternal = ctx.externalBusValue;
      ctx.externalBusValue = baseValue & 0xff;
      const io = this._readIo(a, ctx);
      if (hadExternal) {
        ctx.externalBusValue = prevExternal;
      } else {
        delete ctx.externalBusValue;
      }
      if (io.handled) {
        const readValue = io.value & 0xff;
        const dmaValue = (io.dmaValue == null ? readValue : (io.dmaValue & 0xff));
        const externalValue = (io.externalBusValue == null ? readValue : (io.externalBusValue & 0xff));
        const openBusReadValue = (io.openBusReadValue == null ? externalValue : (io.openBusReadValue & 0xff));
        if (this._isDmaMirrorActor(ctx)) {
          // MiSTer-equivalent split:
          // - internal_data_bus (DMA consumer) may differ from external_data_bus
          // - open_bus_data read-latch source (dma_data_bus) is tracked separately.
          this._publishExternalBusValue(externalValue);
          this._setOpenBusReadValue(openBusReadValue);
          return dmaValue;
        }
        if (io.preserveOpenBus) {
          return readValue;
        }
        this._setOpenBusReadValue(openBusReadValue);
        return this._publishCpuReadResult(readValue);
      }
      return baseValue;
    }

    // Fast path for normal CPU reads outside I/O decode window.
    // Keeps DMA/mirror actors on the generic path above.
    if (ctx.actor === 'cpu' && a >= 0x4020) {
      if (a >= 0x6000 && a <= 0x7fff) {
        const mapper = host.mapper;
        if (this._isMapper4PrgRamFastPath(mapper) && mapper.prgRamEnable) {
          const value = mapper.prgRam[a & 0x1fff] & 0xff;
          this._publishExternalBusValue(value);
          this._notifyMapperCpuBus(a, false, value, ctx);
          return value;
        }
      }
      if (a < 0x8000) {
        const openBus = this._getOpenBus();
        let value = openBus;
        if (host.mapper && typeof host.mapper.cpuReadLow === 'function') {
          const mapped = host.mapper.cpuReadLow(a, openBus);
          if (mapped !== null && mapped !== undefined) {
            value = mapped & 0xff;
          }
        }
        this._publishExternalBusValue(value & 0xff);
        this._notifyMapperCpuBus(a, false, value, ctx);
        return value;
      }

      const value = host.mapper.cpuRead(a);
      this._publishExternalBusValue(value & 0xff);
      this._notifyMapperCpuBus(a, false, value, ctx);
      return value;
    }

    if (a < 0x2000) {
      const value = host.ram[a & 0x7ff];
      this._publishExternalBusValue(value & 0xff);
      return value;
    }

    if (a < 0x4000) {
      return this.ppuRegisters.readRegister(a & 0x7, ctx);
    }

    const io = this._readIo(a, ctx);
    if (io.handled) {
      const readValue = io.value & 0xff;
      const openBusReadValue = io.openBusReadValue == null
        ? readValue
        : (io.openBusReadValue & 0xff);
      this._setOpenBusReadValue(openBusReadValue);
      if (io.preserveOpenBus) {
        return readValue;
      }
      return this._publishCpuReadResult(readValue);
    }

    if (a < 0x8000) {
      const openBus = this._getOpenBus();
      let value = openBus;
      if (a >= 0x4020 && host.mapper && typeof host.mapper.cpuReadLow === 'function') {
        const mapped = host.mapper.cpuReadLow(a, openBus);
        if (mapped !== null && mapped !== undefined) {
          value = mapped & 0xff;
        }
      }
      this._publishExternalBusValue(value & 0xff);
      this._notifyMapperCpuBus(a, false, value, ctx);
      return value;
    }

    const value = host.mapper.cpuRead(a);
    this._publishExternalBusValue(value & 0xff);
    this._notifyMapperCpuBus(a, false, value, ctx);
    return value;
  }

  write(addr, value, context) {
    const host = this.host;
    const cpuBus = this._cpuBus();
    const a = addr & 0xffff;
    const v = value & 0xff;
    let ctx = context;
    if (ctx == null) {
      ctx = this._prepareCpuDirectContext(a, true);
    } else if (ctx.__normalizedBusAccess !== true) {
      ctx = normalizeBusAccessContextCore(this._withPhaseContext(context), a, true);
    }
    this._publishInternalBusValue(v);
    if (cpuBus) {
      cpuBus.address = a;
      cpuBus.isWrite = true;
    }

    if (a < 0x2000) {
      host.ram[a & 0x7ff] = v;
      return;
    }

    if (a < 0x4000) {
      this.ppuRegisters.writeRegister(a & 0x7, v);
      return;
    }

    // Fast path for normal CPU writes outside I/O decode window.
    // Keeps DMA/mirror actors on generic path below.
    if (ctx.actor === 'cpu' && a >= 0x4020) {
      if (a >= 0x6000 && a <= 0x7fff) {
        const mapper = host.mapper;
        if (this._isMapper4PrgRamFastPath(mapper) && mapper.prgRamEnable && !mapper.prgRamWriteProtect) {
          mapper.prgRam[a & 0x1fff] = v;
          this._notifyMapperCpuBus(a, true, v, ctx);
          return;
        }
      }
      if (a < 0x8000) {
        if (host.mapper && typeof host.mapper.cpuWriteLow === 'function') {
          host.mapper.cpuWriteLow(a, v);
        }
        this._notifyMapperCpuBus(a, true, v, ctx);
        return;
      }

      host.mapper.cpuWrite(a, v, ctx);
      this._notifyMapperCpuBus(a, true, v, ctx);
      return;
    }

    if (ctx.ioWriteMode === busAccessIoDirectCore && this.ioRegisters.write(a, v, ctx)) {
      return;
    }

    if (a < 0x8000) {
      if (a >= 0x4020 && host.mapper && typeof host.mapper.cpuWriteLow === 'function') {
        host.mapper.cpuWriteLow(a, v);
      }
      this._notifyMapperCpuBus(a, true, v, ctx);
      return;
    }

    host.mapper.cpuWrite(a, v, ctx);
    this._notifyMapperCpuBus(a, true, v, ctx);
  }
}

const cpuMemoryMapExports = { CpuMemoryMap };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuMemoryMapExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuMemoryMap = cpuMemoryMapExports;
}
