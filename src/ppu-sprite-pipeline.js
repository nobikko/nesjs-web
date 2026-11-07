let PpuSpritePipelineEvalStateCore = null;
let ppuSpritePhaseIdleCore = 'IDLE';
let ppuSpritePhaseClearCore = 'CLEAR';
let ppuSpritePhaseEvalCore = 'EVAL';
let ppuSpritePhaseFetchCore = 'FETCH';
let ppuSpritePhaseRefreshCore = 'REFRESH';
let ppuSpriteClassifyDotPhaseCore = null;
if (typeof require !== 'undefined') {
  try {
    ({
      PpuSpriteEvalState: PpuSpritePipelineEvalStateCore,
      PPU_SPRITE_PHASE_IDLE: ppuSpritePhaseIdleCore,
      PPU_SPRITE_PHASE_CLEAR: ppuSpritePhaseClearCore,
      PPU_SPRITE_PHASE_EVAL: ppuSpritePhaseEvalCore,
      PPU_SPRITE_PHASE_FETCH: ppuSpritePhaseFetchCore,
      PPU_SPRITE_PHASE_REFRESH: ppuSpritePhaseRefreshCore,
    } = require('./ppu-sprite-eval-state'));
  } catch (_err) {
    PpuSpritePipelineEvalStateCore = null;
  }
  try {
    ({ classifyPpuDotPhase: ppuSpriteClassifyDotPhaseCore } = require('./ppu-dot-phase'));
  } catch (_err) {
    ppuSpriteClassifyDotPhaseCore = null;
  }
}
if (!PpuSpritePipelineEvalStateCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuSpriteEvalState) {
  PpuSpritePipelineEvalStateCore = globalThis.NESCorePpuSpriteEvalState.PpuSpriteEvalState;
  ppuSpritePhaseIdleCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_IDLE || ppuSpritePhaseIdleCore;
  ppuSpritePhaseClearCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_CLEAR || ppuSpritePhaseClearCore;
  ppuSpritePhaseEvalCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_EVAL || ppuSpritePhaseEvalCore;
  ppuSpritePhaseFetchCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_FETCH || ppuSpritePhaseFetchCore;
  ppuSpritePhaseRefreshCore = globalThis.NESCorePpuSpriteEvalState.PPU_SPRITE_PHASE_REFRESH || ppuSpritePhaseRefreshCore;
}
if (!ppuSpriteClassifyDotPhaseCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuDotPhase) {
  ppuSpriteClassifyDotPhaseCore = globalThis.NESCorePpuDotPhase.classifyPpuDotPhase;
}
let ppuSpritePublishCpuExternalBusValueCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ publishCpuExternalBusValue: ppuSpritePublishCpuExternalBusValueCore } = require('./cpu-bus-publication'));
  } catch (_err) {
    ppuSpritePublishCpuExternalBusValueCore = null;
  }
}
if (
  !ppuSpritePublishCpuExternalBusValueCore &&
  typeof globalThis !== 'undefined' &&
  globalThis.NESCoreCpuBusPublication
) {
  ppuSpritePublishCpuExternalBusValueCore = globalThis.NESCoreCpuBusPublication.publishCpuExternalBusValue;
}
if (!ppuSpritePublishCpuExternalBusValueCore) {
  throw new Error('CpuBusPublication core not found');
}
if (!PpuSpritePipelineEvalStateCore) {
  throw new Error('PpuSpriteEvalState core not found');
}

const ppuSpritePixelOpaqueCore = 0x40;
const ppuSpritePixelBehindBgCore = 0x80;
const ppuSpritePixelSlotShiftCore = 8;
const ppuSpritePixelSlotMaskCore = 0x0700;
const ppuSpritePhaseCodeIdleCore = 0;
const ppuSpritePhaseCodeClearCore = 1;
const ppuSpritePhaseCodeEvalCore = 2;
const ppuSpritePhaseCodeFetchCore = 3;
const ppuSpritePhaseCodeRefreshCore = 4;

function ppuSpritePhaseCodeFromWindowPhase(phase) {
  if (phase === ppuSpritePhaseClearCore) return ppuSpritePhaseCodeClearCore;
  if (phase === ppuSpritePhaseEvalCore) return ppuSpritePhaseCodeEvalCore;
  if (phase === ppuSpritePhaseFetchCore) return ppuSpritePhaseCodeFetchCore;
  if (phase === ppuSpritePhaseRefreshCore) return ppuSpritePhaseCodeRefreshCore;
  return ppuSpritePhaseCodeIdleCore;
}

function reverseBits8(value) {
  let v = value & 0xff;
  v = ((v & 0xf0) >> 4) | ((v & 0x0f) << 4);
  v = ((v & 0xcc) >> 2) | ((v & 0x33) << 2);
  v = ((v & 0xaa) >> 1) | ((v & 0x55) << 1);
  return v & 0xff;
}

