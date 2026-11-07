const FLAG_C = 0x01;
const FLAG_Z = 0x02;
const FLAG_I = 0x04;
const FLAG_D = 0x08;
const FLAG_B = 0x10;
const FLAG_U = 0x20;
const FLAG_V = 0x40;
const FLAG_N = 0x80;

let CpuMicroSequencerCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ CpuMicroSequencer: CpuMicroSequencerCore } = require('./cpu-micro-sequencer'));
  } catch (_err) {
    CpuMicroSequencerCore = null;
  }
}
if (!CpuMicroSequencerCore && typeof globalThis !== 'undefined' && globalThis.NESCoreCpuMicroSequencer) {
  CpuMicroSequencerCore = globalThis.NESCoreCpuMicroSequencer.CpuMicroSequencer;
}
if (!CpuMicroSequencerCore) {
  throw new Error('CpuMicroSequencer core not found');
}

let createCpuOpcodeTableCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ createCpuOpcodeTable: createCpuOpcodeTableCore } = require('./cpu-opcode-table'));
  } catch (_err) {
    createCpuOpcodeTableCore = null;
  }
}
if (!createCpuOpcodeTableCore && typeof globalThis !== 'undefined' && globalThis.NESCoreCpuOpcodeTable) {
  createCpuOpcodeTableCore = globalThis.NESCoreCpuOpcodeTable.createCpuOpcodeTable;
}
if (!createCpuOpcodeTableCore) {
  throw new Error('CpuOpcodeTable core not found');
}

class CPU6502 {
  constructor(bus) {
    this.bus = bus;
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.p = FLAG_U | FLAG_I;
    this.pc = 0;
    this.stopped = false;
    this.accessCycles = 0;
    this.rdyStallInInstr = false;
    this.flags = {
      C: FLAG_C,
      Z: FLAG_Z,
      I: FLAG_I,
      D: FLAG_D,
      B: FLAG_B,
      U: FLAG_U,
      V: FLAG_V,
      N: FLAG_N,
    };
    this.micro = new CpuMicroSequencerCore(this, {
      I: FLAG_I,
      B: FLAG_B,
      U: FLAG_U,
    });
    this.opcodeTable = createCpuOpcodeTableCore(this);
    this.interruptIFlag = true;
    this.pendingInterruptIFlag = null;
    this.polledNmiPending = false;
    this.polledIrqPending = false;
    this.hadPollWindowCurrentInstruction = false;
    this.instrBusCycleIndex = 0;
    this.instrRdyLowByCycleMask = 0;
    this.lastOpcode = 0xea;
    this._rmwMutateAsl = (old) => {
      this.p = ((this.p & (~FLAG_C & 0xff)) | ((old & 0x80) ? FLAG_C : 0)) & 0xff;
      return (old << 1) & 0xff;
    };
    this._rmwMutateLsr = (old) => {
      this.p = ((this.p & (~FLAG_C & 0xff)) | ((old & 0x01) ? FLAG_C : 0)) & 0xff;
      return (old >> 1) & 0xff;
    };
    this._rmwMutateRol = (old) => {
      const c = (this.p & FLAG_C) ? 1 : 0;
      this.p = ((this.p & (~FLAG_C & 0xff)) | ((old & 0x80) ? FLAG_C : 0)) & 0xff;
      return ((old << 1) | c) & 0xff;
    };
    this._rmwMutateRor = (old) => {
      const c = (this.p & FLAG_C) ? 1 : 0;
      this.p = ((this.p & (~FLAG_C & 0xff)) | ((old & 0x01) ? FLAG_C : 0)) & 0xff;
      return ((old >> 1) | (c << 7)) & 0xff;
    };
    this._interruptLinesSnapshot = { nmi: false, irq: false };
    this._serviceLinesSnapshot = { nmi: false, irq: false };
    this._pollResultSnapshot = { nmi: false, irq: false };
    this._addrInfoSnapshot = { base: 0, addr: 0, pageCross: false };
    this._dummyAddrInfoSnapshot = { base: 0, addr: 0 };
    this._refreshBusFastPaths();
  }

