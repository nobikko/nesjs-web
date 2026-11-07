class CpuPhaseClockState {
  constructor() {
    this.reset();
  }

  reset() {
    this.masterClock = 0;
    this.subClock = 0;
    this.halfCycleCounter = 0;
    this.getOrPut = true;
    this.oddCycle = true;
    this.evenCycle = false;
    this.oddOrEven = true;
    this.getCycle = true;
    this.putCycle = false;
    this.putCycleMister = true;
    this.cpuCe = false;
    this.putCe = false;
    this.getCe = false;
    // MiSTer aliases
    this.aclk1 = false;
    this.aclk1Delayed = false;
    this._pendingToggle = false;
    if (!this._snapshot) {
      this._snapshot = {
        masterClock: 0,
        subClock: 0,
        halfCycleCounter: 0,
        getOrPut: true,
        oddCycle: true,
        evenCycle: false,
        oddOrEven: true,
        getCycle: true,
        putCycle: false,
        putCycleMister: true,
        cpuCe: false,
        putCe: false,
        getCe: false,
        aclk1: false,
        aclk1Delayed: false,
      };
    }
  }

  beginHalfTick(masterClock, subClock) {
    const master = masterClock >>> 0;
    const sub = subClock >>> 0;
    const cpuCe = (sub % 12) === 0;
    const getOrPut = (this.getOrPut === true);
    const oddCycle = getOrPut;
    const evenCycle = !getOrPut;
    const getCe = cpuCe && getOrPut;
    const putCe = cpuCe && !getOrPut;
    const halfCycleCounter = (this.halfCycleCounter + 1) >>> 0;

    this.masterClock = master;
    this.subClock = sub;
    this.cpuCe = cpuCe;
    this.oddCycle = oddCycle;
    this.evenCycle = evenCycle;
    this.getCe = getCe;
    this.putCe = putCe;
    this.getCycle = getOrPut;
    this.putCycle = !getOrPut;
    this.putCycleMister = getOrPut;
    this.oddOrEven = getOrPut;
    this.aclk1 = getCe;
    this.aclk1Delayed = putCe;
    this._pendingToggle = cpuCe;
    this.halfCycleCounter = halfCycleCounter;
    return this;
  }

  commitHalfTick() {
    if (this._pendingToggle) {
      this.getOrPut = !this.getOrPut;
    }
    this._pendingToggle = false;
  }

  snapshot() {
    const snap = this._snapshot;
    snap.masterClock = this.masterClock >>> 0;
    snap.subClock = this.subClock >>> 0;
    snap.halfCycleCounter = this.halfCycleCounter >>> 0;
    snap.getOrPut = !!this.getOrPut;
    snap.oddCycle = !!this.oddCycle;
    snap.evenCycle = !!this.evenCycle;
    snap.oddOrEven = !!this.oddOrEven;
    snap.getCycle = !!this.getCycle;
    snap.putCycle = !!this.putCycle;
    snap.putCycleMister = !!this.putCycleMister;
    snap.cpuCe = !!this.cpuCe;
    snap.putCe = !!this.putCe;
    snap.getCe = !!this.getCe;
    snap.aclk1 = !!this.aclk1;
    snap.aclk1Delayed = !!this.aclk1Delayed;
    return snap;
  }
}

const cpuPhaseClockStateExports = { CpuPhaseClockState };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuPhaseClockStateExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuPhaseClockState = cpuPhaseClockStateExports;
}
