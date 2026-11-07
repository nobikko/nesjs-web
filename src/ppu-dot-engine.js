let ppuDotEngineClassifyDotPhaseCore = null;
let ppuDotEngineIsRenderScanlineCore = null;
if (typeof require !== 'undefined') {
  try {
    ({
      classifyPpuDotPhase: ppuDotEngineClassifyDotPhaseCore,
      isPpuRenderScanline: ppuDotEngineIsRenderScanlineCore,
    } = require('./ppu-dot-phase'));
  } catch (_err) {
    ppuDotEngineClassifyDotPhaseCore = null;
    ppuDotEngineIsRenderScanlineCore = null;
  }
}
if (
  (!ppuDotEngineClassifyDotPhaseCore || !ppuDotEngineIsRenderScanlineCore) &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCorePpuDotPhase
) {
  ppuDotEngineClassifyDotPhaseCore = globalThis.NESCorePpuDotPhase.classifyPpuDotPhase;
  ppuDotEngineIsRenderScanlineCore = globalThis.NESCorePpuDotPhase.isPpuRenderScanline;
}

const PPU_DOT_ENGINE_MAX = 340;
const PPU_DOT_ENGINE_SPRITE_PHASE_IDLE = 0;
const PPU_DOT_ENGINE_SPRITE_PHASE_CLEAR = 1;
const PPU_DOT_ENGINE_SPRITE_PHASE_EVAL = 2;
const PPU_DOT_ENGINE_SPRITE_PHASE_FETCH = 3;
const PPU_DOT_ENGINE_SPRITE_PHASE_REFRESH = 4;
const ppuDotEngineSpriteWindowPhaseNames = ['IDLE', 'CLEAR', 'EVAL', 'FETCH', 'REFRESH'];
const ppuDotEngineBgPixelOpaque = 0x40;
const ppuDotEngineSpritePixelOpaque = 0x40;
const ppuDotEngineSpritePixelBehindBg = 0x80;
const ppuDotEngineSpritePixelSlotShift = 8;
const ppuDotEngineSpritePixelSlotMask = 0x0700;
const ppuDotEngineBgFetchWindow = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineBgIncrementCoarseX = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineBgIncrementY = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineBgCopyHorizontalBits = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineSpriteWindowPhase = new Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineSpriteWindowPhaseCode = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineSpriteDotInWindow = new Uint16Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineSpriteReadPhase = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);
const ppuDotEngineSpriteWritePhase = new Uint8Array(PPU_DOT_ENGINE_MAX + 1);

for (let dot = 0; dot <= PPU_DOT_ENGINE_MAX; dot += 1) {
  const bgFetchWindow = (dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336);
  ppuDotEngineBgFetchWindow[dot] = bgFetchWindow ? 1 : 0;
  ppuDotEngineBgIncrementCoarseX[dot] = (bgFetchWindow && (dot & 0x07) === 0) ? 1 : 0;
  ppuDotEngineBgIncrementY[dot] = dot === 256 ? 1 : 0;
  ppuDotEngineBgCopyHorizontalBits[dot] = dot === 257 ? 1 : 0;

  let spritePhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_IDLE;
  if (dot >= 1 && dot <= 64) {
    spritePhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_CLEAR;
    ppuDotEngineSpriteDotInWindow[dot] = dot;
  } else if (dot >= 65 && dot <= 256) {
    spritePhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_EVAL;
    ppuDotEngineSpriteDotInWindow[dot] = dot - 64;
  } else if (dot >= 257 && dot <= 320) {
    spritePhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_FETCH;
    ppuDotEngineSpriteDotInWindow[dot] = dot - 256;
  } else if (dot >= 321 && dot <= 340) {
    spritePhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_REFRESH;
    ppuDotEngineSpriteDotInWindow[dot] = dot - 320;
  } else {
    ppuDotEngineSpriteDotInWindow[dot] = 0;
  }
  ppuDotEngineSpriteWindowPhaseCode[dot] = spritePhaseCode & 0xff;
  ppuDotEngineSpriteWindowPhase[dot] = ppuDotEngineSpriteWindowPhaseNames[spritePhaseCode] || 'IDLE';

  ppuDotEngineSpriteReadPhase[dot] = (dot >= 65 && dot <= 256 && (dot & 1) === 1) ? 1 : 0;
  ppuDotEngineSpriteWritePhase[dot] = (dot >= 65 && dot <= 256 && (dot & 1) === 0) ? 1 : 0;
}

class PpuDotEngine {
  constructor(host) {
    this.host = host;
    this._dotPhaseScratch = {};
    this._composeScratch = {
      frameOffset: -1,
      bgOpaque: false,
      spritePacked: 0,
    };
    this._mapperDotTickScratch = {
      frame: 0,
      scanline: 0,
      dot: 0,
      x: 0,
      rendering: false,
      ppuAddr: 0,
      ppuAddrBus: 0,
      ppuAddrV: 0,
    };
    this._tickBindings = null;
  }

