function resolveBackendSharedNamespace() {
  if (typeof globalThis !== 'undefined' && globalThis.NESCoreBackendShared) {
    return globalThis.NESCoreBackendShared;
  }
  return null;
}

function readNesStateSnapshot(nes, out = null) {
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

function isBackendContractValid(candidate, options = null) {
  const opts = options || null;
  const requireRunFrames = !!(opts && opts.requireRunFrames);
  if (!candidate) return false;
  const hasCore = (
    typeof candidate.setController1 === 'function' &&
    typeof candidate.runCpuCycles === 'function' &&
    typeof candidate.runFrame === 'function'
  );
  if (!hasCore) return false;
  if (requireRunFrames && typeof candidate.runFrames !== 'function') return false;
  return true;
}

const backendSharedExports = {
  resolveBackendSharedNamespace,
  readNesStateSnapshot,
  isBackendContractValid,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = backendSharedExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreBackendShared = backendSharedExports;
}
