let misterSingleClockPublishCpuExternalBusValueCore = null;
let misterSingleClockPublishCpuInternalBusValueCore = null;

if (typeof require !== 'undefined') {
  try {
    ({
      publishCpuExternalBusValue: misterSingleClockPublishCpuExternalBusValueCore,
      publishCpuInternalBusValue: misterSingleClockPublishCpuInternalBusValueCore,
    } = require('./cpu-bus-publication'));
  } catch (_err) {
    misterSingleClockPublishCpuExternalBusValueCore = null;
    misterSingleClockPublishCpuInternalBusValueCore = null;
  }
}

if (
  (!misterSingleClockPublishCpuExternalBusValueCore || !misterSingleClockPublishCpuInternalBusValueCore) &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCoreCpuBusPublication
) {
  misterSingleClockPublishCpuExternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuExternalBusValue;
  misterSingleClockPublishCpuInternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuInternalBusValue;
}

if (!misterSingleClockPublishCpuExternalBusValueCore || !misterSingleClockPublishCpuInternalBusValueCore) {
  throw new Error('CpuBusPublication core not found');
}

class MisterSingleClockBus {
  constructor(nes) {
    this.nes = nes;
  }

  _readPrg(addr) {
    const nes = this.nes;
    const prg = nes.cartridge && nes.cartridge.prg ? nes.cartridge.prg : null;
    if (!prg || prg.length === 0) return 0;
    const base = (addr - 0x8000) & 0xffff;
    if (prg.length === 0x4000) {
      return prg[base & 0x3fff] & 0xff;
    }
    return prg[base % prg.length] & 0xff;
  }

  readCpu(addr) {
    const nes = this.nes;
    const a = addr & 0xffff;
    let value = 0;
    if (a < 0x2000) {
      value = nes.ram[a & 0x7ff] & 0xff;
    } else if (a < 0x4000) {
      // PPU register mirrors (baseline open-bus behavior for rewrite start).
      value = nes.state.bus.openBus & 0xff;
    } else if (a === 0x4016) {
      value = nes._readControllerPort1() & 0xff;
    } else if (a >= 0x8000) {
      value = this._readPrg(a);
    } else {
      value = nes.state.bus.openBus & 0xff;
    }
    misterSingleClockPublishCpuExternalBusValueCore(nes, value & 0xff);
    return value & 0xff;
  }

  writeCpu(addr, value) {
    const nes = this.nes;
    const a = addr & 0xffff;
    const v = value & 0xff;
    misterSingleClockPublishCpuInternalBusValueCore(nes, v);
    nes.state.bus.address = a;
    nes.state.bus.isWrite = true;

    if (a < 0x2000) {
      nes.ram[a & 0x7ff] = v;
      return;
    }
    if (a < 0x4000) {
      nes._writePpuRegister(a & 0x7, v);
      return;
    }
    if (a === 0x4014) {
      nes.dma.requestOamPage(nes, v);
      return;
    }
    if (a === 0x4016) {
      nes._writeControllerStrobe(v);
      return;
    }
    if (a === 0x2000 || a === 0x2001 || a === 0x2005 || a === 0x2006 || a === 0x2007) {
      nes._writePpuMappedRegister(a, v);
    }
  }

  readPpu(addr) {
    return this.nes.ppuRead(addr);
  }

  writePpu(addr, value) {
    this.nes.ppuWrite(addr, value);
  }
}

const misterSingleClockBusExports = { MisterSingleClockBus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockBusExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockBus = misterSingleClockBusExports;
}