  _resolveTickBindings(nes, ppu) {
    const cached = this._tickBindings;
    if (cached) {
      return cached;
    }
    const backgroundPipeline = nes.ppuBackgroundPipeline;
    const spritePipeline = nes.ppuSpritePipeline;
    const mapper = nes.mapper;
    const mapperHooks = nes.mapperHooks;
    const hasBgSamplePacked = !!(
      backgroundPipeline &&
      typeof backgroundPipeline.samplePixelPacked === 'function'
    );
    const hasBgSamplePackedFast = !!(
      backgroundPipeline &&
      typeof backgroundPipeline.samplePixelPackedFast === 'function'
    );
    const hasSpriteSamplePacked = !!(
      spritePipeline &&
      typeof spritePipeline.samplePixelPacked === 'function'
    );
    const hasSpriteSamplePackedVisibleFast = !!(
      spritePipeline &&
      typeof spritePipeline.samplePixelPackedVisibleFast === 'function'
    );
    const hasSpriteClockSet = !!(
      spritePipeline &&
      typeof spritePipeline.clockSpriteSet === 'function'
    );
    const hasSpriteOnDotFast = !!(
      spritePipeline &&
      typeof spritePipeline.onDotFast === 'function'
    );
    const hasSpriteOnDotFastCode = !!(
      spritePipeline &&
      typeof spritePipeline.onDotFastCode === 'function'
    );
    const hasSpriteClockSetFast = !!(
      spritePipeline &&
      typeof spritePipeline.clockSpriteSetFast === 'function'
    );
    const bgState = backgroundPipeline ? backgroundPipeline.state : null;
    const usePackedFastPath = !!(
      bgState &&
      hasBgSamplePackedFast &&
      hasSpriteSamplePackedVisibleFast &&
      hasSpriteOnDotFastCode &&
      hasSpriteClockSetFast
    );
    const bindings = {
      nes,
      ppu,
      backgroundPipeline,
      spritePipeline,
      mapper,
      mapperHooks,
      hasBgSamplePacked,
      hasBgSamplePackedFast,
      hasSpriteSamplePacked,
      hasSpriteSamplePackedVisibleFast,
      hasSpriteClockSet,
      hasSpriteOnDotFast,
      hasSpriteOnDotFastCode,
      hasSpriteClockSetFast,
      bgState,
      usePackedFastPath,
      hasRenderEnabledLatched: typeof nes.isPpuRenderingEnabledLatched === 'function',
      hasRenderEnabled: typeof nes.isPpuRenderingEnabled === 'function',
      renderingEnabledLatchedFn: typeof nes.isPpuRenderingEnabledLatched === 'function'
        ? nes.isPpuRenderingEnabledLatched.bind(nes)
        : null,
      renderingEnabledFn: typeof nes.isPpuRenderingEnabled === 'function'
        ? nes.isPpuRenderingEnabled.bind(nes)
        : null,
      hasClockPpuTimingState: typeof nes.clockPpuTimingState === 'function',
      clockPpuTimingStateFn: (
        nes.ppuIoPipeline &&
        typeof nes.ppuIoPipeline.clockTimingState === 'function'
      )
        ? nes.ppuIoPipeline.clockTimingState.bind(nes.ppuIoPipeline)
        : (typeof nes.clockPpuTimingState === 'function' ? nes.clockPpuTimingState.bind(nes) : null),
      mapperNeedsPpuDotTick: !!(
        mapper &&
        mapperHooks &&
        mapperHooks.onPpuDotTick &&
        typeof mapper.onPpuDotTick === 'function'
      ),
      mapperDotTickEvent: this._mapperDotTickScratch,
      preferRenderEnableShiftFast: !Object.prototype.hasOwnProperty.call(nes, 'isPpuRenderingEnabledLatched'),
    };
    this._tickBindings = bindings;
    return bindings;
  }

  _ppu(nes) {
    return nes.ppuState;
  }

  _renderingEnabled(nes) {
    if (nes && typeof nes.isPpuRenderingEnabledLatched === 'function') {
      return nes.isPpuRenderingEnabledLatched();
    }
    return nes.isPpuRenderingEnabled();
  }

  _renderLine(nes) {
    const ppu = this._ppu(nes);
    if (ppuDotEngineIsRenderScanlineCore) return ppuDotEngineIsRenderScanlineCore(ppu.scanline);
    return (ppu.scanline >= 0 && ppu.scanline < 240) || ppu.scanline === 261;
  }