class PpuSpritePipeline {
  constructor(host) {
    this.host = host;
    this.state = (host && host.ppuState && host.ppuState.spriteEval)
      ? host.ppuState.spriteEval
      : new PpuSpritePipelineEvalStateCore();
    this._dotPhaseScratch = {
      scanline: 0,
      dot: 0,
      renderingActive: false,
      beginSpriteEvaluation: false,
      spriteTargetScanline: 0,
      swapSecondaryOam: false,
      spriteWindowPhase: ppuSpritePhaseIdleCore,
      spriteDotInWindow: 0,
      spriteReadPhase: false,
      spriteWritePhase: false,
      renderScanline: false,
      visibleScanline: false,
      visiblePixel: false,
      captureVisibleLineState: false,
      bgFetchActive: false,
      bgIncrementCoarseX: false,
      bgIncrementY: false,
      bgCopyHorizontalBits: false,
      bgCopyVerticalBits: false,
      x: -1,
    };
    this._spriteReadMetaLo = new Array(8);
    this._spriteReadMetaHi = new Array(8);
    for (let slot = 0; slot < 8; slot += 1) {
      this._spriteReadMetaLo[slot] = {
        __aleMeta: true,
        observe: true,
        origin: 'ppu_spr',
        stage: 'pattern_lo',
        slot,
        ale: true,
        rawAddr: 0,
        busAddr: 0,
      };
      this._spriteReadMetaHi[slot] = {
        __aleMeta: true,
        observe: true,
        origin: 'ppu_spr',
        stage: 'pattern_hi',
        slot,
        ale: true,
        rawAddr: 0,
        busAddr: 0,
      };
    }
  }

  reset() {
    this.state.reset();
  }

  _cpu() {
    return this.host.cpuState;
  }

  _setCpuOpenBus(value) {
    const v = value & 0xff;
    ppuSpritePublishCpuExternalBusValueCore(this.host, v);
  }

  _renderingEnabled() {
    if (this.host && typeof this.host.isPpuRenderingEnabledLatched === 'function') {
      return this.host.isPpuRenderingEnabledLatched();
    }
    return this.host.isPpuRenderingEnabled();
  }

  _renderLine() {
    const ppu = this.host.ppuState;
    const scanline = ppu.scanline;
    return (scanline >= 0 && scanline < 240) || scanline === 261;
  }

  _classifyDotPhase(dotPhaseInput) {
    if (dotPhaseInput && typeof dotPhaseInput === 'object') return dotPhaseInput;
    const ppu = this.host.ppuState;
    if (ppuSpriteClassifyDotPhaseCore) {
      return ppuSpriteClassifyDotPhaseCore(
        ppu.scanline | 0,
        ppu.dot | 0,
        this._renderingEnabled(),
        this._dotPhaseScratch,
      );
    }
    const renderLine = this._renderLine();
    const renderingActive = !!(this._renderingEnabled() && renderLine);
    let spriteWindowPhase = ppuSpritePhaseIdleCore;
    let spriteDotInWindow = 0;
    if (renderingActive) {
      if (ppu.dot >= 1 && ppu.dot <= 64) {
        spriteWindowPhase = ppuSpritePhaseClearCore;
        spriteDotInWindow = ppu.dot;
      } else if (ppu.dot >= 65 && ppu.dot <= 256) {
        spriteWindowPhase = ppuSpritePhaseEvalCore;
        spriteDotInWindow = ppu.dot - 64;
      } else if (ppu.dot >= 257 && ppu.dot <= 320) {
        spriteWindowPhase = ppuSpritePhaseFetchCore;
        spriteDotInWindow = ppu.dot - 256;
      } else if (ppu.dot >= 321 && ppu.dot <= 340) {
        spriteWindowPhase = ppuSpritePhaseRefreshCore;
        spriteDotInWindow = ppu.dot - 320;
      }
    }
    const out = this._dotPhaseScratch;
    out.scanline = ppu.scanline | 0;
    out.dot = ppu.dot | 0;
    out.renderingActive = renderingActive;
    out.beginSpriteEvaluation = !!(renderingActive && ppu.dot === 1);
    out.spriteTargetScanline = ppu.scanline === 261 ? 0 : (ppu.scanline + 1);
    out.swapSecondaryOam = !!(renderingActive && ppu.dot === 257);
    out.spriteWindowPhase = spriteWindowPhase;
    out.spriteDotInWindow = spriteDotInWindow;
    out.spriteReadPhase = !!(spriteWindowPhase === ppuSpritePhaseEvalCore && (ppu.dot & 1) === 1);
    out.spriteWritePhase = !!(spriteWindowPhase === ppuSpritePhaseEvalCore && (ppu.dot & 1) === 0);
    return out;
  }

  _windowPhaseFromDot(dot) {
    const d = dot | 0;
    if (d >= 1 && d <= 64) return ppuSpritePhaseClearCore;
    if (d >= 65 && d <= 256) return ppuSpritePhaseEvalCore;
    if (d >= 257 && d <= 320) return ppuSpritePhaseFetchCore;
    if (d >= 321 && d <= 340) return ppuSpritePhaseRefreshCore;
    return ppuSpritePhaseIdleCore;
  }

