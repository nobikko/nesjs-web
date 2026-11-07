const PPU_SPRITE_PHASE_IDLE = 'IDLE';
const PPU_SPRITE_PHASE_CLEAR = 'CLEAR';
const PPU_SPRITE_PHASE_EVAL = 'EVAL';
const PPU_SPRITE_PHASE_FETCH = 'FETCH';
const PPU_SPRITE_PHASE_REFRESH = 'REFRESH';

class PpuSpriteEvalState {
  constructor() {
    this.reset();
  }

  reset() {
    this.scanline = -1;
    this.dot = 0;
    this.dotInPhase = 0;
    this.targetScanline = -1;
    this.startAddr = 0;
    this.phase = PPU_SPRITE_PHASE_IDLE;
    this.evaluationActive = false;
    this.oamAddr = 0;
    this.secondaryAddr = 0;
    this.secondaryOverflow = false;
    this.evalCount = 0;
    this.copySpriteBase = 0;
    this.evalComplete = false;
    this.nOvr = false;
    this.primaryIndex = 0;
    this.secondaryCount = 0;
    this.copyByte = 0;
    this.copyBase = 0;
    this.currentBase = 0;
    this.currentInRange = false;
    this.overflowByte = 0;
    this.overflowSpriteIndex = 0;
    this.oldRendering = false;
    this.oldUsingSecondary = false;
    this.sprite0Curr = false;
  }
}

const ppuSpriteEvalStateExports = {
  PpuSpriteEvalState,
  PPU_SPRITE_PHASE_IDLE,
  PPU_SPRITE_PHASE_CLEAR,
  PPU_SPRITE_PHASE_EVAL,
  PPU_SPRITE_PHASE_FETCH,
  PPU_SPRITE_PHASE_REFRESH,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuSpriteEvalStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuSpriteEvalState = ppuSpriteEvalStateExports;
}
