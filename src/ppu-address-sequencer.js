class PpuAddressSequencer {
  constructor(host) {
    this.host = host;
  }

  syncAddressState() {
    const ppu = this.host.ppuState;
    const coarseX = ppu.t & 0x1f;
    const coarseY = (ppu.t >> 5) & 0x1f;
    const fineY = (ppu.t >> 12) & 0x07;
    ppu.addr = ppu.v & 0x3fff;
    ppu.addrLatch = ppu.writeToggle & 1;
    ppu.scrollLatch = ppu.writeToggle & 1;
    ppu.scrollX = ((coarseX << 3) | (ppu.fineX & 0x07)) & 0xff;
    ppu.scrollY = ((coarseY << 3) | fineY) & 0xff;
  }

  incrementCoarseX() {
    const ppu = this.host.ppuState;
    if ((ppu.v & 0x001f) === 31) {
      ppu.v &= ~0x001f;
      ppu.v ^= 0x0400;
    } else {
      ppu.v = (ppu.v + 1) & 0x7fff;
    }
  }

  incrementY() {
    const ppu = this.host.ppuState;
    if ((ppu.v & 0x7000) !== 0x7000) {
      ppu.v = (ppu.v + 0x1000) & 0x7fff;
      return;
    }
    ppu.v &= ~0x7000;
    let y = (ppu.v & 0x03e0) >> 5;
    if (y === 29) {
      y = 0;
      ppu.v ^= 0x0800;
    } else if (y === 31) {
      y = 0;
    } else {
      y += 1;
    }
    ppu.v = (ppu.v & ~0x03e0) | ((y & 0x1f) << 5);
  }

  isRenderingAccessInProgress() {
    const ppu = this.host.ppuState;
    const rendering = (this.host && typeof this.host.isPpuRenderingEnabledLatched === 'function')
      ? this.host.isPpuRenderingEnabledLatched()
      : this.host.isPpuRenderingEnabled();
    const renderLine = (ppu.scanline >= 0 && ppu.scanline < 240) || ppu.scanline === 261;
    return rendering && renderLine;
  }

  incrementVAfterDataAccess() {
    const ppu = this.host.ppuState;
    if (this.isRenderingAccessInProgress()) {
      this.incrementCoarseX();
      this.incrementY();
    } else {
      ppu.v = (ppu.v + ((ppu.ctrl & 0x04) ? 32 : 1)) & 0x3fff;
    }
    this.syncAddressState();
  }

  copyHorizontalBits() {
    const ppu = this.host.ppuState;
    ppu.v = (ppu.v & ~0x041f) | (ppu.t & 0x041f);
  }

  copyVerticalBits() {
    const ppu = this.host.ppuState;
    ppu.v = (ppu.v & ~0x7be0) | (ppu.t & 0x7be0);
  }
}

const ppuAddressSequencerExports = { PpuAddressSequencer };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuAddressSequencerExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuAddressSequencer = ppuAddressSequencerExports;
}
