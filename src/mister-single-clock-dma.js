const MISTER_DMA_BUS_OWNER_CPU = 0;
const MISTER_DMA_BUS_OWNER_OAM_DMA = 1;

class MisterSingleClockDma {
  reset(nes) {
    const dma = nes.state.dma;
    dma.engine = 'idle';
    dma.pendingPage = null;
    dma.sourceAddr = 0;
    dma.index = 0;
    dma.latch = 0;
    dma.dmc.pending = false;
    dma.dmc.halt = false;
    dma.dmc.dummy = false;
    dma.dmc.align = false;
    dma.dmc.get = false;
    dma.dmc.abort = false;
  }

  requestOamPage(nes, page) {
    nes.state.dma.pendingPage = page & 0xff;
  }

  isCpuOwned(nes) {
    return nes.state.dma.engine === 'idle';
  }

  _startIfPending(nes, phase) {
    const dma = nes.state.dma;
    if (dma.engine !== 'idle' || dma.pendingPage == null || !phase || !phase.cpuCe) return;
    dma.sourceAddr = ((dma.pendingPage & 0xff) << 8) & 0xffff;
    dma.index = 0;
    dma.latch = 0;
    dma.engine = 'oam_read';
    dma.pendingPage = null;
  }

  onCpuPhaseTick(nes, bus, phase) {
    const dma = nes.state.dma;
    this._startIfPending(nes, phase);
    if (!phase || !phase.cpuCe) return;
    if (dma.engine === 'idle') return;

    if (dma.engine === 'oam_read') {
      dma.latch = bus.readCpu((dma.sourceAddr + dma.index) & 0xffff) & 0xff;
      dma.engine = 'oam_write';
      nes.state.bus.owner = MISTER_DMA_BUS_OWNER_OAM_DMA;
      nes.state.bus.paused = true;
      nes.state.bus.pendingOam = true;
      return;
    }

    if (dma.engine === 'oam_write') {
      const dst = (nes.state.ppu.oamAddr + dma.index) & 0xff;
      nes.ppuState.oamPrimary[dst] = dma.latch & 0xff;
      dma.index = (dma.index + 1) & 0x1ff;
      if (dma.index >= 0x100) {
        dma.engine = 'idle';
        nes.state.bus.owner = MISTER_DMA_BUS_OWNER_CPU;
        nes.state.bus.paused = false;
        nes.state.bus.pendingOam = false;
      } else {
        dma.engine = 'oam_read';
      }
    }
  }
}

const misterSingleClockDmaExports = { MisterSingleClockDma };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockDmaExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockDma = misterSingleClockDmaExports;
}
