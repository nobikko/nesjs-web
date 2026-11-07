let CpuDataBusCombinerCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ CpuDataBusCombiner: CpuDataBusCombinerCore } = require('./cpu-data-bus'));
  } catch (_err) {
    CpuDataBusCombinerCore = null;
  }
}
if (!CpuDataBusCombinerCore && typeof globalThis !== 'undefined' && globalThis.NESCoreCpuDataBus) {
  CpuDataBusCombinerCore = globalThis.NESCoreCpuDataBus.CpuDataBusCombiner;
}
if (!CpuDataBusCombinerCore) {
  throw new Error('CPU data bus combiner core not found');
}

class IoRegisterMap {
  constructor(host) {
    this.host = host;
    this._busContextScratch = {
      addr: 0,
      actor: 'cpu',
      ioReadMode: 'direct',
      cpuAddressBus: 0,
      externalBusValue: 0,
      currentCycle: 0,
      isPutCycle: null,
      apuCs: false,
      regSel: 0,
    };
    this._controllerContextScratch = {
      isPutCycle: false,
      currentCycle: 0,
    };
  }

  _isApuChipSelect(cpuAddressBus) {
    return ((cpuAddressBus & 0xffe0) === 0x4000);
  }

  _registerSelect(addr) {
    return addr & 0x1f;
  }

  _resolveBusContext(addr, context) {
    const a = addr & 0xffff;
    const ctx = context;
    const latchedOpenBus = this.host &&
      this.host.cpuState &&
      this.host.cpuState.bus &&
      this.host.cpuState.bus.openBusData != null
      ? (this.host.cpuState.bus.openBusData & 0xff)
      : (this.host && this.host.cpuState ? (this.host.cpuState.openBus & 0xff) : 0);
    const cpuAddressBus = (ctx && ctx.cpuAddressBus != null ? (ctx.cpuAddressBus & 0xffff) : a);
    const externalBusValue = (ctx && ctx.externalBusValue != null)
      ? (ctx.externalBusValue & 0xff)
      : latchedOpenBus;
    let currentCycle = null;
    if (ctx && typeof ctx.currentCycle === 'number') {
      currentCycle = ctx.currentCycle >>> 0;
    } else if (this.host && this.host.cpuState && typeof this.host.cpuState.busCycleCounter === 'number') {
      currentCycle = this.host.cpuState.busCycleCounter >>> 0;
    } else if (this.host && this.host.cpuState && typeof this.host.cpuState.cycleCounter === 'number') {
      currentCycle = this.host.cpuState.cycleCounter >>> 0;
    } else {
      currentCycle = 0;
    }
    const out = this._busContextScratch;
    out.addr = a;
    out.actor = (ctx && ctx.actor) ? ctx.actor : 'cpu';
    out.ioReadMode = (ctx && ctx.ioReadMode) ? ctx.ioReadMode : 'direct';
    out.cpuAddressBus = cpuAddressBus;
    out.externalBusValue = externalBusValue;
    out.currentCycle = currentCycle;
    out.isPutCycle = (ctx && ctx.isPutCycle != null) ? !!ctx.isPutCycle : null;
    out.apuCs = this._isApuChipSelect(cpuAddressBus);
    out.regSel = this._registerSelect(a);
    return out;
  }

  _resolvePutCycle(bus) {
    if (bus && bus.isPutCycle != null) {
      return !!bus.isPutCycle;
    }
    if (this.host && typeof this.host._isControllerPutCycle === 'function') {
      return !!this.host._isControllerPutCycle();
    }
    return false;
  }

  _writeApuByRegister(addr, value, isPutCycle) {
    const host = this.host;
    const apu = host && host.apu ? host.apu : null;
    const syncDmaLatch = () => {
      if (
        host &&
        host.oamDma &&
        typeof host.oamDma.captureApuDmaLatch === 'function'
      ) {
        host.oamDma.captureApuDmaLatch();
      }
    };
    if (!apu) return true;
    const a = addr & 0xffff;
    const methodName = `write${a.toString(16).padStart(4, '0')}`;
    if (typeof apu[methodName] === 'function') {
      if (a === 0x4017) {
        apu[methodName](value & 0xff, !!isPutCycle);
      } else {
        apu[methodName](value & 0xff);
      }
      syncDmaLatch();
      return true;
    }
    if (typeof apu.writeRegister === 'function') {
      apu.writeRegister(a, value & 0xff, !!isPutCycle);
      syncDmaLatch();
      return true;
    }
    return true;
  }

