let ppuDotPhaseSpriteIdleCore = 'IDLE';
let ppuDotPhaseSpriteClearCore = 'CLEAR';
let ppuDotPhaseSpriteEvalCore = 'EVAL';
let ppuDotPhaseSpriteFetchCore = 'FETCH';
let ppuDotPhaseSpriteRefreshCore = 'REFRESH';

if (typeof require !== 'undefined') {
  try {
    ({
      PPU_SPRITE_PHASE_IDLE: ppuDotPhaseSpriteIdleCore,
      PPU_SPRITE_PHASE_CLEAR: ppuDotPhaseSpriteClearCore,
      PPU_SPRITE_PHASE_EVAL: ppuDotPhaseSpriteEvalCore,
      PPU_SPRITE_PHASE_FETCH: ppuDotPhaseSpriteFetchCore,
      PPU_SPRITE_PHASE_REFRESH: ppuDotPhaseSpriteRefreshCore,
    } = require('./ppu-sprite-eval-state'));
  } catch (_err) {
    // Keep fallback constants for browser-global-only boot paths.
  }
}

if (typeof globalThis !== 'undefined' && globalThis.NESCorePpuSpriteEvalState) {
  ppuDotPhaseSpriteIdleCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_IDLE || ppuDotPhaseSpriteIdleCore;
  ppuDotPhaseSpriteClearCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_CLEAR || ppuDotPhaseSpriteClearCore;
  ppuDotPhaseSpriteEvalCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_EVAL || ppuDotPhaseSpriteEvalCore;
  ppuDotPhaseSpriteFetchCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_FETCH || ppuDotPhaseSpriteFetchCore;
  ppuDotPhaseSpriteRefreshCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_REFRESH || ppuDotPhaseSpriteRefreshCore;
}

function isPpuRenderScanline(scanline) {
  return (scanline >= 0 && scanline < 240) || scanline === 261;
}

function isPpuVisibleScanline(scanline) {
  return scanline >= 0 && scanline < 240;
}

const PPU_DOT_MAX = 340;
const PPU_PHASE_INDEX_IDLE = 0;
const PPU_PHASE_INDEX_CLEAR = 1;
const PPU_PHASE_INDEX_EVAL = 2;
const PPU_PHASE_INDEX_FETCH = 3;
const PPU_PHASE_INDEX_REFRESH = 4;
const ppuDotBgFetchWindow = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotBgIncrementCoarseX = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotBgIncrementY = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotBgCopyHorizontalBits = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotCaptureVisibleLine = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotBeginSpriteEval = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotSwapSecondaryOam = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotSpritePhaseIndex = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotSpriteDotInWindow = new Uint16Array(PPU_DOT_MAX + 1);
const ppuDotSpriteReadPhase = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotSpriteWritePhase = new Uint8Array(PPU_DOT_MAX + 1);
const ppuDotSpriteWindowPhase = new Array(PPU_DOT_MAX + 1);

for (let dot = 0; dot <= PPU_DOT_MAX; dot += 1) {
  const bgFetchWindow = (dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336);
  ppuDotBgFetchWindow[dot] = bgFetchWindow ? 1 : 0;
  ppuDotBgIncrementCoarseX[dot] = (bgFetchWindow && (dot & 0x07) === 0) ? 1 : 0;
  ppuDotBgIncrementY[dot] = dot === 256 ? 1 : 0;
  ppuDotBgCopyHorizontalBits[dot] = dot === 257 ? 1 : 0;
  ppuDotCaptureVisibleLine[dot] = dot === 1 ? 1 : 0;
  ppuDotBeginSpriteEval[dot] = dot === 1 ? 1 : 0;
  ppuDotSwapSecondaryOam[dot] = dot === 257 ? 1 : 0;

  let phaseIndex = PPU_PHASE_INDEX_IDLE;
  let dotInWindow = 0;
  if (dot >= 1 && dot <= 64) {
    phaseIndex = PPU_PHASE_INDEX_CLEAR;
    dotInWindow = dot;
  } else if (dot >= 65 && dot <= 256) {
    phaseIndex = PPU_PHASE_INDEX_EVAL;
    dotInWindow = dot - 64;
  } else if (dot >= 257 && dot <= 320) {
    phaseIndex = PPU_PHASE_INDEX_FETCH;
    dotInWindow = dot - 256;
  } else if (dot >= 321 && dot <= 340) {
    phaseIndex = PPU_PHASE_INDEX_REFRESH;
    dotInWindow = dot - 320;
  }
  ppuDotSpritePhaseIndex[dot] = phaseIndex;
  ppuDotSpriteDotInWindow[dot] = dotInWindow;
  ppuDotSpriteReadPhase[dot] = (phaseIndex === PPU_PHASE_INDEX_EVAL && (dot & 1) === 1) ? 1 : 0;
  ppuDotSpriteWritePhase[dot] = (phaseIndex === PPU_PHASE_INDEX_EVAL && (dot & 1) === 0) ? 1 : 0;
  ppuDotSpriteWindowPhase[dot] = ppuSpritePhaseFromIndex(phaseIndex);
}