  _refreshBusFastPaths() {
    const bus = this.bus || null;
    this._busOnCpuBusCycleStart = (bus && typeof bus.onCpuBusCycleStart === 'function')
      ? bus.onCpuBusCycleStart.bind(bus)
      : null;
    this._busConsumeCpuRDYStallCycle = (bus && typeof bus.consumeCpuRDYStallCycle === 'function')
      ? bus.consumeCpuRDYStallCycle.bind(bus)
      : null;
    this._busAdvanceCpuStallCycle = (bus && typeof bus.advanceCpuStallCycle === 'function')
      ? bus.advanceCpuStallCycle.bind(bus)
      : null;
    this._busAdvanceCpuBusCycleRead = (bus && typeof bus.advanceCpuBusCycleRead === 'function')
      ? bus.advanceCpuBusCycleRead.bind(bus)
      : null;
    this._busAdvanceCpuBusCycleWrite = (bus && typeof bus.advanceCpuBusCycleWrite === 'function')
      ? bus.advanceCpuBusCycleWrite.bind(bus)
      : null;
    this._busAdvanceCpuBusCycleWithAccess = (bus && typeof bus.advanceCpuBusCycleWithAccess === 'function')
      ? bus.advanceCpuBusCycleWithAccess.bind(bus)
      : null;
    this._busAdvanceCpuBusCycleBeforeAccess = (bus && typeof bus.advanceCpuBusCycleBeforeAccess === 'function')
      ? bus.advanceCpuBusCycleBeforeAccess.bind(bus)
      : null;
    this._busAdvanceCpuBusCycleAfterAccess = (bus && typeof bus.advanceCpuBusCycleAfterAccess === 'function')
      ? bus.advanceCpuBusCycleAfterAccess.bind(bus)
      : null;
    this._busAdvanceCpuBusCycle = (bus && typeof bus.advanceCpuBusCycle === 'function')
      ? bus.advanceCpuBusCycle.bind(bus)
      : null;
    this._busCpuRead = (bus && typeof bus.cpuRead === 'function')
      ? bus.cpuRead.bind(bus)
      : null;
    this._busCpuWrite = (bus && typeof bus.cpuWrite === 'function')
      ? bus.cpuWrite.bind(bus)
      : null;
    this._busTickPPU = (bus && typeof bus.tickPPU === 'function')
      ? bus.tickPPU.bind(bus)
      : null;
    this._busTickApu = (bus && typeof bus.tickApu === 'function')
      ? bus.tickApu.bind(bus)
      : null;
  }

  reset() {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xfd;
    this.p = FLAG_U | FLAG_I;
    this.pc = this.read16(0xfffc);
    this.stopped = false;
    this.accessCycles = 0;
    this.rdyStallInInstr = false;
    this.interruptIFlag = true;
    this.pendingInterruptIFlag = null;
    this.polledNmiPending = false;
    this.polledIrqPending = false;
    this.hadPollWindowCurrentInstruction = false;
    this.instrBusCycleIndex = 0;
    this.instrRdyLowByCycleMask = 0;
    this.lastOpcode = 0xea;
  }

  _peekInterruptLines() {
    let nmi = false;
    let irq = false;
    const out = this._interruptLinesSnapshot;
    const bus = this.bus;
    if (!bus) {
      out.nmi = false;
      out.irq = false;
      return out;
    }
    // Poll windows should sample pending edge/level lines directly.
    // Service latches are consumed at instruction boundaries after poll.
    const peekCpuPollLines = bus.peekCpuPollLines;
    if (typeof peekCpuPollLines === 'function') {
      const snap = peekCpuPollLines.call(bus);
      out.nmi = !!(snap && snap.nmi);
      out.irq = !!(snap && snap.irq);
      return out;
    }
    const isNmiPending = bus.isNmiPending;
    const shouldServiceNmi = bus.shouldServiceNmi;
    const peekCpuServiceLines = bus.peekCpuServiceLines;
    if (typeof isNmiPending === 'function') {
      nmi = !!isNmiPending.call(bus);
    } else if (typeof shouldServiceNmi === 'function') {
      nmi = !!shouldServiceNmi.call(bus);
    } else if (typeof peekCpuServiceLines === 'function') {
      const snap = peekCpuServiceLines.call(bus);
      nmi = !!(snap && snap.nmi);
    }
    const isIrqAsserted = bus.isIrqAsserted;
    const shouldServiceIrq = bus.shouldServiceIrq;
    if (typeof isIrqAsserted === 'function') {
      irq = !!isIrqAsserted.call(bus);
    } else if (typeof shouldServiceIrq === 'function') {
      irq = !!shouldServiceIrq.call(bus);
    } else if (typeof peekCpuServiceLines === 'function') {
      const snap = peekCpuServiceLines.call(bus);
      irq = !!(snap && snap.irq);
    }
    out.nmi = !!nmi;
    out.irq = !!irq;
    return out;
  }

  _peekServiceLines() {
    let nmi = false;
    let irq = false;
    const out = this._serviceLinesSnapshot;
    const bus = this.bus;
    if (!bus) {
      out.nmi = false;
      out.irq = false;
      return out;
    }
    const peekCpuServiceLines = bus.peekCpuServiceLines;
    if (typeof peekCpuServiceLines === 'function') {
      const snap = peekCpuServiceLines.call(bus);
      out.nmi = !!(snap && snap.nmi);
      out.irq = !!(snap && snap.irq);
      return out;
    }
    const shouldServiceNmi = bus.shouldServiceNmi;
    const shouldServiceIrq = bus.shouldServiceIrq;
    if (typeof shouldServiceNmi === 'function') {
      nmi = !!shouldServiceNmi.call(bus);
    }
    if (typeof shouldServiceIrq === 'function') {
      irq = !!shouldServiceIrq.call(bus);
    }
    out.nmi = !!nmi;
    out.irq = !!irq;
    return out;
  }

