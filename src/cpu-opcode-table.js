function createCpuOpcodeTable(cpu) {
  const table = new Array(256).fill(null);

  const f = cpu.flags;
  const MASK_ZN = (f.Z | f.N) & 0xff;
  const MASK_CZN = (f.C | f.Z | f.N) & 0xff;
  const readAbsX = () => cpu.addrABSXInfo();
  const readAbsY = () => cpu.addrABSYInfo();
  const readIndY = () => cpu.addrINDYInfo();
  const pollWindow = (options) => {
    if (cpu.pollInterruptAtInstructionPoint) {
      return cpu.pollInterruptAtInstructionPoint(options);
    }
    return null;
  };
  const setZNFast = (value) => {
    const v = value & 0xff;
    cpu.p = ((cpu.p & (~MASK_ZN & 0xff)) | (v === 0 ? f.Z : 0) | (v & f.N)) & 0xff;
  };
  const setCmpFast = (lhs, rhs) => {
    const l = lhs & 0xff;
    const r = rhs & 0xff;
    const diff = (l - r) & 0xff;
    let p = cpu.p & (~MASK_CZN & 0xff);
    if (l >= r) p |= f.C;
    if (diff === 0) p |= f.Z;
    p |= (diff & f.N);
    cpu.p = p & 0xff;
  };

  const defineIndexedReadOp = (opcode, addrInfoFn, baseCycles, applyValue) => {
    table[opcode & 0xff] = () => {
      const m = addrInfoFn();
      const value = cpu.readIndexed(m);
      applyValue(value);
      return baseCycles + (m.pageCross ? 1 : 0);
    };
  };
  const defineImpliedOp = (opcode, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      cpu.impliedDummyRead(() => {
        op();
      });
      return 2;
    };
  };
  const defineImmediateOp = (opcode, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.fetch8() & 0xff);
      return 2;
    };
  };
  const defineZpReadOp = (opcode, cycles, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.read(cpu.addrZP()) & 0xff);
      return cycles;
    };
  };
  const defineZpxReadOp = (opcode, cycles, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.read(cpu.addrZPX()) & 0xff);
      return cycles;
    };
  };
  const defineZpyReadOp = (opcode, cycles, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.read(cpu.addrZPY()) & 0xff);
      return cycles;
    };
  };
  const defineAbsReadOp = (opcode, cycles, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.read(cpu.addrABS()) & 0xff);
      return cycles;
    };
  };
  const defineIndXReadOp = (opcode, cycles, op) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      op(cpu.read(cpu.addrINDX()) & 0xff);
      return cycles;
    };
  };
  const defineZpWriteOp = (opcode, cycles, valueFn) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      cpu.write(cpu.addrZP(), valueFn() & 0xff);
      return cycles;
    };
  };
  const defineZpxWriteOp = (opcode, cycles, valueFn) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      cpu.write(cpu.addrZPX(), valueFn() & 0xff);
      return cycles;
    };
  };
  const defineZpyWriteOp = (opcode, cycles, valueFn) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      cpu.write(cpu.addrZPY(), valueFn() & 0xff);
      return cycles;
    };
  };
  const defineAbsWriteOp = (opcode, cycles, valueFn) => {
    table[opcode & 0xff] = () => {
      const addr = cpu.addrABS();
      pollWindow();
      cpu.write(addr, valueFn() & 0xff);
      return cycles;
    };
  };
  const defineIndXWriteOp = (opcode, cycles, valueFn) => {
    table[opcode & 0xff] = () => {
      pollWindow();
      cpu.write(cpu.addrINDX(), valueFn() & 0xff);
      return cycles;
    };
  };

  // Interrupt/control path
  table[0x00] = () => cpu.micro.executeBrk();

  // Branches
  table[0x10] = () => 2 + cpu.executeBranchFast((cpu.p & f.N) === 0);
  table[0x30] = () => 2 + cpu.executeBranchFast((cpu.p & f.N) !== 0);
  table[0x50] = () => 2 + cpu.executeBranchFast((cpu.p & f.V) === 0);
  table[0x70] = () => 2 + cpu.executeBranchFast((cpu.p & f.V) !== 0);
  table[0x90] = () => 2 + cpu.executeBranchFast((cpu.p & f.C) === 0);
  table[0xB0] = () => 2 + cpu.executeBranchFast((cpu.p & f.C) !== 0);
  table[0xF0] = () => 2 + cpu.executeBranchFast((cpu.p & f.Z) !== 0);
  table[0xD0] = () => {
    pollWindow();
    const off = cpu.fetch8() & 0xff;
    if ((cpu.p & f.Z) !== 0) return 2;
    const prev = cpu.pc & 0xffff;
    cpu.read(prev);
    const rel = off < 0x80 ? off : off - 0x100;
    const next = (prev + rel) & 0xffff;
    if (((prev ^ next) & 0x100) !== 0) {
      pollWindow();
      cpu.read((prev & 0xff00) | (next & 0x00ff));
      cpu.pc = next;
      return 4;
    }
    cpu.pc = next;
    return 3;
  };

  // Stack and flow-control
  table[0x20] = () => cpu.micro.executeJsr();
  table[0x60] = () => cpu.micro.executeRts();
  table[0x40] = () => cpu.micro.executeRti();
  table[0x48] = () => cpu.micro.executePha();
  table[0x08] = () => cpu.micro.executePhp();
  table[0x68] = () => cpu.micro.executePla();
  table[0x28] = () => cpu.micro.executePlp();

  // Register transfer / inc-dec implied ops
  defineImpliedOp(0xAA, () => { cpu.x = cpu.a; cpu.setZN(cpu.x); }); // TAX
  defineImpliedOp(0xA8, () => { cpu.y = cpu.a; cpu.setZN(cpu.y); }); // TAY
  defineImpliedOp(0x8A, () => { cpu.a = cpu.x; cpu.setZN(cpu.a); }); // TXA
  defineImpliedOp(0x98, () => { cpu.a = cpu.y; cpu.setZN(cpu.a); }); // TYA
  defineImpliedOp(0xBA, () => { cpu.x = cpu.sp; cpu.setZN(cpu.x); }); // TSX
  defineImpliedOp(0x9A, () => { cpu.sp = cpu.x; }); // TXS
  defineImpliedOp(0xE8, () => { cpu.x = (cpu.x + 1) & 0xff; cpu.setZN(cpu.x); }); // INX
  defineImpliedOp(0xC8, () => { cpu.y = (cpu.y + 1) & 0xff; cpu.setZN(cpu.y); }); // INY
  defineImpliedOp(0xCA, () => { cpu.x = (cpu.x - 1) & 0xff; cpu.setZN(cpu.x); }); // DEX
  defineImpliedOp(0x88, () => { cpu.y = (cpu.y - 1) & 0xff; cpu.setZN(cpu.y); }); // DEY

  // Flag implied ops
  defineImpliedOp(0x18, () => { cpu.setFlag(f.C, false); }); // CLC
  defineImpliedOp(0x38, () => { cpu.setFlag(f.C, true); }); // SEC
  defineImpliedOp(0xB8, () => { cpu.setFlag(f.V, false); }); // CLV
  defineImpliedOp(0xD8, () => { cpu.setFlag(f.D, false); }); // CLD
  defineImpliedOp(0xF8, () => { cpu.setFlag(f.D, true); }); // SED
  table[0x58] = () => { // CLI
    pollWindow();
    cpu.impliedDummyRead(() => {
      cpu.setFlag(f.I, false);
    });
    return 2;
  };
  table[0x78] = () => { // SEI
    pollWindow();
    cpu.impliedDummyRead(() => {
      cpu.setFlag(f.I, true);
    });
    return 2;
  };

  // NOP family
  table[0xEA] = () => {
    pollWindow();
    cpu.impliedDummyRead();
    return 2;
  };
  [0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA].forEach((op) => {
    table[op] = () => {
      pollWindow();
      cpu.impliedDummyRead();
      return 2;
    };
  });
  [0x80, 0x82, 0x89, 0xC2, 0xE2].forEach((op) => {
    table[op] = () => {
      pollWindow();
      cpu.fetch8();
      return 2;
    };
  });
  [0x04, 0x44, 0x64].forEach((op) => {
    table[op] = () => {
      pollWindow();
      cpu.read(cpu.addrZP());
      return 3;
    };
  });
  [0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4].forEach((op) => {
    table[op] = () => {
      pollWindow();
      cpu.read(cpu.addrZPX());
      return 4;
    };
  });
  table[0x0C] = () => {
    pollWindow();
    cpu.read(cpu.addrABS());
    return 4;
  };

  // KIL/JAM - lock up CPU
  [0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xB2, 0xD2, 0xF2].forEach((op) => {
    table[op] = () => {
      cpu.stopped = true;
      return 1;
    };
  });

  // LDA/LDX/LDY
  defineImmediateOp(0xA9, (v) => { cpu.a = v; cpu.setZN(cpu.a); });
  table[0xA5] = () => {
    pollWindow();
    const v = cpu.read(cpu.addrZP()) & 0xff;
    cpu.a = v;
    setZNFast(v);
    return 3;
  };
  table[0xB5] = () => {
    pollWindow();
    const v = cpu.read(cpu.addrZPX()) & 0xff;
    cpu.a = v;
    setZNFast(v);
    return 4;
  };
  table[0xAD] = () => {
    pollWindow();
    const lo = cpu.fetch8() & 0xff;
    const hi = cpu.fetch8() & 0xff;
    const v = cpu.read((lo | (hi << 8)) & 0xffff) & 0xff;
    cpu.a = v;
    setZNFast(v);
    return 4;
  };
  defineIndXReadOp(0xA1, 6, (v) => { cpu.a = v; cpu.setZN(cpu.a); });

  defineImmediateOp(0xA2, (v) => { cpu.x = v; cpu.setZN(cpu.x); });
  defineZpReadOp(0xA6, 3, (v) => { cpu.x = v; cpu.setZN(cpu.x); });
  defineZpyReadOp(0xB6, 4, (v) => { cpu.x = v; cpu.setZN(cpu.x); });
  defineAbsReadOp(0xAE, 4, (v) => { cpu.x = v; cpu.setZN(cpu.x); });

  defineImmediateOp(0xA0, (v) => { cpu.y = v; cpu.setZN(cpu.y); });
  defineZpReadOp(0xA4, 3, (v) => { cpu.y = v; cpu.setZN(cpu.y); });
  defineZpxReadOp(0xB4, 4, (v) => { cpu.y = v; cpu.setZN(cpu.y); });
  defineAbsReadOp(0xAC, 4, (v) => { cpu.y = v; cpu.setZN(cpu.y); });

  // LAX (unofficial)
  defineZpReadOp(0xA7, 3, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); });
  defineZpyReadOp(0xB7, 4, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); });
  defineAbsReadOp(0xAF, 4, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); });
  defineIndXReadOp(0xA3, 6, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); });

  // ADC/SBC
  defineImmediateOp(0x69, (v) => { cpu.adc(v); });
  defineZpReadOp(0x65, 3, (v) => { cpu.adc(v); });
  defineZpxReadOp(0x75, 4, (v) => { cpu.adc(v); });
  defineAbsReadOp(0x6D, 4, (v) => { cpu.adc(v); });
  defineIndXReadOp(0x61, 6, (v) => { cpu.adc(v); });

  defineImmediateOp(0xE9, (v) => { cpu.sbc(v); });
  defineZpReadOp(0xE5, 3, (v) => { cpu.sbc(v); });
  defineZpxReadOp(0xF5, 4, (v) => { cpu.sbc(v); });
  defineAbsReadOp(0xED, 4, (v) => { cpu.sbc(v); });
  defineIndXReadOp(0xE1, 6, (v) => { cpu.sbc(v); });

  // AND/ORA/EOR
  table[0x29] = () => {
    pollWindow();
    cpu.a = (cpu.a & (cpu.fetch8() & 0xff)) & 0xff;
    setZNFast(cpu.a);
    return 2;
  };
  defineZpReadOp(0x25, 3, (v) => { cpu.a &= v; cpu.setZN(cpu.a); });
  defineZpxReadOp(0x35, 4, (v) => { cpu.a &= v; cpu.setZN(cpu.a); });
  defineAbsReadOp(0x2D, 4, (v) => { cpu.a &= v; cpu.setZN(cpu.a); });
  defineIndXReadOp(0x21, 6, (v) => { cpu.a &= v; cpu.setZN(cpu.a); });

  defineImmediateOp(0x09, (v) => { cpu.a |= v; cpu.setZN(cpu.a); });
  table[0x05] = () => {
    pollWindow();
    cpu.a = (cpu.a | (cpu.read(cpu.addrZP()) & 0xff)) & 0xff;
    setZNFast(cpu.a);
    return 3;
  };
  defineZpxReadOp(0x15, 4, (v) => { cpu.a |= v; cpu.setZN(cpu.a); });
  table[0x0D] = () => {
    pollWindow();
    const lo = cpu.fetch8() & 0xff;
    const hi = cpu.fetch8() & 0xff;
    cpu.a = (cpu.a | (cpu.read((lo | (hi << 8)) & 0xffff) & 0xff)) & 0xff;
    setZNFast(cpu.a);
    return 4;
  };
  defineIndXReadOp(0x01, 6, (v) => { cpu.a |= v; cpu.setZN(cpu.a); });

  defineImmediateOp(0x49, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); });
  defineZpReadOp(0x45, 3, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); });
  defineZpxReadOp(0x55, 4, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); });
  defineAbsReadOp(0x4D, 4, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); });
  defineIndXReadOp(0x41, 6, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); });

  // BIT/CMP/CPX/CPY
  defineZpReadOp(0x24, 3, (v) => {
    cpu.setFlag(f.Z, (cpu.a & v) === 0);
    cpu.setFlag(f.V, (v & 0x40) !== 0);
    cpu.setFlag(f.N, (v & 0x80) !== 0);
  });
  defineAbsReadOp(0x2C, 4, (v) => {
    cpu.setFlag(f.Z, (cpu.a & v) === 0);
    cpu.setFlag(f.V, (v & 0x40) !== 0);
    cpu.setFlag(f.N, (v & 0x80) !== 0);
  });

  table[0xC9] = () => {
    pollWindow();
    setCmpFast(cpu.a, cpu.fetch8() & 0xff);
    return 2;
  };
  defineZpReadOp(0xC5, 3, (v) => { setCmpFast(cpu.a, v); });
  defineZpxReadOp(0xD5, 4, (v) => { setCmpFast(cpu.a, v); });
  defineAbsReadOp(0xCD, 4, (v) => { setCmpFast(cpu.a, v); });
  defineIndXReadOp(0xC1, 6, (v) => { setCmpFast(cpu.a, v); });

  defineImmediateOp(0xE0, (v) => { cpu.cmp(cpu.x, v); });
  defineZpReadOp(0xE4, 3, (v) => { setCmpFast(cpu.x, v); });
  defineAbsReadOp(0xEC, 4, (v) => { setCmpFast(cpu.x, v); });

  defineImmediateOp(0xC0, (v) => { cpu.cmp(cpu.y, v); });
  defineZpReadOp(0xC4, 3, (v) => { setCmpFast(cpu.y, v); });
  defineAbsReadOp(0xCC, 4, (v) => { setCmpFast(cpu.y, v); });

  // STA/STX/STY
  defineZpWriteOp(0x85, 3, () => cpu.a);
  defineZpxWriteOp(0x95, 4, () => cpu.a);
  defineAbsWriteOp(0x8D, 4, () => cpu.a);
  table[0x9D] = () => { cpu.storeABSX(cpu.a); return 5; };
  table[0x99] = () => { cpu.storeABSY(cpu.a); return 5; };
  defineIndXWriteOp(0x81, 6, () => cpu.a);
  table[0x91] = () => { cpu.storeINDY(cpu.a); return 6; };

  defineZpWriteOp(0x86, 3, () => cpu.x);
  defineZpyWriteOp(0x96, 4, () => cpu.x);
  defineAbsWriteOp(0x8E, 4, () => cpu.x);

  defineZpWriteOp(0x84, 3, () => cpu.y);
  defineZpxWriteOp(0x94, 4, () => cpu.y);
  defineAbsWriteOp(0x8C, 4, () => cpu.y);

  // SAX (unofficial)
  defineZpWriteOp(0x87, 3, () => cpu.a & cpu.x);
  defineZpyWriteOp(0x97, 4, () => cpu.a & cpu.x);
  defineAbsWriteOp(0x8F, 4, () => cpu.a & cpu.x);
  defineIndXWriteOp(0x83, 6, () => cpu.a & cpu.x);

  // INC/DEC memory
  table[0xE6] = () => { const a = cpu.addrZP(); const v = cpu.rmw(a, (old) => old + 1); setZNFast(v); return 5; };
  table[0xF6] = () => { const a = cpu.addrZPX(); const v = cpu.rmw(a, (old) => old + 1); cpu.setZN(v); return 6; };
  table[0xEE] = () => { const a = cpu.addrABS(); const v = cpu.rmw(a, (old) => old + 1); setZNFast(v); return 6; };
  table[0xFE] = () => { const v = cpu.rmwABSX((old) => old + 1); cpu.setZN(v); return 7; };

  table[0xC6] = () => { const a = cpu.addrZP(); const v = cpu.rmw(a, (old) => old - 1); cpu.setZN(v); return 5; };
  table[0xD6] = () => { const a = cpu.addrZPX(); const v = cpu.rmw(a, (old) => old - 1); cpu.setZN(v); return 6; };
  table[0xCE] = () => { const a = cpu.addrABS(); const v = cpu.rmw(a, (old) => old - 1); cpu.setZN(v); return 6; };
  table[0xDE] = () => { const v = cpu.rmwABSX((old) => old - 1); cpu.setZN(v); return 7; };

  // ASL/LSR/ROL/ROR
  table[0x0A] = () => {
    pollWindow();
    cpu.impliedDummyRead();
    const c = (cpu.a >> 7) & 1;
    cpu.a = (cpu.a << 1) & 0xff;
    cpu.setFlag(f.C, c);
    cpu.setZN(cpu.a);
    return 2;
  };
  table[0x06] = () => { cpu.rmwAsl(cpu.addrZP()); return 5; };
  table[0x16] = () => { cpu.rmwAsl(cpu.addrZPX()); return 6; };
  table[0x0E] = () => { cpu.rmwAsl(cpu.addrABS()); return 6; };
  table[0x1E] = () => {
    const v = cpu.rmwABSX((old) => {
      cpu.setFlag(f.C, (old & 0x80) !== 0);
      return old << 1;
    });
    cpu.setZN(v);
    return 7;
  };

  table[0x4A] = () => {
    pollWindow();
    cpu.impliedDummyRead();
    const c = cpu.a & 1;
    cpu.a = (cpu.a >> 1) & 0xff;
    cpu.setFlag(f.C, c);
    cpu.setZN(cpu.a);
    return 2;
  };
  table[0x46] = () => { cpu.rmwLsr(cpu.addrZP()); return 5; };
  table[0x56] = () => { cpu.rmwLsr(cpu.addrZPX()); return 6; };
  table[0x4E] = () => { cpu.rmwLsr(cpu.addrABS()); return 6; };
  table[0x5E] = () => {
    const v = cpu.rmwABSX((old) => {
      cpu.setFlag(f.C, old & 1);
      return old >> 1;
    });
    cpu.setZN(v);
    return 7;
  };

  table[0x2A] = () => {
    pollWindow();
    cpu.impliedDummyRead();
    const c = cpu.getFlag(f.C);
    const newC = (cpu.a >> 7) & 1;
    cpu.a = ((cpu.a << 1) | c) & 0xff;
    cpu.setFlag(f.C, newC);
    cpu.setZN(cpu.a);
    return 2;
  };
  table[0x26] = () => { cpu.rmwRol(cpu.addrZP()); return 5; };
  table[0x36] = () => { cpu.rmwRol(cpu.addrZPX()); return 6; };
  table[0x2E] = () => { cpu.rmwRol(cpu.addrABS()); return 6; };
  table[0x3E] = () => {
    const v = cpu.rmwABSX((old) => {
      const c = cpu.getFlag(f.C);
      cpu.setFlag(f.C, (old >> 7) & 1);
      return (old << 1) | c;
    });
    cpu.setZN(v);
    return 7;
  };

  table[0x6A] = () => {
    pollWindow();
    cpu.impliedDummyRead();
    const c = cpu.getFlag(f.C);
    const newC = cpu.a & 1;
    cpu.a = ((cpu.a >> 1) | (c << 7)) & 0xff;
    cpu.setFlag(f.C, newC);
    cpu.setZN(cpu.a);
    return 2;
  };
  table[0x66] = () => { cpu.rmwRor(cpu.addrZP()); return 5; };
  table[0x76] = () => { cpu.rmwRor(cpu.addrZPX()); return 6; };
  table[0x6E] = () => { cpu.rmwRor(cpu.addrABS()); return 6; };
  table[0x7E] = () => {
    const v = cpu.rmwABSX((old) => {
      const c = cpu.getFlag(f.C);
      cpu.setFlag(f.C, old & 1);
      return (old >> 1) | (c << 7);
    });
    cpu.setZN(v);
    return 7;
  };

  // JMP
  table[0x4C] = () => { cpu.pc = cpu.addrABS(); return 3; };
  table[0x6C] = () => { cpu.pc = cpu.read16bug(cpu.addrABS()); return 5; };

  // Page-cross sensitive indexed reads (official + common unofficial)
  defineIndexedReadOp(0xBD, readAbsX, 4, (v) => { cpu.a = v; cpu.setZN(cpu.a); }); // LDA abs,X
  defineIndexedReadOp(0xB9, readAbsY, 4, (v) => { cpu.a = v; cpu.setZN(cpu.a); }); // LDA abs,Y
  defineIndexedReadOp(0xB1, readIndY, 5, (v) => { cpu.a = v; cpu.setZN(cpu.a); }); // LDA (zp),Y

  defineIndexedReadOp(0xBE, readAbsY, 4, (v) => { cpu.x = v; cpu.setZN(cpu.x); }); // LDX abs,Y
  defineIndexedReadOp(0xBC, readAbsX, 4, (v) => { cpu.y = v; cpu.setZN(cpu.y); }); // LDY abs,X

  defineIndexedReadOp(0x7D, readAbsX, 4, (v) => { cpu.adc(v); }); // ADC abs,X
  defineIndexedReadOp(0x79, readAbsY, 4, (v) => { cpu.adc(v); }); // ADC abs,Y
  defineIndexedReadOp(0x71, readIndY, 5, (v) => { cpu.adc(v); }); // ADC (zp),Y

  defineIndexedReadOp(0xFD, readAbsX, 4, (v) => { cpu.sbc(v); }); // SBC abs,X
  defineIndexedReadOp(0xF9, readAbsY, 4, (v) => { cpu.sbc(v); }); // SBC abs,Y
  defineIndexedReadOp(0xF1, readIndY, 5, (v) => { cpu.sbc(v); }); // SBC (zp),Y

  defineIndexedReadOp(0x3D, readAbsX, 4, (v) => { cpu.a &= v; cpu.setZN(cpu.a); }); // AND abs,X
  defineIndexedReadOp(0x39, readAbsY, 4, (v) => { cpu.a &= v; cpu.setZN(cpu.a); }); // AND abs,Y
  defineIndexedReadOp(0x31, readIndY, 5, (v) => { cpu.a &= v; cpu.setZN(cpu.a); }); // AND (zp),Y

  defineIndexedReadOp(0x1D, readAbsX, 4, (v) => { cpu.a |= v; cpu.setZN(cpu.a); }); // ORA abs,X
  defineIndexedReadOp(0x19, readAbsY, 4, (v) => { cpu.a |= v; cpu.setZN(cpu.a); }); // ORA abs,Y
  defineIndexedReadOp(0x11, readIndY, 5, (v) => { cpu.a |= v; cpu.setZN(cpu.a); }); // ORA (zp),Y

  defineIndexedReadOp(0x5D, readAbsX, 4, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); }); // EOR abs,X
  defineIndexedReadOp(0x59, readAbsY, 4, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); }); // EOR abs,Y
  defineIndexedReadOp(0x51, readIndY, 5, (v) => { cpu.a ^= v; cpu.setZN(cpu.a); }); // EOR (zp),Y

  defineIndexedReadOp(0xDD, readAbsX, 4, (v) => { setCmpFast(cpu.a, v); }); // CMP abs,X
  defineIndexedReadOp(0xD9, readAbsY, 4, (v) => { setCmpFast(cpu.a, v); }); // CMP abs,Y
  defineIndexedReadOp(0xD1, readIndY, 5, (v) => { setCmpFast(cpu.a, v); }); // CMP (zp),Y

  // Hot implied ops in JP ROM loops: keep cycle behavior, lower flag update overhead.
  table[0xE8] = () => {
    pollWindow();
    cpu.impliedDummyRead(() => {
      const v = (cpu.x + 1) & 0xff;
      cpu.x = v;
      setZNFast(v);
    });
    return 2;
  };
  table[0xC8] = () => {
    pollWindow();
    cpu.impliedDummyRead(() => {
      const v = (cpu.y + 1) & 0xff;
      cpu.y = v;
      setZNFast(v);
    });
    return 2;
  };

  defineIndexedReadOp(0xBF, readAbsY, 4, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); }); // LAX abs,Y
  defineIndexedReadOp(0xB3, readIndY, 5, (v) => { cpu.a = v; cpu.x = v; cpu.setZN(v); }); // LAX (zp),Y

  // Indexed NOP family with optional page-cross cycle.
  const nopAbsX = (opcode) => {
    table[opcode & 0xff] = () => {
      const m = cpu.addrABSXInfo();
      cpu.readIndexed(m);
      return 4 + (m.pageCross ? 1 : 0);
    };
  };
  nopAbsX(0x1C);
  nopAbsX(0x3C);
  nopAbsX(0x5C);
  nopAbsX(0x7C);
  nopAbsX(0xDC);
  nopAbsX(0xFC);

  return table;
}

const cpuOpcodeTableExports = { createCpuOpcodeTable };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuOpcodeTableExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuOpcodeTable = cpuOpcodeTableExports;
}
