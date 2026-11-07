let emuBackendSharedNs = null;
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  try {
    // eslint-disable-next-line global-require
    emuBackendSharedNs = require('./emulation-backend-shared');
  } catch (_err) {
    emuBackendSharedNs = null;
  }
}
if (!emuBackendSharedNs && typeof globalThis !== 'undefined' && globalThis.NESCoreBackendShared) {
  emuBackendSharedNs = globalThis.NESCoreBackendShared;
}

class EmuBackendJsCore {
  constructor(nes) {
    this.nes = nes || null;
    this._stateSnapshot = readNesStateSnapshot(this.nes, {});
    this._frameResult = {
      frameAdvanced: false,
      usedFallback: false,
      beforeCpuCycles: 0,
      afterCpuCycles: 0,
      cpuCycles: 0,
      frameCounter: 0,
    };
    this._framesResult = {
      ran: 0,
      usedFallbackFrames: 0,
      noAdvanceFrames: 0,
      beforeCpuCycles: 0,
      afterCpuCycles: 0,
      frameCounter: 0,
    };
  }

  getName() {
    return 'js';
  }

  attach(nes) {
    this.nes = nes || null;
    readNesStateSnapshot(this.nes, this._stateSnapshot);
  }

  _assertNes() {
    if (!this.nes) {
      throw new Error('Emulation backend not attached');
    }
    return this.nes;
  }

  setController1(buttons) {
    const nes = this._assertNes();
    nes.setController1(buttons);
  }

  runCpuCycles(cycles) {
    const nes = this._assertNes();
    return nes.runCpuCycles(cycles | 0);
  }

  runUntilNextVBlank(maxCpuCycles) {
    const nes = this._assertNes();
    return nes.runUntilNextVBlank(maxCpuCycles | 0);
  }

  runFrame(maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
    const nes = this._assertNes();
    const beforeCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
    const step = nes.runUntilNextVBlank(maxCpuCycles | 0);
    let usedFallback = false;
    if (!step.frameAdvanced) {
      nes.runCpuCycles(fallbackCpuCycles | 0);
      usedFallback = true;
    }
    const afterCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : beforeCpuCycles;
    const out = this._frameResult;
    out.frameAdvanced = !!step.frameAdvanced;
    out.usedFallback = usedFallback;
    out.beforeCpuCycles = beforeCpuCycles;
    out.afterCpuCycles = afterCpuCycles;
    out.cpuCycles = (step && typeof step.cpuCycles === 'number') ? (step.cpuCycles >>> 0) : 0;
    out.frameCounter = (step && typeof step.frameCounter === 'number') ? (step.frameCounter >>> 0) : 0;
    return out;
  }

  runFrames(frameCount, maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
    const nes = this._assertNes();
    const target = frameCount | 0;
    const beforeCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
    const maxCycles = maxCpuCycles | 0;
    const fallbackCycles = fallbackCpuCycles | 0;
    if (target <= 0) {
      const outEmpty = this._framesResult;
      outEmpty.ran = 0;
      outEmpty.usedFallbackFrames = 0;
      outEmpty.noAdvanceFrames = 0;
      outEmpty.beforeCpuCycles = beforeCpuCycles;
      outEmpty.afterCpuCycles = beforeCpuCycles;
      outEmpty.frameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : 0;
      return outEmpty;
    }
    let ran = 0;
    let usedFallbackFrames = 0;
    let noAdvanceFrames = 0;
    while (ran < target) {
      const stepBeforeCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
      const step = nes.runUntilNextVBlank(maxCycles);
      if (!step.frameAdvanced) {
        nes.runCpuCycles(fallbackCycles);
        usedFallbackFrames += 1;
      }
      const stepAfterCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : stepBeforeCycles;
      if (stepAfterCycles === stepBeforeCycles) noAdvanceFrames += 1;
      ran += 1;
    }
    const afterCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : beforeCpuCycles;
    const out = this._framesResult;
    out.ran = ran;
    out.usedFallbackFrames = usedFallbackFrames;
    out.noAdvanceFrames = noAdvanceFrames;
    out.beforeCpuCycles = beforeCpuCycles;
    out.afterCpuCycles = afterCpuCycles;
    out.frameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : 0;
    return out;
  }

