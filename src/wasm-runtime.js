let wasmRuntimeSharedNs = null;
if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
  try {
    // eslint-disable-next-line global-require
    wasmRuntimeSharedNs = require('./emulation-backend-shared');
  } catch (_err) {
    wasmRuntimeSharedNs = null;
  }
}
if (!wasmRuntimeSharedNs && typeof globalThis !== 'undefined' && globalThis.NESCoreBackendShared) {
  wasmRuntimeSharedNs = globalThis.NESCoreBackendShared;
}

function resolveWasmRuntimeEnabled(options = null) {
  const opts = options || null;
  if (opts && opts.forceDisable === true) return false;
  if (opts && opts.forceEnable === true) return true;
  if (typeof globalThis !== 'undefined' && globalThis.__NES_ENABLE_WASM_RUNTIME === true) return true;
  try {
    if (typeof globalThis !== 'undefined' && globalThis.location && typeof globalThis.location.search === 'string') {
      const params = new URLSearchParams(globalThis.location.search || '');
      const core = String(params.get('core') || '').trim().toLowerCase();
      const runtime = String(params.get('runtime') || '').trim().toLowerCase();
      if (core === 'wasm' || runtime === 'wasm') return true;
    }
  } catch (_err) {
    // Keep disabled on URL parse failures.
  }
  return false;
}

// Generated from src/wasm-runtime-native-loop.rs.
// Regenerate with: node scripts/build-wasm-runtime-native-loop.js
const WASM_NATIVE_LOOP_MODULE_BASE64 = 'AGFzbQEAAAABEgNgAn9/AX9gAAF/YAN/f38BfwIcAQNlbnYUcnVuX2ZyYW1lX3N0ZXBfZmxhZ3MAAAMEAwEBAgUDAQARBhkDfwFBgIDAAAt/AEGIgMAAC38AQZCAwAALB2EGBm1lbW9yeQIAE2dldF9sYXN0X25vX2FkdmFuY2UAARZnZXRfbGFzdF91c2VkX2ZhbGxiYWNrAAIKcnVuX2ZyYW1lcwADCl9fZGF0YV9lbmQDAQtfX2hlYXBfYmFzZQMCCpIBAwsAQQAoAoCAwIAACwsAQQAoAoSAwIAAC3gBBH9BACEDQQAhBEEAIQUCQCAAQQFIDQBBACEEIAAhBUEAIQMDQAJAIAUNACAAIQUMAgsgBUF/aiEFIAEgAhCAgICAACIGQQFxIANqIQMgBkEBdkEBcSAEaiEEDAALC0EAIAQ2AoCAwIAAQQAgAzYChIDAgAAgBQsAvwEEbmFtZQAeHXdhc20tcnVudGltZS1uYXRpdmUtbG9vcC53YXNtAYMBBABHX1pOMjR3YXNtX3J1bnRpbWVfbmF0aXZlX2xvb3AyMHJ1bl9mcmFtZV9zdGVwX2ZsYWdzMTdoNTdhZWE1OTlkY2M1MjRjZUUBE2dldF9sYXN0X25vX2FkdmFuY2UCFmdldF9sYXN0X3VzZWRfZmFsbGJhY2sDCnJ1bl9mcmFtZXMHEgEAD19fc3RhY2tfcG9pbnRlcgA9CXByb2R1Y2VycwEMcHJvY2Vzc2VkLWJ5AQVydXN0Yx0xLjk0LjAgKDRhNGVmNDkzZSAyMDI2LTAzLTAyKQCUAQ90YXJnZXRfZmVhdHVyZXMIKwtidWxrLW1lbW9yeSsPYnVsay1tZW1vcnktb3B0KxZjYWxsLWluZGlyZWN0LW92ZXJsb25nKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrE25vbnRyYXBwaW5nLWZwdG9pbnQrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=';