  pollInterruptAtInstructionPoint(options) {
    const hasOptions = !!options;
    const queue = !hasOptions || options.queue !== false;
    const iFlagSet = (hasOptions && Object.prototype.hasOwnProperty.call(options, 'iFlagSet'))
      ? !!options.iFlagSet
      : !!this.interruptIFlag;
    const lines = this._peekInterruptLines();
    const nmi = !!lines.nmi;
    const irq = !!lines.irq && !iFlagSet;
    // Track poll-window presence independently from queueing.
    // BRK hijack windows intentionally sample with queue:false.
    this.hadPollWindowCurrentInstruction = true;
    if (queue) {
      if (nmi) {
        this.polledNmiPending = true;
        this.polledIrqPending = false;
      } else if (irq) {
        this.polledIrqPending = true;
      }
    }
    const out = this._pollResultSnapshot;
    out.nmi = !!nmi;
    out.irq = !!irq;
    return out;
  }

  _consumePolledInterruptVector() {
    if (this.polledNmiPending) {
      this.polledNmiPending = false;
      this.polledIrqPending = false;
      return 0xfffa;
    }
    if (this.polledIrqPending) {
      this.polledIrqPending = false;
      return 0xfffe;
    }
    return null;
  }

  _sampleInterruptState() {
    const bus = this.bus;
    if (!bus || typeof bus.onCpuPhaseTick !== 'function') {
      if (bus && typeof bus.sampleCpuInterruptState === 'function') {
        bus.sampleCpuInterruptState(!!this.interruptIFlag);
      }
    }
    if (this.pendingInterruptIFlag !== null) {
      this.interruptIFlag = !!this.pendingInterruptIFlag;
      this.pendingInterruptIFlag = null;
    }
  }

  sampleInternalCycles(cycles) {
    const count = cycles | 0;
    for (let i = 0; i < count; i += 1) {
      this._sampleInterruptState();
    }
  }

  _resetInstructionRdyTrace() {
    this.instrBusCycleIndex = 0;
    this.instrRdyLowByCycleMask = 0;
  }

  _markRdyLowForCurrentCycle(forceLow) {
    let low = !!forceLow;
    const bus = this.bus;
    if (!low && bus && typeof bus.isCpuRdyLow === 'function') {
      try {
        low = !!bus.isCpuRdyLow();
      } catch (_err) {
        low = false;
      }
    }
    if (!low) return;
    const bit = this.instrBusCycleIndex | 0;
    if (bit < 0 || bit > 30) return;
    this.instrRdyLowByCycleMask |= (1 << bit);
  }

  _advanceInstructionBusCycleIndex() {
    this.instrBusCycleIndex = (this.instrBusCycleIndex + 1) & 0x7f;
  }

  _didRdyLowOccurAtInstructionCycle(cycleIndex) {
    const idx = cycleIndex | 0;
    if (idx < 0 || idx > 30) return false;
    return ((this.instrRdyLowByCycleMask >>> idx) & 0x01) !== 0;
  }

  _t65RdyModForUnstableOpcode(opcode) {
    const op = opcode & 0xff;
    // Direct T65.vhd mapping (line 414):
    //   ((MCycle = "011" && IR != 0x93) || (MCycle = "100" && IR == 0x93)) && Rdy = '0'
    //   => rdy_mod = '1'
    // MCycle is 0-based from opcode fetch, matching instrBusCycleIndex.
    const checkCycle = op === 0x93 ? 4 : 3;
    return this._didRdyLowOccurAtInstructionCycle(checkCycle);
  }

  read(addr, beforeSample) {
    this.accessCycles += 1;
    const a = addr & 0xffff;
    const onCpuBusCycleStart = this._busOnCpuBusCycleStart;
    const consumeCpuRDYStallCycle = this._busConsumeCpuRDYStallCycle;
    const advanceCpuStallCycle = this._busAdvanceCpuStallCycle;
    const advanceCpuBusCycleRead = this._busAdvanceCpuBusCycleRead;
    const advanceCpuBusCycleWithAccess = this._busAdvanceCpuBusCycleWithAccess;
    const advanceCpuBusCycleBeforeAccess = this._busAdvanceCpuBusCycleBeforeAccess;
    const advanceCpuBusCycleAfterAccess = this._busAdvanceCpuBusCycleAfterAccess;
    const advanceCpuBusCycle = this._busAdvanceCpuBusCycle;
    const cpuRead = this._busCpuRead;
    const tickPPU = this._busTickPPU;
    const tickApu = this._busTickApu;
    let hook = null;
    if (onCpuBusCycleStart) {
      hook = onCpuBusCycleStart(a, false, 0);
    }
    this._markRdyLowForCurrentCycle(false);
    if (consumeCpuRDYStallCycle) {
      while (consumeCpuRDYStallCycle()) {
        this.rdyStallInInstr = true;
        this.accessCycles += 1;
        if (advanceCpuStallCycle) advanceCpuStallCycle();
        else {
          if (tickPPU) tickPPU(3);
          if (tickApu) tickApu(1);
        }
        this._markRdyLowForCurrentCycle(true);
        this._sampleInterruptState();
      }
    }
    if (hook && hook.hijackRead) {
      const value = hook.value & 0xff;
      if (beforeSample) beforeSample(value & 0xff);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return value;
    }
    if (advanceCpuBusCycleRead) {
      const value = advanceCpuBusCycleRead(a) & 0xff;
      if (beforeSample) beforeSample(value);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return value;
    }
    if (advanceCpuBusCycleWithAccess) {
      const value = advanceCpuBusCycleWithAccess(() => cpuRead(a) & 0xff) & 0xff;
      if (beforeSample) beforeSample(value);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return value;
    }
    if (advanceCpuBusCycleBeforeAccess && advanceCpuBusCycleAfterAccess) {
      advanceCpuBusCycleBeforeAccess();
      const value = cpuRead(a) & 0xff;
      advanceCpuBusCycleAfterAccess();
      if (beforeSample) beforeSample(value);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return value;
    }
    if (advanceCpuBusCycle) advanceCpuBusCycle();
    else {
      if (tickPPU) tickPPU(3);
      if (tickApu) tickApu(1);
    }
    const value = cpuRead(a) & 0xff;
    if (beforeSample) beforeSample(value);
    this._sampleInterruptState();
    this._advanceInstructionBusCycleIndex();
    return value;
  }

