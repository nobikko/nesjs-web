class MisterSingleClockPpu {
  reset(nes) {
    const ppu = nes.state.ppu;
    ppu.scanline = 0;
    ppu.dot = 0;
    ppu.frameCounter = 0;
    ppu.status = 0;
    ppu.mask = 0;
    ppu.ctrl = 0;
    ppu.v = 0;
    ppu.t = 0;
    ppu.fineX = 0;
    ppu.writeToggle = 0;
    ppu.ioBus = 0;
    ppu.ioBusDecayCpu = 0;
    ppu.oamAddr = 0;
  }

  _tickDot(ppu) {
    ppu.dot += 1;
    if (ppu.dot >= 341) {
      ppu.dot = 0;
      ppu.scanline += 1;
      if (ppu.scanline >= 262) {
        ppu.scanline = 0;
        ppu.frameCounter = (ppu.frameCounter + 1) >>> 0;
      }
    }
  }

  onMasterTick(nes) {
    const ppu = nes.state.ppu;
    this._tickDot(ppu);

    // Baseline VBL timing: set near start, clear on pre-render.
    if (ppu.scanline === 241 && ppu.dot === 1) {
      ppu.status |= 0x80;
    }
    if (ppu.scanline === 261 && ppu.dot === 1) {
      ppu.status &= ~0x80;
    }
  }
}

const misterSingleClockPpuExports = { MisterSingleClockPpu };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockPpuExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockPpu = misterSingleClockPpuExports;
}
