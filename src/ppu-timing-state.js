let PpuTimingBackgroundStateCore = null;
let PpuTimingSpriteEvalStateCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ PpuBackgroundState: PpuTimingBackgroundStateCore } = require('./ppu-background-state'));
  } catch (_err) {
    PpuTimingBackgroundStateCore = null;
  }
  try {
    ({ PpuSpriteEvalState: PpuTimingSpriteEvalStateCore } = require('./ppu-sprite-eval-state'));
  } catch (_err) {
    PpuTimingSpriteEvalStateCore = null;
  }
}
if (!PpuTimingBackgroundStateCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuBackgroundState) {
  PpuTimingBackgroundStateCore = globalThis.NESCorePpuBackgroundState.PpuBackgroundState;
}
if (!PpuTimingSpriteEvalStateCore && typeof globalThis !== 'undefined' && globalThis.NESCorePpuSpriteEvalState) {
  PpuTimingSpriteEvalStateCore = globalThis.NESCorePpuSpriteEvalState.PpuSpriteEvalState;
}
if (!PpuTimingBackgroundStateCore) {
  throw new Error('PpuBackgroundState core not found');
}
if (!PpuTimingSpriteEvalStateCore) {
  throw new Error('PpuSpriteEvalState core not found');
}

class PpuTimingState {
  constructor() {
    this.bg = new PpuTimingBackgroundStateCore();
    this.spriteEval = new PpuTimingSpriteEvalStateCore();
    this.oamPrimary = new Uint8Array(0x100);
    this.secondaryOam = new Uint8Array(0x20);
    this.nextSecondaryOam = new Uint8Array(0x20);
    this.secondarySpritePresent = new Uint8Array(8);
    this.nextSecondarySpritePresent = new Uint8Array(8);
    this.secondarySpriteIsSprite0 = new Uint8Array(8);
    this.nextSecondarySpriteIsSprite0 = new Uint8Array(8);
    this.scanlineV = new Uint16Array(240);
    this.scanlineFineX = new Uint8Array(240);
    this.scanlineScrollX = new Uint8Array(240);
    this.scanlineScrollY = new Uint8Array(240);
    this.scanlinePpuCtrl = new Uint8Array(240);
    this.scanlineBgWorldY = new Uint16Array(240);
    this.scanlineBgNtBaseY = new Uint8Array(240);
    this.scanlineChrBank = new Uint8Array(240);
    this.spriteLinePatternLo = new Uint8Array(8);
    this.spriteLinePatternHi = new Uint8Array(8);
    this.spriteLineAttr = new Uint8Array(8);
    this.spriteLineX = new Uint8Array(8);
    this.spriteLineIsSprite0 = new Uint8Array(8);
    this.spriteLineValid = new Uint8Array(8);
    this.frameColor = new Uint8Array(256 * 240);
    this.frameBgOpaque = new Uint8Array(256 * 240);
    this.reset();
  }

  reset() {
    this.bg.reset();
    this.spriteEval.reset();
    this.ctrl = 0;
    this.mask = 0;
    this.pendingMaskWriteValid = false;
    this.pendingMaskWriteValue = 0;
    this.status = 0;
    this.nmiOccurred = false;
    this.oamAddr = 0;
    this.addr = 0;
    this.addrLatch = 0;
    this.v = 0;
    this.t = 0;
    this.fineX = 0;
    this.writeToggle = 0;
    this.dataBuffer = 0;
    this.ioBus = 0;
    this.ioBusDecayHighCpu = 0;
    this.ioBusDecayLowCpu = 0;
    this.ioBusDecayCpu = 0;
    this.scrollX = 0;
    this.scrollY = 0;
    this.scrollLatch = 0;
    this.renderFineX = 0;
    this.oamCopyBuffer = 0xff;
    this.renderEnableShift = 0;
    this.bgEnableShift = 0;
    this.objEnableShift = 0;
    this.read2007Delayed = 0;
    this.write2007Delayed = 0;
    this.read2007Pulse = false;
    this.write2007Pulse = false;
    this.read2007Shift = 0;
    this.write2007Shift = 0;
    this.read2007Pending = false;
    this.write2007Pending = false;
    this.pending2007ReadValid = false;
    this.pending2007ReadAddr = 0;
    this.pending2007ReadBufferAddr = 0;
    this.pending2007ReadBusReady = false;
    this.pending2007ReadBusValue = 0;
    this.queued2007ReadValid = false;
    this.queued2007ReadAddr = 0;
    this.queued2007ReadBufferAddr = 0;
    this.pending2007WriteValid = false;
    this.pending2007WriteAddr = 0;
    this.pending2007WriteValue = 0;
    this.pending2007WriteCommitted = false;
    this.queued2007WriteValid = false;
    this.queued2007WriteAddr = 0;
    this.queued2007WriteValue = 0;
    this.vramAleActive = false;
    this.vramAddressLowLatch = 0;
    this.vramAddressBus = 0;
    this.bgSegmentStartLine = 0;
    this.bgSegmentScrollY = 0;
    this.bgSegmentNtBaseY = 0;
    this.warmupActive = true;
    this.scanline = 0;
    this.dot = 0;
    this.dotClock = 0;
    this.oddFrame = false;
    this.vblankSetOnLastTick = false;
    this.vblankClearOnLastTick = false;
    this.preventVblankSet = false;
    this.frameCounter = 0;
    this.vblankStarted = false;
    this.statusReadStartValid = false;
    this.statusReadStartCycle = 0;
    this.statusReadStartVblank = false;
    this.statusReadMidValid = false;
    this.statusReadMidCycle = 0;
    this.statusReadMidFlags = 0;
    this.statusReadMidCaptured = false;
    this.frameIncludesSprites = true;
    this.sprite0HitScanline = -1;
    this.spriteCounterShift = 0;
    this.sprite0OnLine = false;

    this.oamPrimary.fill(0x00);
    this.secondaryOam.fill(0xff);
    this.nextSecondaryOam.fill(0xff);
    this.secondarySpritePresent.fill(0);
    this.nextSecondarySpritePresent.fill(0);
    this.secondarySpriteIsSprite0.fill(0);
    this.nextSecondarySpriteIsSprite0.fill(0);

    this.scanlineV.fill(0);
    this.scanlineFineX.fill(0);
    this.scanlineScrollX.fill(0);
    this.scanlineScrollY.fill(0);
    this.scanlinePpuCtrl.fill(0);
    this.scanlineBgWorldY.fill(0);
    this.scanlineBgNtBaseY.fill(0);
    this.scanlineChrBank.fill(0);
    this.spriteLinePatternLo.fill(0);
    this.spriteLinePatternHi.fill(0);
    this.spriteLineAttr.fill(0);
    this.spriteLineX.fill(0);
    this.spriteLineIsSprite0.fill(0);
    this.spriteLineValid.fill(0);
    this.frameColor.fill(0x0f);
    this.frameBgOpaque.fill(0);
  }
}

const ppuTimingStateExports = { PpuTimingState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuTimingStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuTimingState = ppuTimingStateExports;
}