  _classifyDotPhase(nes, renderingEnabledInput = null) {
    const ppu = this._ppu(nes);
    const renderingEnabled = (renderingEnabledInput == null)
      ? this._renderingEnabled(nes)
      : !!renderingEnabledInput;
    if (false && ppuDotEngineClassifyDotPhaseCore) {
      return ppuDotEngineClassifyDotPhaseCore(
        ppu.scanline | 0,
        ppu.dot | 0,
        renderingEnabled,
        this._dotPhaseScratch,
      );
    }
    const dot = ppu.dot | 0;
    const dotIndex = (dot >= 0 && dot <= PPU_DOT_ENGINE_MAX) ? dot : 0;
    const scanline = ppu.scanline | 0;
    const visibleScanline = scanline >= 0 && scanline < 240;
    const renderLine = visibleScanline || scanline === 261;
    const renderingActive = !!(renderingEnabled && renderLine);
    const x = (dot - 1) | 0;
    const phase = this._dotPhaseScratch;
    phase.scanline = scanline;
    phase.dot = dot;
    phase.x = x;
    phase.renderScanline = renderLine;
    phase.visibleScanline = visibleScanline;
    phase.renderingActive = renderingActive;
    phase.visiblePixel = visibleScanline && x >= 0 && x < 256;
    phase.captureVisibleLineState = visibleScanline && dotIndex === 1;
    phase.spriteTargetScanline = scanline === 261 ? 0 : ((scanline + 1) | 0);
    if (renderingActive) {
      phase.bgFetchActive = ppuDotEngineBgFetchWindow[dotIndex] !== 0;
      phase.bgIncrementCoarseX = ppuDotEngineBgIncrementCoarseX[dotIndex] !== 0;
      phase.bgIncrementY = ppuDotEngineBgIncrementY[dotIndex] !== 0;
      phase.bgCopyHorizontalBits = ppuDotEngineBgCopyHorizontalBits[dotIndex] !== 0;
      phase.bgCopyVerticalBits = scanline === 261 && dot >= 280 && dot <= 304;
      phase.beginSpriteEvaluation = dotIndex === 1;
      phase.swapSecondaryOam = dotIndex === 257;
      phase.spriteWindowPhase = ppuDotEngineSpriteWindowPhase[dotIndex];
      phase.spriteDotInWindow = ppuDotEngineSpriteDotInWindow[dotIndex] | 0;
      phase.spriteReadPhase = ppuDotEngineSpriteReadPhase[dotIndex] !== 0;
      phase.spriteWritePhase = ppuDotEngineSpriteWritePhase[dotIndex] !== 0;
    } else {
      phase.bgFetchActive = false;
      phase.bgIncrementCoarseX = false;
      phase.bgIncrementY = false;
      phase.bgCopyHorizontalBits = false;
      phase.bgCopyVerticalBits = false;
      phase.beginSpriteEvaluation = false;
      phase.swapSecondaryOam = false;
      phase.spriteWindowPhase = 'IDLE';
      phase.spriteDotInWindow = 0;
      phase.spriteReadPhase = false;
      phase.spriteWritePhase = false;
    }
    return phase;
  }

  _incrementCoarseX(nes) {
    if (nes.incrementPpuCoarseX) {
      nes.incrementPpuCoarseX();
      return;
    }
    const ppu = this._ppu(nes);
    if ((ppu.v & 0x001f) === 31) {
      ppu.v &= ~0x001f;
      ppu.v ^= 0x0400;
    } else {
      ppu.v = (ppu.v + 1) & 0x7fff;
    }
  }