  _spriteHeight() {
    const ppu = this.host.ppuState;
    return (ppu.ctrl & 0x20) ? 16 : 8;
  }

  _writeSecondary(index, value, isSprite0) {
    const ppu = this.host.ppuState;
    if (index < 0 || index >= 0x20) return;
    ppu.nextSecondaryOam[index] = value & 0xff;
    const slot = (index >> 2) & 0x07;
    ppu.nextSecondarySpritePresent[slot] = 1;
    if (isSprite0) {
      ppu.nextSecondarySpriteIsSprite0[slot] = 1;
    }
  }

  _readPpuBus(addr, accessMeta) {
    const host = this.host;
    if (host && typeof host.ppuReadWithAle === 'function') {
      return host.ppuReadWithAle(addr, accessMeta) & 0xff;
    }
    return host.ppuRead(addr, accessMeta) & 0xff;
  }

  _computeSpritePatternAddress(slot, highPlane) {
    const ppu = this.host.ppuState;
    const state = this.state;
    const secBase = (slot * 4) & 0x1f;

    const spriteHeight = this._spriteHeight();
    const yByte = ppu.secondaryOam[secBase] & 0xff;
    const tile = ppu.secondaryOam[(secBase + 1) & 0x1f] & 0xff;
    const attr = ppu.secondaryOam[(secBase + 2) & 0x1f] & 0xff;
    const target = state.targetScanline & 0x1ff;
    let rowRaw;
    if (target === 261) {
      // MiSTer pre-render quirk: OAMEval compares scanline[7:0], so 261 behaves as 5.
      const scanlineByte = target & 0xff;
      rowRaw = scanlineByte - yByte;
    } else {
      const sy = (yByte + 1) & 0x1ff;
      rowRaw = target - sy;
    }
    const inRange = rowRaw >= 0 && rowRaw < spriteHeight;
    let row = rowRaw;
    if (attr & 0x80) {
      row = (spriteHeight - 1) - row;
    }

    let tileAddr;
    let tileRow;
    if (spriteHeight === 16) {
      const pt16 = (tile & 0x01) ? 0x1000 : 0x0000;
      const top = tile & 0xfe;
      const row16 = row & 0x0f;
      const half = (row16 >= 8) ? 1 : 0;
      tileAddr = pt16 + (((top + half) & 0xff) * 16);
      tileRow = row16 & 0x07;
    } else {
      const spritePtBase = (ppu.ctrl & 0x08) ? 0x1000 : 0x0000;
      tileAddr = spritePtBase + (tile * 16);
      tileRow = row & 0x07;
    }

    const addr = (tileAddr + tileRow + (highPlane ? 8 : 0)) & 0x3fff;
    return { valid: inRange, addr };
  }

  _fetchSpritePattern(slot, highPlane) {
    const ppu = this.host.ppuState;
    const secBase = (slot * 4) & 0x1f;
    ppu.spriteLineX[slot] = ppu.secondaryOam[(secBase + 3) & 0x1f] & 0xff;
    ppu.spriteLineAttr[slot] = ppu.secondaryOam[(secBase + 2) & 0x1f] & 0xff;
    ppu.spriteLineIsSprite0[slot] = slot === 0 ? 1 : 0;

    const fetch = this._computeSpritePatternAddress(slot, highPlane);
    const slotIndex = slot & 0x07;
    const accessMeta = highPlane
      ? this._spriteReadMetaHi[slotIndex]
      : this._spriteReadMetaLo[slotIndex];
    accessMeta.rawAddr = fetch.addr & 0x3fff;
    accessMeta.busAddr = fetch.addr & 0x3fff;
    const value = this._readPpuBus(fetch.addr, accessMeta) & 0xff;

    if (!fetch.valid) {
      if (highPlane) {
        ppu.spriteLinePatternHi[slot] = 0;
        ppu.spriteLineValid[slot] = 0;
      } else {
        ppu.spriteLinePatternLo[slot] = 0;
      }
      return;
    }

    if (highPlane) {
      const flipX = (ppu.spriteLineAttr[slot] & 0x40) !== 0;
      if (flipX) {
        ppu.spriteLinePatternLo[slot] = reverseBits8(ppu.spriteLinePatternLo[slot] & 0xff);
        ppu.spriteLinePatternHi[slot] = reverseBits8(value);
      } else {
        ppu.spriteLinePatternHi[slot] = value;
      }
      ppu.spriteLineValid[slot] = 1;
      ppu.spriteAnyOnLine = true;
    } else {
      ppu.spriteLinePatternLo[slot] = value;
    }
  }

