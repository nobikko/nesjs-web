class CpuMicroSequencer {
  constructor(cpu, flags) {
    this.cpu = cpu;
    this.flags = flags;
  }

  runMicroOps(_nominalCycles, microOps) {
    for (let i = 0; i < microOps.length; i += 1) {
      microOps[i]();
    }
  }

  serviceInterrupt(vectorAddrOrResolver, breakFlag) {
    const cpu = this.cpu;
    const f = this.flags;
    let vectorAddr = 0xfffe;
    let lo = 0;
    let hi = 0;
    this.runMicroOps(7, [
      () => cpu.read(cpu.pc),
      () => cpu.read(cpu.pc),
      () => cpu.push((cpu.pc >> 8) & 0xff),
      () => cpu.push(cpu.pc & 0xff),
      () => {
        vectorAddr = typeof vectorAddrOrResolver === 'function'
          ? (vectorAddrOrResolver() & 0xffff)
          : (vectorAddrOrResolver & 0xffff);
        cpu.push(breakFlag ? (cpu.p | f.B | f.U) : ((cpu.p & ~f.B) | f.U));
      },
      () => {
        cpu.setFlag(f.I, true);
        lo = cpu.read(vectorAddr);
      },
      () => {
        hi = cpu.read((vectorAddr + 1) & 0xffff);
        cpu.pc = (lo | (hi << 8)) & 0xffff;
      },
    ]);
  }

  executeBrk() {
    const cpu = this.cpu;
    const f = this.flags;
    let vectorAddr = 0xfffe;
    let lo = 0;
    let hi = 0;
    let hijackWithNmi = false;
    const pollBrkWindow = () => {
      if (cpu.pollInterruptAtInstructionPoint) {
        const sampled = cpu.pollInterruptAtInstructionPoint({ queue: false });
        if (sampled && sampled.nmi) hijackWithNmi = true;
        return;
      }
      if (!cpu.bus) return;
      if (cpu.bus.peekCpuServiceLines) {
        const snap = cpu.bus.peekCpuServiceLines() || {};
        if (snap.nmi) hijackWithNmi = true;
        return;
      }
      if (cpu.bus.shouldServiceNmi && cpu.bus.shouldServiceNmi()) {
        hijackWithNmi = true;
      }
    };
    // BRK discards next-byte via a forced fetch before vectoring.
    this.runMicroOps(7, [
      () => {
        pollBrkWindow();
        cpu.fetch8();
      },
      () => {
        pollBrkWindow();
        cpu.push((cpu.pc >> 8) & 0xff);
      },
      () => {
        pollBrkWindow();
        cpu.push(cpu.pc & 0xff);
      },
      () => {
        pollBrkWindow();
        if (hijackWithNmi) {
          vectorAddr = 0xfffa;
          if (cpu.bus.consumeNmi) cpu.bus.consumeNmi();
          else if (cpu.bus.consumePendingNmi) cpu.bus.consumePendingNmi();
        }
        cpu.push(cpu.p | f.B | f.U);
      },
      () => {
        cpu.setFlag(f.I, true);
        lo = cpu.read(vectorAddr);
      },
      () => {
        hi = cpu.read((vectorAddr + 1) & 0xffff);
        cpu.pc = (lo | (hi << 8)) & 0xffff;
      },
    ]);
    return 7;
  }

  executeRmw(addr, mutate) {
    const cpu = this.cpu;
    let oldVal = 0;
    let newVal = 0;
    this.runMicroOps(3, [
      () => { oldVal = cpu.read(addr); },
      () => cpu.write(addr, oldVal),
      () => {
        if (cpu.pollInterruptAtInstructionPoint) {
          cpu.pollInterruptAtInstructionPoint();
        }
        newVal = mutate(oldVal) & 0xff;
        cpu.write(addr, newVal);
      },
    ]);
    return newVal & 0xff;
  }

  executeBranch(cond) {
    const cpu = this.cpu;
    if (cpu.pollInterruptAtInstructionPoint) {
      cpu.pollInterruptAtInstructionPoint();
    }
    const off = cpu.fetch8();
    if (!cond) return 0;

    const prev = cpu.pc;
    // Taken branches always perform one dummy read at the current PC.
    cpu.read(prev);

    const rel = off < 0x80 ? off : off - 0x100;
    const next = (prev + rel) & 0xffff;
    const pageCross = ((prev ^ next) & 0x100) !== 0;
    if (pageCross) {
      if (cpu.pollInterruptAtInstructionPoint) {
        cpu.pollInterruptAtInstructionPoint();
      }
      // Page-cross branch performs an additional read with old high/new low.
      const dummy = (prev & 0xff00) | (next & 0x00ff);
      cpu.read(dummy);
    }

    cpu.pc = next;
    return 1 + (pageCross ? 1 : 0);
  }

  executeJsr() {
    const cpu = this.cpu;
    // JSR timing/order is quirky: read low operand, dummy stack read,
    // push return address, then read high operand.
    let lo = 0;
    let hi = 0;
    this.runMicroOps(6, [
      () => { lo = cpu.fetch8(); },
      () => { cpu.read(0x0100 | cpu.sp); },
      () => cpu.push((cpu.pc >> 8) & 0xff),
      () => cpu.push(cpu.pc & 0xff),
      () => { hi = cpu.fetch8(); },
      () => { cpu.pc = ((hi << 8) | lo) & 0xffff; },
    ]);
    return 6;
  }

  executeRts() {
    const cpu = this.cpu;
    let lo = 0;
    let hi = 0;
    this.runMicroOps(6, [
      () => { cpu.read(cpu.pc); },
      () => { cpu.read(0x0100 | cpu.sp); },
      () => { lo = cpu.pop(); },
      () => { hi = cpu.pop(); },
      () => {
        cpu.read((hi << 8) | lo);
        cpu.pc = ((hi << 8) | lo) + 1;
        cpu.pc &= 0xffff;
      },
    ]);
    return 6;
  }

  executeRti() {
    const cpu = this.cpu;
    const f = this.flags;
    let lo = 0;
    let hi = 0;
    this.runMicroOps(6, [
      () => { cpu.read(cpu.pc); },
      () => { cpu.read(0x0100 | cpu.sp); },
      () => {
        cpu.pop((value) => {
          cpu.setProcessorStatus((value | f.U) & 0xef);
        });
      },
      () => { lo = cpu.pop(); },
      () => {
        hi = cpu.pop();
        if (cpu.pollInterruptAtInstructionPoint) {
          cpu.pollInterruptAtInstructionPoint();
        }
      },
      () => { cpu.pc = (hi << 8) | lo; },
    ]);
    return 6;
  }

  executePha() {
    const cpu = this.cpu;
    cpu.read(cpu.pc);
    if (cpu.pollInterruptAtInstructionPoint) {
      cpu.pollInterruptAtInstructionPoint();
    }
    cpu.push(cpu.a);
    return 3;
  }

  executePhp() {
    const cpu = this.cpu;
    const f = this.flags;
    cpu.read(cpu.pc);
    if (cpu.pollInterruptAtInstructionPoint) {
      cpu.pollInterruptAtInstructionPoint();
    }
    cpu.push(cpu.p | f.B | f.U);
    return 3;
  }

  executePla() {
    const cpu = this.cpu;
    cpu.read(cpu.pc);
    cpu.read(0x0100 | cpu.sp);
    if (cpu.pollInterruptAtInstructionPoint) {
      cpu.pollInterruptAtInstructionPoint();
    }
    cpu.pop((value) => {
      cpu.a = value & 0xff;
      cpu.setZN(cpu.a);
    });
    return 4;
  }

  executePlp() {
    const cpu = this.cpu;
    const f = this.flags;
    cpu.read(cpu.pc);
    cpu.read(0x0100 | cpu.sp);
    if (cpu.pollInterruptAtInstructionPoint) {
      cpu.pollInterruptAtInstructionPoint();
    }
    cpu.pop((value) => {
      cpu.setProcessorStatus((value | f.U) & 0xef);
    });
    return 4;
  }
}

const cpuMicroSequencerExports = { CpuMicroSequencer };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuMicroSequencerExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuMicroSequencer = cpuMicroSequencerExports;
}