function ppuSpritePhaseFromIndex(index) {
  if (index === PPU_PHASE_INDEX_CLEAR) return ppuDotPhaseSpriteClearCore;
  if (index === PPU_PHASE_INDEX_EVAL) return ppuDotPhaseSpriteEvalCore;
  if (index === PPU_PHASE_INDEX_FETCH) return ppuDotPhaseSpriteFetchCore;
  if (index === PPU_PHASE_INDEX_REFRESH) return ppuDotPhaseSpriteRefreshCore;
  return ppuDotPhaseSpriteIdleCore;
}

function classifyPpuDotPhase(scanline, dot, renderingEnabled, out = null) {
  const phase = out || {};
  const line = scanline | 0;
  const d = dot | 0;
  const visibleScanline = line >= 0 && line < 240;
  const renderScanline = visibleScanline || line === 261;
  const renderingActive = !!(renderingEnabled && renderScanline);
  const dotIndex = (dot >= 0 && dot <= PPU_DOT_MAX) ? dot : 0;
  const x = (d - 1) | 0;

  phase.scanline = line;
  phase.dot = d;
  phase.x = x;
  phase.renderScanline = renderScanline;
  phase.visibleScanline = visibleScanline;
  phase.renderingActive = renderingActive;
  phase.visiblePixel = visibleScanline && x >= 0 && x < 256;
  phase.captureVisibleLineState = visibleScanline && dotIndex === 1;
  phase.spriteTargetScanline = line === 261 ? 0 : ((line + 1) | 0);

  if (renderingActive) {
    phase.bgFetchActive = ppuDotBgFetchWindow[dotIndex] !== 0;
    phase.bgIncrementCoarseX = ppuDotBgIncrementCoarseX[dotIndex] !== 0;
    phase.bgIncrementY = ppuDotBgIncrementY[dotIndex] !== 0;
    phase.bgCopyHorizontalBits = ppuDotBgCopyHorizontalBits[dotIndex] !== 0;
    phase.bgCopyVerticalBits = line === 261 && d >= 280 && d <= 304;
    phase.beginSpriteEvaluation = ppuDotBeginSpriteEval[dotIndex] !== 0;
    phase.swapSecondaryOam = ppuDotSwapSecondaryOam[dotIndex] !== 0;
    phase.spriteWindowPhase = ppuDotSpriteWindowPhase[dotIndex];
    phase.spriteDotInWindow = ppuDotSpriteDotInWindow[dotIndex] | 0;
    phase.spriteReadPhase = ppuDotSpriteReadPhase[dotIndex] !== 0;
    phase.spriteWritePhase = ppuDotSpriteWritePhase[dotIndex] !== 0;
  } else {
    phase.bgFetchActive = false;
    phase.bgIncrementCoarseX = false;
    phase.bgIncrementY = false;
    phase.bgCopyHorizontalBits = false;
    phase.bgCopyVerticalBits = false;
    phase.beginSpriteEvaluation = false;
    phase.swapSecondaryOam = false;
    phase.spriteWindowPhase = ppuDotPhaseSpriteIdleCore;
    phase.spriteDotInWindow = 0;
    phase.spriteReadPhase = false;
    phase.spriteWritePhase = false;
  }
  return phase;
}

const ppuDotPhaseExports = {
  classifyPpuDotPhase,
  isPpuRenderScanline,
  isPpuVisibleScanline,
  PPU_SPRITE_PHASE_IDLE: ppuDotPhaseSpriteIdleCore,
  PPU_SPRITE_PHASE_CLEAR: ppuDotPhaseSpriteClearCore,
  PPU_SPRITE_PHASE_EVAL: ppuDotPhaseSpriteEvalCore,
  PPU_SPRITE_PHASE_FETCH: ppuDotPhaseSpriteFetchCore,
  PPU_SPRITE_PHASE_REFRESH: ppuDotPhaseSpriteRefreshCore,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuDotPhaseExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuDotPhase = ppuDotPhaseExports;
}