  _isInRangeYByte(yByte) {
    const spriteHeight = this._spriteHeight();
    const target = this.state.targetScanline & 0x1ff;
    if (target === 261) {
      // MiSTer pre-render quirk: compare against scanline[7:0] (261 -> 5).
      const scanlineByte = target & 0xff;
      const y = yByte & 0xff;
      return scanlineByte >= y && scanlineByte < (y + spriteHeight);
    }
    const sy = ((yByte & 0xff) + 1) & 0x1ff;
    return sy <= 239 && target >= sy && target < (sy + spriteHeight);
  }

  _setEvalOamAddr(nextAddr) {
    const ppu = this.host.ppuState;
    const state = this.state;
    const v = nextAddr & 0xff;
    state.oamAddr = v;
    ppu.oamAddr = v;
  }

  _advancePrimaryAddr(delta) {
    const state = this.state;
    const next = (state.oamAddr | 0) + (delta | 0);
    if (next > 0xff) {
      state.nOvr = true;
    }
    this._setEvalOamAddr(next & 0xff);
  }

  _writeSecondaryByteAtCurrent(value) {
    this._storeSecondaryAtCurrent(value);
    this._advanceSecondaryAddr();
  }

  _storeSecondaryAtCurrent(value) {
    const state = this.state;
    const secIndex = state.secondaryAddr & 0x1f;
    const isSprite0 = state.copySpriteBase === (state.startAddr & 0xfc);
    this._writeSecondary(secIndex, value & 0xff, isSprite0);
  }

  _advanceSecondaryAddr() {
    const state = this.state;
    state.secondaryAddr = (state.secondaryAddr + 1) & 0x1f;
    if (state.secondaryAddr === 0) {
      state.secondaryOverflow = true;
    }
  }

  _deriveEvalWindowState() {
    const state = this.state;
    state.primaryIndex = (state.oamAddr >> 2) & 0x3f;
    state.secondaryCount = state.secondaryOverflow ? 8 : ((state.secondaryAddr >> 2) & 0x07);
    state.copyByte = state.oamAddr & 0x03;
    state.copyBase = state.copySpriteBase & 0xff;
    state.currentBase = state.oamAddr & 0xfc;
    state.overflowByte = state.oamAddr & 0x03;
    state.overflowSpriteIndex = state.primaryIndex & 0x7f;
  }

  _usingSecondaryForDot(dot, renderingActive) {
    const cycle = dot | 0;
    if (!renderingActive) return false;
    return (((cycle & 0x01) === 0) && cycle <= 255) || cycle > 255;
  }

  _maybeApplyOamCorruption(dot, renderingActive) {
    const ppu = this.host.ppuState;
    const state = this.state;
    const oamAddr = ppu.oamAddr & 0xff;
    const usingSecondary = this._usingSecondaryForDot(dot, renderingActive);
    const renderingRisingEdge = (!state.oldRendering) && !!renderingActive;
    if (renderingRisingEdge && (state.oldUsingSecondary !== usingSecondary)) {
      const rowCur = usingSecondary ? (state.secondaryAddr & 0x1f) : ((oamAddr >> 3) & 0x1f);
      const rowLast = state.oldUsingSecondary ? (state.secondaryAddr & 0x1f) : ((oamAddr >> 3) & 0x1f);
      const dstBase = (rowCur << 3) & 0xff;
      const srcBase = (rowLast << 3) & 0xff;
      for (let i = 0; i < 8; i += 1) {
        ppu.oamPrimary[(dstBase + i) & 0xff] = ppu.oamPrimary[(srcBase + i) & 0xff];
      }
      if (rowCur < 0x20 && rowLast < 0x20) {
        ppu.nextSecondaryOam[rowCur] = ppu.nextSecondaryOam[rowLast] & 0xff;
        ppu.secondaryOam[rowCur] = ppu.secondaryOam[rowLast] & 0xff;
      }
    }
    return usingSecondary;
  }

  readOamData(dotPhaseInput) {
    const host = this.host;
    const ppu = host.ppuState;
    const dotPhase = this._classifyDotPhase(dotPhaseInput);
    let value;
    if (dotPhase.renderingActive) {
      value = ppu.oamCopyBuffer & 0xff;
    } else {
      const addr = ppu.oamAddr & 0xff;
      const raw = ppu.oamPrimary[addr];
      value = ((addr & 0x03) === 0x02) ? (raw & 0xe3) : raw;
    }
    host.refreshPpuIoBus(value);
    this._setCpuOpenBus(value);
    return value;
  }

  writeOamAddr(value, dotPhaseInput) {
    const host = this.host;
    this._classifyDotPhase(dotPhaseInput);
    this._setEvalOamAddr(value & 0xff);
  }

  writeOamData(value, dotPhaseInput) {
    const host = this.host;
    const ppu = host.ppuState;
    const dotPhase = this._classifyDotPhase(dotPhaseInput);
    if (dotPhase.renderingActive) {
      this._setEvalOamAddr((ppu.oamAddr + 4) & 0xfc);
      return;
    }

    const addr = ppu.oamAddr & 0xff;
    ppu.oamPrimary[addr] = ((addr & 0x03) === 0x02) ? (value & 0xe3) : (value & 0xff);
    this._setEvalOamAddr((ppu.oamAddr + 1) & 0xff);
  }

