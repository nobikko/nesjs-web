let ppuRegisterClassifyDotPhaseCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ classifyPpuDotPhase: ppuRegisterClassifyDotPhaseCore } = require('./ppu-dot-phase'));
  } catch (_err) {
    ppuRegisterClassifyDotPhaseCore = null;
  }
}
if (!ppuRegisterClassifyDotPhaseCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuDotPhase) {
  ppuRegisterClassifyDotPhaseCore = globalThis.NESCorePpuDotPhase.classifyPpuDotPhase;
}

let ppuRegisterPublishCpuExternalBusValueCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ publishCpuExternalBusValue: ppuRegisterPublishCpuExternalBusValueCore } = require('./cpu-bus-publication'));
  } catch (_err) {
    ppuRegisterPublishCpuExternalBusValueCore = null;
  }
}
if (
  !ppuRegisterPublishCpuExternalBusValueCore &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCoreCpuBusPublication
) {
  ppuRegisterPublishCpuExternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuExternalBusValue;
}
if (!ppuRegisterPublishCpuExternalBusValueCore) {
  throw new Error('CpuBusPublication core not found');
}

class PpuRegisterBus {
  constructor(host) {
    this.host = host;
    this._dotPhaseScratch = {
      renderingActive: false,
      renderScanline: false,
    };
  }

  _ppu() {
    return this.host.ppuState;
  }

  _cpu() {
    return this.host.cpuState;
  }

  _setCpuOpenBus(value) {
    const v = value & 0xff;
    ppuRegisterPublishCpuExternalBusValueCore(this.host, v);
  }

  _syncAddressState() {
    this.host.ppuAddressSequencer.syncAddressState();
  }

  _currentDotPhase() {
    const ppu = this._ppu();
    const renderingEnabled = (this.host && typeof this.host.isPpuRenderingEnabledLatched === 'function')
      ? this.host.isPpuRenderingEnabledLatched()
      : this.host.isPpuRenderingEnabled();
    if (ppuRegisterClassifyDotPhaseCore) {
      return ppuRegisterClassifyDotPhaseCore(
        ppu.scanline | 0,
        ppu.dot | 0,
        renderingEnabled,
        this._dotPhaseScratch,
      );
    }
    const renderLine = (ppu.scanline >= 0 && ppu.scanline < 240) || ppu.scanline === 261;
    const out = this._dotPhaseScratch;
    out.renderingActive = !!(renderingEnabled && renderLine);
    out.renderScanline = !!renderLine;
    return out;
  }

  _currentCpuBusCycle(context) {
    if (context && context.currentCycle != null) {
      return context.currentCycle >>> 0;
    }
    const cpu = this._cpu();
    if (cpu && cpu.timeline && cpu.timeline.lastCpuBusCycle != null) {
      return cpu.timeline.lastCpuBusCycle >>> 0;
    }
    return 0;
  }

  readStatus(context) {
    const host = this.host;
    const ppu = this._ppu();
    // Pre-vblank suppression window (equivalent to reading $2002 one PPU tick
    // before the vblank flag would be raised).
    if (ppu.scanline === 241 && ppu.dot === 0) {
      ppu.preventVblankSet = true;
    }
    // MiSTer-equivalent old/new boundary:
    // nmi_occured is sampled as pre-edge only when read and entering_vblank
    // collide on the same CE boundary. Outside that collision window, use
    // the current combinational state.
    const vblankBoundaryCollision =
      (ppu.vblankSetOnLastTick === true) ||
      (ppu.vblankClearOnLastTick === true);
    const currentCycle = this._currentCpuBusCycle(context);
    const hasStartLatch = !!ppu.statusReadStartValid && ((ppu.statusReadStartCycle >>> 0) === currentCycle);
    const useStartVblank = hasStartLatch && vblankBoundaryCollision;
    const sampledVblank = useStartVblank ? !!ppu.statusReadStartVblank : !!ppu.nmiOccurred;
    const hasMidLatch = !!ppu.statusReadMidValid && ((ppu.statusReadMidCycle >>> 0) === currentCycle);
    const sampledSpriteFlags = vblankBoundaryCollision
      ? (ppu.status & 0x60)
      : (hasMidLatch ? (ppu.statusReadMidFlags & 0x60) : (ppu.status & 0x60));
    let statusHi = sampledSpriteFlags | (sampledVblank ? 0x80 : 0x00);
    const value = statusHi | (ppu.ioBus & 0x1f);
    ppu.statusReadStartValid = false;
    ppu.statusReadMidValid = false;
    ppu.statusReadMidCaptured = false;
    ppu.nmiOccurred = false;
    ppu.status &= ~0x80;
    host.interrupts.setPpuVblank(false);
    if (ppu.vblankSetOnLastTick === true) {
      if (host.interrupts && typeof host.interrupts.suppressNmiEdge === 'function') {
        host.interrupts.suppressNmiEdge();
      } else {
        host.interrupts.clearNmi();
      }
    }
    ppu.writeToggle = 0;
    this._syncAddressState();
    host.refreshPpuIoBus(value, 0xe0);
    this._setCpuOpenBus(value);
    return value;
  }

  readOamData() {
    const dotPhase = this._currentDotPhase();
    return this.host.ppuSpritePipeline.readOamData(dotPhase);
  }