  _incrementY(nes) {
    if (nes.incrementPpuY) {
      nes.incrementPpuY();
      return;
    }
    const ppu = this._ppu(nes);
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

  _copyHorizontalBits(nes) {
    if (nes.copyPpuHorizontalBits) {
      nes.copyPpuHorizontalBits();
      return;
    }
    const ppu = this._ppu(nes);
    ppu.v = (ppu.v & ~0x041f) | (ppu.t & 0x041f);
  }

  _copyVerticalBits(nes) {
    if (nes.copyPpuVerticalBits) {
      nes.copyPpuVerticalBits();
      return;
    }
    const ppu = this._ppu(nes);
    ppu.v = (ppu.v & ~0x7be0) | (ppu.t & 0x7be0);
  }

  _captureLineState(nes, y) {
    const ppu = this._ppu(nes);
    const coarseY = (ppu.v >> 5) & 0x1f;
    const fineY = (ppu.v >> 12) & 0x07;
    const ntY = (ppu.v >> 11) & 0x01;
    const worldY = ((ntY * 240) + (coarseY * 8) + fineY) & 0x1ff;
    const coarseX = ppu.v & 0x1f;

    ppu.scanlineV[y] = ppu.v & 0x7fff;
    ppu.scanlineFineX[y] = ppu.fineX & 0x07;
    ppu.scanlineScrollX[y] = ((coarseX << 3) | (ppu.fineX & 0x07)) & 0xff;
    ppu.scanlineScrollY[y] = ((coarseY << 3) | fineY) & 0xff;
    ppu.scanlinePpuCtrl[y] = ppu.ctrl;
    ppu.scanlineBgWorldY[y] = worldY;
    ppu.scanlineBgNtBaseY[y] = ntY;
    ppu.scanlineChrBank[y] = (typeof nes.mapper.chrBank === 'number') ? (nes.mapper.chrBank & 0xff) : 0;
    // Cache "any visible sprite on line" once per scanline to avoid per-pixel
    // lazy recomputation in the hot visible-pixel loop.
    const spriteLineValid = ppu.spriteLineValid;
    let anyOnLine = false;
    if (spriteLineValid && spriteLineValid.length >= 8) {
      for (let slot = 0; slot < 8; slot += 1) {
        if ((spriteLineValid[slot] & 0x01) !== 0) {
          anyOnLine = true;
          break;
        }
      }
    }
    ppu.spriteAnyOnLine = anyOnLine;
  }

  _composeVisiblePixel(nes, dotPhase, x, y, out = null) {
    const composed = out || this._composeScratch;
    const ppu = this._ppu(nes);
    if (!dotPhase.visiblePixel) {
      composed.frameOffset = -1;
      composed.bgOpaque = false;
      composed.spritePacked = 0;
      return composed;
    }

    const frameOffset = (y * 256) + x;
    const bgEnableLatched = (typeof ppu.bgEnableShift === 'number')
      ? ((ppu.bgEnableShift & 0x02) !== 0)
      : ((ppu.mask & 0x08) !== 0);
    const bgLeftMask = (ppu.mask & 0x02) !== 0;
    const bgPipeline = nes.ppuBackgroundPipeline;
    let bgPacked;
    if (bgPipeline && typeof bgPipeline.samplePixelPacked === 'function') {
      bgPacked = bgPipeline.samplePixelPacked(x, bgEnableLatched, bgLeftMask) | 0;
    } else {
      const bgPixel = bgPipeline.samplePixel(x);
      bgPacked = (bgPixel.colorIndex & 0x3f) | (bgPixel.opaque ? ppuDotEngineBgPixelOpaque : 0);
    }
    const bgOpaque = (bgPacked & ppuDotEngineBgPixelOpaque) !== 0;
    let composedColor = bgPacked & 0x3f;
    ppu.frameBgOpaque[frameOffset] = bgOpaque ? 1 : 0;

    const spritePipeline = nes.ppuSpritePipeline;
    const objEnableLatched = (typeof ppu.objEnableShift === 'number')
      ? ((ppu.objEnableShift & 0x02) !== 0)
      : ((ppu.mask & 0x10) !== 0);
    const objLeftMask = (ppu.mask & 0x04) !== 0;
    let spritePacked;
    if (spritePipeline && typeof spritePipeline.samplePixelPacked === 'function') {
      spritePacked = spritePipeline.samplePixelPacked(x, y, objEnableLatched, objLeftMask) | 0;
    } else {
      const spritePixel = spritePipeline.samplePixel(x, y);
      const slot = (spritePixel.slot == null || spritePixel.slot < 0) ? 0 : (spritePixel.slot & 0x07);
      spritePacked = (spritePixel.colorIndex & 0x3f)
        | (spritePixel.opaque ? ppuDotEngineSpritePixelOpaque : 0)
        | (spritePixel.behindBg ? ppuDotEngineSpritePixelBehindBg : 0)
        | (slot << ppuDotEngineSpritePixelSlotShift);
    }
    if (
      (spritePacked & ppuDotEngineSpritePixelOpaque) !== 0 &&
      !(((spritePacked & ppuDotEngineSpritePixelBehindBg) !== 0) && bgOpaque)
    ) {
      composedColor = spritePacked & 0x3f;
    }

    ppu.frameColor[frameOffset] = composedColor & 0x3f;
    if (!ppu.frameIncludesSprites) {
      ppu.frameIncludesSprites = true;
    }

    composed.frameOffset = frameOffset;
    composed.bgOpaque = bgOpaque;
    composed.spritePacked = spritePacked;
    return composed;
  }

  _visiblePixelX(dotPhase) {
    if (!dotPhase || !dotPhase.visiblePixel) return -1;
    const x = dotPhase.x | 0;
    if (x < 0 || x >= 256) return -1;
    return x;
  }

  _maybeSetSprite0Hit(ppu, dotPhase, y, spritePacked, bgOpaque) {
    if ((ppu.status & 0x40) !== 0) return;
    const visibleX = this._visiblePixelX(dotPhase);
    if (visibleX < 0 || visibleX >= 255) return;
    if (!ppu.sprite0OnLine) return;
    if ((spritePacked & ppuDotEngineSpritePixelOpaque) === 0) return;
    if (((spritePacked & ppuDotEngineSpritePixelSlotMask) >> ppuDotEngineSpritePixelSlotShift) !== 0) return;
    if (!bgOpaque) return;
    ppu.status |= 0x40;
    ppu.sprite0HitScanline = y;
  }

  _clockSpriteSet(nes, dotPhase) {
    if (
      nes.ppuSpritePipeline &&
      typeof nes.ppuSpritePipeline.clockSpriteSet === 'function'
    ) {
      nes.ppuSpritePipeline.clockSpriteSet(dotPhase);
    }
  }

  _updateSpriteCounterShift(nes, dotPhase) {
    const ppu = this._ppu(nes);
    let spriteSr = ppu.spriteCounterShift & 0x0f;
    if ((spriteSr & 0x04) === 0) {
      spriteSr = ((spriteSr << 1) & 0x0f);
    }
    if (dotPhase.dot === 339 && dotPhase.renderScanline) {
      spriteSr = nes.isPpuRenderingEnabled() ? 0x01 : 0x00;
    }
    if (dotPhase.dot === 256) {
      spriteSr = 0x00;
    }
    ppu.spriteCounterShift = spriteSr & 0x0f;
  }

  tick(ppuCycles) {
    const nes = this.host;
    const ppu = this._ppu(nes);
    let bindings = this._tickBindings;
    if (!bindings) {
      bindings = this._resolveTickBindings(nes, ppu);
    }
    const dotPhase = this._dotPhaseScratch;
    const palette = nes.palette;
    const backdropColor = (palette && palette.length > 0) ? (palette[0] & 0x3f) : 0;
    const frameColor = ppu.frameColor;
    const hasRenderEnabledLatched = bindings.hasRenderEnabledLatched;
    const renderingEnabledLatchedFn = bindings.renderingEnabledLatchedFn;
    const renderingEnabledFn = bindings.renderingEnabledFn;
    const preferRenderEnableShiftFast = !!bindings.preferRenderEnableShiftFast;
    const hasBgEnableShift = typeof ppu.bgEnableShift === 'number';
    const hasObjEnableShift = typeof ppu.objEnableShift === 'number';
    const hasRenderEnableShift = typeof ppu.renderEnableShift === 'number';
    const backgroundPipeline = bindings.backgroundPipeline;
    const spritePipeline = bindings.spritePipeline;
    const hasBgSamplePacked = bindings.hasBgSamplePacked;
    const hasSpriteSamplePacked = bindings.hasSpriteSamplePacked;
    const hasSpriteClockSet = bindings.hasSpriteClockSet;
    const hasSpriteOnDotFast = bindings.hasSpriteOnDotFast;
    const hasSpriteOnDotFastCode = bindings.hasSpriteOnDotFastCode;
    const hasSpriteClockSetFast = bindings.hasSpriteClockSetFast;
    const bgState = bindings.bgState;
    const spriteLineValid = ppu.spriteLineValid;
    const spriteLineX = ppu.spriteLineX;
    const spriteLineAttr = ppu.spriteLineAttr;
    const spriteLinePatternLo = ppu.spriteLinePatternLo;
    const spriteLinePatternHi = ppu.spriteLinePatternHi;
    const usePackedFastPath = bindings.usePackedFastPath;
    const clockPpuTimingStateFn = bindings.clockPpuTimingStateFn;
    const mapper = bindings.mapper;
    const mapperNeedsPpuDotTick = bindings.mapperNeedsPpuDotTick;
    for (let i = 0; i < ppuCycles; i += 1) {
      if (ppu.vblankSetOnLastTick) ppu.vblankSetOnLastTick = false;
      if (ppu.vblankClearOnLastTick) ppu.vblankClearOnLastTick = false;
      ppu.dotClock = (ppu.dotClock + 1) >>> 0;
      if (clockPpuTimingStateFn) {
        clockPpuTimingStateFn();
      }
      const renderingEnabled = (hasRenderEnableShift && preferRenderEnableShiftFast)
        ? ((ppu.renderEnableShift & 0x02) !== 0)
        : (hasRenderEnabledLatched
          ? !!(renderingEnabledLatchedFn && renderingEnabledLatchedFn())
          : ((ppu.mask & 0x18) !== 0));
      ppu.dot += 1;
      if (
        ppu.scanline === 261 &&
        ppu.dot === 340 &&
        ppu.oddFrame &&
        renderingEnabled
      ) {
        ppu.dot = 0;
        ppu.scanline = 0;
        ppu.oddFrame = !ppu.oddFrame;
      } else if (ppu.dot >= 341) {
        ppu.dot = 0;
        ppu.scanline += 1;
        if (ppu.scanline >= 262) {
          ppu.scanline = 0;
          ppu.oddFrame = !ppu.oddFrame;
        }
      }

      const dot = ppu.dot | 0;
      const y = ppu.scanline | 0;
      const x = (dot - 1) | 0;
      const dotIndex = (dot >= 0 && dot <= PPU_DOT_ENGINE_MAX) ? dot : 0;
      const visibleScanline = y >= 0 && y < 240;
      const renderLine = visibleScanline || y === 261;
      if (!renderLine) {
        if (mapperNeedsPpuDotTick) {
          const ppuAddrBus = (typeof ppu.vramAddressBus === 'number' ? ppu.vramAddressBus : ppu.v) & 0x3fff;
          const tickEvent = bindings.mapperDotTickEvent;
          tickEvent.frame = ppu.frameCounter >>> 0;
          tickEvent.scanline = y | 0;
          tickEvent.dot = ppu.dot | 0;
          tickEvent.x = x | 0;
          tickEvent.rendering = false;
          tickEvent.ppuAddr = ppuAddrBus;
          tickEvent.ppuAddrBus = ppuAddrBus;
          tickEvent.ppuAddrV = ppu.v & 0x3fff;
          mapper.onPpuDotTick(tickEvent);
        }
        if (dot === 256) {
          ppu.spriteCounterShift = 0x00;
        }
        // MiSTer-style entering_vblank equivalent: scanline start tick.
        if (ppu.scanline === 241 && ppu.dot === 1) {
          if (!ppu.preventVblankSet) {
            ppu.status |= 0x80;
            ppu.nmiOccurred = true;
            ppu.vblankSetOnLastTick = true;
            ppu.vblankStarted = true;
            ppu.frameCounter += 1;
            nes.interrupts.setPpuVblank(true);
          }
          ppu.preventVblankSet = false;
        }
        continue;
      }
      const renderingActive = !!(renderingEnabled && renderLine);
      const visiblePixel = visibleScanline && x >= 0 && x < 256;
      const captureVisibleLineState = visibleScanline && dotIndex === 1;
      let bgFetchActive = 0;
      let bgIncrementCoarseX = 0;
      let bgIncrementY = 0;
      let bgCopyHorizontalBits = 0;
      let bgCopyVerticalBits = false;
      let beginSpriteEvaluation = false;
      let swapSecondaryOam = false;
      let spriteWindowPhaseCode = PPU_DOT_ENGINE_SPRITE_PHASE_IDLE;
      let spriteDotInWindow = 0;
      let spriteReadPhase = false;
      if (renderingActive) {
        bgFetchActive = ppuDotEngineBgFetchWindow[dotIndex];
        bgIncrementCoarseX = ppuDotEngineBgIncrementCoarseX[dotIndex];
        bgIncrementY = ppuDotEngineBgIncrementY[dotIndex];
        bgCopyHorizontalBits = ppuDotEngineBgCopyHorizontalBits[dotIndex];
        bgCopyVerticalBits = y === 261 && dot >= 280 && dot <= 304;
        beginSpriteEvaluation = dotIndex === 1;
        swapSecondaryOam = dotIndex === 257;
        spriteWindowPhaseCode = ppuDotEngineSpriteWindowPhaseCode[dotIndex] | 0;
        spriteDotInWindow = ppuDotEngineSpriteDotInWindow[dotIndex] | 0;
        spriteReadPhase = ppuDotEngineSpriteReadPhase[dotIndex] !== 0;
      }
      const spriteTargetScanline = y === 261 ? 0 : ((y + 1) | 0);
      if (mapperNeedsPpuDotTick) {
        const ppuAddrBus = (typeof ppu.vramAddressBus === 'number' ? ppu.vramAddressBus : ppu.v) & 0x3fff;
        const tickEvent = bindings.mapperDotTickEvent;
        tickEvent.frame = ppu.frameCounter >>> 0;
        tickEvent.scanline = y | 0;
        tickEvent.dot = ppu.dot | 0;
        tickEvent.x = x | 0;
        tickEvent.rendering = renderingActive === true;
        tickEvent.ppuAddr = ppuAddrBus;
        tickEvent.ppuAddrBus = ppuAddrBus;
        tickEvent.ppuAddrV = ppu.v & 0x3fff;
        mapper.onPpuDotTick(tickEvent);
      }

      if (bgFetchActive !== 0) {
        backgroundPipeline.onRenderDot(ppu.dot);
      }
      if (renderingActive) {
        if (bgIncrementCoarseX !== 0) {
          this._incrementCoarseX(nes);
        }
        if (bgIncrementY !== 0) {
          this._incrementY(nes);
        }
        if (bgCopyHorizontalBits !== 0) {
          this._copyHorizontalBits(nes);
        }
        if (bgCopyVerticalBits) {
          this._copyVerticalBits(nes);
        }
      }

      if (hasSpriteOnDotFastCode) {
        spritePipeline.onDotFastCode(
          y,
          dot,
          renderingActive,
          beginSpriteEvaluation,
          spriteTargetScanline,
          swapSecondaryOam,
          spriteWindowPhaseCode,
          spriteDotInWindow,
          spriteReadPhase,
        );
      } else if (hasSpriteOnDotFast) {
        spritePipeline.onDotFast(
          y,
          dot,
          renderingActive,
          beginSpriteEvaluation,
          spriteTargetScanline,
          swapSecondaryOam,
          ppuDotEngineSpriteWindowPhaseNames[spriteWindowPhaseCode] || 'IDLE',
          spriteDotInWindow,
          spriteReadPhase,
        );
      } else {
        dotPhase.scanline = y;
        dotPhase.dot = dot;
        dotPhase.renderingActive = renderingActive;
        dotPhase.spriteTargetScanline = spriteTargetScanline;
        dotPhase.beginSpriteEvaluation = beginSpriteEvaluation;
        dotPhase.swapSecondaryOam = swapSecondaryOam;
        dotPhase.spriteWindowPhase = ppuDotEngineSpriteWindowPhaseNames[spriteWindowPhaseCode] || 'IDLE';
        dotPhase.spriteDotInWindow = spriteDotInWindow;
        dotPhase.spriteReadPhase = spriteReadPhase;
        spritePipeline.onDot(dotPhase);
      }

      if (captureVisibleLineState) {
        this._captureLineState(nes, y);
      }
      if (visiblePixel) {
        const frameOffset = (y << 8) + x;
        if (usePackedFastPath) {
          const bgEnableLatched = hasBgEnableShift
            ? ((ppu.bgEnableShift & 0x02) !== 0)
            : ((ppu.mask & 0x08) !== 0);
          const bgLeftMask = (ppu.mask & 0x02) !== 0;
          let bgPacked = backdropColor;
          if (bgEnableLatched && (bgLeftMask || x >= 8)) {
            const bit = ppu.fineX & 0x07;
            const colorId = (((bgState.patternHiShift >>> bit) & 0x01) << 1)
              | ((bgState.patternLoShift >>> bit) & 0x01);
            if (colorId !== 0) {
              const paletteIndex = ((((bgState.attrHiShift >>> bit) & 0x01) << 1)
                | ((bgState.attrLoShift >>> bit) & 0x01)) << 2;
              bgPacked = (palette[paletteIndex | colorId] & 0x3f) | ppuDotEngineBgPixelOpaque;
            }
          }
          const bgOpaque = (bgPacked & ppuDotEngineBgPixelOpaque) !== 0;
          let composedColor = bgPacked & 0x3f;

          const objEnableLatched = hasObjEnableShift
            ? ((ppu.objEnableShift & 0x02) !== 0)
            : ((ppu.mask & 0x10) !== 0);
          const objLeftMask = (ppu.mask & 0x04) !== 0;
          let spritePacked = 0;
          if (objEnableLatched && (objLeftMask || x >= 8)) {
            if (ppu.spriteAnyOnLine) {
              const counting = (ppu.spriteCounterShift & 0x04) !== 0;
              for (let slot = 0; slot < 8; slot += 1) {
                if ((spriteLineValid[slot] & 0x01) === 0) continue;
                const xCounter = spriteLineX[slot];
                if ((xCounter !== 0) && counting) continue;
                const attr = spriteLineAttr[slot];
                const lo = spriteLinePatternLo[slot];
                const hi = spriteLinePatternHi[slot];
                const colorId = ((hi & 0x80) >>> 6) | ((lo & 0x80) >>> 7);
                if (colorId === 0) continue;
                const colorIndex = palette[0x10 + ((attr & 0x03) << 2) + colorId] & 0x3f;
                spritePacked = (colorIndex
                  | ppuDotEngineSpritePixelOpaque
                  | (((attr & 0x20) !== 0) ? ppuDotEngineSpritePixelBehindBg : 0)
                  | ((slot & 0x07) << ppuDotEngineSpritePixelSlotShift)) & 0x07ff;
                break;
              }
            }
          }
          if (
            (spritePacked & ppuDotEngineSpritePixelOpaque) !== 0 &&
            !(((spritePacked & ppuDotEngineSpritePixelBehindBg) !== 0) && bgOpaque)
          ) {
            composedColor = spritePacked & 0x3f;
          }

          frameColor[frameOffset] = composedColor & 0x3f;

          if (
            (ppu.status & 0x40) === 0 &&
            x >= 0 &&
            x < 255 &&
            ppu.sprite0OnLine &&
            (spritePacked & ppuDotEngineSpritePixelOpaque) !== 0 &&
            (((spritePacked & ppuDotEngineSpritePixelSlotMask) >> ppuDotEngineSpritePixelSlotShift) === 0) &&
            bgOpaque
          ) {
            ppu.status |= 0x40;
            ppu.sprite0HitScanline = y;
          }
        } else {
          const bgEnableLatched = hasBgEnableShift
            ? ((ppu.bgEnableShift & 0x02) !== 0)
            : ((ppu.mask & 0x08) !== 0);
          const bgLeftMask = (ppu.mask & 0x02) !== 0;
          let bgPacked = 0;
          if (!bgEnableLatched || (!bgLeftMask && x < 8)) {
            bgPacked = backdropColor;
          } else if (hasBgSamplePacked) {
            bgPacked = backgroundPipeline.samplePixelPacked(x, bgEnableLatched, bgLeftMask) | 0;
          } else {
            const bgPixel = backgroundPipeline.samplePixel(x);
            bgPacked = (bgPixel.colorIndex & 0x3f)
              | (bgPixel.opaque ? ppuDotEngineBgPixelOpaque : 0);
          }
          const bgOpaque = (bgPacked & ppuDotEngineBgPixelOpaque) !== 0;
          let composedColor = bgPacked & 0x3f;

          const objEnableLatched = hasObjEnableShift
            ? ((ppu.objEnableShift & 0x02) !== 0)
            : ((ppu.mask & 0x10) !== 0);
          const objLeftMask = (ppu.mask & 0x04) !== 0;
          let spritePacked = 0;
          if (objEnableLatched && (objLeftMask || x >= 8)) {
            if (hasSpriteSamplePacked) {
              spritePacked = spritePipeline.samplePixelPacked(x, y, objEnableLatched, objLeftMask) | 0;
            } else {
              const spritePixel = spritePipeline.samplePixel(x, y);
              const slot = (spritePixel.slot == null || spritePixel.slot < 0)
                ? 0
                : (spritePixel.slot & 0x07);
              spritePacked = (spritePixel.colorIndex & 0x3f)
                | (spritePixel.opaque ? ppuDotEngineSpritePixelOpaque : 0)
                | (spritePixel.behindBg ? ppuDotEngineSpritePixelBehindBg : 0)
                | (slot << ppuDotEngineSpritePixelSlotShift);
            }
          }
          if (
            (spritePacked & ppuDotEngineSpritePixelOpaque) !== 0 &&
            !(((spritePacked & ppuDotEngineSpritePixelBehindBg) !== 0) && bgOpaque)
          ) {
            composedColor = spritePacked & 0x3f;
          }

          frameColor[frameOffset] = composedColor & 0x3f;

          if (
            (ppu.status & 0x40) === 0 &&
            x >= 0 &&
            x < 255 &&
            ppu.sprite0OnLine &&
            (spritePacked & ppuDotEngineSpritePixelOpaque) !== 0 &&
            (((spritePacked & ppuDotEngineSpritePixelSlotMask) >> ppuDotEngineSpritePixelSlotShift) === 0) &&
            bgOpaque
          ) {
            ppu.status |= 0x40;
            ppu.sprite0HitScanline = y;
          }
        }
      }
      if (dot > 0 && dot <= 257) {
        if (usePackedFastPath) {
          spritePipeline.clockSpriteSetFast(dot, true, renderingActive);
        } else if (hasSpriteClockSetFast) {
          spritePipeline.clockSpriteSetFast(dot, true, renderingActive);
        } else if (hasSpriteClockSet) {
          dotPhase.dot = dot;
          dotPhase.renderScanline = true;
          dotPhase.renderingActive = renderingActive;
          spritePipeline.clockSpriteSet(dotPhase);
        }
      }
      let spriteSr = ppu.spriteCounterShift & 0x0f;
      if ((spriteSr & 0x04) === 0) {
        spriteSr = ((spriteSr << 1) & 0x0f);
      }
      if (dot === 339 && renderLine) {
        spriteSr = renderingEnabledFn
          ? (renderingEnabledFn() ? 0x01 : 0x00)
          : (((ppu.mask & 0x18) !== 0) ? 0x01 : 0x00);
      }
      if (dot === 256) {
        spriteSr = 0x00;
      }
      ppu.spriteCounterShift = spriteSr & 0x0f;

      // MiSTer-style entering_vblank equivalent: scanline start tick.
      if (ppu.scanline === 241 && ppu.dot === 1) {
        if (!ppu.preventVblankSet) {
          ppu.status |= 0x80;
          ppu.nmiOccurred = true;
          ppu.vblankSetOnLastTick = true;
          ppu.vblankStarted = true;
          ppu.frameCounter += 1;
          nes.interrupts.setPpuVblank(true);
        }
        ppu.preventVblankSet = false;
      }

      // MiSTer-style clear signal on pre-render line start.
      if (ppu.scanline === 261 && ppu.dot === 1) {
        // Release warm-up suppression (MiSTer: clear <= 0 when ce && clear_signal).
        ppu.warmupActive = false;
        ppu.preventVblankSet = false;
        ppu.vblankClearOnLastTick = true;
        ppu.status &= ~0x80;
        ppu.nmiOccurred = false;
        ppu.status &= ~0x40;
        ppu.status &= ~0x20;
        ppu.vblankStarted = false;
        ppu.sprite0HitScanline = -1;
        nes.interrupts.setPpuVblank(false);
      }
    }
  }
}

const ppuDotEngineExports = { PpuDotEngine };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuDotEngineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuDotEngine = ppuDotEngineExports;
}