  beginEvaluation(targetScanline) {
    const host = this.host;
    const ppu = host.ppuState;
    const evalTargetScanline = (ppu.scanline === 261) ? 261 : (targetScanline | 0);
    this.state.targetScanline = evalTargetScanline;
    this.state.startAddr = ppu.oamAddr & 0xff;
    this.state.phase = ppuSpritePhaseClearCore;
    this._setEvalOamAddr(this.state.startAddr & 0xff);
    this.state.secondaryAddr = 0;
    this.state.secondaryOverflow = false;
    this.state.evalCount = 0;
    this.state.evaluationActive = true;
    this.state.copySpriteBase = this.state.startAddr & 0xfc;
    this.state.currentBase = this.state.startAddr & 0xfc;
    this.state.currentInRange = false;
    this.state.nOvr = false;
    this.state.evalComplete = false;
    this.state.overflowByte = 0;
    this.state.overflowSpriteIndex = 0;
    this._deriveEvalWindowState();
    ppu.nextSecondaryOam.fill(0xff);
    ppu.nextSecondarySpritePresent.fill(0);
    ppu.nextSecondarySpriteIsSprite0.fill(0);
  }

  swapSecondaryOam() {
    const ppu = this.host.ppuState;
    this._setEvalOamAddr(0);
    ppu.secondaryOam.set(ppu.nextSecondaryOam);
    ppu.secondarySpritePresent.set(ppu.nextSecondarySpritePresent);
    ppu.secondarySpriteIsSprite0.set(ppu.nextSecondarySpriteIsSprite0);
    ppu.spriteLinePatternLo.fill(0);
    ppu.spriteLinePatternHi.fill(0);
    ppu.spriteLineAttr.fill(0);
    ppu.spriteLineX.fill(0);
    ppu.spriteLineIsSprite0.fill(0);
    ppu.spriteLineValid.fill(0);
    ppu.spriteAnyOnLine = null;
  }

  _onClearDot(dot, isPreRender) {
    const ppu = this.host.ppuState;
    const state = this.state;
    ppu.oamCopyBuffer = 0xff;
    if ((dot & 1) === 0) {
      const clearIndex = ((dot - 1) >> 1) & 0x1f;
      if (!isPreRender && clearIndex < 0x20) {
        ppu.nextSecondaryOam[clearIndex] = 0xff;
      }
      this._advanceSecondaryAddr();
    }
  }

  _onEvalReadDot(isPreRender) {
    const ppu = this.host.ppuState;
    const state = this.state;
    if (isPreRender) {
      ppu.oamCopyBuffer = ppu.nextSecondaryOam[state.secondaryAddr & 0x1f] & 0xff;
      return;
    }
    const addr = state.oamAddr & 0xff;
    const spriteIndex = (addr >> 2) & 0x3f;
    if (spriteIndex >= 64) {
      ppu.oamCopyBuffer = 0xff;
      return;
    }
    const raw = ppu.oamPrimary[addr] & 0xff;
    const value = (addr & 0x03) === 0x02 ? (raw & 0xe3) : raw;
    state.currentBase = addr & 0xfc;
    state.copyByte = addr & 0x03;
    ppu.oamCopyBuffer = value;
  }

  _onEvalWriteDot(isPreRender) {
    const ppu = this.host.ppuState;
    const state = this.state;
    if (state.phase !== ppuSpritePhaseEvalCore) {
      return;
    }
    const prevEvalCount = state.evalCount & 0x03;
    const oamWrEnabled = !state.secondaryOverflow && !isPreRender;
    const latched = ppu.oamCopyBuffer & 0xff;
    if (oamWrEnabled && !state.nOvr) {
      this._storeSecondaryAtCurrent(latched);
    } else {
      ppu.oamCopyBuffer = ppu.nextSecondaryOam[state.secondaryAddr & 0x1f] & 0xff;
    }

    const addr = state.oamAddr & 0xff;
    const base = addr & 0xfc;
    const inRange = this._isInRangeYByte(latched);
    if (this.host.ppuState.dot === 66) {
      state.sprite0Curr = !!(inRange && !isPreRender);
    }
    state.currentBase = base;

    if (prevEvalCount === 0) {
      state.currentInRange = inRange;
      state.copySpriteBase = base;
      if (inRange && !isPreRender && !state.nOvr) {
        if (!state.secondaryOverflow) {
          this._advanceSecondaryAddr();
        } else {
          ppu.status |= 0x20;
        }
        this._advancePrimaryAddr(1);
        state.evalCount = 1;
      } else {
        if (!isPreRender) {
          if (state.secondaryOverflow && !state.nOvr) {
            const oldN = (state.oamAddr >> 2) & 0x3f;
            const newN = (oldN + 1) & 0x3f;
            const low = ((state.oamAddr & 0x03) + 1) & 0x03;
            this._setEvalOamAddr(((newN << 2) | low) & 0xff);
            if (newN < oldN) state.nOvr = true;
          } else {
            const oldN = (state.oamAddr >> 2) & 0x3f;
            this._setEvalOamAddr((state.oamAddr + 4) & 0xfc);
            const newN = (state.oamAddr >> 2) & 0x3f;
            if (newN < oldN) state.nOvr = true;
          }
        }
      }
      this._deriveEvalWindowState();
      return;
    }

    if (prevEvalCount === 3) {
      if (inRange && !state.nOvr) {
        this._advancePrimaryAddr(1);
      } else if (state.secondaryOverflow && !state.nOvr) {
        this._advancePrimaryAddr(5);
      } else {
        const oldN = (state.oamAddr >> 2) & 0x3f;
        this._setEvalOamAddr((state.oamAddr + 1) & 0xfc);
        const newN = (state.oamAddr >> 2) & 0x3f;
        if (newN < oldN) state.nOvr = true;
      }
      if (state.secondaryOverflow) state.nOvr = true;
    } else {
      this._advancePrimaryAddr(1);
    }

    // MiSTer eval SR: once started, eval_count and secondary addr advance every write phase.
    state.evalCount = (state.evalCount + 1) & 0x03;
    if (!state.secondaryOverflow) {
      this._advanceSecondaryAddr();
    } else {
      ppu.status |= 0x20;
    }
    this._deriveEvalWindowState();
  }

