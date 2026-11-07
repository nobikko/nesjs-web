class PpuBackgroundState {
  constructor() {
    this.reset();
  }

  reset() {
    this.patternLoShift = 0;
    this.patternHiShift = 0;
    this.attrLoShift = 0;
    this.attrHiShift = 0;
    this.fetchPhase = 0;
    this.currentNameTable = 0;
    this.currentAttributeTable = 0;
    this.currentPatternLo = 0;
    this.currentPatternHi = 0;
    this.nextTileId = 0;
    this.nextAttr = 0;
    this.nextPatternLo = 0;
    this.nextPatternHi = 0;
  }
}

const ppuBackgroundStateExports = { PpuBackgroundState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuBackgroundStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuBackgroundState = ppuBackgroundStateExports;
}
