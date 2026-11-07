let Mapper4BaseCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ MapperBase: Mapper4BaseCore } = require('./mapper-base'));
  } catch (_err) {
    Mapper4BaseCore = null;
  }
}
if (!Mapper4BaseCore && typeof globalThis !== 'undefined' && globalThis.NESCoreMapperBase) {
  Mapper4BaseCore = globalThis.NESCoreMapperBase.MapperBase;
}
if (!Mapper4BaseCore) {
  throw new Error('MapperBase core not found');
}

class Mapper4 extends Mapper4BaseCore {
  constructor(cartridge, options = null) {
    const opts = options || {};
    super(typeof opts.a12LowTicks === 'number' ? opts.a12LowTicks : 8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgRam = new Uint8Array(0x2000);
    this.bankRegs = new Uint8Array(8);
    this.bankSelect = 0;
    this.prgMode = 0;
    this.chrMode = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.prgRamEnable = true;
    this.prgRamWriteProtect = false;
    this.irqAltBehavior = !!opts.irqAltBehavior;
    this.irqSupport = opts.irqSupport !== false;
    this.submapper = typeof opts.submapper === 'number' ? (opts.submapper & 0x0f) : 0;
    this.prgBankCount8k = Math.max(1, this.prg.length >> 13);
    this.chrBankCount1k = Math.max(1, this.chr.length >> 10);
    this.prgBankMask = ((this.prgBankCount8k & (this.prgBankCount8k - 1)) === 0)
      ? (this.prgBankCount8k - 1)
      : -1;
    this.chrBankMask = ((this.chrBankCount1k & (this.chrBankCount1k - 1)) === 0)
      ? (this.chrBankCount1k - 1)
      : -1;
    this.prgSlots = new Uint16Array(4);
    this.chrSlots = new Uint16Array(8);
    this.prgSlotOffsets = new Uint32Array(4);
    this.chrSlotOffsets = new Uint32Array(8);
    this.chrIsRam = cartridge.chrBanks === 0;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
    this._a12Initialized = false;
    this._a12Last = false;
    this._a12LowSince = 0;
    this._a12LowTicksMin = 8;
    this.reset();
  }

  reset() {
    super.reset();
    this.bankRegs.fill(0);
    this.bankSelect = 0;
    this.prgMode = 0;
    this.chrMode = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.prgRamEnable = true;
    this.prgRamWriteProtect = false;
    this.mirroringMode = this.cartridge.mirroring || this.mirroringMode || 'horizontal';
    this._a12Initialized = false;
    this._a12Last = false;
    this._a12LowSince = 0;
    this._a12LowTicksMin = this.a12Filter && typeof this.a12Filter.minLowTicks === 'number'
      ? (this.a12Filter.minLowTicks >>> 0)
      : 8;
    this._recomputeBankMaps();
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || 'horizontal';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff && this.prgRamEnable) {
      return this.prgRam[a & 0x1fff];
    }
    return openBus & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x7fff && this.prgRamEnable && !this.prgRamWriteProtect) {
      this.prgRam[a & 0x1fff] = v;
      return true;
    }
    return false;
  }

  _normalizePrgBank(bank) {
    const b = bank | 0;
    if (this.prgBankMask >= 0) return b & this.prgBankMask;
    const count = this.prgBankCount8k | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _normalizeChrBank(bank) {
    const b = bank | 0;
    if (this.chrBankMask >= 0) return b & this.chrBankMask;
    const count = this.chrBankCount1k | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _recomputePrgSlots() {
    const last = Math.max(0, this.prgBankCount8k - 1);
    const secondLast = Math.max(0, this.prgBankCount8k - 2);
    const bank6 = this._normalizePrgBank(this.bankRegs[6] & 0x3f);
    const bank7 = this._normalizePrgBank(this.bankRegs[7] & 0x3f);
    if ((this.prgMode & 0x01) === 0) {
      this.prgSlots[0] = bank6;
      this.prgSlots[1] = bank7;
      this.prgSlots[2] = secondLast;
      this.prgSlots[3] = last;
    } else {
      this.prgSlots[0] = secondLast;
      this.prgSlots[1] = bank7;
      this.prgSlots[2] = bank6;
      this.prgSlots[3] = last;
    }
    this.prgSlotOffsets[0] = this.prgSlots[0] << 13;
    this.prgSlotOffsets[1] = this.prgSlots[1] << 13;
    this.prgSlotOffsets[2] = this.prgSlots[2] << 13;
    this.prgSlotOffsets[3] = this.prgSlots[3] << 13;
  }

  _recomputeChrSlots() {
    const r0 = this.bankRegs[0] & 0xfe;
    const r1 = this.bankRegs[1] & 0xfe;
    const r2 = this.bankRegs[2] & 0xff;
    const r3 = this.bankRegs[3] & 0xff;
    const r4 = this.bankRegs[4] & 0xff;
    const r5 = this.bankRegs[5] & 0xff;
    if ((this.chrMode & 0x01) === 0) {
      this.chrSlots[0] = this._normalizeChrBank(r0);
      this.chrSlots[1] = this._normalizeChrBank(r0 + 1);
      this.chrSlots[2] = this._normalizeChrBank(r1);
      this.chrSlots[3] = this._normalizeChrBank(r1 + 1);
      this.chrSlots[4] = this._normalizeChrBank(r2);
      this.chrSlots[5] = this._normalizeChrBank(r3);
      this.chrSlots[6] = this._normalizeChrBank(r4);
      this.chrSlots[7] = this._normalizeChrBank(r5);
    } else {
      this.chrSlots[0] = this._normalizeChrBank(r2);
      this.chrSlots[1] = this._normalizeChrBank(r3);
      this.chrSlots[2] = this._normalizeChrBank(r4);
      this.chrSlots[3] = this._normalizeChrBank(r5);
      this.chrSlots[4] = this._normalizeChrBank(r0);
      this.chrSlots[5] = this._normalizeChrBank(r0 + 1);
      this.chrSlots[6] = this._normalizeChrBank(r1);
      this.chrSlots[7] = this._normalizeChrBank(r1 + 1);
    }
    this.chrSlotOffsets[0] = this.chrSlots[0] << 10;
    this.chrSlotOffsets[1] = this.chrSlots[1] << 10;
    this.chrSlotOffsets[2] = this.chrSlots[2] << 10;
    this.chrSlotOffsets[3] = this.chrSlots[3] << 10;
    this.chrSlotOffsets[4] = this.chrSlots[4] << 10;
    this.chrSlotOffsets[5] = this.chrSlots[5] << 10;
    this.chrSlotOffsets[6] = this.chrSlots[6] << 10;
    this.chrSlotOffsets[7] = this.chrSlots[7] << 10;
  }

  _recomputeBankMaps() {
    this._recomputePrgSlots();
    this._recomputeChrSlots();
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[this.prgSlotOffsets[((a - 0x8000) >> 13) & 0x03] + (a & 0x1fff)] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xe001) {
      case 0x8000:
        {
          const nextBankSelect = v & 0x07;
          const nextPrgMode = (v >> 6) & 0x01;
          const nextChrMode = (v >> 7) & 0x01;
          const modeChanged = (nextPrgMode !== this.prgMode) || (nextChrMode !== this.chrMode);
          this.bankSelect = nextBankSelect;
          this.prgMode = nextPrgMode;
          this.chrMode = nextChrMode;
          if (modeChanged) this._recomputeBankMaps();
        }
        break;
      case 0x8001:
        {
          const reg = this.bankSelect & 0x07;
          let next = v & 0xff;
          if (reg <= 1) next &= 0xfe;
          if (reg >= 6) next &= 0x3f;
          if (this.bankRegs[reg] === next) break;
          this.bankRegs[reg] = next;
          if (reg <= 5) this._recomputeChrSlots();
          else this._recomputePrgSlots();
        }
        break;
      case 0xa000:
        if ((this.cartridge.mirroring || this.mirroringMode) !== 'four') {
          this.mirroringMode = (v & 0x01) ? 'horizontal' : 'vertical';
        }
        break;
      case 0xa001:
        this.prgRamWriteProtect = (v & 0x40) !== 0;
        this.prgRamEnable = (v & 0x80) !== 0;
        break;
      case 0xc000:
        this.irqLatch = v & 0xff;
        break;
      case 0xc001:
        this.irqReload = true;
        break;
      case 0xe000:
        this.irqEnabled = false;
        this.irqPending = false;
        break;
      case 0xe001:
        this.irqEnabled = true;
        break;
      default:
        break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) {
      return this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] & 0xff;
    }
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.chrIsRam) {
      this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] = value & 0xff;
    }
  }

  _clockIrqCounter() {
    const oldCounter = this.irqCounter & 0xff;
    const newCounter = (oldCounter === 0 || this.irqReload)
      ? (this.irqLatch & 0xff)
      : ((oldCounter - 1) & 0xff);
    this.irqCounter = newCounter;
    if (
      ((!this.irqAltBehavior) || oldCounter !== 0 || this.irqReload) &&
      newCounter === 0 &&
      this.irqEnabled &&
      this.irqSupport
    ) {
      this.irqPending = true;
    }
    this.irqReload = false;
  }

  onPpuAddressBusPattern(addr, dotClock) {
    const busAddr = addr & 0x3fff;
    const dot = dotClock >>> 0;
    const a12 = ((busAddr >> 12) & 0x01) !== 0;
    if (!this._a12Initialized) {
      this._a12Initialized = true;
      this._a12Last = a12;
      this._a12LowSince = dot;
      return;
    }
    const rising = (!this._a12Last) && a12;
    const falling = this._a12Last && (!a12);
    let qualifiedRise = false;
    if (rising) {
      qualifiedRise = (((dot - this._a12LowSince) >>> 0) >= (this._a12LowTicksMin >>> 0));
    }
    if (falling) {
      this._a12LowSince = dot;
    }
    this._a12Last = a12;
    if (qualifiedRise) {
      this._clockIrqCounter();
    }
  }

  onQualifiedA12Rise(_edge, _access) {
    this._clockIrqCounter();
  }
}

const mapper4Exports = { Mapper4 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mapper4Exports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMapper4 = mapper4Exports;
}