  _onFetchDot(dot) {
    const ppu = this.host.ppuState;
    const state = this.state;
    if ((ppu.scanline | 0) === 261) {
      // MiSTer/PPU pre-render quirk: sprite in-range/pattern row checks use scanline byte (261 -> 5).
      state.targetScanline = 261;
    }
    const cycle = ((dot | 0) - 1) | 0;
    ppu.sprite0OnLine = !!state.sprite0Curr;
    ppu.oamCopyBuffer = ppu.secondaryOam[state.secondaryAddr & 0x1f] & 0xff;
    if (!state.secondaryOverflow) {
      const mod = cycle & 0x07;
      if (mod < 3 || mod === 7) {
        state.secondaryAddr = (state.secondaryAddr + 1) & 0x1f;
        if (state.secondaryAddr === 0) {
          state.secondaryOverflow = true;
        }
      }
    }

    const rel = (dot - 257) | 0;
    if (rel < 0) return;
    const slot = ((rel >> 3) & 0x07) | 0;
    const step = rel & 0x07;

    if (step === 5) {
      this._fetchSpritePattern(slot, false);
      return;
    }

    if (step === 7) {
      this._fetchSpritePattern(slot, true);
      return;
    }
  }

  _onRefreshDot(dot) {
    const ppu = this.host.ppuState;
    // MiSTer OAMEval drives oam_data from temp[0] during refresh.
    ppu.oamCopyBuffer = ppu.secondaryOam[0] & 0xff;
  }

  _clockEvalPersistenceWhenRenderingOff(spriteWritePhase) {
    if (!spriteWritePhase) return;
    const ppu = this.host.ppuState;
    const state = this.state;
    // MiSTer OAMEval:
    // once eval_count is non-zero, eval SR keeps advancing on secondary-write cycles
    // even if rendering/evaluating has dropped.
    if ((state.evalCount & 0x03) === 0) return;
    state.evalCount = (state.evalCount + 1) & 0x03;
    if (!state.secondaryOverflow) {
      state.secondaryAddr = (state.secondaryAddr + 1) & 0x1f;
      if (state.secondaryAddr === 0) {
        state.secondaryOverflow = true;
      }
    } else {
      ppu.status |= 0x20;
    }
    this._deriveEvalWindowState();
  }

  _applyClearSecondaryAddr(dot, renderingActive) {
    if (!renderingActive) return;
    // MiSTer clear_secondary_addr = ((cycle==63)||(cycle==255)||(cycle==339)) && rendering.
    // Dot is cycle+1, so clear points are 64, 256, 340. Clearing takes precedence.
    if (dot !== 64 && dot !== 256 && dot !== 340) return;
    const state = this.state;
    state.secondaryAddr = 0;
    state.secondaryOverflow = false;
  }

  clockSpriteSet(dotPhaseInput) {
    const dotPhase = (dotPhaseInput && typeof dotPhaseInput === 'object' && dotPhaseInput.dot != null)
      ? dotPhaseInput
      : this._classifyDotPhase(dotPhaseInput);
    let rendering = dotPhase.renderingActive;
    if (rendering !== true && rendering !== false) {
      rendering = null;
    }
    this.clockSpriteSetFast(
      dotPhase.dot | 0,
      dotPhase.renderScanline === true,
      rendering,
    );
  }