  write(addr, value, beforeSample) {
    this.accessCycles += 1;
    const a = addr & 0xffff;
    const v = value & 0xff;
    const onCpuBusCycleStart = this._busOnCpuBusCycleStart;
    const advanceCpuBusCycleWrite = this._busAdvanceCpuBusCycleWrite;
    const advanceCpuBusCycleWithAccess = this._busAdvanceCpuBusCycleWithAccess;
    const advanceCpuBusCycleBeforeAccess = this._busAdvanceCpuBusCycleBeforeAccess;
    const advanceCpuBusCycleAfterAccess = this._busAdvanceCpuBusCycleAfterAccess;
    const advanceCpuBusCycle = this._busAdvanceCpuBusCycle;
    const cpuWrite = this._busCpuWrite;
    const tickPPU = this._busTickPPU;
    const tickApu = this._busTickApu;
    if (onCpuBusCycleStart) onCpuBusCycleStart(a, true, v);
    if (advanceCpuBusCycleWrite) {
      this._markRdyLowForCurrentCycle(false);
      // RDY is only honored on CPU read cycles; write cycles complete un-stalled.
      advanceCpuBusCycleWrite(a, v);
      if (beforeSample) beforeSample(v);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return;
    }
    if (advanceCpuBusCycleWithAccess) {
      this._markRdyLowForCurrentCycle(false);
      // RDY is only honored on CPU read cycles; write cycles complete un-stalled.
      advanceCpuBusCycleWithAccess(() => {
        cpuWrite(a, v);
      });
      if (beforeSample) beforeSample(v);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return;
    }
    if (advanceCpuBusCycleBeforeAccess && advanceCpuBusCycleAfterAccess) {
      advanceCpuBusCycleBeforeAccess();
      this._markRdyLowForCurrentCycle(false);
      // RDY is only honored on CPU read cycles; write cycles complete un-stalled.
      cpuWrite(a, v);
      advanceCpuBusCycleAfterAccess();
      if (beforeSample) beforeSample(v);
      this._sampleInterruptState();
      this._advanceInstructionBusCycleIndex();
      return;
    }
    if (advanceCpuBusCycle) advanceCpuBusCycle();
    else {
      if (tickPPU) tickPPU(3);
      if (tickApu) tickApu(1);
    }
    this._markRdyLowForCurrentCycle(false);
    // RDY is only honored on CPU read cycles; write cycles complete un-stalled.
    cpuWrite(a, v);
    if (beforeSample) beforeSample(v);
    this._sampleInterruptState();
    this._advanceInstructionBusCycleIndex();
  }

  read16(addr) {
    const lo = this.read(addr);
    const hi = this.read((addr + 1) & 0xffff);
    return lo | (hi << 8);
  }

  read16bug(addr) {
    const lo = this.read(addr);
    const hi = this.read((addr & 0xff00) | ((addr + 1) & 0x00ff));
    return lo | (hi << 8);
  }

  push(v) {
    this.write(0x0100 | this.sp, v);
    this.sp = (this.sp - 1) & 0xff;
  }

  pop(beforeSample) {
    this.sp = (this.sp + 1) & 0xff;
    return this.read(0x0100 | this.sp, beforeSample);
  }

  getFlag(flag) {
    return (this.p & flag) !== 0 ? 1 : 0;
  }

  setFlag(flag, on) {
    if (on) this.p |= flag;
    else this.p &= ~flag;
    if ((flag & FLAG_I) !== 0) {
      this.pendingInterruptIFlag = !!on;
    }
  }