function decodeBase64ToUint8Array(base64Text) {
  const text = String(base64Text || '');
  if (!text) return new Uint8Array(0);
  if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
    const buf = Buffer.from(text, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (typeof atob === 'function') {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i) & 0xff;
    }
    return out;
  }
  throw new Error('No base64 decoder available');
}

const WASM_NATIVE_LOOP_MODULE_BYTES = decodeBase64ToUint8Array(WASM_NATIVE_LOOP_MODULE_BASE64);

let wasmNativeLoopModuleCache = undefined;

function getWasmNativeLoopModule() {
  if (wasmNativeLoopModuleCache !== undefined) return wasmNativeLoopModuleCache;
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.Module !== 'function') {
    wasmNativeLoopModuleCache = null;
    return wasmNativeLoopModuleCache;
  }
  try {
    wasmNativeLoopModuleCache = new WebAssembly.Module(WASM_NATIVE_LOOP_MODULE_BYTES);
  } catch (_err) {
    wasmNativeLoopModuleCache = null;
  }
  return wasmNativeLoopModuleCache;
}

const WASM_RUNTIME_INPUT_DEVICE_METHODS = {
  setController1(buttons) {
    this._assertNes().setController1(buttons);
  },

  setFamilyBasicKeyboardState(keys) {
    const nes = this._assertNes();
    if (typeof nes.setFamilyBasicKeyboardState !== 'function') return false;
    return !!nes.setFamilyBasicKeyboardState(keys || null);
  },

  setFamilyBasicKey(code, pressed) {
    const nes = this._assertNes();
    if (typeof nes.setFamilyBasicKey !== 'function') return false;
    return !!nes.setFamilyBasicKey(code, !!pressed);
  },

  isFamilyBasicKeyboardAvailable() {
    const nes = this._assertNes();
    if (typeof nes.isFamilyBasicKeyboardAvailable !== 'function') return false;
    return !!nes.isFamilyBasicKeyboardAvailable();
  },

  isFamilyBasicKeyboardDeviceEnabled() {
    const nes = this._assertNes();
    if (typeof nes.isFamilyBasicKeyboardDeviceEnabled !== 'function') return false;
    return !!nes.isFamilyBasicKeyboardDeviceEnabled();
  },

  setFamilyBasicKeyboardDeviceEnabled(enabled) {
    const nes = this._assertNes();
    if (typeof nes.setFamilyBasicKeyboardDeviceEnabled !== 'function') return false;
    return !!nes.setFamilyBasicKeyboardDeviceEnabled(!!enabled);
  },

  isFamilyBasicCassetteAvailable() {
    const nes = this._assertNes();
    if (typeof nes.isFamilyBasicCassetteAvailable !== 'function') return false;
    return !!nes.isFamilyBasicCassetteAvailable();
  },

  isFamilyBasicCassetteDeviceEnabled() {
    const nes = this._assertNes();
    if (typeof nes.isFamilyBasicCassetteDeviceEnabled !== 'function') return false;
    return !!nes.isFamilyBasicCassetteDeviceEnabled();
  },

  setFamilyBasicCassetteDeviceEnabled(enabled) {
    const nes = this._assertNes();
    if (typeof nes.setFamilyBasicCassetteDeviceEnabled !== 'function') return false;
    return !!nes.setFamilyBasicCassetteDeviceEnabled(!!enabled);
  },

  setFamilyBasicCassetteMode(mode) {
    const nes = this._assertNes();
    if (typeof nes.setFamilyBasicCassetteMode !== 'function') return false;
    return !!nes.setFamilyBasicCassetteMode(mode);
  },

  rewindFamilyBasicCassette() {
    const nes = this._assertNes();
    if (typeof nes.rewindFamilyBasicCassette !== 'function') return false;
    return !!nes.rewindFamilyBasicCassette();
  },

  clearFamilyBasicCassette() {
    const nes = this._assertNes();
    if (typeof nes.clearFamilyBasicCassette !== 'function') return false;
    return !!nes.clearFamilyBasicCassette();
  },

  loadFamilyBasicCassetteBits(bits) {
    const nes = this._assertNes();
    if (typeof nes.loadFamilyBasicCassetteBits !== 'function') return false;
    return !!nes.loadFamilyBasicCassetteBits(bits);
  },

  exportFamilyBasicCassetteBits() {
    const nes = this._assertNes();
    if (typeof nes.exportFamilyBasicCassetteBits !== 'function') return [];
    return nes.exportFamilyBasicCassetteBits();
  },

  getFamilyBasicCassetteState() {
    const nes = this._assertNes();
    if (typeof nes.getFamilyBasicCassetteState !== 'function') return null;
    return nes.getFamilyBasicCassetteState();
  },
};