  clockSpriteSetFast(dot, renderScanline, renderingActive = null) {
    const ppu = this.host.ppuState;
    const d = dot | 0;
    if (!renderScanline || d <= 0 || d >= 257) {
      return;
    }
    const counting = (ppu.spriteCounterShift & 0x04) !== 0;
    const rendering = (renderingActive === true || renderingActive === false)
      ? renderingActive
      : ((this.host && typeof this.host.isPpuRenderingEnabledLatched === 'function')
        ? this.host.isPpuRenderingEnabledLatched()
        : this._renderingEnabled());
    const shouldShift = rendering === true;
    if (!counting && !shouldShift) {
      return;
    }
    const spriteLineX = ppu.spriteLineX;
    const spriteLinePatternLo = ppu.spriteLinePatternLo;
    const spriteLinePatternHi = ppu.spriteLinePatternHi;

    for (let slot = 0; slot < 8; slot += 1) {
      const xCounter = spriteLineX[slot];
      if (counting && xCounter !== 0) {
        spriteLineX[slot] = (xCounter - 1) & 0xff;
      } else if (shouldShift) {
        spriteLinePatternLo[slot] = (spriteLinePatternLo[slot] << 1) & 0xff;
        spriteLinePatternHi[slot] = (spriteLinePatternHi[slot] << 1) & 0xff;
      }
    }
  }

  samplePixelPackedVisibleFast(x, spEnableOverride = null, spLeftOverride = null) {
    const host = this.host;
    const ppu = host.ppuState;
    const spEnable = (spEnableOverride == null)
      ? ((host && typeof host.isPpuObjEnabledLatched === 'function')
        ? host.isPpuObjEnabledLatched()
        : (ppu.mask & 0x10) !== 0)
      : !!spEnableOverride;
    const spLeft = (spLeftOverride == null)
      ? ((ppu.mask & 0x04) !== 0)
      : !!spLeftOverride;
    if (!spEnable) {
      return 0;
    }
    if (!spLeft && x < 8) {
      return 0;
    }
    if (ppu.spriteAnyOnLine !== true) {
      if (ppu.spriteAnyOnLine == null) {
        let anyOnLine = false;
        for (let i = 0; i < 8; i += 1) {
          if ((ppu.spriteLineValid[i] & 0x01) !== 0) {
            anyOnLine = true;
            break;
          }
        }
        ppu.spriteAnyOnLine = anyOnLine;
      }
      if (ppu.spriteAnyOnLine !== true) {
        return 0;
      }
    }

    const counting = (ppu.spriteCounterShift & 0x04) !== 0;
    const spriteLineValid = ppu.spriteLineValid;
    const spriteLineX = ppu.spriteLineX;
    const spriteLineAttr = ppu.spriteLineAttr;
    const spriteLinePatternLo = ppu.spriteLinePatternLo;
    const spriteLinePatternHi = ppu.spriteLinePatternHi;
    const palette = host.palette;
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
      const flags = ppuSpritePixelOpaqueCore
        | (((attr & 0x20) !== 0) ? ppuSpritePixelBehindBgCore : 0)
        | ((slot & 0x07) << ppuSpritePixelSlotShiftCore);
      return (colorIndex | flags) & 0x07ff;
    }