  getStateSnapshot() {
    return readNesStateSnapshot(this._assertNes(), this._stateSnapshot);
  }
}

function createJsEmulationBackend(nes) {
  return new EmuBackendJsCore(nes || null);
}

function isValidBackend(candidate) {
  if (emuBackendSharedNs && typeof emuBackendSharedNs.isBackendContractValid === 'function') {
    return emuBackendSharedNs.isBackendContractValid(candidate);
  }
  if (!candidate) return false;
  return (
    typeof candidate.setController1 === 'function' &&
    typeof candidate.runCpuCycles === 'function' &&
    typeof candidate.runFrame === 'function'
  );
}

function readNesStateSnapshot(nes, out = null) {
  if (emuBackendSharedNs && typeof emuBackendSharedNs.readNesStateSnapshot === 'function') {
    return emuBackendSharedNs.readNesStateSnapshot(nes, out);
  }
  if (!nes) return out || null;
  const snapshot = out || {};
  const cpu = nes.cpu || null;
  const cpuState = nes.cpuState || null;
  const ppuState = nes.ppuState || null;
  const cartridge = nes.cartridge || null;
  const controllers = nes.controllers || null;
  snapshot.frameCounter = ppuState ? (ppuState.frameCounter >>> 0) : 0;
  snapshot.cpuCycleCounter = cpuState ? (cpuState.cycleCounter >>> 0) : 0;
  snapshot.cpuPc = cpu ? (cpu.pc & 0xffff) : 0;
  snapshot.cpuStopped = !!(cpu && cpu.stopped);
  snapshot.unsupportedOpcodeCount = (cpu && typeof cpu.unsupportedOpcodeCount === 'number')
    ? (cpu.unsupportedOpcodeCount >>> 0)
    : 0;
  snapshot.ppuStatus = ppuState ? (ppuState.status & 0xff) : 0;
  snapshot.mapper = (cartridge && typeof cartridge.mapper === 'number')
    ? (cartridge.mapper | 0)
    : -1;
  snapshot.joypad1Buttons = (controllers && typeof controllers.joypad1Buttons === 'number')
    ? (controllers.joypad1Buttons & 0xff)
    : 0;
  return snapshot;
}

function tryCreateWasmBackend(nes, options = null) {
  if (typeof globalThis === 'undefined') return null;
  const wasmNs = globalThis.NESCoreWasmEmulationBackend;
  if (!wasmNs || typeof wasmNs.createWasmEmulationBackend !== 'function') return null;
  try {
    const backend = wasmNs.createWasmEmulationBackend(nes, options || null);
    return isValidBackend(backend) ? backend : null;
  } catch (_err) {
    return null;
  }
}

function createPreferredEmulationBackend(nes, options = null) {
  const opts = options || null;
  const preferWasm = !(opts && opts.preferWasm === false);
  const strictWasm = !!(opts && opts.strictWasm);
  if (strictWasm && !preferWasm) {
    throw new Error('strictWasm requires preferWasm=true');
  }
  if (preferWasm) {
    const wasmBackend = tryCreateWasmBackend(nes, opts);
    if (wasmBackend) return wasmBackend;
    if (strictWasm) {
      throw new Error('strictWasm enabled but WASM backend is unavailable');
    }
  }
  return createJsEmulationBackend(nes);
}

const emulationBackendExports = {
  EmuBackendJs: EmuBackendJsCore,
  createJsEmulationBackend,
  createPreferredEmulationBackend,
  readNesStateSnapshot,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = emulationBackendExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreEmulationBackend = emulationBackendExports;
}
