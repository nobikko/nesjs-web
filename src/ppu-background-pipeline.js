let PpuBackgroundPipelineStateCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ PpuBackgroundState: PpuBackgroundPipelineStateCore } = require('./ppu-background-state'));
  } catch (_err) {
    PpuBackgroundPipelineStateCore = null;
  }
}
if (!PpuBackgroundPipelineStateCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuBackgroundState) {
  PpuBackgroundPipelineStateCore = globalThis.NESCorePpuBackgroundState.PpuBackgroundState;
}
if (!PpuBackgroundPipelineStateCore) {
  throw new Error('PpuBackgroundState core not found');
}

const ppuBackgroundPixelOpaqueCore = 0x40;

class PpuBackgroundPipeline {
  constructor(host) {
    this.host = host;
    this.state = (host && host.ppuState && host.ppuState.bg)
      ? host.ppuState.bg
      : new PpuBackgroundPipelineStateCore();
    this._bgMetaNametable = {
      __aleMeta: true,
      observe: true,
      origin: 'ppu_bg',
      stage: 'nametable',
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
    this._bgMetaAttribute = {
      __aleMeta: true,
      observe: true,
      origin: 'ppu_bg',
      stage: 'attribute',
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
    this._bgMetaPatternLo = {
      __aleMeta: true,
      observe: true,
      origin: 'ppu_bg',
      stage: 'pattern_lo',
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
    this._bgMetaPatternHi = {
      __aleMeta: true,
      observe: true,
      origin: 'ppu_bg',
      stage: 'pattern_hi',
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
  }

  reset() {
    this.state.reset();
  }

  _fetchRange(dot) {
    return (dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336);
  }

  _shiftRegisters() {
    const state = this.state;
    // MiSTer BgPainter serial-in behavior:
    // playfield_pipe_1 shifts in 1, playfield_pipe_2 shifts in 0.
    state.patternLoShift = ((state.patternLoShift >>> 1) | 0x8000) & 0xffff;
    state.patternHiShift = (state.patternHiShift >>> 1) & 0xffff;
    // Attribute pipes are 9-bit in MiSTer. Bit 8 holds the loaded value.
    state.attrLoShift = ((state.attrLoShift & 0x100) | ((state.attrLoShift >>> 1) & 0xff)) & 0x1ff;
    state.attrHiShift = ((state.attrHiShift & 0x100) | ((state.attrHiShift >>> 1) & 0xff)) & 0x1ff;
  }

  _reverseBits8(value) {
    let v = value & 0xff;
    v = ((v & 0xf0) >> 4) | ((v & 0x0f) << 4);
    v = ((v & 0xcc) >> 2) | ((v & 0x33) << 2);
    v = ((v & 0xaa) >> 1) | ((v & 0x55) << 1);
    return v & 0xff;
  }

  _reloadRegisters() {
    const state = this.state;
    state.currentNameTable = state.nextTileId & 0xff;
    state.currentAttributeTable = state.nextAttr & 0x03;
    state.currentPatternLo = state.nextPatternLo & 0xff;
    state.currentPatternHi = state.nextPatternHi & 0xff;
    // MiSTer loads bit-reversed pattern bytes into the high half.
    state.patternLoShift = (state.patternLoShift & 0x00ff) | (this._reverseBits8(state.nextPatternLo) << 8);
    state.patternHiShift = (state.patternHiShift & 0x00ff) | (this._reverseBits8(state.nextPatternHi) << 8);
    // Attribute load updates only bit 8; lower bits are shifted copies.
    state.attrLoShift = (state.attrLoShift & 0x0ff) | ((state.nextAttr & 0x01) ? 0x100 : 0x000);
    state.attrHiShift = (state.attrHiShift & 0x0ff) | ((state.nextAttr & 0x02) ? 0x100 : 0x000);
  }

  _fetchNametableByte() {
    const host = this.host;
    const ppu = host.ppuState;
    const addr = 0x2000 | (ppu.v & 0x0fff);
    this.state.nextTileId = this._readBus(addr, this._bgMetaNametable) & 0xff;
  }

  _fetchAttributeBits() {
    const host = this.host;
    const ppu = host.ppuState;
    const coarseX = ppu.v & 0x1f;
    const coarseY = (ppu.v >> 5) & 0x1f;
    const ntBase = 0x2000 | (ppu.v & 0x0c00);
    const attrAddr = ntBase | 0x03c0 | ((coarseY >> 2) << 3) | (coarseX >> 2);
    const attr = this._readBus(attrAddr, this._bgMetaAttribute) & 0xff;
    const shift = ((coarseY & 0x02) << 1) | (coarseX & 0x02);
    this.state.nextAttr = (attr >> shift) & 0x03;
  }

  _fetchPatternLo() {
    const host = this.host;
    const ppu = host.ppuState;
    const fineY = (ppu.v >> 12) & 0x07;
    const bgPtBase = (ppu.ctrl & 0x10) ? 0x1000 : 0x0000;
    const tileAddr = bgPtBase + (this.state.nextTileId * 16) + fineY;
    this.state.nextPatternLo = this._readBus(tileAddr, this._bgMetaPatternLo) & 0xff;
  }

  _fetchPatternHi() {
    const host = this.host;
    const ppu = host.ppuState;
    const fineY = (ppu.v >> 12) & 0x07;
    const bgPtBase = (ppu.ctrl & 0x10) ? 0x1000 : 0x0000;
    const tileAddr = bgPtBase + (this.state.nextTileId * 16) + fineY + 8;
    this.state.nextPatternHi = this._readBus(tileAddr, this._bgMetaPatternHi) & 0xff;
  }

  _readBus(addr, accessMeta) {
    const host = this.host;
    if (host && typeof host.ppuReadWithAle === 'function') {
      return host.ppuReadWithAle(addr, accessMeta) & 0xff;
    }
    return host.ppuRead(addr, accessMeta) & 0xff;
  }

  onRenderDot(dot) {
    if (!this._fetchRange(dot)) return;

    const state = this.state;
    this._shiftRegisters();
    state.fetchPhase = (dot - 1) & 0x07;
    switch (state.fetchPhase) {
      case 0:
        this._reloadRegisters();
        this._fetchNametableByte();
        break;
      case 2:
        this._fetchAttributeBits();
        break;
      case 4:
        this._fetchPatternLo();
        break;
      case 6:
        this._fetchPatternHi();
        break;
      default:
        break;
    }
  }

  samplePixelPackedFast(x, bgEnable, bgLeft) {
    const host = this.host;
    const ppu = host.ppuState;
    const state = this.state;
    const backdrop = host.palette[0] & 0x3f;
    if (!bgEnable || (!bgLeft && x < 8)) return backdrop;

    const bit = ppu.fineX & 0x07;
    const colorId = (((state.patternHiShift >>> bit) & 0x01) << 1)
      | ((state.patternLoShift >>> bit) & 0x01);
    if (colorId === 0) {
      return backdrop;
    }

    const paletteIndex = ((((state.attrHiShift >>> bit) & 0x01) << 1)
      | ((state.attrLoShift >>> bit) & 0x01)) << 2;
    return (host.palette[paletteIndex | colorId] & 0x3f) | ppuBackgroundPixelOpaqueCore;
  }

  samplePixelPacked(x, bgEnableOverride = null, bgLeftOverride = null) {
    const host = this.host;
    const ppu = host.ppuState;
    const bgEnable = (bgEnableOverride == null)
      ? ((host && typeof host.isPpuBgEnabledLatched === 'function')
        ? host.isPpuBgEnabledLatched()
        : (ppu.mask & 0x08) !== 0)
      : !!bgEnableOverride;
    const bgLeft = (bgLeftOverride == null)
      ? ((ppu.mask & 0x02) !== 0)
      : !!bgLeftOverride;
    return this.samplePixelPackedFast(x, bgEnable, bgLeft);
  }

  samplePixel(x) {
    const packed = this.samplePixelPacked(x);
    return {
      colorIndex: packed & 0x3f,
      opaque: (packed & ppuBackgroundPixelOpaqueCore) !== 0,
    };
  }
}

const ppuBackgroundPipelineExports = { PpuBackgroundPipeline };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuBackgroundPipelineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuBackgroundPipeline = ppuBackgroundPipelineExports;
}
