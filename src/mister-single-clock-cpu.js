const MISTER_CPU_BUS_OWNER_CPU = 0;
const MISTER_CPU_BUS_OWNER_DMA_GENERIC = 3;

class MisterSingleClockCpu {
  reset(nes, bus) {
    const cpu = nes.state.cpu;
    cpu.a = 0;
    cpu.x = 0;
    cpu.y = 0;
    cpu.p = 0x24;
    cpu.sp = 0xfd;
    cpu.stopped = false;
    cpu.interruptIFlag = true;
    cpu.unsupportedOpcodeCount = 0;
    cpu.lastOpcode = 0xea;
    const lo = bus.readCpu(0xfffc) & 0xff;
    const hi = bus.readCpu(0xfffd) & 0xff;
    cpu.pc = ((hi << 8) | lo) & 0xffff;
  }

  _setZn(cpu, value) {
    const v = value & 0xff;
    if (v === 0) cpu.p |= 0x02;
    else cpu.p &= ~0x02;
    if ((v & 0x80) !== 0) cpu.p |= 0x80;
    else cpu.p &= ~0x80;
  }

  _fetch8(nes, bus) {
    const cpu = nes.state.cpu;
    const value = bus.readCpu(cpu.pc & 0xffff) & 0xff;
    cpu.pc = (cpu.pc + 1) & 0xffff;
    return value;
  }

  onCpuCe(nes, bus, phase) {
    const cpu = nes.state.cpu;
    if (cpu.stopped) return;

    // During OAM DMA ownership, CPU is paused at CE points.
    if (nes.state.dma.engine !== 'idle') {
      nes.state.bus.owner = MISTER_CPU_BUS_OWNER_DMA_GENERIC;
      nes.state.bus.paused = true;
      return;
    }

    nes.state.bus.owner = MISTER_CPU_BUS_OWNER_CPU;
    nes.state.bus.paused = false;
    const op = this._fetch8(nes, bus);
    cpu.lastOpcode = op & 0xff;

    switch (op & 0xff) {
      case 0xea: // NOP
        break;
      case 0xa9: { // LDA #imm
        const imm = this._fetch8(nes, bus);
        cpu.a = imm & 0xff;
        this._setZn(cpu, cpu.a);
        break;
      }
      case 0xa2: { // LDX #imm
        const imm = this._fetch8(nes, bus);
        cpu.x = imm & 0xff;
        this._setZn(cpu, cpu.x);
        break;
      }
      case 0xa0: { // LDY #imm
        const imm = this._fetch8(nes, bus);
        cpu.y = imm & 0xff;
        this._setZn(cpu, cpu.y);
        break;
      }
      case 0x8d: { // STA abs
        const lo = this._fetch8(nes, bus);
        const hi = this._fetch8(nes, bus);
        const addr = ((hi << 8) | lo) & 0xffff;
        bus.writeCpu(addr, cpu.a & 0xff);
        break;
      }
      case 0x4c: { // JMP abs
        const lo = this._fetch8(nes, bus);
        const hi = this._fetch8(nes, bus);
        cpu.pc = ((hi << 8) | lo) & 0xffff;
        break;
      }
      case 0x00: { // BRK
        const returnPc = (cpu.pc + 1) & 0xffff;
        const status = (cpu.p | 0x30) & 0xff;
        bus.writeCpu(0x0100 | (cpu.sp & 0xff), (returnPc >>> 8) & 0xff);
        cpu.sp = (cpu.sp - 1) & 0xff;
        bus.writeCpu(0x0100 | (cpu.sp & 0xff), returnPc & 0xff);
        cpu.sp = (cpu.sp - 1) & 0xff;
        bus.writeCpu(0x0100 | (cpu.sp & 0xff), status);
        cpu.sp = (cpu.sp - 1) & 0xff;
        cpu.p = (cpu.p | 0x04) & 0xff;
        const lo = bus.readCpu(0xfffe) & 0xff;
        const hi = bus.readCpu(0xffff) & 0xff;
        cpu.pc = ((hi << 8) | lo) & 0xffff;
        break;
      }
      default:
        cpu.unsupportedOpcodeCount = (cpu.unsupportedOpcodeCount + 1) >>> 0;
        throw new Error(
          `MisterSingleClockCpu unsupported opcode $${(op & 0xff).toString(16).toUpperCase().padStart(2, '0')} at PC=$${((cpu.pc - 1) & 0xffff).toString(16).toUpperCase().padStart(4, '0')}`
        );
    }

    if (phase && phase.cpuCe) {
      nes.state.cpuCycleCounter = (nes.state.cpuCycleCounter + 1) >>> 0;
    }
  }
}

const misterSingleClockCpuExports = { MisterSingleClockCpu };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterSingleClockCpuExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterSingleClockCpu = misterSingleClockCpuExports;
}