  readData() {
    const host = this.host;
    const ppu = this._ppu();
    if (host.queuePpu2007Read) host.queuePpu2007Read();
    const addr = ppu.v & 0x3fff;
    const previousBuffer = ppu.dataBuffer & 0xff;
    const bufferAddr = addr >= 0x3f00 ? ((addr - 0x1000) & 0x3fff) : (addr & 0x3fff);
    // Keep $2007's internal read buffer update in the same CPU read cycle.
    // The detailed bus/mapper notification still flows through the delayed path.
    ppu.dataBuffer = host.ppuRead(bufferAddr, {
      observe: false,
      origin: 'cpu_2007',
      stage: 'buffer_prefetch_immediate',
      rawAddr: bufferAddr,
      busAddr: bufferAddr,
    }) & 0xff;
    let ret;
    if (addr >= 0x3f00) {
      // Palette reads return 6-bit palette data; upper bits come from PPU IO bus.
      const value = host.ppuRead(addr, {
        observe: false,
        origin: 'cpu_2007',
        stage: 'palette_direct',
        rawAddr: addr & 0x3fff,
        busAddr: addr & 0x3fff,
      });
      ret = (ppu.ioBus & 0xc0) | (value & 0x3f);
      ppu.queued2007ReadBufferAddr = bufferAddr;
    } else {
      ret = previousBuffer;
      ppu.queued2007ReadBufferAddr = bufferAddr;
    }
    ppu.queued2007ReadAddr = addr & 0x3fff;
    ppu.queued2007ReadValid = true;
    if (addr >= 0x3f00) host.refreshPpuIoBus(ret, 0x1f);
    else host.refreshPpuIoBus(ret, 0xff);
    this._setCpuOpenBus(ret);
    return ret;
  }

  readRegister(reg, context) {
    const ppu = this._ppu();
    if (reg === 2) return this.readStatus(context);
    if (reg === 4) return this.readOamData();
    if (reg === 7) return this.readData();
    const value = ppu.ioBus;
    this._setCpuOpenBus(value);
    return value;
  }

  writeCtrl(value) {
    const host = this.host;
    const ppu = this._ppu();
    // MiSTer NES PPU warm-up: clear=1 forces vbl_enable/ctrl bits to 0 every cycle.
    if (ppu.warmupActive) {
      host.interrupts.setPpuNmiOutput(false, false);
      return;
    }
    ppu.ctrl = value & 0xff;
    ppu.t = (ppu.t & 0x73ff) | ((value & 0x03) << 10);
    const nextNmiEnable = (ppu.ctrl & 0x80) !== 0;
    host.interrupts.setPpuNmiOutput(nextNmiEnable, false);
    if (host.mapper && typeof host.mapper.onPpuControl === 'function') {
      host.mapper.onPpuControl(ppu.ctrl);
    }
    this._syncAddressState();
  }

  writeMask(value) {
    // MiSTer NES PPU warm-up: clear=1 forces mask bits to 0 every cycle.
    if (this._ppu().warmupActive) return;
    const ppu = this._ppu();
    // MiSTer applies register writes on pclk/ce boundaries. Queue writes here and
    // commit from the PPU timing pipeline after re/eo/eb shift updates.
    ppu.pendingMaskWriteValid = true;
    ppu.pendingMaskWriteValue = value & 0xff;
  }

  writeOamAddr(value) {
    const dotPhase = this._currentDotPhase();
    this.host.ppuSpritePipeline.writeOamAddr(value, dotPhase);
  }

  writeOamData(value) {
    const dotPhase = this._currentDotPhase();
    this.host.ppuSpritePipeline.writeOamData(value, dotPhase);
  }

  writeScroll(value) {
    const ppu = this._ppu();
    // MiSTer NES PPU warm-up: clear=1 forces vram_t, vram_x, address_latch to 0.
    if (ppu.warmupActive) return;
    if (ppu.writeToggle === 0) {
      ppu.fineX = value & 0x07;
      ppu.t = (ppu.t & ~0x001f) | ((value >> 3) & 0x1f);
      ppu.writeToggle = 1;
    } else {
      ppu.t = (ppu.t & ~0x73e0) | (((value >> 3) & 0x1f) << 5) | ((value & 0x07) << 12);
      ppu.writeToggle = 0;
    }
    this._syncAddressState();
  }

  writeAddr(value) {
    const ppu = this._ppu();
    // MiSTer NES PPU warm-up: clear=1 forces vram_t, address_latch to 0.
    if (ppu.warmupActive) return;
    if (ppu.writeToggle === 0) {
      ppu.t = (ppu.t & 0x00ff) | ((value & 0x3f) << 8);
      ppu.writeToggle = 1;
    } else {
      ppu.t = (ppu.t & 0x7f00) | (value & 0xff);
      ppu.v = ppu.t & 0x3fff;
      ppu.writeToggle = 0;
    }
    this._syncAddressState();
  }

  writeData(value) {
    const host = this.host;
    const ppu = this._ppu();
    if (host.queuePpu2007Write) host.queuePpu2007Write();
    ppu.queued2007WriteAddr = ppu.v & 0x3fff;
    ppu.queued2007WriteValue = value & 0xff;
    ppu.queued2007WriteValid = true;
  }

  writeRegister(reg, value) {
    const host = this.host;
    host.refreshPpuIoBus(value);
    if (reg === 0) {
      this.writeCtrl(value);
      return;
    }
    if (reg === 1) {
      this.writeMask(value);
      return;
    }
    if (reg === 3) {
      this.writeOamAddr(value);
      return;
    }
    if (reg === 4) {
      this.writeOamData(value);
      return;
    }
    if (reg === 5) {
      this.writeScroll(value);
      return;
    }
    if (reg === 6) {
      this.writeAddr(value);
      return;
    }
    if (reg === 7) {
      this.writeData(value);
    }
  }
}

const ppuRegisterBusExports = { PpuRegisterBus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuRegisterBusExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuRegisterBus = ppuRegisterBusExports;
}
