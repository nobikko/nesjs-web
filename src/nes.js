let SingleClockNESCore = null;

if (typeof require !== 'undefined') {
  try {
    ({ NES: SingleClockNESCore } = require('./nes-single-clock'));
  } catch (_err) {
    SingleClockNESCore = null;
  }
}

if (!SingleClockNESCore && typeof globalThis !== 'undefined' && globalThis.NESCoreNesSingleClock) {
  SingleClockNESCore = globalThis.NESCoreNesSingleClock.NES;
}

if (!SingleClockNESCore) {
  throw new Error('Single-clock NES core not found');
}

const nesExports = { NES: SingleClockNESCore };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = nesExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreNES = nesExports;
}
