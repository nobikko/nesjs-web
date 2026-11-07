class MisterSingleClockApu {
  reset(nes) {
    nes.state.apu.frameCounter = 0;
    nes.state.apu.status = 0;
  }

  onCpuPhaseTick(nes, phase) {
    if (!phase || !phase.cpuCe) return;
    nes.state.apu.frameCounter = (nes.state.apu.frameCounter + 1) >>> 0;
  }
}

const misterSingleClockApuExports = { MisterSingleClockApu };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockApuExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockApu = misterSingleClockApuExports;
}