  read(addr, context) {
    const host = this.host;
    const bus = this._resolveBusContext(addr, context);
    if (!bus.apuCs) {
      return { handled: false, value: 0 };
    }
    const controllerContext = this._controllerContextScratch;
    controllerContext.isPutCycle = this._resolvePutCycle(bus);
    controllerContext.currentCycle = bus.currentCycle;

    if (bus.regSel === 0x15) {
      const apuStatus = host.apu.read4015(bus.externalBusValue, this._resolvePutCycle(bus));
      const merged = CpuDataBusCombinerCore.mergeApuStatus(apuStatus, bus.externalBusValue);
      return {
        handled: true,
        value: merged,
        dmaValue: merged,
        externalBusValue: bus.externalBusValue & 0xff,
        openBusReadValue: bus.externalBusValue & 0xff,
        preserveOpenBus: true,
      };
    }

    if (bus.regSel === 0x16) {
      const rawPort = host.controllers.read4016Raw(controllerContext);
      const merged = CpuDataBusCombinerCore.mergeControllerPort(rawPort, bus.externalBusValue);
      const value = merged & 0xff;
      if (host.controllers && typeof host.controllers.pulseClock4016 === 'function') {
        host.controllers.pulseClock4016(controllerContext);
      }
      return {
        handled: true,
        value,
        dmaValue: value,
        externalBusValue: merged & 0xff,
        openBusReadValue: merged & 0xff,
      };
    }

    if (bus.regSel === 0x17) {
      const rawPort = host.controllers.read4017Raw(controllerContext);
      const merged = CpuDataBusCombinerCore.mergeControllerPort(rawPort, bus.externalBusValue);
      const value = merged & 0xff;
      if (host.controllers && typeof host.controllers.pulseClock4017 === 'function') {
        host.controllers.pulseClock4017(controllerContext);
      }
      return {
        handled: true,
        value,
        dmaValue: value,
        externalBusValue: merged & 0xff,
        openBusReadValue: merged & 0xff,
      };
    }

    return { handled: false, value: 0 };
  }

  write(addr, value, context) {
    const host = this.host;
    const v = value & 0xff;
    const bus = this._resolveBusContext(addr, context);
    if (!bus.apuCs) return false;
    const putCycle = this._resolvePutCycle(bus);
    const controllerContext = this._controllerContextScratch;
    controllerContext.isPutCycle = putCycle;
    controllerContext.currentCycle = bus.currentCycle;

    if (bus.regSel === 0x14) {
      // MiSTer-style path: the DMA trigger is captured in CPU bus-cycle logic
      // (onCpuBusCycleStart) so $4014 writes are recognized at cycle level.
      return true;
    }

    if (bus.regSel === 0x16) {
      host.controllers.write4016(v, controllerContext);
      return true;
    }

    // APU register select map follows MiSTer ApuMW groups:
    // SQ1: 00-03, SQ2: 04-07, TRI: 08-0B, NOI: 0C-0F, DMC: 10-13/15, CTRL: 17.
    switch (bus.regSel) {
      case 0x00:
      case 0x01:
      case 0x02:
      case 0x03:
      case 0x04:
      case 0x05:
      case 0x06:
      case 0x07:
      case 0x08:
      case 0x0a:
      case 0x0b:
      case 0x0c:
      case 0x0e:
      case 0x0f:
      case 0x10:
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x15:
      case 0x17:
        return this._writeApuByRegister(0x4000 | (bus.regSel & 0x1f), v, putCycle);
      default:
        break;
    }

    return false;
  }
}

const ioRegisterMapExports = { IoRegisterMap };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ioRegisterMapExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreIoRegisterMap = ioRegisterMapExports;
}