    return 0;
  }

  samplePixelPacked(x, y, spEnableOverride = null, spLeftOverride = null) {
    if (x < 0 || x >= 256 || y < 0 || y >= 240) {
      return 0;
    }
    return this.samplePixelPackedVisibleFast(x, spEnableOverride, spLeftOverride);
  }

  samplePixel(x, y) {
    const packed = this.samplePixelPacked(x, y) | 0;
    const opaque = (packed & ppuSpritePixelOpaqueCore) !== 0;
    if (!opaque) {
      return { opaque: false, colorIndex: 0, behindBg: false, isSprite0: false, slot: -1 };
    }
    const slot = (packed & ppuSpritePixelSlotMaskCore) >> ppuSpritePixelSlotShiftCore;
    return {
      opaque: true,
      colorIndex: packed & 0x3f,
      behindBg: (packed & ppuSpritePixelBehindBgCore) !== 0,
      isSprite0: slot === 0,
      slot,
    };
  }

  _onDotInternal(
    scanline,
    dot,
    renderingActive,
    beginSpriteEvaluation,
    spriteTargetScanline,
    swapSecondaryOam,
    spriteWindowPhase,
    spriteDotInWindow,
    spriteReadPhase,
    spriteWindowPhaseCode = -1,
  ) {
    const host = this.host;
    const state = this.state;
    const prevScanline = state.scanline | 0;
    const prevDot = state.dot | 0;
    const line = scanline | 0;
    const d = dot | 0;
    const rendering = renderingActive === true;
    if ((scanline !== prevScanline) || (dot < prevDot)) {
      state.evaluationActive = false;
    }
    state.scanline = line;
    state.dot = d;
    state.dotInPhase = 0;
    // Fast idle path: once rendering is fully inactive (vblank idle span),
    // skip corruption/eval phase bookkeeping until the next active edge.
    if (
      !rendering &&
      state.evaluationActive !== true &&
      state.oldRendering === false &&
      state.oldUsingSecondary === false
    ) {
      state.phase = ppuSpritePhaseIdleCore;
      return;
    }
    const usingSecondary = this._maybeApplyOamCorruption(d, rendering);
    state.oldRendering = rendering;
    state.oldUsingSecondary = usingSecondary;
    const windowDot = spriteDotInWindow | 0;
    let phaseCode = spriteWindowPhaseCode | 0;
    if (phaseCode < ppuSpritePhaseCodeIdleCore || phaseCode > ppuSpritePhaseCodeRefreshCore) {
      phaseCode = ppuSpritePhaseCodeFromWindowPhase(spriteWindowPhase);
    }
    const continueEvaluation = (state.evaluationActive === true) && !rendering;
    const preRender = line === 261;
    const clearSecondaryAddr = rendering && (d === 64 || d === 256 || d === 340);

    if (!rendering && !state.evaluationActive) {
      state.phase = ppuSpritePhaseIdleCore;
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    if (continueEvaluation) {
      const cycle = (d - 1) | 0;
      const secondaryWrite = (cycle & 0x01) === 1;
      state.phase = ppuSpritePhaseEvalCore;
      this._clockEvalPersistenceWhenRenderingOff(secondaryWrite);
      if (d >= 340) {
        state.evaluationActive = false;
      }
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    if (beginSpriteEvaluation) {
      this.beginEvaluation(spriteTargetScanline | 0);
    }

    if (swapSecondaryOam) {
      this.swapSecondaryOam();
    }

    if (phaseCode === ppuSpritePhaseCodeClearCore) {
      state.phase = ppuSpritePhaseClearCore;
      state.dotInPhase = windowDot;
      this._onClearDot(d, preRender);
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    if (phaseCode === ppuSpritePhaseCodeEvalCore) {
      state.dotInPhase = windowDot;
      state.phase = ppuSpritePhaseEvalCore;
      if (spriteReadPhase) this._onEvalReadDot(preRender);
      else this._onEvalWriteDot(preRender);
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    if (phaseCode === ppuSpritePhaseCodeFetchCore) {
      state.phase = ppuSpritePhaseFetchCore;
      state.dotInPhase = windowDot;
      this._onFetchDot(d);
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    if (phaseCode === ppuSpritePhaseCodeRefreshCore) {
      state.phase = ppuSpritePhaseRefreshCore;
      state.dotInPhase = windowDot;
      this._onRefreshDot(d);
      if (d >= 340) {
        state.evaluationActive = false;
      }
      if (clearSecondaryAddr) {
        state.secondaryAddr = 0;
        state.secondaryOverflow = false;
      }
      return;
    }

    state.phase = ppuSpritePhaseIdleCore;
    if (d >= 340) {
      state.evaluationActive = false;
    }
    if (clearSecondaryAddr) {
      state.secondaryAddr = 0;
      state.secondaryOverflow = false;
    }
  }

  onDotFast(
    scanline,
    dot,
    renderingActive,
    beginSpriteEvaluation,
    spriteTargetScanline,
    swapSecondaryOam,
    spriteWindowPhase,
    spriteDotInWindow,
    spriteReadPhase,
  ) {
    this._onDotInternal(
      scanline | 0,
      dot | 0,
      renderingActive,
      beginSpriteEvaluation,
      spriteTargetScanline | 0,
      swapSecondaryOam,
      spriteWindowPhase,
      spriteDotInWindow | 0,
      spriteReadPhase,
      ppuSpritePhaseCodeFromWindowPhase(spriteWindowPhase),
    );
  }

  onDotFastCode(
    scanline,
    dot,
    renderingActive,
    beginSpriteEvaluation,
    spriteTargetScanline,
    swapSecondaryOam,
    spriteWindowPhaseCode,
    spriteDotInWindow,
    spriteReadPhase,
  ) {
    this._onDotInternal(
      scanline | 0,
      dot | 0,
      renderingActive,
      beginSpriteEvaluation,
      spriteTargetScanline | 0,
      swapSecondaryOam,
      ppuSpritePhaseIdleCore,
      spriteDotInWindow | 0,
      spriteReadPhase,
      spriteWindowPhaseCode | 0,
    );
  }

  onDot(dotPhaseInput) {
    const dotPhase = (dotPhaseInput && typeof dotPhaseInput === 'object' && dotPhaseInput.dot != null && dotPhaseInput.scanline != null)
      ? dotPhaseInput
      : this._classifyDotPhase(dotPhaseInput);
    this._onDotInternal(
      dotPhase.scanline | 0,
      dotPhase.dot | 0,
      dotPhase.renderingActive === true,
      dotPhase.beginSpriteEvaluation === true,
      dotPhase.spriteTargetScanline | 0,
      dotPhase.swapSecondaryOam === true,
      dotPhase.spriteWindowPhase,
      dotPhase.spriteDotInWindow | 0,
      dotPhase.spriteReadPhase === true,
    );
  }
}

const ppuSpritePipelineExports = { PpuSpritePipeline };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuSpritePipelineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuSpritePipeline = ppuSpritePipelineExports;
}