class WasmRuntimeJsBridgeCore {
  constructor(nes) {
    this.nes = nes || null;
    this.runtimeKind = 'js-bridge';
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

  attach(nes) {
    this.nes = nes || null;
    readNesStateSnapshot(this.nes, this._stateSnapshot);
  }

  _assertNes() {
    if (!this.nes) throw new Error('WASM runtime bridge not attached');
    return this.nes;
  }

  runCpuCycles(cycles) {
    return this._assertNes().runCpuCycles(cycles | 0);
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

class WasmRuntimeNativeLoopCore {
  constructor(nes, wasmModule) {
    if (!wasmModule) throw new Error('WASM module required');
    this.nes = nes || null;
    this.runtimeKind = 'wasm-loop';
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
    this._runFrameStepFlagsBound = this._runFrameStepFlags.bind(this);
    this._instance = new WebAssembly.Instance(wasmModule, {
      env: {
        run_frame_step_flags: (maxCpuCycles, fallbackCpuCycles) => (
          this._runFrameStepFlagsBound(maxCpuCycles | 0, fallbackCpuCycles | 0) | 0
        ),
      },
    });
    this._exports = this._instance.exports || {};
    if (
      typeof this._exports.run_frames !== 'function' ||
      typeof this._exports.get_last_used_fallback !== 'function' ||
      typeof this._exports.get_last_no_advance !== 'function'
    ) {
      throw new Error('WASM runtime missing run_frames export');
    }
  }

  _runFrameStepFlags(maxCpuCycles, fallbackCpuCycles) {
    const nes = this._assertNes();
    const stepBeforeCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
    const step = nes.runUntilNextVBlank(maxCpuCycles | 0);
    let flags = 0;
    if (!step.frameAdvanced) {
      nes.runCpuCycles(fallbackCpuCycles | 0);
      flags |= 0x1;
    }
    const stepAfterCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : stepBeforeCycles;
    if (stepAfterCycles === stepBeforeCycles) flags |= 0x2;
    return flags;
  }

  attach(nes) {
    this.nes = nes || null;
    readNesStateSnapshot(this.nes, this._stateSnapshot);
  }

  _assertNes() {
    if (!this.nes) throw new Error('WASM native loop runtime not attached');
    return this.nes;
  }

  runCpuCycles(cycles) {
    return this._assertNes().runCpuCycles(cycles | 0);
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
    ran = this._exports.run_frames(target, maxCycles, fallbackCycles) | 0;
    if (ran < 0) ran = 0;
    if (ran > target) ran = target;
    let usedFallbackFrames = this._exports.get_last_used_fallback() | 0;
    if (usedFallbackFrames < 0) usedFallbackFrames = 0;
    if (usedFallbackFrames > ran) usedFallbackFrames = ran;
    let noAdvanceFrames = this._exports.get_last_no_advance() | 0;
    if (noAdvanceFrames < 0) noAdvanceFrames = 0;
    if (noAdvanceFrames > ran) noAdvanceFrames = ran;
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

Object.assign(WasmRuntimeJsBridgeCore.prototype, WASM_RUNTIME_INPUT_DEVICE_METHODS);
Object.assign(WasmRuntimeNativeLoopCore.prototype, WASM_RUNTIME_INPUT_DEVICE_METHODS);

function readNesStateSnapshot(nes, out = null) {
  if (wasmRuntimeSharedNs && typeof wasmRuntimeSharedNs.readNesStateSnapshot === 'function') {
    return wasmRuntimeSharedNs.readNesStateSnapshot(nes, out);
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

function isRuntimeContractValid(runtime) {
  if (wasmRuntimeSharedNs && typeof wasmRuntimeSharedNs.isBackendContractValid === 'function') {
    return wasmRuntimeSharedNs.isBackendContractValid(runtime, { requireRunFrames: true });
  }
  if (!runtime) return false;
  return (
    typeof runtime.setController1 === 'function' &&
    typeof runtime.runCpuCycles === 'function' &&
    typeof runtime.runFrame === 'function' &&
    typeof runtime.runFrames === 'function'
  );
}

function attachRuntime(runtime, nes) {
  if (!runtime) return runtime;
  if (typeof runtime.attach === 'function') {
    try {
      runtime.attach(nes || null);
    } catch (_err) {
      // Keep runtime as-is if attach fails.
    }
  }
  return runtime;
}

function tryBuildRuntimeFromFactory(factory, nes, options) {
  if (typeof factory !== 'function') return null;
  try {
    const runtime = factory(nes || null, options || null);
    if (!isRuntimeContractValid(runtime)) return null;
    return attachRuntime(runtime, nes);
  } catch (_err) {
    return null;
  }
}

function resolveInjectedRuntime(nes, options = null) {
  const opts = options || null;
  if (opts && isRuntimeContractValid(opts.runtime)) {
    return attachRuntime(opts.runtime, nes);
  }

  if (opts && typeof opts.runtimeFactory === 'function') {
    const runtimeFromOpts = tryBuildRuntimeFromFactory(opts.runtimeFactory, nes, opts);
    if (runtimeFromOpts) return runtimeFromOpts;
  }

  if (
    typeof globalThis !== 'undefined' &&
    typeof globalThis.__NES_WASM_RUNTIME_FACTORY === 'function'
  ) {
    const runtimeFromGlobal = tryBuildRuntimeFromFactory(globalThis.__NES_WASM_RUNTIME_FACTORY, nes, opts);
    if (runtimeFromGlobal) return runtimeFromGlobal;
  }

  return null;
}

function resolvePreferNativeWasm(options = null) {
  const opts = options || null;
  if (opts && opts.forceJsBridge === true) return false;
  if (opts && opts.preferNativeWasm === false) return false;
  return true;
}

function resolveStrictNativeWasm(options = null) {
  const opts = options || null;
  return !!(opts && opts.strictNativeWasm);
}

function tryCreateNativeRuntime(nes, options = null) {
  if (!resolvePreferNativeWasm(options)) return null;
  const wasmModule = getWasmNativeLoopModule();
  if (!wasmModule) return null;
  try {
    return new WasmRuntimeNativeLoopCore(nes || null, wasmModule);
  } catch (_err) {
    return null;
  }
}

function createRuntime(nes, options = null) {
  if (!resolveWasmRuntimeEnabled(options)) return null;
  const injected = resolveInjectedRuntime(nes || null, options || null);
  if (injected) return injected;
  const nativeRuntime = tryCreateNativeRuntime(nes || null, options || null);
  if (nativeRuntime) return nativeRuntime;
  if (resolveStrictNativeWasm(options)) return null;
  return new WasmRuntimeJsBridgeCore(nes || null);
}

const wasmRuntimeExports = {
  WasmRuntimeJsBridge: WasmRuntimeJsBridgeCore,
  WasmRuntimeNativeLoop: WasmRuntimeNativeLoopCore,
  createRuntime,
  readNesStateSnapshot,
  isRuntimeContractValid,
  getWasmNativeLoopModule,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = wasmRuntimeExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreWasmRuntime = wasmRuntimeExports;
}
