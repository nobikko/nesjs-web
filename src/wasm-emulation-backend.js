let wasmEmuBackendSharedNs = null;
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  try {
    // eslint-disable-next-line global-require
    wasmEmuBackendSharedNs = require('./emulation-backend-shared');
  } catch (_err) {
    wasmEmuBackendSharedNs = null;
  }
}
if (!wasmEmuBackendSharedNs && typeof globalThis !== 'undefined' && globalThis.NESCoreBackendShared) {
  wasmEmuBackendSharedNs = globalThis.NESCoreBackendShared;
}

class WasmEmulationBackendCore {
  constructor(runtime, nes) {
    this.runtime = runtime || null;
    this.nes = nes || null;
    this._stateSnapshot = readNesStateSnapshot(this.nes, {});
    this._framesResult = {
      ran: 0,
      usedFallbackFrames: 0,
      noAdvanceFrames: 0,
      beforeCpuCycles: 0,
      afterCpuCycles: 0,
    };
  }

  getName() {
    return 'wasm';
  }

  attach(nes) {
    this.nes = nes || null;
    readNesStateSnapshot(this.nes, this._stateSnapshot);
    if (this.runtime && typeof this.runtime.attach === 'function') {
      this.runtime.attach(this.nes);
    }
  }

  setController1(buttons) {
    if (!this.runtime || typeof this.runtime.setController1 !== 'function') {
      throw new Error('WASM emulation runtime missing setController1');
    }
    this.runtime.setController1(buttons);
  }

  runCpuCycles(cycles) {
    if (!this.runtime || typeof this.runtime.runCpuCycles !== 'function') {
      throw new Error('WASM emulation runtime missing runCpuCycles');
    }
    return this.runtime.runCpuCycles(cycles | 0);
  }

  runFrame(maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
    if (!this.runtime || typeof this.runtime.runFrame !== 'function') {
      throw new Error('WASM emulation runtime missing runFrame');
    }
    return this.runtime.runFrame(maxCpuCycles | 0, fallbackCpuCycles | 0);
  }

  runFrames(frameCount, maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
    if (!this.runtime || typeof this.runtime.runFrames !== 'function') {
      throw new Error('WASM emulation runtime missing runFrames');
    }
    return this.runtime.runFrames(frameCount | 0, maxCpuCycles | 0, fallbackCpuCycles | 0);
  }

  getStateSnapshot() {
    if (this.runtime && typeof this.runtime.getStateSnapshot === 'function') {
      try {
        const snapshot = this.runtime.getStateSnapshot();
        if (snapshot && typeof snapshot === 'object') return snapshot;
      } catch (_err) {
        // Fallback to attached NES snapshot below.
      }
    }
    return readNesStateSnapshot(this.nes, this._stateSnapshot);
  }
}

function isRuntimeContractValid(runtime) {
  if (wasmEmuBackendSharedNs && typeof wasmEmuBackendSharedNs.isBackendContractValid === 'function') {
    return wasmEmuBackendSharedNs.isBackendContractValid(runtime, { requireRunFrames: true });
  }
  if (!runtime) return false;
  return (
    typeof runtime.setController1 === 'function' &&
    typeof runtime.runCpuCycles === 'function' &&
    typeof runtime.runFrame === 'function' &&
    typeof runtime.runFrames === 'function'
  );
}

function readNesStateSnapshot(nes, out = null) {
  if (wasmEmuBackendSharedNs && typeof wasmEmuBackendSharedNs.readNesStateSnapshot === 'function') {
    return wasmEmuBackendSharedNs.readNesStateSnapshot(nes, out);
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

function resolveRuntimeFactory(options = null) {
  const opts = options || null;
  if (opts && typeof opts.runtimeFactory === 'function') {
    return opts.runtimeFactory;
  }
  if (
    typeof globalThis !== 'undefined' &&
    globalThis.NESCoreWasmRuntime &&
    typeof globalThis.NESCoreWasmRuntime.createRuntime === 'function'
  ) {
    return globalThis.NESCoreWasmRuntime.createRuntime;
  }
  return null;
}

function createWasmEmulationBackend(nes, options = null) {
  const opts = options || null;
  const runtimeFactory = resolveRuntimeFactory(opts);
  if (!runtimeFactory) return null;
  let runtime = null;
  try {
    runtime = runtimeFactory(nes || null, opts);
  } catch (_err) {
    runtime = null;
  }
  if (!isRuntimeContractValid(runtime)) return null;
  return new WasmEmulationBackendCore(runtime, nes || null);
}

const wasmEmulationBackendExports = {
  WasmEmulationBackend: WasmEmulationBackendCore,
  createWasmEmulationBackend,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = wasmEmulationBackendExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreWasmEmulationBackend = wasmEmulationBackendExports;
}