  setProcessorStatus(value, options) {
    this.p = value & 0xff;
    if ((this.p & FLAG_U) === 0) {
      this.p |= FLAG_U;
    }
    this.p &= 0xef;
    const nextI = (this.p & FLAG_I) !== 0;
    if (options && options.immediateInterruptI) {
      this.interruptIFlag = nextI;
      this.pendingInterruptIFlag = null;
    } else {
      this.pendingInterruptIFlag = nextI;
    }
  }

  setZN(v) {
    this.setFlag(FLAG_Z, (v & 0xff) === 0);
    this.setFlag(FLAG_N, (v & 0x80) !== 0);
  }

  fetch8() {
    const v = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  fetch16() {
    const lo = this.fetch8();
    const hi = this.fetch8();
    return lo | (hi << 8);
  }

  addrZP() { return this.fetch8(); }
  addrZPX() {
    const base = this.fetch8();
    // Indexed zero-page addressing performs a dummy read from the unindexed base.
    this.read(base);
    return (base + this.x) & 0xff;
  }
  addrZPY() {
    const base = this.fetch8();
    // Indexed zero-page addressing performs a dummy read from the unindexed base.
    this.read(base);
    return (base + this.y) & 0xff;
  }
  addrABS() { return this.fetch16(); }
  addrABSX() { return (this.fetch16() + this.x) & 0xffff; }
  addrABSY() { return (this.fetch16() + this.y) & 0xffff; }
  addrABSXInfo() {
    const base = this.fetch16();
    const addr = (base + this.x) & 0xffff;
    const out = this._addrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    out.pageCross = ((base ^ addr) & 0x100) !== 0;
    return out;
  }
  addrABSYInfo() {
    const base = this.fetch16();
    const addr = (base + this.y) & 0xffff;
    const out = this._addrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    out.pageCross = ((base ^ addr) & 0x100) !== 0;
    return out;
  }
  addrINDX() {
    const base = this.fetch8();
    // (indirect,X) performs a dummy read before index add.
    this.read(base);
    const zp = (base + this.x) & 0xff;
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    return lo | (hi << 8);
  }
  addrINDY() {
    const zp = this.fetch8();
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    return ((lo | (hi << 8)) + this.y) & 0xffff;
  }
  addrINDYInfo() {
    const zp = this.fetch8();
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    const base = lo | (hi << 8);
    const addr = (base + this.y) & 0xffff;
    const out = this._addrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    out.pageCross = ((base ^ addr) & 0x100) !== 0;
    return out;
  }

  nmi() {
    if (this.bus.consumePendingNmi) {
      this.bus.consumePendingNmi();
    }
    this.micro.serviceInterrupt(0xfffa, false);
  }

  irq(ignoreI = false) {
    if (!ignoreI && this.getFlag(FLAG_I)) return;
    this.micro.serviceInterrupt(() => {
      if (this.bus.consumePendingNmi && this.bus.consumePendingNmi()) {
        return 0xfffa;
      }
      return 0xfffe;
    }, false);
  }

  adc(v) {
    const a = this.a;
    const c = this.getFlag(FLAG_C);
    const sum = a + v + c;
    this.setFlag(FLAG_C, sum > 0xff);
    const res = sum & 0xff;
    this.setFlag(FLAG_V, (~(a ^ v) & (a ^ res) & 0x80) !== 0);
    this.a = res;
    this.setZN(this.a);
  }

  sbc(v) {
    this.adc((~v) & 0xff);
  }

  cmp(reg, v) {
    const r = (reg - v) & 0x1ff;
    this.setFlag(FLAG_C, reg >= v);
    this.setFlag(FLAG_Z, (r & 0xff) === 0);
    this.setFlag(FLAG_N, (r & 0x80) !== 0);
  }

  _addrABSXWithDummyRead() {
    return this._addrABSXWithDummyInfo().addr;
  }

  _addrABSXWithDummyInfo() {
    const base = this.fetch16();
    const addr = (base + this.x) & 0xffff;
    const dummy = (base & 0xff00) | (addr & 0x00ff);
    this.read(dummy);
    const out = this._dummyAddrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    return out;
  }

  _addrABSYWithDummyRead() {
    return this._addrABSYWithDummyInfo().addr;
  }

  _addrABSYWithDummyInfo() {
    const base = this.fetch16();
    const addr = (base + this.y) & 0xffff;
    const dummy = (base & 0xff00) | (addr & 0x00ff);
    this.read(dummy);
    const out = this._dummyAddrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    return out;
  }

  _addrINDYWithDummyRead() {
    return this._addrINDYWithDummyInfo().addr;
  }

  _addrINDYWithDummyInfo() {
    const zp = this.fetch8();
    const lo = this.read(zp);
    const hi = this.read((zp + 1) & 0xff);
    const base = lo | (hi << 8);
    const addr = (base + this.y) & 0xffff;
    const dummy = (base & 0xff00) | (addr & 0x00ff);
    this.read(dummy);
    const out = this._dummyAddrInfoSnapshot;
    out.base = base;
    out.addr = addr;
    return out;
  }

  _resolveUnstableStoreTarget(base, addr, rawValue, options) {
    const opts = options;
    const base16 = base & 0xffff;
    const addr16 = addr & 0xffff;
    const pageCross = ((base16 ^ addr16) & 0x100) !== 0;
    const h = (((base16 >> 8) + 1) & 0xff);
    // T65 Rdy_mod semantics: B-variant data path is used only while no RDY-low
    // modification was observed for the instruction.
    const rdyMod = !!(opts && opts.rdyMod);
    const useBPath = !rdyMod;
    const value = useBPath ? ((rawValue & h) & 0xff) : (rawValue & 0xff);
    const quirk = (opts && opts.quirk) ? opts.quirk : 'copy';
    let targetAddr = addr16;
    if (pageCross) {
      if (quirk === 'and') {
        targetAddr = ((((h & value) & 0xff) << 8) | (addr16 & 0xff)) & 0xffff;
      } else if (quirk === 'copy') {
        targetAddr = ((value << 8) | (addr16 & 0xff)) & 0xffff;
      } else {
        targetAddr = ((h << 8) | (addr16 & 0xff)) & 0xffff;
      }
    }
    return {
      addr: targetAddr & 0xffff,
      value: value & 0xff,
      rdyMod,
      pageCross,
      quirk,
    };
  }

  rmw(addr, mutate) {
    return this.micro.executeRmw(addr, mutate);
  }

  rmwABSX(mutate) {
    const addr = this._addrABSXWithDummyRead();
    return this.rmw(addr, mutate);
  }

  rmwABSY(mutate) {
    const addr = this._addrABSYWithDummyRead();
    return this.rmw(addr, mutate);
  }

  rmwINDY(mutate) {
    const addr = this._addrINDYWithDummyRead();
    return this.rmw(addr, mutate);
  }

  rmwAsl(addr) {
    const v = this.rmw(addr, this._rmwMutateAsl);
    this.setZN(v);
    return v;
  }

  rmwLsr(addr) {
    const v = this.rmw(addr, this._rmwMutateLsr);
    this.setZN(v);
    return v;
  }

  rmwRol(addr) {
    const v = this.rmw(addr, this._rmwMutateRol);
    this.setZN(v);
    return v;
  }

  rmwRor(addr) {
    const v = this.rmw(addr, this._rmwMutateRor);
    this.setZN(v);
    return v;
  }

  readIndexed(info) {
    if (info.pageCross) {
      const dummy = (info.base & 0xff00) | (info.addr & 0x00ff);
      this.read(dummy);
    }
    this.pollInterruptAtInstructionPoint();
    return this.read(info.addr);
  }

  executeBranchFast(cond) {
    this.pollInterruptAtInstructionPoint();
    const off = this.fetch8();
    if (!cond) return 0;

    const prev = this.pc;
    this.read(prev);

    const rel = off < 0x80 ? off : off - 0x100;
    const next = (prev + rel) & 0xffff;
    if (((prev ^ next) & 0x100) !== 0) {
      this.pollInterruptAtInstructionPoint();
      this.read((prev & 0xff00) | (next & 0x00ff));
      this.pc = next;
      return 2;
    }

    this.pc = next;
    return 1;
  }

  storeABSX(value) {
    const addr = this._addrABSXWithDummyRead();
    this.pollInterruptAtInstructionPoint();
    this.write(addr, value);
  }

  storeABSY(value) {
    const addr = this._addrABSYWithDummyRead();
    this.pollInterruptAtInstructionPoint();
    this.write(addr, value);
  }

  storeINDY(value) {
    const addr = this._addrINDYWithDummyRead();
    this.pollInterruptAtInstructionPoint();
    this.write(addr, value);
  }

  rmwShift(addr, mode) {
    if (mode === 'asl') return this.rmwAsl(addr);
    if (mode === 'lsr') return this.rmwLsr(addr);
    if (mode === 'rol') return this.rmwRol(addr);
    if (mode === 'ror') return this.rmwRor(addr);
    const v = this.rmw(addr, (old) => {
      if (mode === 'asl') {
        this.setFlag(FLAG_C, (old & 0x80) !== 0);
        return old << 1;
      }
      if (mode === 'lsr') {
        this.setFlag(FLAG_C, old & 1);
        return old >> 1;
      }
      if (mode === 'rol') {
        const c = this.getFlag(FLAG_C);
        this.setFlag(FLAG_C, (old >> 7) & 1);
        return (old << 1) | c;
      }
      const c = this.getFlag(FLAG_C);
      this.setFlag(FLAG_C, old & 1);
      return (old >> 1) | (c << 7);
    });
    this.setZN(v);
    return v;
  }

  impliedDummyRead(beforeSample) {
    this.read(this.pc, beforeSample);
  }

  step() {
    this.accessCycles = 0;
    this.rdyStallInInstr = false;
    this._resetInstructionRdyTrace();
    const hadPollWindowPrevInstruction = !!this.hadPollWindowCurrentInstruction;
    this.hadPollWindowCurrentInstruction = false;
    if (this.stopped) return 1;
    const queuedVector = this._consumePolledInterruptVector();
    const serviceLines = this._peekServiceLines();
    if (queuedVector === 0xfffa) this.nmi();
    else if (queuedVector === 0xfffe) this.irq(true);
    else if (!hadPollWindowPrevInstruction && serviceLines.nmi) this.nmi();
    else if (!hadPollWindowPrevInstruction && serviceLines.irq) {
      this.irq(true);
    }

    const op = this.fetch8();
    this.lastOpcode = op & 0xff;
    const microHandler = this.opcodeTable[op];
    if (microHandler) return microHandler();

    switch (op) {
      // Unofficial opcodes commonly used by commercial ROMs.

      // SLO (ASL then ORA)
      case 0x07: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 5;
      }
      case 0x17: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x0f: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x1f: {
        const v = this.rmwABSX((old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x1b: {
        const v = this.rmwABSY((old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x03: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 8;
      }
      case 0x13: {
        const v = this.rmwINDY((old) => {
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return old << 1;
        });
        this.a |= v;
        this.setZN(this.a);
        return 8;
      }

      // RLA (ROL then AND)
      case 0x27: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 5;
      }
      case 0x37: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x2f: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x3f: {
        const v = this.rmwABSX((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x3b: {
        const v = this.rmwABSY((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x23: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 8;
      }
      case 0x33: {
        const v = this.rmwINDY((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 0x80) !== 0);
          return (old << 1) | c;
        });
        this.a &= v;
        this.setZN(this.a);
        return 8;
      }

      // SRE (LSR then EOR)
      case 0x47: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 5;
      }
      case 0x57: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x4f: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 6;
      }
      case 0x5f: {
        const v = this.rmwABSX((old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x5b: {
        const v = this.rmwABSY((old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 7;
      }
      case 0x43: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 8;
      }
      case 0x53: {
        const v = this.rmwINDY((old) => {
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return old >> 1;
        });
        this.a ^= v;
        this.setZN(this.a);
        return 8;
      }

      // RRA (ROR then ADC)
      case 0x67: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 5;
      }
      case 0x77: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 6;
      }
      case 0x6f: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 6;
      }
      case 0x7f: {
        const v = this.rmwABSX((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 7;
      }
      case 0x7b: {
        const v = this.rmwABSY((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 7;
      }
      case 0x63: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 8;
      }
      case 0x73: {
        const v = this.rmwINDY((old) => {
          const c = this.getFlag(FLAG_C);
          this.setFlag(FLAG_C, (old & 1) !== 0);
          return (old >> 1) | (c << 7);
        });
        this.adc(v);
        return 8;
      }

      // DCP (DEC then CMP)
      case 0xc7: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => old - 1);
        this.cmp(this.a, v);
        return 5;
      }
      case 0xd7: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => old - 1);
        this.cmp(this.a, v);
        return 6;
      }
      case 0xcf: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => old - 1);
        this.cmp(this.a, v);
        return 6;
      }
      case 0xdf: {
        const v = this.rmwABSX((old) => old - 1);
        this.cmp(this.a, v);
        return 7;
      }
      case 0xdb: {
        const v = this.rmwABSY((old) => old - 1);
        this.cmp(this.a, v);
        return 7;
      }
      case 0xc3: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => old - 1);
        this.cmp(this.a, v);
        return 8;
      }
      case 0xd3: {
        const v = this.rmwINDY((old) => old - 1);
        this.cmp(this.a, v);
        return 8;
      }

      // ISC/ISB (INC then SBC)
      case 0xe7: {
        const a = this.addrZP();
        const v = this.rmw(a, (old) => old + 1);
        this.sbc(v);
        return 5;
      }
      case 0xf7: {
        const a = this.addrZPX();
        const v = this.rmw(a, (old) => old + 1);
        this.sbc(v);
        return 6;
      }
      case 0xef: {
        const a = this.addrABS();
        const v = this.rmw(a, (old) => old + 1);
        this.sbc(v);
        return 6;
      }
      case 0xff: {
        const v = this.rmwABSX((old) => old + 1);
        this.sbc(v);
        return 7;
      }
      case 0xfb: {
        const v = this.rmwABSY((old) => old + 1);
        this.sbc(v);
        return 7;
      }
      case 0xe3: {
        const a = this.addrINDX();
        const v = this.rmw(a, (old) => old + 1);
        this.sbc(v);
        return 8;
      }
      case 0xf3: {
        const v = this.rmwINDY((old) => old + 1);
        this.sbc(v);
        return 8;
      }

      // Immediate unofficial ALU opcodes
      case 0x0b: case 0x2b: {
        this.pollInterruptAtInstructionPoint();
        this.a &= this.fetch8();
        this.setZN(this.a);
        this.setFlag(FLAG_C, (this.a & 0x80) !== 0);
        return 2;
      }
      case 0x4b: {
        this.pollInterruptAtInstructionPoint();
        this.a &= this.fetch8();
        this.setFlag(FLAG_C, (this.a & 1) !== 0);
        this.a = (this.a >> 1) & 0xff;
        this.setZN(this.a);
        return 2;
      }
      case 0x6b: {
        this.pollInterruptAtInstructionPoint();
        this.a &= this.fetch8();
        const c = this.getFlag(FLAG_C);
        this.a = ((this.a >> 1) | (c << 7)) & 0xff;
        this.setZN(this.a);
        this.setFlag(FLAG_C, (this.a & 0x40) !== 0);
        this.setFlag(FLAG_V, ((this.a & 0x40) ^ ((this.a & 0x20) << 1)) !== 0);
        return 2;
      }
      case 0x8b: {
        // ANE/XAA immediate: unstable on hardware; this constant matches
        // common RP2A03 behavior used by test ROMs.
        this.pollInterruptAtInstructionPoint();
        const imm = this.fetch8();
        this.a = (this.a | 0xee) & this.x & imm;
        this.setZN(this.a);
        return 2;
      }
      case 0xab: {
        // LXA/OAL immediate: unstable on hardware; use common RP2A03 model.
        this.pollInterruptAtInstructionPoint();
        const imm = this.fetch8();
        const v = (this.a | 0xee) & imm;
        this.a = v;
        this.x = v;
        this.setZN(v);
        return 2;
      }
      case 0xcb: {
        this.pollInterruptAtInstructionPoint();
        const imm = this.fetch8();
        const t = (this.a & this.x) - imm;
        this.setFlag(FLAG_C, t >= 0);
        this.x = t & 0xff;
        this.setZN(this.x);
        return 2;
      }

      case 0xeb: {
        // Unofficial SBC immediate (same ALU behavior as 0xE9).
        this.pollInterruptAtInstructionPoint();
        this.sbc(this.fetch8());
        return 2;
      }

      case 0x93: {
        // SHA/AHX (indirect),Y
        const info = this._addrINDYWithDummyInfo();
        const rdyMod = this._t65RdyModForUnstableOpcode(0x93);
        const resolved = this._resolveUnstableStoreTarget(info.base, info.addr, this.a & this.x, {
          quirk: 'copy',
          rdyMod,
        });
        this.pollInterruptAtInstructionPoint();
        this.write(resolved.addr, resolved.value);
        return 6;
      }
      case 0x9f: {
        // SHA/AHX absolute,Y
        const info = this._addrABSYWithDummyInfo();
        const rdyMod = this._t65RdyModForUnstableOpcode(0x9f);
        const resolved = this._resolveUnstableStoreTarget(info.base, info.addr, this.a & this.x, {
          quirk: 'copy',
          rdyMod,
        });
        this.pollInterruptAtInstructionPoint();
        this.write(resolved.addr, resolved.value);
        return 5;
      }
      case 0x9b: {
        // SHS/TAS absolute,Y
        this.sp = this.a & this.x;
        const info = this._addrABSYWithDummyInfo();
        const rdyMod = this._t65RdyModForUnstableOpcode(0x9b);
        const resolved = this._resolveUnstableStoreTarget(info.base, info.addr, this.sp, {
          quirk: 'and',
          rdyMod,
        });
        this.pollInterruptAtInstructionPoint();
        this.write(resolved.addr, resolved.value);
        return 5;
      }
      case 0x9c: {
        // SHY absolute,X
        const info = this._addrABSXWithDummyInfo();
        const rdyMod = this._t65RdyModForUnstableOpcode(0x9c);
        const resolved = this._resolveUnstableStoreTarget(info.base, info.addr, this.y, {
          quirk: 'and',
          rdyMod,
        });
        this.pollInterruptAtInstructionPoint();
        this.write(resolved.addr, resolved.value);
        return 5;
      }
      case 0x9e: {
        // SHX absolute,Y
        const info = this._addrABSYWithDummyInfo();
        const rdyMod = this._t65RdyModForUnstableOpcode(0x9e);
        const resolved = this._resolveUnstableStoreTarget(info.base, info.addr, this.x, {
          quirk: 'and',
          rdyMod,
        });
        this.pollInterruptAtInstructionPoint();
        this.write(resolved.addr, resolved.value);
        return 5;
      }

      case 0xbb: {
        const m = this.addrABSYInfo();
        const v = this.readIndexed(m) & this.sp;
        this.a = v;
        this.x = v;
        this.sp = v;
        this.setZN(v);
        return 4 + (m.pageCross ? 1 : 0);
      }

      default:
        this.unsupportedOpcodeCount = (this.unsupportedOpcodeCount || 0) + 1;
        if (this.unsupportedOpcodeCount <= 8) {
          console.warn(
            `Unsupported opcode ${op.toString(16).padStart(2, '0')} at PC=${((this.pc - 1) & 0xffff).toString(16).padStart(4, '0')} - treating as NOP`
          );
        }
        return 2;
    }
  }
}

const cpu6502Exports = {
  CPU6502,
  FLAG_C,
  FLAG_Z,
  FLAG_I,
  FLAG_D,
  FLAG_B,
  FLAG_U,
  FLAG_V,
  FLAG_N,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpu6502Exports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCPU6502 = cpu6502Exports;
}
