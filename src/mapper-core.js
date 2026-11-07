let MapperCoreBaseCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ MapperBase: MapperCoreBaseCore } = require('./mapper-base'));
  } catch (_err) {
    MapperCoreBaseCore = null;
  }
}
if (!MapperCoreBaseCore && typeof globalThis !== 'undefined' && globalThis.NESCoreMapperBase) {
  MapperCoreBaseCore = globalThis.NESCoreMapperBase.MapperBase;
}
if (!MapperCoreBaseCore) {
  throw new Error('MapperBase core not found');
}

let MapperCore4Core = null;
if (typeof require !== 'undefined') {
  try {
    ({ Mapper4: MapperCore4Core } = require('./mapper4'));
  } catch (_err) {
    MapperCore4Core = null;
  }
}
if (!MapperCore4Core && typeof globalThis !== 'undefined' && globalThis.NESCoreMapper4) {
  MapperCore4Core = globalThis.NESCoreMapper4.Mapper4;
}
if (!MapperCore4Core) {
  throw new Error('Mapper4 core not found');
}

function normalizeModulo(value, modulo) {
  const m = modulo | 0;
  if (m <= 0) return 0;
  const v = (value | 0) % m;
  return v < 0 ? (v + m) : v;
}

class Mapper0 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgIs16k = this.prg.length === 0x4000;
    const ramSize = Math.max(
      0,
      (typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    if (ramSize > 0) {
      this.prgRam = new Uint8Array(ramSize);
      this.prgRam.fill(0xff);
      if (cartridge.prgRam && cartridge.prgRam.length > 0) {
        const copyLen = Math.min(this.prgRam.length, cartridge.prgRam.length);
        for (let i = 0; i < copyLen; i++) this.prgRam[i] = cartridge.prgRam[i] & 0xff;
      }
    } else {
      this.prgRam = null;
    }
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (this.prgRam && a >= 0x6000 && a <= 0x7fff) {
      return this.prgRam[a % this.prgRam.length] & 0xff;
    }
    return openBus & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (this.prgRam && a >= 0x6000 && a <= 0x7fff) {
      this.prgRam[a % this.prgRam.length] = value & 0xff;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    if (addr < 0x8000) return 0;
    if (this.prg.length <= 0x4000) {
      const size = this.prg.length | 0;
      if (size <= 0) return 0;
      return this.prg[(addr - 0x8000) % size] & 0xff;
    }
    if (this.prgIs16k) {
      return this.prg[(addr - 0x8000) & 0x3fff];
    }
    return this.prg[(addr - 0x8000) & 0x7fff];
  }

  cpuWrite(_addr, _value) {
    // NROM ignores writes to PRG space.
  }

  ppuRead(addr) {
    if (addr < 0x2000) return this.chr[addr];
    return 0;
  }

  ppuWrite(addr, value) {
    if (addr < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[addr] = value;
    }
  }
}

class Mapper3 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgIs16k = this.prg.length === 0x4000;
    this.chrIsRam = cartridge.chrBanks === 0;
    this.chr8kBanks = Math.max(1, (this.chr.length / 0x2000) | 0);
    this.chrBank = 0;
    this.chrBankMask = Math.max(0, this.chr8kBanks - 1);
    this.chrBankBase = 0;
    // NES2 mapper 3 submapper 2 commonly expects CNROM bus-conflict behavior.
    this.hasBusConflict = this.submapper === 2;
  }

  cpuRead(addr) {
    if (addr < 0x8000) return 0;
    if (this.prgIs16k) {
      return this.prg[(addr - 0x8000) & 0x3fff];
    }
    return this.prg[addr - 0x8000];
  }

  cpuWrite(addr, value) {
    if (addr >= 0x8000) {
      let v = value & 0xff;
      if (this.hasBusConflict) {
        v &= this.cpuRead(addr) & 0xff;
      }
      this.chrBank = v & this.chrBankMask;
      this.chrBankBase = this.chrBank << 13;
    }
  }

  ppuRead(addr) {
    if (addr < 0x2000) {
      if (this.chrIsRam) return this.chr[addr];
      return this.chr[this.chrBankBase + (addr & 0x1fff)];
    }
    return 0;
  }

  ppuWrite(addr, value) {
    if (addr < 0x2000 && this.chrIsRam) {
      this.chr[addr] = value;
    }
  }
}

class Mapper2 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.selectedBank = 0;
    this.selectedBase = 0;
    this.fixedBase = Math.max(0, this.prg16kBanks - 1) << 14;
  }

  _normalizeBank(bank) {
    if (this.prg16kBanks <= 1) return 0;
    // Mapper2 boards typically decode low bank bits only; modulo keeps
    // behavior stable for non power-of-two bank counts in test ROMs.
    return normalizeModulo(bank, this.prg16kBanks);
  }

  cpuRead(addr) {
    if (addr < 0x8000) return 0;
    if (addr < 0xC000) {
      return this.prg[this.selectedBase + (addr & 0x3fff)];
    }
    return this.prg[this.fixedBase + (addr & 0x3fff)];
  }

  cpuWrite(addr, value) {
    if (addr >= 0x8000) {
      this.selectedBank = this._normalizeBank(value & 0xff);
      this.selectedBase = this.selectedBank << 14;
    }
  }

  ppuRead(addr) {
    if (addr < 0x2000) return this.chr[addr];
    return 0;
  }

  ppuWrite(addr, value) {
    if (addr < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[addr] = value & 0xff;
    }
  }
}

class Mapper1 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgRam = new Uint8Array(0x2000);
    this.prgRam.fill(0xff);
    if (cartridge.prgRam && cartridge.prgRam.length > 0) {
      const copyLen = Math.min(this.prgRam.length, cartridge.prgRam.length);
      for (let i = 0; i < copyLen; i++) this.prgRam[i] = cartridge.prgRam[i] & 0xff;
    }
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.chr4kBanks = Math.max(1, (this.chr.length / 0x1000) | 0);
    this.chr8kBanks = Math.max(1, (this.chr.length / 0x2000) | 0);
    this.prgReadBases = new Uint32Array(2);
    this.chrReadBases = new Uint32Array(2);
    this.reset();
  }

  reset() {
    super.reset();
    this.shiftReg = 0x10;
    this.control = 0x0c;
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.prgBank = 0;
    this.prgRamDisable = false;
    this._lastSerialWriteCycle = -0x7fffffff;
    this.mirroringMode = this._decodeMirroring(this.control & 0x03);
    this._recomputeReadMaps();
  }

  _decodeMirroring(mode) {
    switch (mode & 0x03) {
      case 0: return 'single0';
      case 1: return 'single1';
      case 2: return 'vertical';
      case 3: return 'horizontal';
      default: return this.cartridge.mirroring || 'horizontal';
    }
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff && !this.prgRamDisable) {
      return this.prgRam[a & 0x1fff] & 0xff;
    }
    return openBus & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff && !this.prgRamDisable) {
      this.prgRam[a & 0x1fff] = value & 0xff;
      return true;
    }
    return false;
  }

  _recomputePrgReadBases() {
    const prgMode = (this.control >> 2) & 0x03;
    // SUROM/SXROM: for >256KB PRG, CHR bank bit 4 selects the 256KB half
    const hiBank = this.prg16kBanks > 16 ? (this.chrBank0 & 0x10) : 0;
    if (prgMode === 0 || prgMode === 1) {
      const bank32 = normalizeModulo(((this.prgBank & 0x0e) | hiBank) >> 1, this.prg32kBanks);
      const base32 = bank32 << 15;
      this.prgReadBases[0] = base32;
      this.prgReadBases[1] = base32 + 0x4000;
      return;
    }
    if (prgMode === 2) {
      const bank16 = normalizeModulo((this.prgBank & 0x0f) | hiBank, this.prg16kBanks);
      this.prgReadBases[0] = (hiBank ? (hiBank << 14) : 0) % this.prg.length;
      this.prgReadBases[1] = bank16 << 14;
      return;
    }
    const bank16 = normalizeModulo((this.prgBank & 0x0f) | hiBank, this.prg16kBanks);
    this.prgReadBases[0] = bank16 << 14;
    const fixedLast = normalizeModulo(0x0f | hiBank, this.prg16kBanks);
    this.prgReadBases[1] = fixedLast << 14;
  }

  _mapPrgOffset(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a >>> 14) & 0x01;
    return this.prgReadBases[slot] + (a & 0x3fff);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[this._mapPrgOffset(a)] & 0xff;
  }

  _recomputeChrReadBases() {
    const chrMode = (this.control >> 4) & 0x01;
    if (chrMode === 0) {
      const bank8 = normalizeModulo((this.chrBank0 & 0x1e) >> 1, this.chr8kBanks);
      const base8 = bank8 << 13;
      this.chrReadBases[0] = base8;
      this.chrReadBases[1] = base8 + 0x1000;
      return;
    }
    this.chrReadBases[0] = normalizeModulo(this.chrBank0 & 0x1f, this.chr4kBanks) << 12;
    this.chrReadBases[1] = normalizeModulo(this.chrBank1 & 0x1f, this.chr4kBanks) << 12;
  }

  _recomputeReadMaps() {
    this._recomputePrgReadBases();
    this._recomputeChrReadBases();
  }

  _mapChrOffset(addr) {
    const a = addr & 0x1fff;
    const slot = (a >>> 12) & 0x01;
    return this.chrReadBases[slot] + (a & 0x0fff);
  }

  ppuRead(addr) {
    if ((addr & 0x3fff) < 0x2000) {
      return this.chr[this._mapChrOffset(addr)] & 0xff;
    }
    return 0;
  }

  ppuWrite(addr, value) {
    if ((addr & 0x3fff) < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[this._mapChrOffset(addr)] = value & 0xff;
    }
  }

  _commitSerialWrite(addr, data5) {
    const reg = (addr >> 13) & 0x03;
    const data = data5 & 0x1f;
    if (reg === 0) {
      this.control = data;
      this.mirroringMode = this._decodeMirroring(this.control & 0x03);
      this._recomputeReadMaps();
      return;
    }
    if (reg === 1) {
      this.chrBank0 = data;
      this._recomputeReadMaps();
      return;
    }
    if (reg === 2) {
      this.chrBank1 = data;
      this._recomputeChrReadBases();
      return;
    }
    this.prgBank = data;
    this.prgRamDisable = (data & 0x10) !== 0;
    this._recomputePrgReadBases();
  }

  cpuWrite(addr, value, context) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    const isResetWrite = (v & 0x80) !== 0;
    const currentCycle = (
      context && typeof context.currentCycle === 'number'
        ? (context.currentCycle >>> 0)
        : -1
    );
    let allowWrite = true;
    if (currentCycle >= 0) {
      const delta = ((currentCycle - this._lastSerialWriteCycle) >>> 0);
      // MMC1 ignores writes within 2 cycles of any previous write
      // (dummy+real pair), except reset writes (bit7 set) which are
      // always processed. The timestamp is updated for every write.
      allowWrite = isResetWrite || delta >= 2;
      this._lastSerialWriteCycle = currentCycle;
    }
    if (!allowWrite) return;
    if (isResetWrite) {
      this.shiftReg = 0x10;
      this.control |= 0x0c;
      this.mirroringMode = this._decodeMirroring(this.control & 0x03);
      this._recomputeReadMaps();
      return;
    }
    const complete = (this.shiftReg & 0x01) !== 0;
    this.shiftReg = (this.shiftReg >> 1) | ((v & 0x01) << 4);
    if (!complete) return;
    this._commitSerialWrite(a, this.shiftReg);
    this.shiftReg = 0x10;
  }
}

class Mapper5 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom && cartridge.chrRom.length > 0 ? cartridge.chrRom : new Uint8Array(0x2000);
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    const prgRamSize = Math.max(
      0,
      (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    this.wram = prgRamSize > 0 ? new Uint8Array(0x2000) : null;
    if (this.wram) this.wram.fill(0xff);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);

    this.prgMode = 3;       // $5100
    this.chrMode = 3;       // $5101
    this.wramProtect1 = 0;  // $5102
    this.wramProtect2 = 0;  // $5103
    this.exramMode = 0;     // $5104
    this.ntMode = 0;        // $5105
    this.fillTile = 0;      // $5106
    this.fillAttr = 0;      // $5107

    // PRG: [0]=$5113(WRAM $6000), [1]=$5114, [2]=$5115, [3]=$5116, [4]=$5117
    this.prgRegs = new Uint8Array(5);
    this.prgRegs[4] = 0xff; // $5117 defaults to last ROM bank

    // CHR: A set for sprites ($5120-$5127), B set for BG ($5128-$512B)
    this.chrRegsA = new Uint16Array(8);
    this.chrRegsB = new Uint16Array(4);
    this.chrHi = 0;          // $5130 upper 2 bits for CHR bank writes
    this.lastChrWrite = 0;   // 0=A, 1=B — which set was last written
    this.fetchingSprites = false; // true during sprite fetch phase (dots 257-320)
    this.largeSprites = false;    // PPU $2000 bit 5 — 8x16 sprite mode
    this.exAttrByte = 0;     // ExRAM byte captured on last BG nametable fetch (ExGrafix)

    // WRAM (64KB max, 8 × 8KB banks)
    this.wram = new Uint8Array(0x10000);
    // ExRAM (1KB)
    this.exram = new Uint8Array(0x400);

    // Multiplier ($5205/$5206)
    this.multiplicand = 0;
    this.multiplier = 0;

    // Scanline counter / IRQ
    this.irqTarget = 0;     // $5203
    this.irqEnabled = false; // $5204 bit 7
    this.irqPending = false;
    this._prevScanline = -1;
    this.scanlineCounter = 0;
    this.inFrame = false;
  }

  _wramWriteEnabled() {
    return (this.wramProtect1 & 0x03) === 0x02 && (this.wramProtect2 & 0x03) === 0x01;
  }

  _readWramBank(bank, addr) {
    const off = ((bank & 0x07) << 13) + (addr & 0x1fff);
    return this.wram[off & 0xffff] & 0xff;
  }

  _writeWramBank(bank, addr, value) {
    const off = ((bank & 0x07) << 13) + (addr & 0x1fff);
    this.wram[off & 0xffff] = value & 0xff;
  }

  onPpuControl(value) {
    const large = (value & 0x20) !== 0;
    this.largeSprites = large;
    // Per MMC5: switching out of 8x16 sprites forgets the last-bank-written
    // so BG fetches fall back to the A set regardless of prior writes.
    if (!large) {
      this.lastChrWrite = 0;
    }
  }

  _mapChr1kBank(slot) {
    const s = slot & 0x07;
    // In 8x8 sprite mode, the A set is used for ALL fetches (sprite+BG).
    // In 8x16 mode, A = sprite fetches, B = BG fetches.
    const useB = this.largeSprites && !this.fetchingSprites;

    if (useB) {
      // Background CHR registers (B set). Per MMC5, the register value is
      // a bank number in units of the current CHR mode size, so shift to
      // translate into 1K slots:
      //   mode 0 (8K): value << 3
      //   mode 1 (4K): value << 2, mirrored across both 4K halves
      //   mode 2 (2K): value << 1
      //   mode 3 (1K): value as-is
      const bs = s & 0x03;
      if (this.chrMode === 0) {
        return normalizeModulo((this.chrRegsB[3] << 3) + s, this.chr1kBanks);
      }
      if (this.chrMode === 1) {
        return normalizeModulo((this.chrRegsB[3] << 2) + bs, this.chr1kBanks);
      }
      if (this.chrMode === 2) {
        // B set mode 2 mirrors: slots 0,1 use regB[1]; slots 2,3 use regB[3].
        const base = this.chrRegsB[1 + ((bs >> 1) << 1)] << 1;
        return normalizeModulo(base + (bs & 1), this.chr1kBanks);
      }
      return normalizeModulo(this.chrRegsB[bs] & 0xffff, this.chr1kBanks);
    }

    // Sprite CHR registers (A set)
    if (this.chrMode === 0) {
      return normalizeModulo((this.chrRegsA[7] << 3) + s, this.chr1kBanks);
    }
    if (this.chrMode === 1) {
      const base = this.chrRegsA[3 + ((s >> 2) << 2)] << 2;
      return normalizeModulo(base + (s & 3), this.chr1kBanks);
    }
    if (this.chrMode === 2) {
      const base = this.chrRegsA[1 + ((s >> 1) << 1)] << 1;
      return normalizeModulo(base + (s & 1), this.chr1kBanks);
    }
    return normalizeModulo(this.chrRegsA[s] & 0xffff, this.chr1kBanks);
  }

  isIrqAsserted() {
    return this.irqPending && this.irqEnabled;
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    const slot = (a >> 10) & 0x03;
    const mode = (this.ntMode >> (slot * 2)) & 0x03;
    const off = a & 0x03ff;
    if (mode === 0) return off;
    if (mode === 1) return 0x400 + off;
    // Modes 2 (ExRAM) and 3 (Fill) — content overridden by readNametable
    return off;
  }

  readNametable(rawAddr) {
    const a = rawAddr & 0x0fff;
    const slot = (a >> 10) & 0x03;
    const mode = (this.ntMode >> (slot * 2)) & 0x03;
    if (mode === 2) {
      // ExRAM as nametable
      return this.exram[a & 0x03ff] & 0xff;
    }
    if (mode === 3) {
      // Fill mode
      const off = a & 0x03ff;
      if (off >= 0x3c0) {
        const attr = this.fillAttr & 0x03;
        return attr | (attr << 2) | (attr << 4) | (attr << 6);
      }
      return this.fillTile;
    }
    return null; // use default VRAM for modes 0, 1
  }

  onNametableRead(rawAddr, value) {
    // ExGrafix (ExRAM mode 1): capture ExRAM byte for each BG tile fetch.
    // The 2 pattern fetches that follow use bits 5:0 as a 4KB CHR bank override
    // and bits 7:6 as the palette select (palette override not yet wired up).
    if (this.exramMode !== 1 || this.fetchingSprites) return;
    const off = rawAddr & 0x03ff;
    if (off < 0x03c0) {
      this.exAttrByte = this.exram[off] & 0xff;
    }
  }

  writeNametable(rawAddr, value) {
    const a = rawAddr & 0x0fff;
    const slot = (a >> 10) & 0x03;
    const mode = (this.ntMode >> (slot * 2)) & 0x03;
    if (mode === 2) {
      this.exram[a & 0x03ff] = value & 0xff;
      return true;
    }
    if (mode === 3) return true; // Fill mode — absorb writes
    return false;
  }

  getMirroringMode(defaultMode) {
    return defaultMode || this.cartridge.mirroring || 'vertical';
  }

  onPpuAddressBus(access) {
    const dot = access.dot;
    const scanline = access.scanline;

    // Track BG vs sprite fetch phase for CHR bank switching
    this.fetchingSprites = (dot >= 257 && dot <= 320);

    // Scanline counter
    if (access.rendering && scanline >= 0 && scanline <= 239) {
      if (scanline !== this._prevScanline && dot < 8) {
        if (!this.inFrame) {
          this.inFrame = true;
          this.scanlineCounter = 0;
        }
        this._prevScanline = scanline;
        this.scanlineCounter++;
        if (this.scanlineCounter === this.irqTarget) {
          this.irqPending = true;
        }
      }
    } else if (scanline >= 241 && this.inFrame) {
      this.inFrame = false;
      this._prevScanline = -1;
      this.scanlineCounter = 0;
    }
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;

    // ExRAM ($5C00-$5FFF)
    if (a >= 0x5c00 && a <= 0x5fff) {
      return (this.exramMode <= 2) ? (this.exram[a & 0x03ff] & 0xff) : 0;
    }
    // WRAM ($6000-$7FFF)
    if (a >= 0x6000 && a <= 0x7fff) {
      return this._readWramBank(this.prgRegs[0], a);
    }
    // IRQ status ($5204)
    if (a === 0x5204) {
      const result = (this.irqPending ? 0x80 : 0) | (this.inFrame ? 0x40 : 0);
      this.irqPending = false;
      return result;
    }
    // Multiplier ($5205-$5206)
    if (a === 0x5205) return ((this.multiplicand * this.multiplier) & 0xff);
    if (a === 0x5206) return ((this.multiplicand * this.multiplier) >> 8) & 0xff;
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;

    // ExRAM ($5C00-$5FFF)
    if (a >= 0x5c00 && a <= 0x5fff) {
      if (this.exramMode <= 2) this.exram[a & 0x03ff] = v;
      return true;
    }
    // WRAM ($6000-$7FFF)
    if (a >= 0x6000 && a <= 0x7fff) {
      if (this._wramWriteEnabled()) this._writeWramBank(this.prgRegs[0], a, v);
      return true;
    }

    if (a < 0x5100 || a > 0x5206) return false;

    if (a === 0x5100) { this.prgMode = v & 0x03; return true; }
    if (a === 0x5101) { this.chrMode = v & 0x03; return true; }
    if (a === 0x5102) { this.wramProtect1 = v; return true; }
    if (a === 0x5103) { this.wramProtect2 = v; return true; }
    if (a === 0x5104) { this.exramMode = v & 0x03; return true; }
    if (a === 0x5105) { this.ntMode = v; return true; }
    if (a === 0x5106) { this.fillTile = v; return true; }
    if (a === 0x5107) { this.fillAttr = v & 0x03; return true; }

    // PRG banking ($5113-$5117)
    if (a === 0x5113) { this.prgRegs[0] = v; return true; }
    if (a >= 0x5114 && a <= 0x5117) { this.prgRegs[a - 0x5113] = v; return true; }

    // CHR banking A ($5120-$5127)
    if (a >= 0x5120 && a <= 0x5127) {
      this.chrRegsA[a - 0x5120] = v | (this.chrHi << 8);
      this.lastChrWrite = 0;
      return true;
    }
    // CHR banking B ($5128-$512B)
    if (a >= 0x5128 && a <= 0x512b) {
      this.chrRegsB[a - 0x5128] = v | (this.chrHi << 8);
      this.lastChrWrite = 1;
      return true;
    }
    // CHR upper bits ($5130)
    if (a === 0x5130) { this.chrHi = v & 0x03; return true; }

    // IRQ ($5203-$5204)
    if (a === 0x5203) { this.irqTarget = v; return true; }
    if (a === 0x5204) { this.irqEnabled = !!(v & 0x80); return true; }

    // Multiplier ($5205-$5206)
    if (a === 0x5205) { this.multiplicand = v; return true; }
    if (a === 0x5206) { this.multiplier = v; return true; }

    return true;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;

    if (this.prgMode === 0) {
      // 32KB: $5117 bits 6:2, always ROM
      const bank32 = (this.prgRegs[4] >> 2) & 0x1f;
      const base = normalizeModulo(bank32, Math.max(1, this.prg.length >> 15)) << 15;
      return this.prg[(base + (a & 0x7fff)) % this.prg.length] & 0xff;
    }

    if (this.prgMode === 1) {
      if (a < 0xc000) {
        const reg = this.prgRegs[2]; // $5115
        if (reg & 0x80) {
          const bank16 = (reg >> 1) & 0x3f;
          const base = normalizeModulo(bank16, Math.max(1, this.prg.length >> 14)) << 14;
          return this.prg[(base + (a & 0x3fff)) % this.prg.length] & 0xff;
        }
        return this._readWramBank(((reg & 0x06) >> 1) * 2 + ((a >> 13) & 1), a);
      }
      const reg = this.prgRegs[4]; // $5117, always ROM
      const bank16 = (reg >> 1) & 0x3f;
      const base = normalizeModulo(bank16, Math.max(1, this.prg.length >> 14)) << 14;
      return this.prg[(base + (a & 0x3fff)) % this.prg.length] & 0xff;
    }

    if (this.prgMode === 2) {
      if (a < 0xc000) {
        const reg = this.prgRegs[2]; // $5115, 16KB
        if (reg & 0x80) {
          const bank16 = (reg >> 1) & 0x3f;
          const base = normalizeModulo(bank16, Math.max(1, this.prg.length >> 14)) << 14;
          return this.prg[(base + (a & 0x3fff)) % this.prg.length] & 0xff;
        }
        return this._readWramBank(((reg & 0x06) >> 1) * 2 + ((a >> 13) & 1), a);
      }
      if (a < 0xe000) {
        const reg = this.prgRegs[3]; // $5116, 8KB
        if (reg & 0x80) {
          const base = normalizeModulo(reg & 0x7f, this.prg8kBanks) << 13;
          return this.prg[(base + (a & 0x1fff)) % this.prg.length] & 0xff;
        }
        return this._readWramBank(reg & 0x07, a);
      }
      const base = normalizeModulo(this.prgRegs[4] & 0x7f, this.prg8kBanks) << 13;
      return this.prg[(base + (a & 0x1fff)) % this.prg.length] & 0xff;
    }

    // Mode 3: 8KB × 4
    const slot = (a - 0x8000) >> 13;
    const reg = this.prgRegs[slot + 1];
    if (slot === 3 || (reg & 0x80)) {
      const base = normalizeModulo(reg & 0x7f, this.prg8kBanks) << 13;
      return this.prg[(base + (a & 0x1fff)) % this.prg.length] & 0xff;
    }
    return this._readWramBank(reg & 0x07, a);
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    const v = value & 0xff;

    // Only WRAM-mapped slots can be written
    let reg;
    if (this.prgMode === 0) return;
    if (this.prgMode === 1) {
      if (a < 0xc000) reg = this.prgRegs[2]; else return;
    } else if (this.prgMode === 2) {
      if (a < 0xc000) reg = this.prgRegs[2];
      else if (a < 0xe000) reg = this.prgRegs[3];
      else return;
    } else {
      const slot = (a - 0x8000) >> 13;
      if (slot === 3) return;
      reg = this.prgRegs[slot + 1];
    }
    if (!(reg & 0x80) && this._wramWriteEnabled()) {
      let bank;
      if ((this.prgMode === 1 || (this.prgMode === 2 && a < 0xc000))) {
        bank = ((reg & 0x06) >> 1) * 2 + ((a >> 13) & 1);
      } else {
        bank = reg & 0x07;
      }
      this._writeWramBank(bank, a, v);
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;

    // ExGrafix: BG pattern fetches use the per-tile ExRAM-selected 4KB bank.
    if (this.exramMode === 1 && !this.fetchingSprites) {
      const bank4k = (this.exAttrByte & 0x3f) | (this.chrHi << 6);
      const off = (bank4k << 12) + (a & 0x0fff);
      return this.chr[off % this.chr.length] & 0xff;
    }

    const slot = (a >> 10) & 0x07;
    const bank = this._mapChr1kBank(slot);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = this._mapChr1kBank(slot);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper7 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.prgBank = 0;
    this.mirroringMode = 'single0';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || 'single0';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank * 0x8000) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    if ((addr & 0xffff) < 0x8000) return;
    const v = value & 0xff;
    this.prgBank = v & 0x07;
    this.mirroringMode = (v & 0x10) !== 0 ? 'single1' : 'single0';
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper66 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.chr8kBanks = Math.max(1, (this.chr.length / 0x2000) | 0);
    this.prgBank = 0;
    this.chrBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank * 0x8000) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    if ((addr & 0xffff) < 0x8000) return;
    const v = value & 0xff;
    this.prgBank = (v >> 4) & 0x03;
    this.chrBank = v & 0x03;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank * 0x2000) + (a & 0x1fff);
      return this.chr[off % this.chr.length] & 0xff;
    }
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank * 0x2000) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper71 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.prgBank = 0;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
  }

  _normalizeBank(bank) {
    return normalizeModulo(bank, this.prg16kBanks);
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = this._normalizeBank(this.prgBank);
      const off = (bank * 0x4000) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x9000 && a <= 0x9fff) {
      this.mirroringMode = (v & 0x10) !== 0 ? 'single1' : 'single0';
    }
    if (a >= 0x8000) {
      this.prgBank = this._normalizeBank(v & 0x0f);
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper70_152 extends MapperCoreBaseCore {
  constructor(cartridge, enableMirroringControl = false) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.enableMirroringControl = !!enableMirroringControl;
    this.prgBank = 0;
    this.chrBank = 0;
    this.mirroringMode = 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    const mirroringBit = (v & 0x80) !== 0;
    if (mirroringBit) {
      // Mapper70 roms that toggle bit7 expect one-screen control, same as mapper152.
      this.enableMirroringControl = true;
    }
    if (this.enableMirroringControl) {
      this.mirroringMode = mirroringBit ? 'single1' : 'single0';
    }
    this.prgBank = (v >> 4) & 0x07;
    this.chrBank = v & 0x0f;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper140 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, this.prg.length >> 15);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgBank = 0;
    this.chrBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank << 15) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x6000 || a > 0x7fff) return false;
    this.prgBank = (v >> 4) & 0x03;
    this.chrBank = v & 0x0f;
    return true;
  }

  cpuWrite(_addr, _value) {}

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper184 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.chr4kBanks = Math.max(1, this.chr.length >> 12);
    this.chrLow = 0;
    this.chrHigh = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[(a - 0x8000) % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x6000 || a > 0x7fff) return false;
    this.chrLow = v & 0x07;
    this.chrHigh = 0x80 | ((v >> 4) & 0x07);
    return true;
  }

  cpuWrite(_addr, _value) {}

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bankRaw = (a < 0x1000) ? this.chrLow : this.chrHigh;
    const bank = normalizeModulo(bankRaw, this.chr4kBanks);
    const off = (bank << 12) + (a & 0x0fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bankRaw = (a < 0x1000) ? this.chrLow : this.chrHigh;
      const bank = normalizeModulo(bankRaw, this.chr4kBanks);
      const off = (bank << 12) + (a & 0x0fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper72_92 extends MapperCoreBaseCore {
  constructor(cartridge, jf19Mode = false) {
    super(8);
    this.cartridge = cartridge;
    this.jf19Mode = !!jf19Mode;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgBank0 = 0;
    this.prgBank1 = Math.max(0, this.prg16kBanks - 1);
    this.chrBank = 0;
    this.prgFlag = false;
    this.chrFlag = false;
    this._prgBank0Norm = 0;
    this._prgBank1Norm = normalizeModulo(this.prgBank1, this.prg16kBanks);
    this._prgBase0 = this._prgBank0Norm << 14;
    this._prgBase1 = this._prgBank1Norm << 14;
    this._chrBankNorm = 0;
    this._chrBase = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const base = a < 0xc000 ? this._prgBase0 : this._prgBase1;
    return this.prg[base + (a & 0x3fff)] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if (!this.prgFlag && (v & 0x80) !== 0) {
      if (this.jf19Mode) {
        this.prgBank1 = v & 0x0f;
        this._prgBank1Norm = normalizeModulo(this.prgBank1, this.prg16kBanks);
        this._prgBase1 = this._prgBank1Norm << 14;
      } else {
        this.prgBank0 = v & 0x07;
        this._prgBank0Norm = normalizeModulo(this.prgBank0, this.prg16kBanks);
        this._prgBase0 = this._prgBank0Norm << 14;
      }
    }
    if (!this.chrFlag && (v & 0x40) !== 0) {
      this.chrBank = v & 0x0f;
      this._chrBankNorm = normalizeModulo(this.chrBank, this.chr8kBanks);
      this._chrBase = this._chrBankNorm << 13;
    }
    this.prgFlag = (v & 0x80) !== 0;
    this.chrFlag = (v & 0x40) !== 0;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    return this.chr[this._chrBase + (a & 0x1fff)] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[this._chrBase + (a & 0x1fff)] = value & 0xff;
    }
  }
}

class Mapper93 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chrEnabled = true;
    this.prgBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank = (v >> 4) & 0x07;
    this.chrEnabled = (v & 0x01) === 0x01;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    if (!this.chrEnabled && this.cartridge.chrBanks > 0) {
      return 0xff;
    }
    return this.chr[a & 0x1fff] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper89 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgBank = 0;
    this.chrBank = 0;
    this.mirroringMode = 'single0';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'single0';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank = (v >> 4) & 0x07;
    this.chrBank = (v & 0x07) | ((v & 0x80) >> 4);
    this.mirroringMode = (v & 0x08) ? 'single1' : 'single0';
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper155 extends Mapper1 {
  constructor(cartridge) {
    super(cartridge);
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      return this.prgRam[a & 0x1fff] & 0xff;
    }
    return openBus & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      this.prgRam[a & 0x1fff] = value & 0xff;
      return true;
    }
    return false;
  }
}

class Mapper65 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgRegs = new Uint8Array(3);
    this.chrRegs = new Uint8Array(8);
    this.prgRegs[0] = 0;
    this.prgRegs[1] = 1;
    this.prgRegs[2] = Math.max(0, this.prg8kBanks - 2);
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqEnabled = false;
    this.irqCounter = 0;
    this.irqReload = 0;
    this.irqPending = false;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = slot < 3
      ? normalizeModulo(this.prgRegs[slot] & 0xff, this.prg8kBanks)
      : Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if (a === 0x8000) { this.prgRegs[0] = v; return; }
    if (a === 0xa000) { this.prgRegs[1] = v; return; }
    if (a === 0xc000) { this.prgRegs[2] = v; return; }
    if (a === 0x9001) {
      this.mirroringMode = (v & 0x80) ? 'horizontal' : 'vertical';
      return;
    }
    if (a === 0x9003) {
      this.irqEnabled = (v & 0x80) !== 0;
      this.irqPending = false;
      return;
    }
    if (a === 0x9004) {
      this.irqCounter = this.irqReload & 0xffff;
      this.irqPending = false;
      return;
    }
    if (a === 0x9005) {
      this.irqReload = (this.irqReload & 0x00ff) | ((v << 8) & 0xff00);
      return;
    }
    if (a === 0x9006) {
      this.irqReload = (this.irqReload & 0xff00) | v;
      return;
    }
    if (a >= 0xb000 && a <= 0xb007) {
      this.chrRegs[a & 0x07] = v;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    const old = this.irqCounter & 0xffff;
    this.irqCounter = (old - 1) & 0xffff;
    if (old === 1) {
      this.irqEnabled = false;
      this.irqPending = true;
    }
  }
}

class Mapper67 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr2kBanks = Math.max(1, this.chr.length >> 11);
    this.prgBank = 0;
    this.chrRegs = new Uint8Array(4);
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqLatchHigh = false;
    this.irqEnabled = false;
    this.irqCounter = 0;
    this.irqPending = false;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xf800) {
      case 0x8800: this.chrRegs[0] = v; return;
      case 0x9800: this.chrRegs[1] = v; return;
      case 0xa800: this.chrRegs[2] = v; return;
      case 0xb800: this.chrRegs[3] = v; return;
      case 0xc800:
        this.irqCounter &= this.irqLatchHigh ? 0x00ff : 0xff00;
        this.irqCounter |= this.irqLatchHigh ? ((v << 8) & 0xff00) : v;
        this.irqLatchHigh = !this.irqLatchHigh;
        return;
      case 0xd800:
        this.irqEnabled = (v & 0x10) !== 0;
        this.irqLatchHigh = false;
        this.irqPending = false;
        return;
      case 0xe800:
        switch (v & 0x03) {
          case 0: this.mirroringMode = 'vertical'; break;
          case 1: this.mirroringMode = 'horizontal'; break;
          case 2: this.mirroringMode = 'single0'; break;
          case 3: this.mirroringMode = 'single1'; break;
          default: break;
        }
        return;
      case 0xf800:
        this.prgBank = v;
        return;
      default:
        return;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 11) & 0x03;
    const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr2kBanks);
    const off = (bank << 11) + (a & 0x07ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 11) & 0x03;
      const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr2kBanks);
      const off = (bank << 11) + (a & 0x07ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    this.irqCounter = (this.irqCounter - 1) & 0xffff;
    if (this.irqCounter === 0xffff) {
      this.irqEnabled = false;
      this.irqPending = true;
    }
  }
}

class Mapper78 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgBank = 0;
    this.chrBank = 0;
    this.mirroringMode = cartridge.mirroring || 'single0';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'single0';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank = v & 0x07;
    this.chrBank = (v >> 4) & 0x0f;
    if (this.submapper === 3) {
      this.mirroringMode = (v & 0x08) ? 'vertical' : 'horizontal';
    } else {
      this.mirroringMode = (v & 0x08) ? 'single1' : 'single0';
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper76BaseCore extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.command = 0;
    this.prgRegs = new Uint8Array(2);
    this.chrRegs = new Uint8Array(6);
  }

  isIrqAsserted() {
    return false;
  }

  getMirroringMode(defaultMode) {
    return this.cartridge.mirroring || defaultMode || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xa000) bank = normalizeModulo(this.prgRegs[0], this.prg8kBanks);
    else if (a < 0xc000) bank = normalizeModulo(this.prgRegs[1], this.prg8kBanks);
    else if (a < 0xe000) bank = Math.max(0, this.prg8kBanks - 2);
    else bank = Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if ((a & 0x01) === 0) {
      this.command = v & 0x07;
      return;
    }
    const c = this.command & 0x07;
    if (c <= 5) {
      this.chrRegs[c] = v;
    } else if (c === 6) {
      this.prgRegs[0] = v & 0x3f;
    } else if (c === 7) {
      this.prgRegs[1] = v & 0x3f;
    }
  }

  _mapChrSlot(slot) {
    const s = slot & 0x07;
    if (s < 4) {
      const bank2k = this.chrRegs[(s >> 1) & 0x01] & 0x3f;
      const bank1k = (bank2k << 1) | (s & 0x01);
      return normalizeModulo(bank1k, this.chr1kBanks);
    }
    const reg = 2 + (s - 4);
    return normalizeModulo(this.chrRegs[reg] & 0x7f, this.chr1kBanks);
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = this._mapChrSlot(slot);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = this._mapChrSlot(slot);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper88 extends Mapper76BaseCore {
  constructor(cartridge) {
    super(cartridge);
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if ((a & 0x01) === 0) {
      this.command = v & 0x07;
      return;
    }
    const c = this.command & 0x07;
    if (c <= 5) {
      let next = v & 0xff;
      if (c <= 1) next &= 0x3f;
      else next |= 0x40;
      this.chrRegs[c] = next & 0xff;
      return;
    }
    if (c === 6) {
      this.prgRegs[0] = v & 0x3f;
      return;
    }
    if (c === 7) {
      this.prgRegs[1] = v & 0x3f;
    }
  }
}

class Mapper95 extends Mapper76BaseCore {
  constructor(cartridge) {
    super(cartridge);
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    const table = (a >> 10) & 0x03;
    const offset = a & 0x03ff;
    if (table < 2) {
      return (((this.chrRegs[0] >> 5) & 0x01) << 10) | offset;
    }
    return (((this.chrRegs[1] >> 5) & 0x01) << 10) | offset;
  }
}

class Mapper154 extends Mapper88 {
  constructor(cartridge) {
    super(cartridge);
    this.mirroringMode = 'single0';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'single0';
  }

  cpuWrite(addr, value) {
    this.mirroringMode = (value & 0x40) ? 'single1' : 'single0';
    super.cpuWrite(addr, value);
  }
}

class Mapper96 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, this.prg.length >> 15);
    this.chr4kBanks = Math.max(1, this.chr.length >> 12);
    this.prgBank = 0;
    this.outerChrBank = 0;
    this.innerChrBank = 0;
    this.lastPpuAddress = 0;
    this._prgBankNorm = 0;
    this._prgBase = 0;
    this._chrLowNorm = 0;
    this._chrHighNorm = 0;
    this._chrLowBase = 0;
    this._chrHighBase = 0;
    this._recomputePrgBase();
    this._recomputeChrBases();
  }

  _chrLow() {
    return this.outerChrBank | this.innerChrBank;
  }

  _chrHigh() {
    return this.outerChrBank | 0x03;
  }

  _recomputePrgBase() {
    this._prgBankNorm = normalizeModulo(this.prgBank, this.prg32kBanks);
    this._prgBase = this._prgBankNorm << 15;
  }

  _recomputeChrBases() {
    this._chrLowNorm = normalizeModulo(this._chrLow(), this.chr4kBanks);
    this._chrHighNorm = normalizeModulo(this._chrHigh(), this.chr4kBanks);
    this._chrLowBase = this._chrLowNorm << 12;
    this._chrHighBase = this._chrHighNorm << 12;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[this._prgBase + (a & 0x7fff)] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank = v & 0x03;
    this.outerChrBank = v & 0x04;
    this._recomputePrgBase();
    this._recomputeChrBases();
  }

  onPpuAddressBus(access) {
    const next = (access && access.busAddr != null) ? (access.busAddr & 0x3fff) : 0;
    const oldRegion = this.lastPpuAddress & 0x3000;
    const nextRegion = next & 0x3000;
    if (oldRegion !== 0x2000 && nextRegion === 0x2000) {
      this.innerChrBank = (next >> 8) & 0x03;
      this._recomputeChrBases();
    }
    this.lastPpuAddress = next;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const base = a < 0x1000 ? this._chrLowBase : this._chrHighBase;
    return this.chr[base + (a & 0x0fff)] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const base = a < 0x1000 ? this._chrLowBase : this._chrHighBase;
      this.chr[base + (a & 0x0fff)] = value & 0xff;
    }
  }
}

class Mapper97 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.prgBank1 = Math.max(0, this.prg16kBanks - 1);
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const fixed = Math.max(0, this.prg16kBanks - 1);
      const off = (fixed << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const bank = normalizeModulo(this.prgBank1, this.prg16kBanks);
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank1 = v & 0x0f;
    switch ((v >> 6) & 0x03) {
      case 0: this.mirroringMode = 'single0'; break;
      case 1: this.mirroringMode = 'horizontal'; break;
      case 2: this.mirroringMode = 'vertical'; break;
      case 3: this.mirroringMode = 'single1'; break;
      default: break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper77 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, this.prg.length >> 15);
    this.chr2kBanks = Math.max(1, this.chr.length >> 11);
    this.prgBank = 0;
    this.chrRomBank = 0;
    this.chrRam = new Uint8Array(0x1800);
  }

  getMirroringMode(_defaultMode) {
    return 'four';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank << 15) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.prgBank = v & 0x0f;
    this.chrRomBank = (v >> 4) & 0x0f;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    if (a < 0x0800) {
      const bank = normalizeModulo(this.chrRomBank, this.chr2kBanks);
      const off = (bank << 11) + (a & 0x07ff);
      return this.chr[off % this.chr.length] & 0xff;
    }
    return this.chrRam[(a - 0x0800) % this.chrRam.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return;
    const v = value & 0xff;
    if (a < 0x0800 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrRomBank, this.chr2kBanks);
      const off = (bank << 11) + (a & 0x07ff);
      this.chr[off % this.chr.length] = v;
      return;
    }
    if (a >= 0x0800) {
      this.chrRam[(a - 0x0800) % this.chrRam.length] = v;
    }
  }
}

class Mapper188 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.slot0Bank = 0;
    this.slot0OpenBus = false;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      if (this.slot0OpenBus) return 0xff;
      const bank = normalizeModulo(this.slot0Bank, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const bank = this.prg16kBanks > 8 ? 7 : Math.max(0, this.prg16kBanks - 1);
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if ((v & 0x10) !== 0) {
      this.slot0OpenBus = false;
      this.slot0Bank = v & 0x07;
    } else {
      const expansion = (v & 0x07) | 0x08;
      if (this.prg16kBanks >= 0x10) {
        this.slot0OpenBus = false;
        this.slot0Bank = expansion;
      } else {
        this.slot0OpenBus = true;
      }
    }
    this.mirroringMode = (v & 0x20) ? 'horizontal' : 'vertical';
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper6 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.wram = new Uint8Array(0x2000);
    // Front Fareast (mapper 6) uses 32KB CHR-RAM.
    // Some hacked dumps may still carry CHR-ROM data, so preserve it as power-on contents.
    this.chr = new Uint8Array(0x8000);
    if (cartridge.chrRom && cartridge.chrRom.length) {
      this.chr.set(cartridge.chrRom.subarray(0, Math.min(cartridge.chrRom.length, this.chr.length)));
    }
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgSlot0 = 0;
    this.prgSlot1 = 1;
    // Power-on upper window:
    // Some legacy FFE dumps (including known hFFE sets) expect $E000 reset
    // vectors from banks $0E/$0F rather than the physical last pair.
    // Keep generic behavior for small images, but prefer $0E/$0F when present.
    if (this.prg8kBanks >= 0x10) {
      this.prgSlot2 = 0x0e;
      this.prgSlot3 = 0x0f;
    } else {
      this.prgSlot2 = Math.max(0, this.prg8kBanks - 2);
      this.prgSlot3 = Math.max(0, this.prg8kBanks - 1);
    }
    this.chrBankBase = 0;
    this.altMode = true;
    this.irqEnabled = false;
    this.irqCounter = 0;
    this.irqPending = false;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    let bank = this.prgSlot0;
    if ((slot & 0x03) === 1) bank = this.prgSlot1;
    else if ((slot & 0x03) === 2) bank = this.prgSlot2;
    else if ((slot & 0x03) === 3) bank = this.prgSlot3;
    const off = (normalizeModulo(bank, this.prg8kBanks) << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (!this.wram) return true;
      this.wram[a & 0x1fff] = v;
      return true;
    }
    if (a === 0x42fe) {
      this.altMode = (v & 0x80) === 0;
      this.mirroringMode = ((v >> 4) & 0x01) ? 'single1' : 'single0';
      return true;
    }
    if (a === 0x42ff) {
      this.mirroringMode = ((v >> 4) & 0x01) ? 'horizontal' : 'vertical';
      return true;
    }
    if (a === 0x4501) {
      this.irqEnabled = false;
      this.irqPending = false;
      return true;
    }
    if (a === 0x4502) {
      this.irqCounter = (this.irqCounter & 0xff00) | v;
      this.irqPending = false;
      return true;
    }
    if (a === 0x4503) {
      this.irqCounter = (this.irqCounter & 0x00ff) | ((v << 8) & 0xff00);
      this.irqEnabled = true;
      this.irqPending = false;
      return true;
    }
    return false;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (!this.wram) return openBus & 0xff;
      return this.wram[a & 0x1fff] & 0xff;
    }
    return null;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    let next = v;
    // Mapper 6 has CHR-RAM, so PRG pair comes from bits 2..7 in 8KB units.
    // Low two bits are CHR select.
    const pair = (next & 0xfc) & 0xff;
    this.prgSlot0 = pair;
    this.prgSlot1 = pair + 1;
    next &= 0x03;
    this.chrBankBase = (next << 3) & 0xff;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBankBase + ((a >> 10) & 0x07), this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000) {
      const bank = normalizeModulo(this.chrBankBase + ((a >> 10) & 0x07), this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    const next = (this.irqCounter + 1) & 0xffff;
    this.irqCounter = next;
    if (next === 0x0000) {
      this.irqEnabled = false;
      this.irqPending = true;
    }
  }
}

class Mapper186 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.wram = new Uint8Array(0x10000);
    this.reg4200 = 0;
    this.reg4202 = 0;
    this.readyForBit = true;
    this.enableDecoder = false;
    this.irqEnabled = false;
    this.prgBank0 = 0;
    // Mesen StudyBox init: C000-FFFF fixed to bank 0.
    this.prgBank1 = 0;
  }

  getMirroringMode(_defaultMode) {
    return 'four';
  }

  isIrqAsserted() {
    return false;
  }

  _wramRead(addr, openBus) {
    const a = addr & 0xffff;
    // $4000-$4FFF -> WRAM bank 8, first $400 bytes unmapped.
    if (a >= 0x4000 && a <= 0x4fff) {
      if (a < 0x4400) return openBus & 0xff;
      return this.wram[(8 << 12) + (a & 0x0fff)] & 0xff;
    }
    // $5000-$5FFF -> WRAM bank ((reg4200 & 0x07) + 8)
    if (a >= 0x5000 && a <= 0x5fff) {
      const bank = (this.reg4200 & 0x07) + 8;
      return this.wram[(bank << 12) + (a & 0x0fff)] & 0xff;
    }
    // $6000-$6FFF/$7000-$7FFF -> WRAM bank pair from reg4200[7:6]
    if (a >= 0x6000 && a <= 0x7fff) {
      const base = (this.reg4200 >> 5) & 0x06;
      const bank = a < 0x7000 ? base : (base + 1);
      return this.wram[(bank << 12) + (a & 0x0fff)] & 0xff;
    }
    return openBus & 0xff;
  }

  _wramWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x4000 && a <= 0x4fff) {
      if (a < 0x4400) return true;
      this.wram[(8 << 12) + (a & 0x0fff)] = v;
      return true;
    }
    if (a >= 0x5000 && a <= 0x5fff) {
      const bank = (this.reg4200 & 0x07) + 8;
      this.wram[(bank << 12) + (a & 0x0fff)] = v;
      return true;
    }
    if (a >= 0x6000 && a <= 0x7fff) {
      const base = (this.reg4200 >> 5) & 0x06;
      const bank = a < 0x7000 ? base : (base + 1);
      this.wram[(bank << 12) + (a & 0x0fff)] = v;
      return true;
    }
    return false;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x4000 || a > 0x7fff) return null;
    switch (a) {
      case 0x4200:
        // Real StudyBox returns tape byte; fallback keeps BIOS path moving.
        return 0xaa;
      case 0x4201:
        return (this.enableDecoder ? 0x80 : 0x00) | 0x40;
      case 0x4202:
        return this.readyForBit ? 0x40 : 0x00;
      case 0x4203:
        return 0x00;
      default:
        break;
    }
    return this._wramRead(a, openBus);
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x4000 || a > 0x7fff) return false;
    switch (a) {
      case 0x4200:
        this.reg4200 = v;
        return true;
      case 0x4201:
        this.prgBank0 = v & 0xff;
        return true;
      case 0x4202:
        this.reg4202 = v;
        this.enableDecoder = (v & 0x01) !== 0;
        this.irqEnabled = (v & 0x02) !== 0;
        this.readyForBit = (v & 0x10) === 0;
        return true;
      case 0x4203:
        return true;
      default:
        break;
    }
    return this._wramWrite(a, v);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = a < 0xc000
      ? normalizeModulo(this.prgBank0, this.prg16kBanks)
      : normalizeModulo(this.prgBank1, this.prg16kBanks);
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    // StudyBox PRG switching is done via $4201.
    this.prgBank0 = value & 0xff;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper547 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, (this.prg.length / 0x2000) | 0);

    // 8K CHR RAM (two 4K banks)
    this.chrRam = new Uint8Array(0x2000);

    // 16K WRAM (two 8K chips = four 4K pages)
    this.wram = new Uint8Array(0x4000);

    // 2K QT nametable RAM (extended nametable, MMC5-like)
    this.qtRam = new Uint8Array(0x800);
    this.qtByte = 0;

    // Registers $D000-$DF00 indexed by (addr >> 8) & 0x0F
    this.regs = new Uint8Array(16);

    // IRQ state
    this.irqAfter = 0;
    this.irqEnabled = false;
    this.irqCounter = 0;
    this.irqLatch = 0;
    this.irqPending = false;

    // Background CHR override tracking:
    // After a nametable read (non-attribute), the next 2 pattern table reads
    // are background tile fetches that should use qtByte for CHR override.
    this.qtPendingReads = 0;

    // Kanji ROM page table (JIS X 0208 -> CHR ROM mapping)
    this._kanjiPageTable = new Uint8Array([
      0x0, 0x0, 0x2, 0x2, 0x1, 0x1, 0x4, 0x5, 0x6,
      0x7, 0x8, 0x9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF,
      0x0, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6, 0x7, 0x8,
      0x9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF, 0xD, 0xD
    ]);
  }

  // --- Mirroring ---
  getMirroringMode(defaultMode) {
    return (this.regs[0x0A] & 0x02) ? 'horizontal' : 'vertical';
  }

  // --- IRQ ---
  isIrqAsserted() {
    return !!this.irqPending;
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    this.irqCounter = (this.irqCounter + 1) & 0xffff;
    if (this.irqCounter === 0) {
      this.irqCounter = this.irqLatch & 0xffff;
      this.irqPending = true;
    }
  }

  // --- PRG banking helpers ---
  _prgBankAddr(reg) {
    // Bit 6: chip select. 0 = main PRG ROM (bits 0-3), 1 = daughter cart (bits 0-5 + 0x10)
    const v = reg & 0xff;
    const bank = (v & 0x40) ? ((v & 0x3F) + 0x10) : (v & 0x0F);
    return bank;
  }

  // --- WRAM banking helper ---
  _wramBankIndex(reg) {
    return ((reg & 0x08) >> 2) | (reg & 0x01);
  }

  // --- CPU reads ---
  cpuRead(addr) {
    const a = addr & 0xffff;

    // $8000-$9FFF: switchable 8K bank (reg[2])
    // $A000-$BFFF: switchable 8K bank (reg[3])
    // $C000-$DFFF: switchable 8K bank (reg[4]) + Kanji ROM reads at $DC00/$DD00
    // $E000-$FFFF: fixed to bank 0x4F
    if (a >= 0x8000) {
      // Kanji ROM lookup reads at $DC00/$DD00
      if (a === 0xDC00 || a === 0xDD00) {
        return this._kanjiRead(a);
      }
      const slot = (a - 0x8000) >> 13;
      let bank;
      if (slot < 3) {
        bank = this._prgBankAddr(this.regs[2 + slot]);
      } else {
        bank = 0x4F; // fixed last bank
      }
      const off = (bank << 13) + (a & 0x1fff);
      if (off < this.prg.length) {
        return this.prg[off] & 0xff;
      }
      return 0;
    }
    return 0;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    // $6000-$7FFF: WRAM (two 4K banks)
    if (a >= 0x6000 && a < 0x8000) {
      const region = (a & 0x1000) ? 1 : 0; // 0 = $6000-$6FFF, 1 = $7000-$7FFF
      const bank = this._wramBankIndex(this.regs[region]);
      const off = (bank << 12) + (a & 0x0fff);
      return this.wram[off & (this.wram.length - 1)] & 0xff;
    }
    return null;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;

    if (a < 0x8000) return;

    // Only $D000-$DFFF are register writes
    if ((a & 0xF000) !== 0xD000) return;

    const regIdx = (a & 0x0F00) >> 8;
    this.regs[regIdx] = v;

    switch (a & 0xFF00) {
      case 0xD000: // WRAM bank 0 ($6000-$6FFF)
      case 0xD100: // WRAM bank 1 ($7000-$7FFF)
        break;
      case 0xD200: // PRG bank 0 ($8000-$9FFF)
      case 0xD300: // PRG bank 1 ($A000-$BFFF)
      case 0xD400: // PRG bank 2 ($C000-$DFFF)
        break;
      case 0xD500: // CHR bank select
        break;
      case 0xD600: // IRQ latch low
        this.irqLatch = (this.irqLatch & 0xFF00) | v;
        break;
      case 0xD700: // IRQ latch high
        this.irqLatch = (this.irqLatch & 0x00FF) | (v << 8);
        break;
      case 0xD800: // IRQ acknowledge
        this.irqEnabled = !!this.irqAfter;
        this.irqPending = false;
        break;
      case 0xD900: // IRQ control
        this.irqAfter = v & 0x01;
        this.irqEnabled = !!(v & 0x02);
        if (this.irqEnabled) {
          this.irqCounter = this.irqLatch & 0xffff;
        }
        this.irqPending = false;
        break;
      case 0xDA00: // Mirroring + QT RAM control
        break;
      default:
        break;
    }
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    // $6000-$7FFF: WRAM writes
    if (a >= 0x6000 && a < 0x8000) {
      const region = (a & 0x1000) ? 1 : 0;
      const bank = this._wramBankIndex(this.regs[region]);
      const off = (bank << 12) + (a & 0x0fff);
      this.wram[off & (this.wram.length - 1)] = v;
      return true;
    }
    return false;
  }

  // --- Kanji ROM lookup ($DC00/$DD00 reads) ---
  _kanjiRead(addr) {
    const row = (this.regs[13] - 0x20) & 0xff;
    const col = (this.regs[12] - 0x20) & 0xff;

    if (row < 0x60 && col < 0x60) {
      const code = (col % 32) + (row % 16) * 32 + ((col / 32) | 0) * 32 * 16 + ((row / 16) | 0) * 32 * 16 * 3;
      const pageIdx = (code >> 8) & 0xff;
      const page = pageIdx < this._kanjiPageTable.length ? this._kanjiPageTable[pageIdx] : 0;
      const glyph = (code & 0xFF) | (page << 8);
      const tile = (glyph * 4) >>> 0;

      if (addr === 0xDC00) {
        // Tile number
        return (tile & 0xFF) | (this.regs[11] & 0x03);
      } else {
        // Bank byte
        return ((tile >> 8) & 0xff) | ((this.regs[11] & 0x04) ? 0x80 : 0x00) | 0x40;
      }
    }
    return 0;
  }

  // --- CHR (PPU pattern table) ---
  ppuRead(addr) {
    const a = addr & 0x1fff;

    // Check if this is a background pattern read (qtPendingReads > 0)
    if (this.qtPendingReads > 0) {
      this.qtPendingReads--;
      // Use qtByte for CHR override
      if (this.qtByte & 0x40) {
        if (a & 0x0008) {
          // Fill mode: all 0xFF or 0x00 based on bit 7
          return (this.qtByte & 0x80) ? 0xFF : 0x00;
        } else {
          // Read from CHR ROM using qtByte as bank
          let addr256K = ((this.qtByte & 0x3F) << 12) | (a & 0x0FFF);
          if (this.chr.length === 0x20000) {
            // 128K CHR ROM remap
            addr256K = ((addr256K & 0x07) << 1) | ((addr256K & 0x10) >> 4) | ((addr256K & 0x3FFE0) >> 1);
          }
          if (addr256K < this.chr.length) {
            return this.chr[addr256K] & 0xff;
          }
          return 0;
        }
      }
      // qtByte bit 6 clear: read from CHR RAM with bank select from qtByte bit 0
      const chrRamAddr = ((this.qtByte & 0x01) << 12) | (a & 0x0FFF);
      return this.chrRam[chrRamAddr & (this.chrRam.length - 1)] & 0xff;
    }

    // Normal CHR RAM access: 4K banking from reg[5]
    if (a < 0x1000) {
      const bank = this.regs[5] & 0x01;
      return this.chrRam[(bank << 12) | (a & 0x0fff)] & 0xff;
    }
    // $1000-$1FFF always bank 1
    return this.chrRam[0x1000 | (a & 0x0fff)] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x1fff;
    // CHR RAM write: 4K banking
    if (a < 0x1000) {
      const bank = this.regs[5] & 0x01;
      this.chrRam[(bank << 12) | (a & 0x0fff)] = value & 0xff;
    } else {
      // $1000-$1FFF always bank 1
      this.chrRam[0x1000 | (a & 0x0fff)] = value & 0xff;
    }
  }

  // --- Nametable interception (QT RAM, MMC5-like) ---

  /**
   * Called after a normal nametable read.
   * Captures qtByte from QT RAM for non-attribute addresses.
   * The normal VRAM value is still returned by the PPU.
   */
  onNametableRead(rawAddr, value) {
    const a = rawAddr & 0x3fff;
    // Only capture for nametable tile data (not attribute table)
    if ((a & 0x03FF) < 0x3C0) {
      const bankBit = (this.regs[0x0A] & 0x02)
        ? ((a & 0x800) ? 1 : 0)
        : ((a & 0x400) ? 1 : 0);
      this.qtByte = this.qtRam[(bankBit << 10) | (a & 0x3FF)] & 0xff;
      // Signal that the next 2 pattern reads are for background
      this.qtPendingReads = 2;
    }
  }

  /**
   * Called for nametable writes.
   * Returns true if the mapper handles the write (redirects to QT RAM).
   */
  writeNametable(rawAddr, value) {
    if (this.regs[0x0A] & 0x01) {
      const a = rawAddr & 0x3fff;
      const bankBit = (this.regs[0x0A] & 0x02)
        ? ((a & 0x800) ? 1 : 0)
        : ((a & 0x400) ? 1 : 0);
      this.qtRam[(bankBit << 10) | (a & 0x3FF)] = value & 0xff;
      return true; // handled, skip normal VRAM write
    }
    return false; // default VRAM write
  }
}

class Mapper9 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, (this.prg.length / 0x2000) | 0);
    this.chr4kBanks = Math.max(1, (this.chr.length / 0x1000) | 0);
    this.prgBankSelect = 0;
    this.chrFd0 = 0;
    this.chrFe0 = 0;
    this.chrFd1 = 0;
    this.chrFe1 = 0;
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const fixedA = Math.max(0, this.prg8kBanks - 3);
    const fixedC = Math.max(0, this.prg8kBanks - 2);
    const fixedE = Math.max(0, this.prg8kBanks - 1);
    let bank = 0;
    if (a < 0xa000) bank = normalizeModulo(this.prgBankSelect, this.prg8kBanks);
    else if (a < 0xc000) bank = fixedA;
    else if (a < 0xe000) bank = fixedC;
    else bank = fixedE;
    const off = (bank * 0x2000) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0xa000) return;
    if (a < 0xb000) this.prgBankSelect = v & 0x0f;
    else if (a < 0xc000) this.chrFd0 = v & 0x1f;
    else if (a < 0xd000) this.chrFe0 = v & 0x1f;
    else if (a < 0xe000) this.chrFd1 = v & 0x1f;
    else if (a < 0xf000) this.chrFe1 = v & 0x1f;
    else this.mirroringMode = (v & 0x01) ? 'horizontal' : 'vertical';
  }

  _chrBankForAddr(addr) {
    if ((addr & 0x1000) === 0) {
      return normalizeModulo(this.latch0 === 0xfd ? this.chrFd0 : this.chrFe0, this.chr4kBanks);
    }
    return normalizeModulo(this.latch1 === 0xfd ? this.chrFd1 : this.chrFe1, this.chr4kBanks);
  }

  _updateLatches(addr) {
    const a = addr & 0x1fff;
    if (a === 0x0fd8) this.latch0 = 0xfd;
    else if (a === 0x0fe8) this.latch0 = 0xfe;
    else if (a >= 0x1fd8 && a <= 0x1fdf) this.latch1 = 0xfd;
    else if (a >= 0x1fe8 && a <= 0x1fef) this.latch1 = 0xfe;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = this._chrBankForAddr(a);
    const off = (bank * 0x1000) + (a & 0x0fff);
    const value = this.chr[off % this.chr.length] & 0xff;
    this._updateLatches(a);
    return value;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = this._chrBankForAddr(a);
      const off = (bank * 0x1000) + (a & 0x0fff);
      this.chr[off % this.chr.length] = value & 0xff;
      this._updateLatches(a);
    }
  }
}

class Mapper10 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.chr4kBanks = Math.max(1, (this.chr.length / 0x1000) | 0);
    this.prgBankSelect = 0;
    this.chrFd0 = 0;
    this.chrFe0 = 0;
    this.chrFd1 = 0;
    this.chrFe1 = 0;
    this.latch0 = 0xfe;
    this.latch1 = 0xfe;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xc000) bank = normalizeModulo(this.prgBankSelect, this.prg16kBanks);
    else bank = Math.max(0, this.prg16kBanks - 1);
    const off = (bank * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0xa000) return;
    if (a < 0xb000) this.prgBankSelect = v & 0x0f;
    else if (a < 0xc000) this.chrFd0 = v & 0x1f;
    else if (a < 0xd000) this.chrFe0 = v & 0x1f;
    else if (a < 0xe000) this.chrFd1 = v & 0x1f;
    else if (a < 0xf000) this.chrFe1 = v & 0x1f;
    else this.mirroringMode = (v & 0x01) ? 'horizontal' : 'vertical';
  }

  _chrBankForAddr(addr) {
    if ((addr & 0x1000) === 0) {
      return normalizeModulo(this.latch0 === 0xfd ? this.chrFd0 : this.chrFe0, this.chr4kBanks);
    }
    return normalizeModulo(this.latch1 === 0xfd ? this.chrFd1 : this.chrFe1, this.chr4kBanks);
  }

  _updateLatches(addr) {
    const a = addr & 0x1fff;
    if (a === 0x0fd8) this.latch0 = 0xfd;
    else if (a === 0x0fe8) this.latch0 = 0xfe;
    else if (a >= 0x1fd8 && a <= 0x1fdf) this.latch1 = 0xfd;
    else if (a >= 0x1fe8 && a <= 0x1fef) this.latch1 = 0xfe;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = this._chrBankForAddr(a);
    const off = (bank * 0x1000) + (a & 0x0fff);
    const value = this.chr[off % this.chr.length] & 0xff;
    this._updateLatches(a);
    return value;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = this._chrBankForAddr(a);
      const off = (bank * 0x1000) + (a & 0x0fff);
      this.chr[off % this.chr.length] = value & 0xff;
      this._updateLatches(a);
    }
  }
}

class Mapper11 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.chr8kBanks = Math.max(1, (this.chr.length / 0x2000) | 0);
    this.prgBank = 0;
    this.chrBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank * 0x8000) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    const v = value & 0xff;
    this.prgBank = v & 0x03;
    this.chrBank = (v >> 4) & 0x0f;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank * 0x2000) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank * 0x2000) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper13 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chrRam = new Uint8Array(Math.max(0x4000, cartridge.chrRom.length));
    if (cartridge.chrRom && cartridge.chrRom.length > 0) {
      this.chrRam.set(cartridge.chrRom.subarray(0, Math.min(this.chrRam.length, cartridge.chrRom.length)));
    }
    this.upperBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[(a - 0x8000) % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    this.upperBank = value & 0x03;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    if (a < 0x1000) {
      return this.chrRam[a & 0x0fff] & 0xff;
    }
    const off = ((this.upperBank & 0x03) * 0x1000) + (a & 0x0fff);
    return this.chrRam[off % this.chrRam.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return;
    if (a < 0x1000) {
      this.chrRam[a & 0x0fff] = value & 0xff;
      return;
    }
    const off = ((this.upperBank & 0x03) * 0x1000) + (a & 0x0fff);
    this.chrRam[off % this.chrRam.length] = value & 0xff;
  }
}

class Mapper34 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.chr4kBanks = Math.max(1, (this.chr.length / 0x1000) | 0);
    this.prgBank = 0;
    this.chrBank0 = 0;
    this.chrBank1 = 1;
    this.ninaMode = false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank * 0x8000) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a === 0x7ffd) {
      this.prgBank = v & 0x0f;
      this.ninaMode = true;
      return true;
    }
    if (a === 0x7ffe) {
      this.chrBank0 = v & 0x0f;
      this.ninaMode = true;
      return true;
    }
    if (a === 0x7fff) {
      this.chrBank1 = v & 0x0f;
      this.ninaMode = true;
      return true;
    }
    return false;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    this.prgBank = value & 0xff;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    if (!this.ninaMode) {
      return this.chr[a & 0x1fff] & 0xff;
    }
    let bank = 0;
    if (a < 0x1000) bank = normalizeModulo(this.chrBank0, this.chr4kBanks);
    else bank = normalizeModulo(this.chrBank1, this.chr4kBanks);
    const off = (bank * 0x1000) + (a & 0x0fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper79 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, (this.prg.length / 0x8000) | 0);
    this.chr8kBanks = Math.max(1, (this.chr.length / 0x2000) | 0);
    this.bankReg = 0;
  }

  _prgBank() {
    return (this.bankReg >> 3) & 0x07;
  }

  _chrBank() {
    return this.bankReg & 0x07;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this._prgBank(), this.prg32kBanks);
    const off = (bank * 0x8000) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if ((a & 0xe100) === 0x4100) {
      this.bankReg = value & 0xff;
      return true;
    }
    return false;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    this.bankReg = value & 0xff;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this._chrBank(), this.chr8kBanks);
    const off = (bank * 0x2000) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this._chrBank(), this.chr8kBanks);
      const off = (bank * 0x2000) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper87 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.chrBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[(a - 0x8000) % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return false;
    const swapped = (((value & 0x01) << 1) | ((value & 0x02) >> 1)) & 0xff;
    this.chrBank = normalizeModulo(swapped, this.chr8kBanks);
    return true;
  }

  cpuWrite(_addr, _value) {}

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const off = (this.chrBank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const off = (this.chrBank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class MapperTaitoTc0190Base extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgBankMask = ((this.prg8kBanks & (this.prg8kBanks - 1)) === 0)
      ? (this.prg8kBanks - 1)
      : -1;
    this.chrBankMask = ((this.chr1kBanks & (this.chr1kBanks - 1)) === 0)
      ? (this.chr1kBanks - 1)
      : -1;
    this.prgRegs = new Uint8Array(2);
    this.chrRegs = new Uint8Array(8);
    this.prgSlotOffsets = new Uint32Array(4);
    this.chrSlotOffsets = new Uint32Array(8);
    this.chrIsRam = cartridge.chrBanks === 0;
    this.prgRegs[0] = 0;
    this.prgRegs[1] = 1;
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this._recomputeBankMaps();
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  _normalizePrgBank(bank) {
    const b = bank | 0;
    if (this.prgBankMask >= 0) return b & this.prgBankMask;
    const count = this.prg8kBanks | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _normalizeChrBank(bank) {
    const b = bank | 0;
    if (this.chrBankMask >= 0) return b & this.chrBankMask;
    const count = this.chr1kBanks | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _setPrgReg(index, value) {
    this.prgRegs[index & 0x01] = value & 0xff;
    this._recomputePrgSlots();
  }

  _setChrReg(index, value) {
    this.chrRegs[index & 0x07] = value & 0xff;
    this._recomputeChrSlots();
  }

  _setChrPair(pairIndex, value) {
    const base = (pairIndex & 0x03) << 1;
    const bank = (value << 1) & 0xff;
    this.chrRegs[base] = bank & 0xff;
    this.chrRegs[base + 1] = (bank + 1) & 0xff;
    this._recomputeChrSlots();
  }

  _recomputePrgSlots() {
    const fixedSecondLast = Math.max(0, this.prg8kBanks - 2);
    const fixedLast = Math.max(0, this.prg8kBanks - 1);
    this.prgSlotOffsets[0] = this._normalizePrgBank(this.prgRegs[0] & 0x3f) << 13;
    this.prgSlotOffsets[1] = this._normalizePrgBank(this.prgRegs[1] & 0x3f) << 13;
    this.prgSlotOffsets[2] = fixedSecondLast << 13;
    this.prgSlotOffsets[3] = fixedLast << 13;
  }

  _recomputeChrSlots() {
    this.chrSlotOffsets[0] = this._normalizeChrBank(this.chrRegs[0] & 0xff) << 10;
    this.chrSlotOffsets[1] = this._normalizeChrBank(this.chrRegs[1] & 0xff) << 10;
    this.chrSlotOffsets[2] = this._normalizeChrBank(this.chrRegs[2] & 0xff) << 10;
    this.chrSlotOffsets[3] = this._normalizeChrBank(this.chrRegs[3] & 0xff) << 10;
    this.chrSlotOffsets[4] = this._normalizeChrBank(this.chrRegs[4] & 0xff) << 10;
    this.chrSlotOffsets[5] = this._normalizeChrBank(this.chrRegs[5] & 0xff) << 10;
    this.chrSlotOffsets[6] = this._normalizeChrBank(this.chrRegs[6] & 0xff) << 10;
    this.chrSlotOffsets[7] = this._normalizeChrBank(this.chrRegs[7] & 0xff) << 10;
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

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    return this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.chrIsRam) {
      this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] = value & 0xff;
    }
  }
}

class Mapper33 extends MapperTaitoTc0190Base {
  constructor(cartridge) {
    super(cartridge);
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xa003) {
      case 0x8000:
        this._setPrgReg(0, v & 0x3f);
        this.mirroringMode = (v & 0x40) ? 'horizontal' : 'vertical';
        return;
      case 0x8001:
        this._setPrgReg(1, v & 0x3f);
        return;
      case 0x8002:
        this._setChrPair(0, v);
        return;
      case 0x8003:
        this._setChrPair(1, v);
        return;
      case 0xa000:
      case 0xa001:
      case 0xa002:
      case 0xa003:
        this._setChrReg(4 + (a & 0x03), v);
        return;
      default:
        return;
    }
  }
}

class Mapper48 extends MapperTaitoTc0190Base {
  constructor(cartridge) {
    super(cartridge);
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.irqDelayCycles = 0;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  _irqDelayLength() {
    return this.submapper === 1 ? 6 : 22;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xe003) {
      case 0x8000:
        this._setPrgReg(0, v & 0x3f);
        return;
      case 0x8001:
        this._setPrgReg(1, v & 0x3f);
        return;
      case 0x8002:
        this._setChrPair(0, v);
        return;
      case 0x8003:
        this._setChrPair(1, v);
        return;
      case 0xa000:
      case 0xa001:
      case 0xa002:
      case 0xa003:
        this._setChrReg(4 + (a & 0x03), v);
        return;
      case 0xc000:
        this.irqPending = false;
        this.irqLatch = ((v ^ 0xff) + (this.submapper === 1 ? 1 : 0)) & 0xff;
        return;
      case 0xc001:
        this.irqPending = false;
        this.irqCounter = 0;
        this.irqReload = true;
        return;
      case 0xc002:
        this.irqEnabled = true;
        return;
      case 0xc003:
        this.irqEnabled = false;
        this.irqPending = false;
        return;
      case 0xe000:
        this.mirroringMode = (v & 0x40) ? 'horizontal' : 'vertical';
        return;
      default:
        return;
    }
  }

  onQualifiedA12Rise(_edge, _access) {
    const oldCounter = this.irqCounter & 0xff;
    const newCounter = (oldCounter === 0 || this.irqReload)
      ? (this.irqLatch & 0xff)
      : ((oldCounter - 1) & 0xff);
    this.irqCounter = newCounter;
    if (newCounter === 0 && this.irqEnabled) {
      this.irqDelayCycles = this._irqDelayLength();
    }
    this.irqReload = false;
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe) return;
    if (this.irqDelayCycles > 0) {
      this.irqDelayCycles -= 1;
      if (this.irqDelayCycles === 0) {
        this.irqPending = true;
      }
    }
  }
}

class Mapper32 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgRegs = new Uint8Array(2);
    this.chrRegs = new Uint8Array(8);
    this.prgRegs[0] = 0;
    this.prgRegs[1] = 1;
    this.prgMode = 0;
    this.mirroringMode = this.submapper === 1
      ? 'single1'
      : (cartridge.mirroring || 'vertical');
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  _mapPrgBank(slot) {
    const s = slot & 0x03;
    if (s === 3) return Math.max(0, this.prg8kBanks - 1);
    if (this.submapper === 1 || this.prgMode === 0) {
      if (s === 0) return normalizeModulo(this.prgRegs[0] & 0x1f, this.prg8kBanks);
      if (s === 1) return normalizeModulo(this.prgRegs[1] & 0x1f, this.prg8kBanks);
      return Math.max(0, this.prg8kBanks - 2);
    }
    if (s === 0) return Math.max(0, this.prg8kBanks - 2);
    if (s === 1) return normalizeModulo(this.prgRegs[1] & 0x1f, this.prg8kBanks);
    return normalizeModulo(this.prgRegs[0] & 0x1f, this.prg8kBanks);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrgBank(slot);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xf000) {
      case 0x8000:
        this.prgRegs[0] = v & 0x1f;
        return;
      case 0x9000:
        this.prgMode = this.submapper === 1 ? 0 : ((v >> 1) & 0x01);
        if (this.submapper !== 1) {
          this.mirroringMode = (v & 0x01) ? 'horizontal' : 'vertical';
        }
        return;
      case 0xa000:
        this.prgRegs[1] = v & 0x1f;
        return;
      case 0xb000:
        this.chrRegs[a & 0x07] = v;
        return;
      default:
        return;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper80 extends MapperCoreBaseCore {
  constructor(cartridge, alternateMirroring = false) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.chrRegs = new Uint8Array(8);
    this.prgRegs = new Uint8Array(3);
    this.altMirroring = !!alternateMirroring;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
    this.nametableBanks = new Uint8Array(4);
    this.ramPermission = 0;
    this.ram = new Uint8Array(0x80);
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  _ramIndex(addr) {
    return (addr - 0x7f00) & 0x7f;
  }

  _setChrPair(pairIndex, value) {
    const base = (pairIndex & 0x01) << 1;
    this.chrRegs[base] = value & 0xff;
    this.chrRegs[base + 1] = (value + 1) & 0xff;
    if (!this.altMirroring) return;
    const table = (value >> 7) & 0x01;
    if (base === 0) {
      this.nametableBanks[0] = table;
      this.nametableBanks[1] = table;
      return;
    }
    this.nametableBanks[2] = table;
    this.nametableBanks[3] = table;
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    const table = (a >> 10) & 0x03;
    const offset = a & 0x03ff;
    if (this.altMirroring) {
      return ((this.nametableBanks[table] & 0x01) << 10) | offset;
    }
    if (this.mirroringMode === 'vertical') return ((table & 0x01) << 10) | offset;
    if (this.mirroringMode === 'horizontal') return (((table >> 1) & 0x01) << 10) | offset;
    if (this.mirroringMode === 'single1') return 0x400 | offset;
    return offset;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x7f00 && a <= 0x7fff) {
      if (this.ramPermission !== 0xa3) return openBus & 0xff;
      return this.ram[this._ramIndex(a)] & 0xff;
    }
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x7ef0 && a <= 0x7eff) {
      switch (a) {
        case 0x7ef0:
          this._setChrPair(0, v);
          return true;
        case 0x7ef1:
          this._setChrPair(1, v);
          return true;
        case 0x7ef2:
        case 0x7ef3:
        case 0x7ef4:
        case 0x7ef5:
          this.chrRegs[4 + (a - 0x7ef2)] = v;
          return true;
        case 0x7ef6:
        case 0x7ef7:
          if (!this.altMirroring) {
            this.mirroringMode = (v & 0x01) ? 'vertical' : 'horizontal';
          }
          return true;
        case 0x7ef8:
        case 0x7ef9:
          this.ramPermission = v;
          return true;
        case 0x7efa:
        case 0x7efb:
          this.prgRegs[0] = v;
          return true;
        case 0x7efc:
        case 0x7efd:
          this.prgRegs[1] = v;
          return true;
        case 0x7efe:
        case 0x7eff:
          this.prgRegs[2] = v;
          return true;
        default:
          return true;
      }
    }
    if (a >= 0x7f00 && a <= 0x7fff) {
      if (this.ramPermission === 0xa3) {
        this.ram[this._ramIndex(a)] = v;
      }
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = slot < 3
      ? normalizeModulo(this.prgRegs[slot] & 0xff, this.prg8kBanks)
      : Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(_addr, _value) {}

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper207 extends Mapper80 {
  constructor(cartridge) {
    super(cartridge, true);
  }
}

class Mapper82 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.chrRegs = new Uint8Array(6);
    this.prgRegs = new Uint8Array(3);
    this.modeControl = 0;
    this.ramEnable0 = 0;
    this.ramEnable1 = 0;
    this.ramEnable2 = 0;
    this.ram0 = new Uint8Array(0x800);
    this.ram1 = new Uint8Array(0x800);
    this.ram2 = new Uint8Array(0x400);
    this.irqLatch = 0;
    this.irqControl = 0;
    this.irqCounter = 17;
    this.irqPending = false;
  }

  _decodePrgReg(value) {
    return (value >> 2) & 0x0f;
  }

  _mirroringMode() {
    return (this.modeControl & 0x01) ? 'vertical' : 'horizontal';
  }

  _chrBankForSlot(slot) {
    const s = slot & 0x07;
    const invert = (this.modeControl & 0x02) !== 0;
    if (!invert) {
      if (s < 2) return (this.chrRegs[0] & 0xfe) + (s & 0x01);
      if (s < 4) return (this.chrRegs[1] & 0xfe) + (s & 0x01);
      return this.chrRegs[2 + (s - 4)] & 0xff;
    }
    if (s < 4) return this.chrRegs[2 + s] & 0xff;
    if (s < 6) return (this.chrRegs[0] & 0xfe) + (s & 0x01);
    return (this.chrRegs[1] & 0xfe) + (s & 0x01);
  }

  _ramEnabledForAddr(addr) {
    if (addr >= 0x6000 && addr <= 0x67ff) return this.ramEnable0 === 0xca;
    if (addr >= 0x6800 && addr <= 0x6fff) return this.ramEnable1 === 0x69;
    if (addr >= 0x7000 && addr <= 0x73ff) return this.ramEnable2 === 0x84;
    return false;
  }

  _reloadForDisable() {
    if ((this.irqLatch & 0xff) === 0) return 17;
    return (((this.irqLatch & 0xff) + 2) << 4) >>> 0;
  }

  _reloadForAcknowledge() {
    if ((this.irqLatch & 0xff) === 0) return 1;
    return (((this.irqLatch & 0xff) + 1) << 4) >>> 0;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this._mirroringMode() || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x67ff) {
      if (!this._ramEnabledForAddr(a)) return 0;
      return this.ram0[a & 0x07ff] & 0xff;
    }
    if (a >= 0x6800 && a <= 0x6fff) {
      if (!this._ramEnabledForAddr(a)) return 0;
      return this.ram1[a & 0x07ff] & 0xff;
    }
    if (a >= 0x7000 && a <= 0x73ff) {
      if (!this._ramEnabledForAddr(a)) return 0;
      return this.ram2[a & 0x03ff] & 0xff;
    }
    return openBus & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x67ff) {
      if (this._ramEnabledForAddr(a)) this.ram0[a & 0x07ff] = v;
      return true;
    }
    if (a >= 0x6800 && a <= 0x6fff) {
      if (this._ramEnabledForAddr(a)) this.ram1[a & 0x07ff] = v;
      return true;
    }
    if (a >= 0x7000 && a <= 0x73ff) {
      if (this._ramEnabledForAddr(a)) this.ram2[a & 0x03ff] = v;
      return true;
    }
    if (a < 0x7ef0 || a > 0x7fff) return false;
    switch (a & 0x000f) {
      case 0x00: this.chrRegs[0] = v; return true;
      case 0x01: this.chrRegs[1] = v; return true;
      case 0x02: this.chrRegs[2] = v; return true;
      case 0x03: this.chrRegs[3] = v; return true;
      case 0x04: this.chrRegs[4] = v; return true;
      case 0x05: this.chrRegs[5] = v; return true;
      case 0x06:
        this.modeControl = v;
        return true;
      case 0x07:
        this.ramEnable0 = v;
        return true;
      case 0x08:
        this.ramEnable1 = v;
        return true;
      case 0x09:
        this.ramEnable2 = v;
        return true;
      case 0x0a:
        this.prgRegs[0] = this._decodePrgReg(v);
        return true;
      case 0x0b:
        this.prgRegs[1] = this._decodePrgReg(v);
        return true;
      case 0x0c:
        this.prgRegs[2] = this._decodePrgReg(v);
        return true;
      case 0x0d:
        this.irqLatch = v & 0xff;
        return true;
      case 0x0e:
        this.irqControl = v & 0x07;
        if ((this.irqControl & 0x02) === 0 || (this.irqControl & 0x01) !== 0) {
          this.irqCounter = this._reloadForDisable();
        }
        this.irqPending = false;
        return true;
      case 0x0f:
        this.irqPending = false;
        this.irqCounter = this._reloadForAcknowledge();
        return true;
      default:
        return true;
    }
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xa000) bank = normalizeModulo(this.prgRegs[0], this.prg8kBanks);
    else if (a < 0xc000) bank = normalizeModulo(this.prgRegs[1], this.prg8kBanks);
    else if (a < 0xe000) bank = normalizeModulo(this.prgRegs[2], this.prg8kBanks);
    else bank = Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    void addr;
    void value;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this._chrBankForSlot(slot), this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this._chrBankForSlot(slot), this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe) return;
    const countingEnabled = (this.irqControl & 0x02) !== 0;
    const mustBeZero = (this.irqControl & 0x01) === 0;
    if (!countingEnabled || !mustBeZero) return;
    if (this.irqCounter > 0) this.irqCounter -= 1;
    if (this.irqCounter === 0 && (this.irqControl & 0x04) !== 0) {
      this.irqPending = true;
    }
  }
}

class Mapper83 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.mapperId = cartridge.mapper | 0;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.mode = 0;
    this.bankReg = 0;
    this.prgRegs = new Uint8Array(4);
    this.chrRegs = new Uint8Array(8);
    this.ram4 = new Uint8Array(4);
    this.wram = new Uint8Array(0x2000 * 4);
    this.irqCounter = 0;
    this.irqEnabled = false;
    this.irqPending = false;
    this.dipSwitch = (cartridge && typeof cartridge.dipSwitch === 'number')
      ? (cartridge.dipSwitch & 0x03)
      : 0;
  }

  _isSubmapper2() {
    return this.submapper === 2;
  }

  _prgOuter8kBase() {
    if (!this._isSubmapper2()) return 0;
    return ((this.bankReg >> 4) & 0x03) << 5;
  }

  _chrOuter1kBase() {
    if (!this._isSubmapper2()) return 0;
    return ((this.bankReg >> 4) & 0x03) << 8;
  }

  _wramBank() {
    return (this.bankReg >> 6) & 0x03;
  }

  _prgMode() {
    return (this.mode >> 2) & 0x07;
  }

  _mirroring() {
    switch (this.mode & 0x03) {
      case 0: return 'vertical';
      case 1: return 'horizontal';
      case 2: return 'single0';
      case 3: return 'single1';
      default: return 'vertical';
    }
  }

  _mapPrg8k(slot) {
    const s = slot & 0x03;
    const mode = this._prgMode();
    const outer = this._prgOuter8kBase();
    if (mode === 0) {
      const bank16 = this.bankReg & 0x0f;
      if (s < 2) return normalizeModulo(outer + (bank16 << 1) + s, this.prg8kBanks);
      return Math.max(0, this.prg8kBanks - 2 + (s - 2));
    }
    if (mode === 1) {
      const bank32 = (this.bankReg >> 1) & 0x0f;
      return normalizeModulo(outer + (bank32 << 2) + s, this.prg8kBanks);
    }
    if (s === 0) return normalizeModulo(outer + (this.prgRegs[0] & 0xff), this.prg8kBanks);
    if (s === 1) return normalizeModulo(outer + (this.prgRegs[1] & 0xff), this.prg8kBanks);
    if (s === 2) return normalizeModulo(outer + (this.prgRegs[2] & 0xff), this.prg8kBanks);
    return Math.max(0, this.prg8kBanks - 1);
  }

  _mapChr1k(slot) {
    const s = slot & 0x07;
    const outer = this._chrOuter1kBase();
    if (this.submapper === 1) {
      if (s < 2) return normalizeModulo(outer + ((this.chrRegs[0] & 0xfe) + (s & 0x01)), this.chr1kBanks);
      if (s < 4) return normalizeModulo(outer + ((this.chrRegs[1] & 0xfe) + (s & 0x01)), this.chr1kBanks);
      if (s < 6) return normalizeModulo(outer + ((this.chrRegs[6] & 0xfe) + (s & 0x01)), this.chr1kBanks);
      return normalizeModulo(outer + ((this.chrRegs[7] & 0xfe) + (s & 0x01)), this.chr1kBanks);
    }
    return normalizeModulo(outer + (this.chrRegs[s] & 0xff), this.chr1kBanks);
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this._mirroring() || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a === 0x5000) return this.dipSwitch & 0x03;
    if (a >= 0x5100 && a <= 0x5fff) return this.ram4[a & 0x03] & 0xff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (this._isSubmapper2()) {
        const bank = normalizeModulo(this._wramBank(), 4);
        const off = (bank << 13) + (a & 0x1fff);
        return this.wram[off % this.wram.length] & 0xff;
      }
      if ((this.mode & 0x20) !== 0) {
        const bank = normalizeModulo(this.prgRegs[3] & 0xff, this.prg8kBanks);
        const off = (bank << 13) + (a & 0x1fff);
        return this.prg[off % this.prg.length] & 0xff;
      }
      return openBus & 0xff;
    }
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x5100 && a <= 0x5fff) {
      this.ram4[a & 0x03] = v;
      return true;
    }
    if (a >= 0x6000 && a <= 0x7fff && this._isSubmapper2()) {
      const bank = normalizeModulo(this._wramBank(), 4);
      const off = (bank << 13) + (a & 0x1fff);
      this.wram[off % this.wram.length] = v;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrg8k(slot);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if ((a & 0x83fc) === 0x8300) {
      this.prgRegs[a & 0x03] = v;
      return;
    }
    if ((a & 0x83f8) === 0x8310) {
      this.chrRegs[a & 0x07] = v;
      return;
    }
    if ((a & 0x8300) === 0x8000) {
      this.bankReg = v;
      return;
    }
    if ((a & 0x8300) === 0x8100) {
      this.mode = v;
      return;
    }
    if ((a & 0x8301) === 0x8200) {
      this.irqCounter = (this.irqCounter & 0xff00) | v;
      this.irqPending = false;
      return;
    }
    if ((a & 0x8301) === 0x8201) {
      this.irqCounter = (this.irqCounter & 0x00ff) | ((v << 8) & 0xff00);
      this.irqEnabled = (this.mode & 0x80) !== 0;
      this.irqPending = false;
      return;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = this._mapChr1k(slot);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = this._mapChr1k(slot);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    const counter = this.irqCounter & 0xffff;
    if (counter === 0) return;
    const decrement = (this.mode & 0x40) !== 0;
    const next = decrement ? ((counter - 1) & 0xffff) : ((counter + 1) & 0xffff);
    this.irqCounter = next;
    if (next === 0) {
      this.irqPending = true;
      this.irqEnabled = false;
    }
  }
}

class Mapper91 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgRegs = new Uint8Array(2);
    this.chrRegs = new Uint8Array(4);
    this.outerPrg = 0;
    this.outerChr = 0;
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqEnabled = false;
    this.irqPending = false;
    this.irqCounter = 0;
    this.irqDiv4 = 0;
    this.a12Last = 0;
    this.a12Count = 0;
  }

  _isSubmapper0() {
    return this.submapper === 0;
  }

  _isSubmapper1() {
    return this.submapper === 1;
  }

  _composePrg8k(inner) {
    let bank = inner & 0xff;
    if (this._isSubmapper0()) {
      bank += (this.outerPrg & 0x03) << 4;
    }
    return normalizeModulo(bank, this.prg8kBanks);
  }

  _composeChr1k(slot) {
    const s = slot & 0x07;
    const reg2k = this.chrRegs[(s >> 1) & 0x03] & 0xff;
    let bank2k = reg2k;
    if (this._isSubmapper0()) {
      bank2k += (this.outerChr & 0x01) << 8;
    }
    return normalizeModulo((bank2k << 1) + (s & 0x01), this.chr1kBanks);
  }

  _counterToRegisters() {
    this.irqCounter &= 0xffff;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xa000) bank = this._composePrg8k(this.prgRegs[0]);
    else if (a < 0xc000) bank = this._composePrg8k(this.prgRegs[1]);
    else if (a < 0xe000) bank = Math.max(0, this.prg8kBanks - 2);
    else bank = Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x6003) {
      this.chrRegs[a & 0x03] = v;
      return true;
    }
    if (a === 0x6004 && this._isSubmapper1()) {
      this.mirroringMode = 'horizontal';
      return true;
    }
    if (a === 0x6005 && this._isSubmapper1()) {
      this.mirroringMode = 'vertical';
      return true;
    }
    if (a === 0x6006 && this._isSubmapper1()) {
      this.irqCounter = (this.irqCounter & 0xff00) | v;
      this.irqPending = false;
      return true;
    }
    if (a === 0x6007 && this._isSubmapper1()) {
      this.irqCounter = (this.irqCounter & 0x00ff) | ((v << 8) & 0xff00);
      this.irqPending = false;
      return true;
    }
    if (a === 0x7000) {
      this.prgRegs[0] = v;
      return true;
    }
    if (a === 0x7001) {
      this.prgRegs[1] = v;
      return true;
    }
    if (a === 0x7006) {
      this.irqEnabled = false;
      this.irqPending = false;
      return true;
    }
    if (a === 0x7007) {
      this.irqEnabled = true;
      this.irqPending = false;
      this.irqDiv4 = 0;
      this.a12Count = 0;
      return true;
    }
    return false;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    if (this._isSubmapper0() && a >= 0x8000 && a <= 0x9fff) {
      const bits = a & 0x07;
      this.outerChr = bits & 0x01;
      this.outerPrg = (bits >> 1) & 0x03;
      return;
    }
    if (a >= 0xa000 && a <= 0xbfff) {
      this.prgRegs[((a >> 12) & 0x01)] = v;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = this._composeChr1k(slot);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = this._composeChr1k(slot);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onPpuAddressBus(access) {
    if (!this._isSubmapper0()) return;
    const a = access && typeof access.busAddr === 'number'
      ? (access.busAddr & 0x3fff)
      : ((access && typeof access.addr === 'number') ? (access.addr & 0x3fff) : 0);
    const a12 = (a & 0x1000) ? 1 : 0;
    if (!this.a12Last && a12 && this.irqEnabled) {
      this.a12Count += 1;
      if (this.a12Count >= 64) {
        this.irqPending = true;
        this.irqEnabled = false;
      }
    }
    this.a12Last = a12;
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this._isSubmapper1() || !this.irqEnabled) return;
    this.irqDiv4 = (this.irqDiv4 + 1) & 0x03;
    if (this.irqDiv4 !== 0) return;
    if (this.irqCounter <= 5) {
      this.irqCounter = 0;
      this.irqPending = true;
      this.irqEnabled = false;
      return;
    }
    this.irqCounter = (this.irqCounter - 5) & 0xffff;
    this._counterToRegisters();
  }
}

class Mapper94 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.selectedBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.selectedBank, this.prg16kBanks);
      const off = (bank * 0x4000) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    this.selectedBank = (value >> 2) & 0x07;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper180 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.selectedBank = Math.max(0, this.prg16kBanks - 1);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const off = a & 0x3fff;
      return this.prg[off % this.prg.length] & 0xff;
    }
    const bank = normalizeModulo(this.selectedBank, this.prg16kBanks);
    const off = (bank * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    this.selectedBank = value & 0x07;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper185 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.chrEnabled = true;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (this.prg.length === 0x4000) {
      return this.prg[(a - 0x8000) & 0x3fff] & 0xff;
    }
    return this.prg[(a - 0x8000) % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    // CNROM boards are bus-conflict prone: data is ANDed with currently visible PRG-ROM byte.
    const v = (value & 0xff) & (this.cpuRead(a) & 0xff);
    // Mapper 185 (CNROM with protection diode variants):
    // submapper 0: heuristic enable
    // submapper 4..7: enable based on low 2 bits.
    if (this.submapper === 4) this.chrEnabled = (v & 0x03) === 0;
    else if (this.submapper === 5) this.chrEnabled = (v & 0x03) === 1;
    else if (this.submapper === 6) this.chrEnabled = (v & 0x03) === 2;
    else if (this.submapper === 7) this.chrEnabled = (v & 0x03) === 3;
    else this.chrEnabled = ((v & 0x0f) !== 0) && v !== 0x13;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const off = (a & 0x1fff) % this.chr.length;
    const value = this.chr[off] & 0xff;
    if (this.chrEnabled || this.cartridge.chrBanks === 0) return value;
    // When CHR is disabled, model pull-up on D0.
    return 0x01;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper206 extends MapperCore4Core {
  constructor(cartridge, options = null) {
    const opts = options ? { ...options } : {};
    opts.irqSupport = false;
    super(cartridge, opts);
    this.mapper206Submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    // iNES 206 (Namco 108 / MIMIC-1) has no WRAM support.
    this.prgRamEnable = false;
    this.prgRamWriteProtect = true;
    this.irqEnabled = false;
    this.irqPending = false;
    this.irqReload = false;
    this._recomputeBankMaps();
  }

  reset() {
    super.reset();
    this.prgRamEnable = false;
    this.prgRamWriteProtect = true;
    this.irqEnabled = false;
    this.irqPending = false;
    this.irqReload = false;
    this._recomputeBankMaps();
  }

  isIrqAsserted() {
    return false;
  }

  getMirroringMode(defaultMode) {
    return this.cartridge.mirroring || defaultMode || 'horizontal';
  }

  cpuReadLow(_addr, openBus) {
    return openBus & 0xff;
  }

  cpuWriteLow(_addr, _value) {
    return false;
  }

  _recomputePrgSlots() {
    // 206 keeps the top two 8K banks fixed and only banks $8000/$A000.
    const last = Math.max(0, this.prgBankCount8k - 1);
    const secondLast = Math.max(0, this.prgBankCount8k - 2);
    if (this.mapper206Submapper === 1 && this.prgBankCount8k >= 4) {
      // NES 2.0 submapper 1: Namcot 3407/3417/3451, no PRG banking.
      this.prgSlots[0] = this._normalizePrgBank(0);
      this.prgSlots[1] = this._normalizePrgBank(1);
      this.prgSlots[2] = this._normalizePrgBank(2);
      this.prgSlots[3] = this._normalizePrgBank(3);
    } else {
      const bank6 = this._normalizePrgBank(this.bankRegs[6] & 0x0f);
      const bank7 = this._normalizePrgBank(this.bankRegs[7] & 0x0f);
      this.prgSlots[0] = bank6;
      this.prgSlots[1] = bank7;
      this.prgSlots[2] = secondLast;
      this.prgSlots[3] = last;
    }
    this.prgSlotOffsets[0] = this.prgSlots[0] << 13;
    this.prgSlotOffsets[1] = this.prgSlots[1] << 13;
    this.prgSlotOffsets[2] = this.prgSlots[2] << 13;
    this.prgSlotOffsets[3] = this.prgSlots[3] << 13;
  }

  _recomputeChrSlots() {
    // 206 has fixed CHR arrangement (no chrMode bit):
    // $0000-$0FFF = two 2K banks, $1000-$1FFF = four 1K banks.
    const r0 = this.bankRegs[0] & 0x3e;
    const r1 = this.bankRegs[1] & 0x3e;
    const r2 = this.bankRegs[2] & 0x3f;
    const r3 = this.bankRegs[3] & 0x3f;
    const r4 = this.bankRegs[4] & 0x3f;
    const r5 = this.bankRegs[5] & 0x3f;
    this.chrSlots[0] = this._normalizeChrBank(r0);
    this.chrSlots[1] = this._normalizeChrBank(r0 + 1);
    this.chrSlots[2] = this._normalizeChrBank(r1);
    this.chrSlots[3] = this._normalizeChrBank(r1 + 1);
    this.chrSlots[4] = this._normalizeChrBank(r2);
    this.chrSlots[5] = this._normalizeChrBank(r3);
    this.chrSlots[6] = this._normalizeChrBank(r4);
    this.chrSlots[7] = this._normalizeChrBank(r5);
    this.chrSlotOffsets[0] = this.chrSlots[0] << 10;
    this.chrSlotOffsets[1] = this.chrSlots[1] << 10;
    this.chrSlotOffsets[2] = this.chrSlots[2] << 10;
    this.chrSlotOffsets[3] = this.chrSlots[3] << 10;
    this.chrSlotOffsets[4] = this.chrSlots[4] << 10;
    this.chrSlotOffsets[5] = this.chrSlots[5] << 10;
    this.chrSlotOffsets[6] = this.chrSlots[6] << 10;
    this.chrSlotOffsets[7] = this.chrSlots[7] << 10;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    // 206 only decodes bank select/data in $8000-$9FFF.
    switch (a & 0xe001) {
      case 0x8000:
        this.bankSelect = v & 0x07;
        break;
      case 0x8001:
        {
          const reg = this.bankSelect & 0x07;
          let next = v & 0xff;
          if (reg <= 1) next &= 0x3e; // 2K CHR bank bits 5..1.
          else if (reg <= 5) next &= 0x3f; // 1K CHR bank bits 5..0.
          else next &= 0x0f; // PRG bank bits 3..0.
          if (this.bankRegs[reg] === next) return;
          this.bankRegs[reg] = next;
          if (reg <= 5) this._recomputeChrSlots();
          else this._recomputePrgSlots();
        }
        break;
      default:
        // No mirroring/WRAM/IRQ registers at $A000-$FFFF on mapper 206.
        break;
    }
  }

  onPpuAddressBusPattern(_addr, _dotClock) {}

  onQualifiedA12Rise(_edge, _access) {}

  onCpuPhaseTick(_phase) {}
}

class Mapper16 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.mapperId = (typeof cartridge.mapper === 'number' ? cartridge.mapper : 16) | 0;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg16kBanks = Math.max(1, (this.prg.length / 0x4000) | 0);
    this.chr1kBanks = Math.max(1, (this.chr.length / 0x0400) | 0);
    this.outerPrgBank = 0;
    this.mapper153Ram = new Uint8Array(0x2000);
    this.mapper153Ram.fill(0xff);
    this.mapper153RamEnabled = true;
    this.prgPage = 0;
    this.chrRegs = new Uint8Array(8);
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqEnabled = false;
    this.irqCounter = 0;
    this.irqReload = 0;
    this.irqPending = false;
    // 24C0x data out defaults to high when idle.
    this.eepromDataOut = 1;
    this.eepromScl = 1;
    this.eepromSda = 1;
    // X24C02 I2C slave state machine (submapper 5 / LZ93D50 + 24C02).
    // Modes: 0=Idle 1=ChipAddr 2=Address 3=Read 4=Write 5=SendAck 6=WaitAck
    this._eepromMode = 0;
    this._eepromNextMode = 0;
    this._eepromChipAddress = 0;
    this._eepromAddress = 0;
    this._eepromData = 0;
    this._eepromCounter = 0;
    this._eepromOutput = 1;
    this._eepromPrevScl = 0;
    this._eepromPrevSda = 0;
    this._eepromRom = new Uint8Array(256);
    this._eepromRom.fill(0xff);
    const saved = cartridge && cartridge.battery && cartridge.prgRam ? cartridge.prgRam : null;
    if (saved && saved.length >= 256) {
      for (let i = 0; i < 256; i++) this._eepromRom[i] = saved[i] & 0xff;
    }
    if (this.mapperId === 157 || this.mapperId === 159) {
      // X24C01-based paths start with SDA output low until driven by bus sequence.
      this.eepromDataOut = 0;
      this._eepromOutput = 0;
    }
    if (this._isMapper153() && cartridge && cartridge.prgRam && cartridge.prgRam.length > 0) {
      const copyLen = Math.min(this.mapper153Ram.length, cartridge.prgRam.length);
      for (let i = 0; i < copyLen; i++) this.mapper153Ram[i] = cartridge.prgRam[i] & 0xff;
    }
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  _isSubmapper4() {
    return this.submapper === 4;
  }

  _isMapper153() {
    return this.mapperId === 153;
  }

  _canWriteLow() {
    if (this._isMapper153()) return false;
    return this.submapper !== 5;
  }

  _canWriteHigh() {
    if (this._isMapper153()) return true;
    return this.submapper !== 4;
  }

  _writeRegister(addr, value) {
    const reg = addr & 0x000f;
    const v = value & 0xff;
    if (reg <= 0x07) {
      if (this._isMapper153()) {
        // Mapper153: regs 0-7 update outer PRG select via bit0 aggregation.
        this.chrRegs[reg & 0x07] = v;
        let prgSel = 0;
        for (let i = 0; i < 8; i++) prgSel |= (this.chrRegs[i] & 0x01);
        this.outerPrgBank = prgSel & 0x01;
        return;
      }
      this.chrRegs[reg & 0x07] = v;
      return;
    }
    if (reg === 0x08) {
      this.prgPage = v & 0x0f;
      return;
    }
    if (reg === 0x09) {
      switch (v & 0x03) {
        case 0: this.mirroringMode = 'vertical'; break;
        case 1: this.mirroringMode = 'horizontal'; break;
        case 2: this.mirroringMode = 'single0'; break;
        case 3: this.mirroringMode = 'single1'; break;
        default: break;
      }
      return;
    }
    if (reg === 0x0a) {
      this.irqEnabled = (v & 0x01) !== 0;
      if (!this._isSubmapper4()) {
        this.irqCounter = this.irqReload & 0xffff;
      }
      this.irqPending = false;
      if (this.irqEnabled && ((this.irqCounter & 0xffff) === 0)) {
        this.irqPending = true;
      }
      return;
    }
    if (reg === 0x0b) {
      if (this._isSubmapper4()) {
        this.irqCounter = ((this.irqCounter & 0xff00) | v) & 0xffff;
      } else {
        this.irqReload = ((this.irqReload & 0xff00) | v) & 0xffff;
      }
      return;
    }
    if (reg === 0x0c) {
      if (this._isSubmapper4()) {
        this.irqCounter = ((this.irqCounter & 0x00ff) | ((v << 8) & 0xff00)) & 0xffff;
      } else {
        this.irqReload = ((this.irqReload & 0x00ff) | ((v << 8) & 0xff00)) & 0xffff;
      }
      return;
    }
    if (reg === 0x0d) {
      if (this._isMapper153()) {
        this.mapper153RamEnabled = (v & 0x20) !== 0;
        return;
      }
      const scl = (v >> 5) & 0x01;
      const sda = (v >> 6) & 0x01;
      this.eepromScl = scl;
      this.eepromSda = sda;
      if (this.submapper === 5 || this.submapper === 4 || this._isMapper153()) {
        this._eepromTick(scl, sda);
      }
    }
  }

  _eepromWriteBit(getDest, setDest, value) {
    if (this._eepromCounter < 8) {
      const shift = 7 - this._eepromCounter;
      const mask = ~(1 << shift) & 0xff;
      setDest((getDest() & mask) | ((value & 1) << shift));
      this._eepromCounter++;
    }
  }

  _eepromReadBit() {
    if (this._eepromCounter < 8) {
      const shift = 7 - this._eepromCounter;
      this._eepromOutput = (this._eepromData & (1 << shift)) ? 1 : 0;
      this._eepromCounter++;
    }
  }

  _eepromTick(scl, sda) {
    if (this.mapperId === 159) {
      this._eepromTick24C01(scl, sda);
      return;
    }
    const prevScl = this._eepromPrevScl;
    const prevSda = this._eepromPrevSda;

    // START: SDA high->low while SCL stable high.
    if (prevScl && scl && sda < prevSda) {
      this._eepromMode = 1; // ChipAddress
      this._eepromCounter = 0;
      this._eepromOutput = 1;
    } else if (prevScl && scl && sda > prevSda) {
      // STOP: SDA low->high while SCL stable high.
      this._eepromMode = 0; // Idle
      this._eepromOutput = 1;
    } else if (scl > prevScl) {
      // Rising edge of SCL — sample/shift a bit for the active mode.
      switch (this._eepromMode) {
        case 1: // ChipAddress
          this._eepromWriteBit(
            () => this._eepromChipAddress,
            (x) => { this._eepromChipAddress = x & 0xff; },
            sda,
          );
          break;
        case 2: // Address
          this._eepromWriteBit(
            () => this._eepromAddress,
            (x) => { this._eepromAddress = x & 0xff; },
            sda,
          );
          break;
        case 3: // Read
          this._eepromReadBit();
          break;
        case 4: // Write
          this._eepromWriteBit(
            () => this._eepromData,
            (x) => { this._eepromData = x & 0xff; },
            sda,
          );
          break;
        case 5: // SendAck
          this._eepromOutput = 0;
          break;
        case 6: // WaitAck — master ACKs read byte, continue sequential read.
          if (!sda) {
            this._eepromNextMode = 3;
            this._eepromData = this._eepromRom[this._eepromAddress & 0xff] & 0xff;
          }
          break;
        default: break;
      }
    } else if (scl < prevScl) {
      // Falling edge of SCL — transition modes at byte boundaries.
      switch (this._eepromMode) {
        case 1: // ChipAddress complete?
          if (this._eepromCounter === 8) {
            if ((this._eepromChipAddress & 0xa0) === 0xa0) {
              this._eepromMode = 5; // SendAck
              this._eepromCounter = 0;
              this._eepromOutput = 1;
              if (this._eepromChipAddress & 0x01) {
                // Current-Address Read: ACK then transmit data byte.
                this._eepromNextMode = 3;
                this._eepromData = this._eepromRom[this._eepromAddress & 0xff] & 0xff;
              } else {
                // Write: next accept memory address byte.
                this._eepromNextMode = 2;
              }
            } else {
              // Not selected.
              this._eepromMode = 0;
              this._eepromCounter = 0;
              this._eepromOutput = 1;
            }
          }
          break;
        case 2: // Address byte received
          if (this._eepromCounter === 8) {
            this._eepromCounter = 0;
            this._eepromMode = 5; // SendAck
            this._eepromNextMode = 4; // then Write
            this._eepromOutput = 1;
          }
          break;
        case 3: // Finished sending 8 read bits, wait for master ACK.
          if (this._eepromCounter === 8) {
            this._eepromMode = 6; // WaitAck
            this._eepromAddress = (this._eepromAddress + 1) & 0xff;
          }
          break;
        case 4: // Received data byte to store.
          if (this._eepromCounter === 8) {
            this._eepromCounter = 0;
            this._eepromMode = 5; // SendAck
            this._eepromNextMode = 4; // keep accepting writes
            this._eepromRom[this._eepromAddress & 0xff] = this._eepromData & 0xff;
            this._eepromAddress = (this._eepromAddress + 1) & 0xff;
          }
          break;
        case 5: // Finish SendAck
        case 6: // Finish WaitAck
          this._eepromMode = this._eepromNextMode;
          this._eepromCounter = 0;
          this._eepromOutput = 1;
          break;
        default: break;
      }
    }

    this._eepromPrevScl = scl & 1;
    this._eepromPrevSda = sda & 1;
    this.eepromDataOut = this._eepromOutput & 1;
  }

  _eepromTick24C01(scl, sda) {
    const prevScl = this._eepromPrevScl & 1;
    const prevSda = this._eepromPrevSda & 1;
    const nextScl = scl & 1;
    const nextSda = sda & 1;

    // START
    if (prevScl && nextScl && nextSda < prevSda) {
      this._eepromMode = 2; // Address
      this._eepromAddress = 0;
      this._eepromCounter = 0;
      this._eepromOutput = 1;
    } else if (prevScl && nextScl && nextSda > prevSda) {
      // STOP
      this._eepromMode = 0; // Idle
      this._eepromOutput = 1;
    } else if (nextScl > prevScl) {
      // Rising edge
      switch (this._eepromMode) {
        case 2: { // Address
          if (this._eepromCounter < 7) {
            const bit = this._eepromCounter & 7;
            const mask = ~(1 << bit) & 0xff;
            this._eepromAddress = (this._eepromAddress & mask) | (nextSda << bit);
            this._eepromCounter += 1;
          } else if (this._eepromCounter === 7) {
            this._eepromCounter = 8;
            if (nextSda) {
              this._eepromNextMode = 3; // Read
              this._eepromData = this._eepromRom[this._eepromAddress & 0x7f] & 0xff;
            } else {
              this._eepromNextMode = 4; // Write
            }
          }
          break;
        }
        case 5: // SendAck
          this._eepromOutput = 0;
          break;
        case 3: { // Read
          if (this._eepromCounter < 8) {
            const bit = this._eepromCounter & 7;
            this._eepromOutput = (this._eepromData & (1 << bit)) ? 1 : 0;
            this._eepromCounter += 1;
          }
          break;
        }
        case 4: { // Write
          if (this._eepromCounter < 8) {
            const bit = this._eepromCounter & 7;
            const mask = ~(1 << bit) & 0xff;
            this._eepromData = (this._eepromData & mask) | (nextSda << bit);
            this._eepromCounter += 1;
          }
          break;
        }
        case 6: // WaitAck
          if (!nextSda) {
            this._eepromNextMode = 0; // Idle
          }
          break;
        default:
          break;
      }
    } else if (nextScl < prevScl) {
      // Falling edge
      switch (this._eepromMode) {
        case 2: // Address
          if (this._eepromCounter === 8) {
            this._eepromMode = 5; // SendAck
            this._eepromOutput = 1;
          }
          break;
        case 5: // SendAck
          this._eepromMode = this._eepromNextMode;
          this._eepromCounter = 0;
          this._eepromOutput = 1;
          break;
        case 3: // Read
          if (this._eepromCounter === 8) {
            this._eepromMode = 6; // WaitAck
            this._eepromAddress = (this._eepromAddress + 1) & 0x7f;
          }
          break;
        case 4: // Write
          if (this._eepromCounter === 8) {
            this._eepromMode = 5; // SendAck
            this._eepromNextMode = 0; // Idle
            this._eepromRom[this._eepromAddress & 0x7f] = this._eepromData & 0xff;
            this._eepromAddress = (this._eepromAddress + 1) & 0x7f;
          }
          break;
        default:
          break;
      }
    }

    this._eepromPrevScl = nextScl;
    this._eepromPrevSda = nextSda;
    this.eepromDataOut = this._eepromOutput & 1;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return null;
    if (this._isMapper153()) {
      if (!this.mapper153RamEnabled) return openBus & 0xff;
      return this.mapper153Ram[a & 0x1fff] & 0xff;
    }
    if (this.submapper === 4) {
      // FCG-1/2 (submapper 4) has no serial EEPROM data output on reads.
      return openBus & 0xff;
    }
    const bus = openBus & 0xff;
    const sdaOut = this.submapper === 5 ? this._eepromOutput : this.eepromDataOut;
    const eepromBit = (sdaOut & 0x01) << 4;
    return (bus & 0xef) | eepromBit;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return;
    if (this._isMapper153()) {
      if (this.mapper153RamEnabled) {
        this.mapper153Ram[a & 0x1fff] = value & 0xff;
      }
      return;
    }
    if (!this._canWriteLow()) return;
    this._writeRegister(a, value & 0xff);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (this._isMapper153()) {
      const inner = (a < 0xc000) ? (this.prgPage & 0x0f) : 0x0f;
      const bank16k = ((this.outerPrgBank & 0x01) << 4) | inner;
      const bank = normalizeModulo(bank16k, this.prg16kBanks);
      const off = (bank * 0x4000) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    let bank = 0;
    if (a < 0xc000) {
      bank = normalizeModulo(this.prgPage, this.prg16kBanks);
    } else {
      bank = Math.max(0, this.prg16kBanks - 1);
    }
    const off = (bank * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    if (!this._canWriteHigh()) return;
    this._writeRegister(a, value & 0xff);
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    if (this._isMapper153()) {
      // MiSTer mapper153 uses fixed 8KB CHR window.
      return this.chr[a & 0x1fff] & 0xff;
    }
    if (this.cartridge.chrBanks === 0) {
      return this.chr[a & 0x1fff] & 0xff;
    }
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot], this.chr1kBanks);
    const off = (bank * 0x0400) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (this._isMapper153()) {
      if (a < 0x2000 && this.cartridge.chrBanks === 0) {
        this.chr[a & 0x1fff] = value & 0xff;
      }
      return;
    }
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    const counter = this.irqCounter & 0xffff;
    if (counter === 0) {
      this.irqPending = true;
      return;
    }
    this.irqCounter = (counter - 1) & 0xffff;
  }
}

class Mapper118 extends MapperCore4Core {
  constructor(cartridge, options = null) {
    super(cartridge, options || null);
    this.nametableBanks = new Uint8Array(4);
    this._recomputeNametableBanks();
  }

  reset() {
    super.reset();
    if (!this.nametableBanks || this.nametableBanks.length !== 4) {
      this.nametableBanks = new Uint8Array(4);
    }
    this._recomputeNametableBanks();
  }

  _recomputeNametableBanks() {
    if ((this.chrMode & 0x01) === 0) {
      const nt01 = (this.bankRegs[0] >> 7) & 0x01;
      const nt23 = (this.bankRegs[1] >> 7) & 0x01;
      this.nametableBanks[0] = nt01;
      this.nametableBanks[1] = nt01;
      this.nametableBanks[2] = nt23;
      this.nametableBanks[3] = nt23;
      return;
    }
    this.nametableBanks[0] = (this.bankRegs[2] >> 7) & 0x01;
    this.nametableBanks[1] = (this.bankRegs[3] >> 7) & 0x01;
    this.nametableBanks[2] = (this.bankRegs[4] >> 7) & 0x01;
    this.nametableBanks[3] = (this.bankRegs[5] >> 7) & 0x01;
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    const table = (a >> 10) & 0x03;
    const offset = a & 0x03ff;
    const ciramTable = this.nametableBanks[table] & 0x01;
    return (ciramTable << 10) | offset;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x8000) return;
    const reg = a & 0xe001;
    if (reg === 0xa000) {
      // TxSROM ignores MMC3 mirroring writes at $A000.
      return;
    }
    super.cpuWrite(a, value & 0xff);
    if (reg === 0x8000 || reg === 0x8001) {
      this._recomputeNametableBanks();
    }
  }
}

class Mapper119 extends MapperCore4Core {
  constructor(cartridge, options = null) {
    super(cartridge, options || null);
    this.chrRom = cartridge.chrRom;
    this.chrRomBankCount1k = Math.max(1, this.chrRom.length >> 10);
    this.chrRam = new Uint8Array(0x2000);
    if (cartridge.chrBanks === 0 && cartridge.chrRom && cartridge.chrRom.length > 0) {
      this.chrRam.set(cartridge.chrRom.subarray(0, Math.min(this.chrRam.length, cartridge.chrRom.length)));
    }
  }

  _mapChrBankRaw(addr) {
    const a = addr & 0x1fff;
    const r0 = this.bankRegs[0] & 0xfe;
    const r1 = this.bankRegs[1] & 0xfe;
    const r2 = this.bankRegs[2] & 0xff;
    const r3 = this.bankRegs[3] & 0xff;
    const r4 = this.bankRegs[4] & 0xff;
    const r5 = this.bankRegs[5] & 0xff;
    if ((this.chrMode & 0x01) === 0) {
      if (a < 0x0800) return r0 + ((a >> 10) & 0x01);
      if (a < 0x1000) return r1 + ((a >> 10) & 0x01);
      if (a < 0x1400) return r2;
      if (a < 0x1800) return r3;
      if (a < 0x1c00) return r4;
      return r5;
    }
    if (a < 0x0400) return r2;
    if (a < 0x0800) return r3;
    if (a < 0x0c00) return r4;
    if (a < 0x1000) return r5;
    if (a < 0x1800) return r0 + ((a - 0x1000) >> 10);
    return r1 + ((a - 0x1800) >> 10);
  }

  _mapChrAccess(addr) {
    const rawBank = this._mapChrBankRaw(addr) & 0xff;
    const offsetIn1k = addr & 0x03ff;
    const isRam = (rawBank & 0x40) !== 0;
    if (isRam) {
      const ramBank = rawBank & 0x07;
      return {
        isRam: true,
        offset: ((ramBank << 10) | offsetIn1k) % this.chrRam.length,
      };
    }
    const romBank = normalizeModulo(rawBank & 0x3f, this.chrRomBankCount1k);
    return {
      isRam: false,
      offset: ((romBank << 10) | offsetIn1k) % this.chrRom.length,
    };
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const mapped = this._mapChrAccess(a & 0x1fff);
    if (mapped.isRam) {
      return this.chrRam[mapped.offset] & 0xff;
    }
    return this.chrRom[mapped.offset] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return;
    const mapped = this._mapChrAccess(a & 0x1fff);
    if (mapped.isRam || this.cartridge.chrBanks === 0) {
      this.chrRam[mapped.offset % this.chrRam.length] = value & 0xff;
    }
  }
}

class Mapper64 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgRam = new Uint8Array(0x2000);
    this.prgBankCount8k = Math.max(1, this.prg.length >> 13);
    this.chrBankCount1k = Math.max(1, this.chr.length >> 10);
    this.registers = new Uint8Array(16);
    this.currentRegister = 0;
    this.prgMode = 0;
    this.chrMode = 0;
    this.chrSplitMode = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.irqPending = false;
    this.prgRamEnable = true;
    this.prgRamWriteProtect = false;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
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

  _mapPrgBank(slot) {
    const last = Math.max(0, this.prgBankCount8k - 1);
    const r6 = this.registers[6] % this.prgBankCount8k;
    const r7 = this.registers[7] % this.prgBankCount8k;
    const r15 = this.registers[15] % this.prgBankCount8k;
    if ((this.prgMode & 0x01) === 0) {
      if (slot === 0) return r6;
      if (slot === 1) return r7;
      if (slot === 2) return r15;
      return last;
    }
    if (slot === 0) return r15;
    if (slot === 1) return r7;
    if (slot === 2) return r6;
    return last;
  }

  _chrBankBySlot(slot) {
    const s = slot & 0x07;
    const split = (this.chrSplitMode & 0x01) !== 0;
    if ((this.chrMode & 0x01) === 0) {
      if (s === 0) return this.registers[0] & 0xff;
      if (s === 1) return split ? (this.registers[8] & 0xff) : ((this.registers[0] + 1) & 0xff);
      if (s === 2) return this.registers[1] & 0xff;
      if (s === 3) return split ? (this.registers[9] & 0xff) : ((this.registers[1] + 1) & 0xff);
      if (s === 4) return this.registers[2] & 0xff;
      if (s === 5) return this.registers[3] & 0xff;
      if (s === 6) return this.registers[4] & 0xff;
      return this.registers[5] & 0xff;
    }
    if (s === 0) return this.registers[2] & 0xff;
    if (s === 1) return this.registers[3] & 0xff;
    if (s === 2) return this.registers[4] & 0xff;
    if (s === 3) return this.registers[5] & 0xff;
    if (s === 4) return this.registers[0] & 0xff;
    if (s === 5) return split ? (this.registers[8] & 0xff) : ((this.registers[0] + 1) & 0xff);
    if (s === 6) return this.registers[1] & 0xff;
    return split ? (this.registers[9] & 0xff) : ((this.registers[1] + 1) & 0xff);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrgBank(slot & 0x03);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xe001) {
      case 0x8000:
        this.currentRegister = v & 0x0f;
        this.prgMode = (v >> 6) & 0x01;
        this.chrMode = (v >> 7) & 0x01;
        this.chrSplitMode = (v >> 5) & 0x01;
        break;
      case 0x8001:
        this.registers[this.currentRegister & 0x0f] = v;
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
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this._chrBankBySlot(slot), this.chrBankCount1k);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this._chrBankBySlot(slot), this.chrBankCount1k);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onQualifiedA12Rise(_edge, _access) {
    const oldCounter = this.irqCounter & 0xff;
    const newCounter = (oldCounter === 0 || this.irqReload)
      ? (this.irqLatch & 0xff)
      : ((oldCounter - 1) & 0xff);
    this.irqCounter = newCounter;
    if (newCounter === 0 && this.irqEnabled) {
      this.irqPending = true;
    }
    this.irqReload = false;
  }
}

class Mapper69 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgBankMask = ((this.prg8kBanks & (this.prg8kBanks - 1)) === 0)
      ? (this.prg8kBanks - 1)
      : -1;
    this.chrBankMask = ((this.chr1kBanks & (this.chr1kBanks - 1)) === 0)
      ? (this.chr1kBanks - 1)
      : -1;
    this.command = 0;
    this.chrRegs = new Uint8Array(8);
    this.prgRegs = new Uint8Array(3);
    this.prgSlotOffsets = new Uint32Array(4);
    this.chrSlotOffsets = new Uint32Array(8);
    this.workRamControl = 0;
    this.workRam = new Uint8Array(0x2000 * 64);
    this.workRamBankOffset = 0;
    this.workRomBankOffset = 0;
    this.workRamLengthMask = this.workRam.length - 1;
    this.chrIsRam = cartridge.chrBanks === 0;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
    this.irqEnabled = false;
    this.irqCounterEnabled = false;
    this.irqCounter = 0;
    this.irqPending = false;
    this._recomputeBankMaps();
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  _workRamBank() {
    return this.workRamControl & 0x3f;
  }

  _workRamMappedToRam() {
    return (this.workRamControl & 0x40) !== 0;
  }

  _workRamEnabled() {
    return (this.workRamControl & 0x80) !== 0;
  }

  _normalizePrgBank(bank) {
    const b = bank | 0;
    if (this.prgBankMask >= 0) return b & this.prgBankMask;
    const count = this.prg8kBanks | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _normalizeChrBank(bank) {
    const b = bank | 0;
    if (this.chrBankMask >= 0) return b & this.chrBankMask;
    const count = this.chr1kBanks | 0;
    let v = b % count;
    if (v < 0) v += count;
    return v;
  }

  _recomputePrgSlots() {
    this.prgSlotOffsets[0] = this._normalizePrgBank(this.prgRegs[0] & 0x3f) << 13;
    this.prgSlotOffsets[1] = this._normalizePrgBank(this.prgRegs[1] & 0x3f) << 13;
    this.prgSlotOffsets[2] = this._normalizePrgBank(this.prgRegs[2] & 0x3f) << 13;
    this.prgSlotOffsets[3] = Math.max(0, this.prg8kBanks - 1) << 13;
  }

  _recomputeChrSlots() {
    this.chrSlotOffsets[0] = this._normalizeChrBank(this.chrRegs[0] & 0xff) << 10;
    this.chrSlotOffsets[1] = this._normalizeChrBank(this.chrRegs[1] & 0xff) << 10;
    this.chrSlotOffsets[2] = this._normalizeChrBank(this.chrRegs[2] & 0xff) << 10;
    this.chrSlotOffsets[3] = this._normalizeChrBank(this.chrRegs[3] & 0xff) << 10;
    this.chrSlotOffsets[4] = this._normalizeChrBank(this.chrRegs[4] & 0xff) << 10;
    this.chrSlotOffsets[5] = this._normalizeChrBank(this.chrRegs[5] & 0xff) << 10;
    this.chrSlotOffsets[6] = this._normalizeChrBank(this.chrRegs[6] & 0xff) << 10;
    this.chrSlotOffsets[7] = this._normalizeChrBank(this.chrRegs[7] & 0xff) << 10;
  }

  _recomputeWorkBankOffsets() {
    const bank = this.workRamControl & 0x3f;
    this.workRamBankOffset = bank << 13;
    this.workRomBankOffset = this._normalizePrgBank(bank) << 13;
  }

  _recomputeBankMaps() {
    this._recomputePrgSlots();
    this._recomputeChrSlots();
    this._recomputeWorkBankOffsets();
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return null;
    const off = a & 0x1fff;
    if (this._workRamMappedToRam()) {
      // FME-7 command $8 semantics (NESdev):
      // R=1,E=0 ($40-$7F) => open bus at $6000-$7FFF.
      // R=1,E=1 ($C0-$FF) => PRG-RAM mapped/readable/writable.
      if (!this._workRamEnabled()) return openBus & 0xff;
      return this.workRam[(this.workRamBankOffset + off) & this.workRamLengthMask] & 0xff;
    }
    return this.prg[this.workRomBankOffset + off] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return false;
    if (!this._workRamMappedToRam() || !this._workRamEnabled()) return false;
    this.workRam[(this.workRamBankOffset + (a & 0x1fff)) & this.workRamLengthMask] = value & 0xff;
    return true;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    return this.prg[this.prgSlotOffsets[((a - 0x8000) >> 13) & 0x03] + (a & 0x1fff)] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    switch (a & 0xe000) {
      case 0x8000:
        this.command = v & 0x0f;
        break;
      case 0xa000:
        if (this.command <= 0x07) {
          this.chrRegs[this.command & 0x07] = v;
          this._recomputeChrSlots();
        } else if (this.command === 0x08) {
          this.workRamControl = v;
          this._recomputeWorkBankOffsets();
        } else if (this.command >= 0x09 && this.command <= 0x0b) {
          this.prgRegs[this.command - 0x09] = v & 0x3f;
          this._recomputePrgSlots();
        } else if (this.command === 0x0c) {
          switch (v & 0x03) {
            case 0: this.mirroringMode = 'vertical'; break;
            case 1: this.mirroringMode = 'horizontal'; break;
            case 2: this.mirroringMode = 'single0'; break;
            case 3: this.mirroringMode = 'single1'; break;
            default: break;
          }
        } else if (this.command === 0x0d) {
          this.irqEnabled = (v & 0x01) !== 0;
          this.irqCounterEnabled = (v & 0x80) !== 0;
          this.irqPending = false;
        } else if (this.command === 0x0e) {
          this.irqCounter = (this.irqCounter & 0xff00) | v;
        } else if (this.command === 0x0f) {
          this.irqCounter = (this.irqCounter & 0x00ff) | ((v << 8) & 0xff00);
        }
        break;
      case 0xc000:
      case 0xe000:
      default:
        break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    return this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.chrIsRam) {
      this.chr[this.chrSlotOffsets[(a >> 10) & 0x07] + (a & 0x03ff)] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqCounterEnabled) return;
    this.irqCounter = (this.irqCounter - 1) & 0xffff;
    if (this.irqCounter === 0xffff && this.irqEnabled) {
      this.irqPending = true;
    }
  }
}

class Mapper73 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length / 0x4000);
    this.prgBank = 0;
    this.irqEnableOnAck = false;
    this.irqEnabled = false;
    this.smallCounter = false;
    this.irqReload = 0;
    this.irqCounter = 0;
    this.irqPending = false;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank, this.prg16kBanks);
      const off = (bank * 0x4000) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.max(0, this.prg16kBanks - 1);
    const off = (fixed * 0x4000) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    switch (a & 0xf000) {
      case 0x8000: this.irqReload = (this.irqReload & 0xfff0) | (v & 0x0f); break;
      case 0x9000: this.irqReload = (this.irqReload & 0xff0f) | ((v & 0x0f) << 4); break;
      case 0xa000: this.irqReload = (this.irqReload & 0xf0ff) | ((v & 0x0f) << 8); break;
      case 0xb000: this.irqReload = (this.irqReload & 0x0fff) | ((v & 0x0f) << 12); break;
      case 0xc000:
        this.irqEnabled = (v & 0x02) !== 0;
        if (this.irqEnabled) {
          this.irqCounter = this.irqReload & 0xffff;
        }
        this.smallCounter = (v & 0x04) !== 0;
        this.irqEnableOnAck = (v & 0x01) !== 0;
        this.irqPending = false;
        break;
      case 0xd000:
        this.irqPending = false;
        this.irqEnabled = this.irqEnableOnAck;
        break;
      case 0xf000:
        this.prgBank = v & 0x07;
        break;
      default:
        break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    if (this.smallCounter) {
      const oldLow = this.irqCounter & 0xff;
      const nextLow = (oldLow + 1) & 0xff;
      if (nextLow === 0x00) {
        this.irqCounter = (this.irqCounter & 0xff00) | (this.irqReload & 0xff);
        this.irqPending = true;
      } else {
        this.irqCounter = (this.irqCounter & 0xff00) | nextLow;
      }
      return;
    }
    const next = (this.irqCounter + 1) & 0xffff;
    if (next === 0x0000) {
      this.irqCounter = this.irqReload & 0xffff;
      this.irqPending = true;
    } else {
      this.irqCounter = next;
    }
  }
}

class Mapper75 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr4kBanks = Math.max(1, this.chr.length >> 12);
    this.prgBank0 = 0;
    this.prgBank1 = 1;
    this.prgBank2 = 2;
    this.chrBank0 = 0;
    this.chrBank1 = 1;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xa000) bank = normalizeModulo(this.prgBank0, this.prg8kBanks);
    else if (a < 0xc000) bank = normalizeModulo(this.prgBank1, this.prg8kBanks);
    else if (a < 0xe000) bank = normalizeModulo(this.prgBank2, this.prg8kBanks);
    else bank = Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    switch (a & 0xf000) {
      case 0x8000: this.prgBank0 = v & 0x1f; break;
      case 0x9000:
        this.mirroringMode = (v & 0x01) ? 'horizontal' : 'vertical';
        this.chrBank0 = (this.chrBank0 & 0x0f) | ((v & 0x02) << 3);
        this.chrBank1 = (this.chrBank1 & 0x0f) | ((v & 0x04) << 2);
        break;
      case 0xa000: this.prgBank1 = v & 0x1f; break;
      case 0xc000: this.prgBank2 = v & 0x1f; break;
      case 0xe000: this.chrBank0 = (this.chrBank0 & 0x10) | (v & 0x0f); break;
      case 0xf000: this.chrBank1 = (this.chrBank1 & 0x10) | (v & 0x0f); break;
      default: break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank4 = a < 0x1000
      ? normalizeModulo(this.chrBank0, this.chr4kBanks)
      : normalizeModulo(this.chrBank1, this.chr4kBanks);
    const off = (bank4 << 12) + (a & 0x0fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank4 = a < 0x1000
        ? normalizeModulo(this.chrBank0, this.chr4kBanks)
        : normalizeModulo(this.chrBank1, this.chr4kBanks);
      const off = (bank4 << 12) + (a & 0x0fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper76 extends Mapper76BaseCore {
  constructor(cartridge) {
    super(cartridge);
  }
}

class Mapper86 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg32kBanks = Math.max(1, this.prg.length >> 15);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgBank = 0;
    this.chrBank = 0;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = normalizeModulo(this.prgBank, this.prg32kBanks);
    const off = (bank << 15) + (a & 0x7fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x6fff) {
      this.prgBank = (v >> 4) & 0x03;
      this.chrBank = (v & 0x03) | ((v >> 4) & 0x04);
      return true;
    }
    return false;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper18 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgBanks = new Uint8Array(3);
    this.chrBanks = new Uint8Array(8);
    this.irqReloadValue = new Uint8Array(4);
    this.irqCounter = 0;
    this.irqCounterSize = 0;
    this.irqEnabled = false;
    this.irqPending = false;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
    const prgRamSize = Math.max(
      0,
      (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    this.prgRam = prgRamSize > 0 ? new Uint8Array(prgRamSize) : null;
    this.prgRamMask = this.prgRam ? (this.prgRam.length - 1) : 0;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  _irqMask() {
    if (this.irqCounterSize === 1) return 0x0fff;
    if (this.irqCounterSize === 2) return 0x00ff;
    if (this.irqCounterSize === 3) return 0x000f;
    return 0xffff;
  }

  _updatePrgBank(bankNumber, value, upper) {
    const i = bankNumber & 0x03;
    if (i >= 3) return;
    const v = value & 0x0f;
    if (upper) {
      this.prgBanks[i] = ((this.prgBanks[i] & 0x0f) | (v << 4)) & 0xff;
    } else {
      this.prgBanks[i] = ((this.prgBanks[i] & 0xf0) | v) & 0xff;
    }
  }

  _updateChrBank(bankNumber, value, upper) {
    const i = bankNumber & 0x07;
    const v = value & 0x0f;
    if (upper) {
      this.chrBanks[i] = ((this.chrBanks[i] & 0x0f) | (v << 4)) & 0xff;
    } else {
      this.chrBanks[i] = ((this.chrBanks[i] & 0xf0) | v) & 0xff;
    }
  }

  _reloadIrqCounter() {
    this.irqCounter =
      (this.irqReloadValue[0] & 0x0f) |
      ((this.irqReloadValue[1] & 0x0f) << 4) |
      ((this.irqReloadValue[2] & 0x0f) << 8) |
      ((this.irqReloadValue[3] & 0x0f) << 12);
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return null;
    if (!this.prgRam) return openBus & 0xff;
    return this.prgRam[(a - 0x6000) & this.prgRamMask] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return false;
    if (this.prgRam) {
      this.prgRam[(a - 0x6000) & this.prgRamMask] = value & 0xff;
    }
    return true;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    let bank = 0;
    if (a < 0xa000) bank = normalizeModulo(this.prgBanks[0], this.prg8kBanks);
    else if (a < 0xc000) bank = normalizeModulo(this.prgBanks[1], this.prg8kBanks);
    else if (a < 0xe000) bank = normalizeModulo(this.prgBanks[2], this.prg8kBanks);
    else bank = Math.max(0, this.prg8kBanks - 1);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0x0f;
    const upper = (a & 0x0001) !== 0;
    switch (a & 0xf003) {
      case 0x8000:
      case 0x8001: this._updatePrgBank(0, v, upper); break;
      case 0x8002:
      case 0x8003: this._updatePrgBank(1, v, upper); break;
      case 0x9000:
      case 0x9001: this._updatePrgBank(2, v, upper); break;

      case 0xa000:
      case 0xa001: this._updateChrBank(0, v, upper); break;
      case 0xa002:
      case 0xa003: this._updateChrBank(1, v, upper); break;
      case 0xb000:
      case 0xb001: this._updateChrBank(2, v, upper); break;
      case 0xb002:
      case 0xb003: this._updateChrBank(3, v, upper); break;
      case 0xc000:
      case 0xc001: this._updateChrBank(4, v, upper); break;
      case 0xc002:
      case 0xc003: this._updateChrBank(5, v, upper); break;
      case 0xd000:
      case 0xd001: this._updateChrBank(6, v, upper); break;
      case 0xd002:
      case 0xd003: this._updateChrBank(7, v, upper); break;

      case 0xe000:
      case 0xe001:
      case 0xe002:
      case 0xe003:
        this.irqReloadValue[a & 0x03] = v & 0x0f;
        break;

      case 0xf000:
        this.irqPending = false;
        this._reloadIrqCounter();
        break;

      case 0xf001:
        this.irqPending = false;
        this.irqEnabled = (v & 0x01) !== 0;
        if ((v & 0x08) !== 0) this.irqCounterSize = 3;
        else if ((v & 0x04) !== 0) this.irqCounterSize = 2;
        else if ((v & 0x02) !== 0) this.irqCounterSize = 1;
        else this.irqCounterSize = 0;
        break;

      case 0xf002:
        switch (v & 0x03) {
          case 0: this.mirroringMode = 'horizontal'; break;
          case 1: this.mirroringMode = 'vertical'; break;
          case 2: this.mirroringMode = 'single0'; break;
          case 3: this.mirroringMode = 'single1'; break;
          default: break;
        }
        break;
      default:
        break;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrBanks[slot], this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrBanks[slot], this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    const mask = this._irqMask() & 0xffff;
    let counter = this.irqCounter & mask;
    counter = (counter - 1) & mask;
    if (counter === 0) {
      this.irqPending = true;
    }
    this.irqCounter = (this.irqCounter & (~mask)) | (counter & mask);
  }
}

class Mapper19 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.mapperId = cartridge.mapper | 0;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgRegs = new Uint8Array(3);
    this.chrRegs = new Uint8Array(12);
    this.wram = new Uint8Array(0x2000);
    this.ciramPattern = new Uint8Array(0x800);
    this.writeProtect = 0;
    this.disableCiramLow = false;
    this.disableCiramHigh = false;
    this.irqCounter = 0;
    this.irqPending = false;
    const prgRamSize = (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0;
    const prgNvRamSize = (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0;
    // Narrow fallback for RAM-less mapper19 hacks:
    // keep $C000-$DFFF fixed unless board proves full Namco163 behavior.
    this.forceFixedC000Bank =
      this.mapperId === 19 &&
      this.submapper === 0 &&
      prgRamSize <= 0 &&
      prgNvRamSize <= 0 &&
      this.prg.length === 0x20000 &&
      this.chr.length === 0x20000;
    this.prgRegs[2] = Math.max(0, this.prg8kBanks - 2) & 0x3f;
  }

  _chrSlotUsesCiram(slot) {
    const s = slot & 0x07;
    const reg = this.chrRegs[s] & 0xff;
    if (reg < 0xe0) return false;
    if (s < 4) return !this.disableCiramLow;
    return !this.disableCiramHigh;
  }

  _mapPrgBank(slot) {
    const s = slot & 0x03;
    if (s === 0) return normalizeModulo(this.prgRegs[0] & 0x3f, this.prg8kBanks);
    if (s === 1) return normalizeModulo(this.prgRegs[1] & 0x3f, this.prg8kBanks);
    if (s === 2 && this.forceFixedC000Bank) return Math.max(0, this.prg8kBanks - 2);
    if (s === 2) return normalizeModulo(this.prgRegs[2] & 0x3f, this.prg8kBanks);
    return Math.max(0, this.prg8kBanks - 1);
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.cartridge.mirroring || defaultMode || 'vertical';
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    const slot = (a >> 10) & 0x03;
    const reg = this.chrRegs[8 + slot] & 0xff;
    const table = (reg & 0x01) << 10;
    return table | (a & 0x03ff);
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      return this.wram[a & 0x1fff] & 0xff;
    }
    if (a === 0x5000) return this.irqCounter & 0xff;
    if (a === 0x5800) return (this.irqCounter >> 8) & 0xff;
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0x6000 && a <= 0x7fff) {
      const page = ((a - 0x6000) >> 11) & 0x03;
      const globalWriteEnable = (this.writeProtect & 0x40) !== 0;
      const pageWriteProtected = ((this.writeProtect >> page) & 0x01) !== 0;
      if (!globalWriteEnable || pageWriteProtected) return true;
      this.wram[a & 0x1fff] = v;
      return true;
    }
    if (a === 0x5000) {
      this.irqCounter = (this.irqCounter & 0xff00) | v;
      this.irqPending = false;
      return true;
    }
    if (a === 0x5800) {
      this.irqCounter = (this.irqCounter & 0x00ff) | (v << 8);
      this.irqPending = false;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrgBank(slot);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xf800) {
      case 0x8000: this.chrRegs[0] = v; return;
      case 0x8800: this.chrRegs[1] = v; return;
      case 0x9000: this.chrRegs[2] = v; return;
      case 0x9800: this.chrRegs[3] = v; return;
      case 0xa000: this.chrRegs[4] = v; return;
      case 0xa800: this.chrRegs[5] = v; return;
      case 0xb000: this.chrRegs[6] = v; return;
      case 0xb800: this.chrRegs[7] = v; return;
      case 0xc000: this.chrRegs[8] = v; return;
      case 0xc800: this.chrRegs[9] = v; return;
      case 0xd000: this.chrRegs[10] = v; return;
      case 0xd800: this.chrRegs[11] = v; return;
      case 0xe000:
        this.prgRegs[0] = v & 0x3f;
        return;
      case 0xe800:
        this.prgRegs[1] = v & 0x3f;
        this.disableCiramLow = (v & 0x40) !== 0;
        this.disableCiramHigh = (v & 0x80) !== 0;
        return;
      case 0xf000:
        this.prgRegs[2] = v & 0x3f;
        return;
      case 0xf800:
        this.writeProtect = v;
        this.irqPending = false;
        return;
      default:
        return;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    if (this._chrSlotUsesCiram(slot)) {
      const reg = this.chrRegs[slot] & 0xff;
      const off = ((reg & 0x01) << 10) | (a & 0x03ff);
      return this.ciramPattern[off & 0x07ff] & 0xff;
    }
    const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    const v = value & 0xff;
    if (a >= 0x2000) return;
    const slot = (a >> 10) & 0x07;
    if (this._chrSlotUsesCiram(slot)) {
      const reg = this.chrRegs[slot] & 0xff;
      const off = ((reg & 0x01) << 10) | (a & 0x03ff);
      this.ciramPattern[off & 0x07ff] = v;
      return;
    }
    if (this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrRegs[slot] & 0xff, this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = v;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || this.irqPending) return;
    if ((this.irqCounter & 0x8000) === 0) return;
    if ((this.irqCounter & 0x7fff) === 0x7fff) return;
    this.irqCounter = (this.irqCounter + 1) & 0xffff;
    if ((this.irqCounter & 0x7fff) === 0x7fff) this.irqPending = true;
  }
}

class Mapper68 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prgRam = new Uint8Array(0x2000);
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr2kBanks = Math.max(1, this.chr.length >> 11);
    this.chrRegs = new Uint8Array(4);
    this.ntRegs = new Uint8Array(2);
    this.prgBank0 = 0;
    this.prgRamEnabled = false;
    this.mirroringMode = cartridge.mirroring || 'horizontal';
    this.useChrForNametables = false;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'horizontal';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (!this.prgRamEnabled) return openBus & 0xff;
      return this.prgRam[a & 0x1fff] & 0xff;
    }
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff && this.prgRamEnabled) {
      this.prgRam[a & 0x1fff] = value & 0xff;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    if (a < 0xc000) {
      const bank = normalizeModulo(this.prgBank0, this.prg16kBanks);
      const off = (bank << 14) + (a & 0x3fff);
      return this.prg[off % this.prg.length] & 0xff;
    }
    const fixed = Math.min(7, Math.max(0, this.prg16kBanks - 1));
    const off = (fixed << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    switch (a & 0xf000) {
      case 0x8000: this.chrRegs[0] = v; break;
      case 0x9000: this.chrRegs[1] = v; break;
      case 0xa000: this.chrRegs[2] = v; break;
      case 0xb000: this.chrRegs[3] = v; break;
      case 0xc000: this.ntRegs[0] = (v | 0x80) & 0xff; break;
      case 0xd000: this.ntRegs[1] = (v | 0x80) & 0xff; break;
      case 0xe000:
        switch (v & 0x03) {
          case 0: this.mirroringMode = 'vertical'; break;
          case 1: this.mirroringMode = 'horizontal'; break;
          case 2: this.mirroringMode = 'single0'; break;
          case 3: this.mirroringMode = 'single1'; break;
          default: break;
        }
        this.useChrForNametables = (v & 0x10) !== 0;
        break;
      case 0xf000:
        this.prgBank0 = v & 0x07;
        this.prgRamEnabled = (v & 0x10) !== 0;
        break;
      default:
        break;
    }
  }

  mapNametableAddr(addr) {
    const a = addr & 0x0fff;
    if (!this.useChrForNametables) return a & 0x0fff;
    const table = (a >> 10) & 0x03;
    const offset = a & 0x03ff;
    let reg = 0;
    if (this.mirroringMode === 'vertical') reg = table & 0x01;
    else if (this.mirroringMode === 'horizontal') reg = (table >> 1) & 0x01;
    else if (this.mirroringMode === 'single1') reg = 1;
    else reg = 0;
    const ciram = this.ntRegs[reg] & 0x01;
    return (ciram << 10) | offset;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrRegs[(a >> 11) & 0x03], this.chr2kBanks);
    const off = (bank << 11) + (a & 0x07ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrRegs[(a >> 11) & 0x03], this.chr2kBanks);
      const off = (bank << 11) + (a & 0x07ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class Mapper15 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.prgRam = new Uint8Array(0x2000);
    this.chrWritable = false;
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.cpuWrite(0x8000, 0x00);
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  _setPrgSlot(slot, bank) {
    const s = slot & 0x03;
    const b = normalizeModulo(bank, this.prg8kBanks);
    if (!this._slots) this._slots = new Uint8Array(4);
    this._slots[s] = b & 0xff;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._slots ? this._slots[slot & 0x03] : 0;
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return null;
    if (!this.prgRam || this.prgRam.length === 0) return openBus & 0xff;
    return this.prgRam[a & 0x1fff] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return false;
    if (!this.prgRam || this.prgRam.length === 0) return true;
    this.prgRam[a & 0x1fff] = value & 0xff;
    return true;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    this.mirroringMode = (v & 0x40) ? 'horizontal' : 'vertical';
    const latched = v & 0xff;
    const mode = a & 0x03;
    // Mapper-hacked ROMs expect CHR writes to remain enabled except in mode 3.
    this.chrWritable = (mode !== 3);
    if (mode === 0) {
      const base = ((latched & 0x3f) << 1) & 0xff;
      this._setPrgSlot(0, base + 0);
      this._setPrgSlot(1, base + 1);
      this._setPrgSlot(2, base + 2);
      this._setPrgSlot(3, base + 3);
      return;
    }
    if (mode === 1) {
      for (let i = 0; i < 4; i++) {
        let b = latched & 0x3f;
        if (i >= 2) b |= 0x07;
        this._setPrgSlot(i, ((b << 1) + (i & 1)) & 0xff);
      }
      return;
    }
    if (mode === 2) {
      const bank8k = (((latched & 0x3f) << 1) + (latched >> 7)) & 0xff;
      this._setPrgSlot(0, bank8k);
      this._setPrgSlot(1, bank8k);
      this._setPrgSlot(2, bank8k);
      this._setPrgSlot(3, bank8k);
      return;
    }
    // mode === 3
    for (let i = 0; i < 4; i++) {
      const b = latched & 0x3f;
      this._setPrgSlot(i, ((b << 1) + (i & 1)) & 0xff);
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && (this.cartridge.chrBanks === 0 || this.chrWritable)) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper166 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.altMode = (cartridge.mapper | 0) === 167;
    this.regs = new Uint8Array(4);
    this._updateMapping();
  }

  _setSlots(bank0, bank1) {
    this.slot0 = normalizeModulo(bank0, this.prg16kBanks);
    this.slot1 = normalizeModulo(bank1, this.prg16kBanks);
  }

  _updateMapping() {
    const outerBank = (((this.regs[0] ^ this.regs[1]) & 0x10) << 1) & 0xff;
    const innerBank = (this.regs[2] ^ this.regs[3]) & 0x1f;
    if ((this.regs[1] & 0x08) !== 0) {
      const bank = (outerBank | innerBank) & 0xfe;
      this._setSlots(this.altMode ? bank + 1 : bank, this.altMode ? bank : bank + 1);
      return;
    }
    if ((this.regs[1] & 0x04) !== 0) {
      this._setSlots(0x1f, outerBank | innerBank);
      return;
    }
    this._setSlots(outerBank | innerBank, this.altMode ? 0x20 : 0x07);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = a < 0xc000 ? this.slot0 : this.slot1;
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    switch (a & 0xe000) {
      case 0x8000: this.regs[0] = v & 0x10; break;
      case 0xa000: this.regs[1] = v & 0x1c; break;
      case 0xc000: this.regs[2] = v & 0x1f; break;
      case 0xe000: this.regs[3] = v & 0x1f; break;
      default: break;
    }
    this._updateMapping();
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper232 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prgBlock = 0;
    this.prgPage = 0;
    this._updateBanks();
  }

  _setSlots(bank0, bank1) {
    this.slot0 = normalizeModulo(bank0, this.prg16kBanks);
    this.slot1 = normalizeModulo(bank1, this.prg16kBanks);
  }

  _updateBanks() {
    const base = ((this.prgBlock & 0x03) << 2) & 0xff;
    this._setSlots(base | (this.prgPage & 0x03), base | 0x03);
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const bank = a < 0xc000 ? this.slot0 : this.slot1;
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a >= 0xc000) {
      this.prgPage = v & 0x03;
    } else if (this.submapper === 1) {
      this.prgBlock = ((v >> 4) & 0x01) | ((v >> 2) & 0x02);
    } else {
      this.prgBlock = (v >> 3) & 0x03;
    }
    this._updateBanks();
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a < 0x2000) return this.chr[a & 0x1fff] & 0xff;
    return 0;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      this.chr[a & 0x1fff] = value & 0xff;
    }
  }
}

class Mapper228 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg16kBanks = Math.max(1, this.prg.length >> 14);
    this.chr8kBanks = Math.max(1, this.chr.length >> 13);
    this.prgChip = 0;
    this.prgPage = 0;
    this.prgSizeMode = 0;
    this.chrBank = 0;
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.reg4x4 = new Uint8Array(4);
  }

  _chipBase(chip) {
    const c = chip & 0x03;
    if (this.prg16kBanks >= 128) {
      return c * 32;
    }
    if (this.prg16kBanks >= 96) {
      if (c === 0) return 0;
      if (c === 1) return 32;
      if (c === 3) return 64;
      return -1;
    }
    if (this.prg16kBanks >= 64) {
      if (c === 0) return 0;
      if (c === 1) return 32;
      return -1;
    }
    return (c * 32) % this.prg16kBanks;
  }

  _mapPrg16k(slot) {
    const base = this._chipBase(this.prgChip);
    if (base < 0) return -1;
    const page = this.prgPage & 0x1f;
    if (this.prgSizeMode === 0) {
      if (slot === 0) return base + (page & 0x1e);
      return base + (page | 0x01);
    }
    return base + page;
  }

  isIrqAsserted() {
    return false;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x4020 && a <= 0x5fff) {
      const i = a & 0x03;
      return ((openBus & 0xf0) | (this.reg4x4[i] & 0x0f)) & 0xff;
    }
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a >= 0x4020 && a <= 0x5fff) {
      this.reg4x4[a & 0x03] = value & 0x0f;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a < 0xc000) ? 0 : 1;
    const bank = this._mapPrg16k(slot);
    if (bank < 0 || bank >= this.prg16kBanks) return 0xff;
    const off = (bank << 14) + (a & 0x3fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    this.mirroringMode = ((a >> 13) & 0x01) ? 'horizontal' : 'vertical';
    this.prgChip = (a >> 11) & 0x03;
    this.prgPage = (a >> 6) & 0x1f;
    this.prgSizeMode = (a >> 5) & 0x01;
    this.chrBank = (((a & 0x0f) << 2) | (v & 0x03)) & 0x3f;
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const bank = normalizeModulo(this.chrBank, this.chr8kBanks);
      const off = (bank << 13) + (a & 0x1fff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }
}

class MapperVRC6 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.mapperId = cartridge.mapper | 0;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prg16Reg = 0;
    this.prg8Reg = 0;
    this.chrRegs = new Uint8Array(8);
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqPrescaler = 341;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqCycleMode = false;
    this.irqPending = false;
    const prgRamSize = Math.max(
      0,
      (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    this.prgRam = prgRamSize > 0 ? new Uint8Array(prgRamSize) : null;
    this.prgRamMask = this.prgRam ? (this.prgRam.length - 1) : 0;
  }

  _translateAddress(addr) {
    const a = addr & 0xffff;
    if (this.mapperId !== 26) return a;
    const low = a & 0x0003;
    const swapped = ((low & 0x01) << 1) | ((low & 0x02) >> 1);
    return (a & 0xfffc) | swapped;
  }

  _mapPrgBank(slot) {
    const last = Math.max(0, this.prg8kBanks - 1);
    const prg16Base = normalizeModulo((this.prg16Reg & 0x0f) << 1, this.prg8kBanks);
    if (slot === 0) return prg16Base;
    if (slot === 1) return normalizeModulo(prg16Base + 1, this.prg8kBanks);
    if (slot === 2) return normalizeModulo(this.prg8Reg & 0x1f, this.prg8kBanks);
    return last;
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrgBank(slot & 0x03);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = this._translateAddress(addr & 0xffff);
    const v = value & 0xff;
    if (a < 0x8000) return;

    if (a >= 0x8000 && a <= 0x8003) {
      this.prg16Reg = v;
      return;
    }

    if (a === 0xb003) {
      switch ((v >> 2) & 0x03) {
        case 0: this.mirroringMode = 'vertical'; break;
        case 1: this.mirroringMode = 'horizontal'; break;
        case 2: this.mirroringMode = 'single0'; break;
        case 3: this.mirroringMode = 'single1'; break;
        default: break;
      }
      return;
    }

    if (a >= 0xc000 && a <= 0xc003) {
      this.prg8Reg = v;
      return;
    }

    if (a >= 0xd000 && a <= 0xd003) {
      this.chrRegs[a & 0x03] = v;
      return;
    }
    if (a >= 0xe000 && a <= 0xe003) {
      this.chrRegs[4 + (a & 0x03)] = v;
      return;
    }

    if (a === 0xf000) {
      this.irqLatch = v & 0xff;
      return;
    }
    if (a === 0xf001) {
      this.irqEnableAfterAck = (v & 0x01) !== 0;
      this.irqEnabled = (v & 0x02) !== 0;
      this.irqCycleMode = (v & 0x04) !== 0;
      if (this.irqEnabled) {
        this.irqCounter = this.irqLatch & 0xff;
        this.irqPrescaler = 341;
      }
      this.irqPending = false;
      return;
    }
    if (a === 0xf002) {
      this.irqEnabled = this.irqEnableAfterAck;
      this.irqPending = false;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot], this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrRegs[slot], this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    this.irqPrescaler -= 3;
    if (this.irqCycleMode || this.irqPrescaler <= 0) {
      if ((this.irqCounter & 0xff) === 0xff) {
        this.irqCounter = this.irqLatch & 0xff;
        this.irqPending = true;
      } else {
        this.irqCounter = (this.irqCounter + 1) & 0xff;
      }
      this.irqPrescaler += 341;
    }
  }
}

class MapperVRC24 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.mapperId = cartridge.mapper | 0;
    this.submapper = (typeof cartridge.submapper === 'number' ? cartridge.submapper : 0) & 0x0f;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgReg0 = 0;
    this.prgReg1 = 0;
    this.prgMode = 0;
    this.loChrRegs = new Uint8Array(8);
    this.hiChrRegs = new Uint8Array(8);
    this.latch = 0;
    this.mirroringMode = cartridge.mirroring || 'vertical';
    this.irqReload = 0;
    this.irqCounter = 0;
    this.irqPrescaler = 0;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqCycleMode = false;
    this.irqPending = false;
    const prgRamSize = Math.max(
      0,
      (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    this.prgRam = prgRamSize > 0 ? new Uint8Array(prgRamSize) : null;
    this.prgRamMask = this.prgRam ? (this.prgRam.length - 1) : 0;
    const saved = cartridge && cartridge.battery && cartridge.prgRam ? cartridge.prgRam : null;
    if (saved && this.prgRam) {
      const copyLen = Math.min(saved.length, this.prgRam.length);
      for (let i = 0; i < copyLen; i++) this.prgRam[i] = saved[i] & 0xff;
    }
  }

  _isMapper22() {
    return this.mapperId === 22;
  }

  _isExactVrc2() {
    if (this.mapperId === 22) return true; // VRC2a
    if (this.mapperId === 23 && this.submapper === 3) return true; // VRC2b
    if (this.mapperId === 25 && this.submapper === 3) return true; // VRC2c
    return false;
  }

  _hasPrgMode() {
    return !this._isExactVrc2();
  }

  _hasIrq() {
    return !this._isExactVrc2();
  }

  _translateAddress(addr) {
    const a = addr & 0xffff;
    let A0 = 0;
    let A1 = 0;
    if (this.mapperId === 22) {
      A0 = (a >> 1) & 0x01;
      A1 = a & 0x01;
    } else if (this.mapperId === 21) {
      if (this.submapper === 2) {
        A0 = (a >> 6) & 0x01;
        A1 = (a >> 7) & 0x01;
      } else {
        A0 = (a >> 1) & 0x01;
        A1 = (a >> 2) & 0x01;
      }
    } else if (this.mapperId === 23) {
      if (this.submapper === 2) {
        A0 = (a >> 2) & 0x01;
        A1 = (a >> 3) & 0x01;
      } else {
        A0 = a & 0x01;
        A1 = (a >> 1) & 0x01;
      }
    } else if (this.mapperId === 25) {
      if (this.submapper === 2) {
        A0 = (a >> 3) & 0x01;
        A1 = (a >> 2) & 0x01;
      } else {
        A0 = (a >> 1) & 0x01;
        A1 = a & 0x01;
      }
    } else {
      A0 = a & 0x01;
      A1 = (a >> 1) & 0x01;
    }
    return ((a & 0xff00) | (A1 << 1) | A0) & 0xffff;
  }

  _mapPrgBank(slot) {
    const last = Math.max(0, this.prg8kBanks - 1);
    const secondLast = Math.max(0, this.prg8kBanks - 2);
    const r0 = normalizeModulo(this.prgReg0, this.prg8kBanks);
    const r1 = normalizeModulo(this.prgReg1, this.prg8kBanks);
    if ((this.prgMode & 0x01) === 0) {
      if (slot === 0) return r0;
      if (slot === 1) return r1;
      if (slot === 2) return secondLast;
      return last;
    }
    if (slot === 0) return secondLast;
    if (slot === 1) return r1;
    if (slot === 2) return r0;
    return last;
  }

  _mapChrBank(slot) {
    const i = slot & 0x07;
    let page = (this.loChrRegs[i] & 0x0f) | ((this.hiChrRegs[i] & 0x1f) << 4);
    if (this._isMapper22()) {
      page >>= 1;
    }
    return normalizeModulo(page, this.chr1kBanks);
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (this.prgRam) {
        return this.prgRam[(a - 0x6000) & this.prgRamMask] & 0xff;
      }
      return ((openBus & 0xfe) | (this.latch & 0x01)) & 0xff;
    }
    return null;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a >= 0x6000 && a <= 0x7fff) {
      if (this.prgRam) {
        this.prgRam[(a - 0x6000) & this.prgRamMask] = value & 0xff;
        return true;
      }
      this.latch = value & 0x01;
      return true;
    }
    return false;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const bank = this._mapPrgBank(slot & 0x03);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = addr & 0xffff;
    const v = value & 0xff;
    if (a < 0x8000) return;
    const translated = this._translateAddress(a) & 0xf00f;
    if (translated >= 0x8000 && translated <= 0x8006) {
      this.prgReg0 = v & 0x1f;
      return;
    }
    const isVrc2Mirror = this._isExactVrc2() && translated >= 0x9000 && translated <= 0x9003;
    const isVrc4Mirror = !this._isExactVrc2() && translated >= 0x9000 && translated <= 0x9001;
    if (isVrc2Mirror || isVrc4Mirror) {
      const mask = this._isExactVrc2() ? 0x01 : 0x03;
      switch (v & mask) {
        case 0: this.mirroringMode = 'vertical'; break;
        case 1: this.mirroringMode = 'horizontal'; break;
        case 2: this.mirroringMode = 'single0'; break;
        case 3: this.mirroringMode = 'single1'; break;
        default: break;
      }
      return;
    }
    if (this._hasPrgMode() && translated >= 0x9002 && translated <= 0x9003) {
      this.prgMode = (v >> 1) & 0x01;
      return;
    }
    if (translated >= 0xa000 && translated <= 0xa006) {
      this.prgReg1 = v & 0x1f;
      return;
    }
    if (translated >= 0xb000 && translated <= 0xe006) {
      const regNumber = ((((translated >> 12) & 0x07) - 3) << 1) + ((translated >> 1) & 0x01);
      const lowBits = (translated & 0x01) === 0;
      if (regNumber >= 0 && regNumber < 8) {
        if (lowBits) this.loChrRegs[regNumber] = v & 0x0f;
        else this.hiChrRegs[regNumber] = v & 0x1f;
      }
      return;
    }
    if (translated === 0xf000) {
      this.irqReload = (this.irqReload & 0xf0) | (v & 0x0f);
      return;
    }
    if (translated === 0xf001) {
      this.irqReload = (this.irqReload & 0x0f) | ((v & 0x0f) << 4);
      return;
    }
    if (translated === 0xf002) {
      this.irqEnableAfterAck = (v & 0x01) !== 0;
      this.irqEnabled = (v & 0x02) !== 0;
      this.irqCycleMode = (v & 0x04) !== 0;
      if (this.irqEnabled) {
        this.irqCounter = this.irqReload & 0xff;
        this.irqPrescaler = 341;
      }
      this.irqPending = false;
      return;
    }
    if (translated === 0xf003) {
      this.irqEnabled = this.irqEnableAfterAck;
      this.irqPending = false;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = this._mapChrBank(slot);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = this._mapChrBank(slot);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this._hasIrq() || !this.irqEnabled) return;
    this.irqPrescaler -= 3;
    if (this.irqCycleMode || this.irqPrescaler <= 0) {
      if ((this.irqCounter & 0xff) === 0xff) {
        this.irqCounter = this.irqReload & 0xff;
        this.irqPending = true;
      } else {
        this.irqCounter = (this.irqCounter + 1) & 0xff;
      }
      this.irqPrescaler += 341;
    }
  }
}

class Mapper85 extends MapperCoreBaseCore {
  constructor(cartridge) {
    super(8);
    this.cartridge = cartridge;
    this.prg = cartridge.prgRom;
    this.chr = cartridge.chrRom;
    this.prg8kBanks = Math.max(1, this.prg.length >> 13);
    this.chr1kBanks = Math.max(1, this.chr.length >> 10);
    this.prgReg0 = 0;
    this.prgReg1 = 0;
    this.prgReg2 = 0;
    this.chrRegs = new Uint8Array(8);
    this.controlFlags = 0;
    const prgRamSize = Math.max(
      0,
      (cartridge && typeof cartridge.prgRamSize === 'number' ? cartridge.prgRamSize : 0) | 0,
      (cartridge && typeof cartridge.prgNvRamSize === 'number' ? cartridge.prgNvRamSize : 0) | 0,
    );
    this.prgRam = prgRamSize > 0 ? new Uint8Array(prgRamSize) : null;
    this.prgRamMask = this.prgRam ? (this.prgRam.length - 1) : 0;
    this.irqReload = 0;
    this.irqCounter = 0;
    this.irqPrescaler = 341;
    this.irqEnabled = false;
    this.irqEnableAfterAck = false;
    this.irqCycleMode = false;
    this.irqPending = false;
    this.mirroringMode = cartridge.mirroring || 'vertical';
  }

  _translateAddress(addr) {
    let a = addr & 0xffff;
    if ((a & 0x10) !== 0 && (a & 0xf010) !== 0x9010) {
      a |= 0x08;
      a &= ~0x10;
    }
    return a & 0xffff;
  }

  _isPrgRamEnabled() {
    return (this.controlFlags & 0x80) !== 0;
  }

  _setMirroringFromControl() {
    switch (this.controlFlags & 0x03) {
      case 0: this.mirroringMode = 'vertical'; break;
      case 1: this.mirroringMode = 'horizontal'; break;
      case 2: this.mirroringMode = 'single0'; break;
      case 3: this.mirroringMode = 'single1'; break;
      default: break;
    }
  }

  getMirroringMode(defaultMode) {
    return this.mirroringMode || defaultMode || this.cartridge.mirroring || 'vertical';
  }

  isIrqAsserted() {
    return !!this.irqPending;
  }

  cpuReadLow(addr, openBus) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return null;
    if (!this.prgRam || !this._isPrgRamEnabled()) return openBus & 0xff;
    return this.prgRam[(a - 0x6000) & this.prgRamMask] & 0xff;
  }

  cpuWriteLow(addr, value) {
    const a = addr & 0xffff;
    if (a < 0x6000 || a > 0x7fff) return false;
    if (this.prgRam && this._isPrgRamEnabled()) {
      this.prgRam[(a - 0x6000) & this.prgRamMask] = value & 0xff;
    }
    return true;
  }

  cpuRead(addr) {
    const a = addr & 0xffff;
    if (a < 0x8000) return 0;
    const slot = (a - 0x8000) >> 13;
    const last = Math.max(0, this.prg8kBanks - 1);
    let bank = last;
    if ((slot & 0x03) === 0) bank = normalizeModulo(this.prgReg0 & 0x3f, this.prg8kBanks);
    else if ((slot & 0x03) === 1) bank = normalizeModulo(this.prgReg1 & 0x3f, this.prg8kBanks);
    else if ((slot & 0x03) === 2) bank = normalizeModulo(this.prgReg2 & 0x3f, this.prg8kBanks);
    const off = (bank << 13) + (a & 0x1fff);
    return this.prg[off % this.prg.length] & 0xff;
  }

  cpuWrite(addr, value) {
    const a = this._translateAddress(addr);
    const v = value & 0xff;
    if (a < 0x8000) return;
    switch (a & 0xf038) {
      case 0x8000:
        this.prgReg0 = v & 0x3f;
        return;
      case 0x8008:
        this.prgReg1 = v & 0x3f;
        return;
      case 0x9000:
        this.prgReg2 = v & 0x3f;
        return;
      case 0xa000:
        this.chrRegs[0] = v;
        return;
      case 0xa008:
        this.chrRegs[1] = v;
        return;
      case 0xb000:
        this.chrRegs[2] = v;
        return;
      case 0xb008:
        this.chrRegs[3] = v;
        return;
      case 0xc000:
        this.chrRegs[4] = v;
        return;
      case 0xc008:
        this.chrRegs[5] = v;
        return;
      case 0xd000:
        this.chrRegs[6] = v;
        return;
      case 0xd008:
        this.chrRegs[7] = v;
        return;
      case 0xe000:
        this.controlFlags = v;
        this._setMirroringFromControl();
        return;
      case 0xe008:
        this.irqReload = v & 0xff;
        return;
      case 0xf000:
        this.irqEnableAfterAck = (v & 0x01) !== 0;
        this.irqEnabled = (v & 0x02) !== 0;
        this.irqCycleMode = (v & 0x04) !== 0;
        if (this.irqEnabled) {
          this.irqCounter = this.irqReload & 0xff;
          this.irqPrescaler = 341;
        }
        this.irqPending = false;
        return;
      case 0xf008:
        this.irqEnabled = this.irqEnableAfterAck;
        this.irqPending = false;
        return;
      default:
        return;
    }
  }

  ppuRead(addr) {
    const a = addr & 0x3fff;
    if (a >= 0x2000) return 0;
    const slot = (a >> 10) & 0x07;
    const bank = normalizeModulo(this.chrRegs[slot], this.chr1kBanks);
    const off = (bank << 10) + (a & 0x03ff);
    return this.chr[off % this.chr.length] & 0xff;
  }

  ppuWrite(addr, value) {
    const a = addr & 0x3fff;
    if (a < 0x2000 && this.cartridge.chrBanks === 0) {
      const slot = (a >> 10) & 0x07;
      const bank = normalizeModulo(this.chrRegs[slot], this.chr1kBanks);
      const off = (bank << 10) + (a & 0x03ff);
      this.chr[off % this.chr.length] = value & 0xff;
    }
  }

  onCpuPhaseTick(phase) {
    if (!phase || !phase.cpuCe || !this.irqEnabled) return;
    this.irqPrescaler -= 3;
    if (this.irqCycleMode || this.irqPrescaler <= 0) {
      if ((this.irqCounter & 0xff) === 0xff) {
        this.irqCounter = this.irqReload & 0xff;
        this.irqPending = true;
      } else {
        this.irqCounter = (this.irqCounter + 1) & 0xff;
      }
      this.irqPrescaler += 341;
    }
  }
}

function createMapper(cartridge) {
  if (cartridge.mapper === 0) return new Mapper0(cartridge);
  if (cartridge.mapper === 1) return new Mapper1(cartridge);
  if (cartridge.mapper === 2) return new Mapper2(cartridge);
  if (cartridge.mapper === 3) return new Mapper3(cartridge);
  if (cartridge.mapper === 5) return new Mapper5(cartridge);
  if (cartridge.mapper === 6) return new Mapper6(cartridge);
  if (cartridge.mapper === 4) {
    const mapper4Options = cartridge && cartridge.mapperOptions
      ? (cartridge.mapperOptions.mapper4 || null)
      : null;
    return new MapperCore4Core(cartridge, mapper4Options);
  }
  if (cartridge.mapper === 7) return new Mapper7(cartridge);
  if (cartridge.mapper === 9) return new Mapper9(cartridge);
  if (cartridge.mapper === 10) return new Mapper10(cartridge);
  if (cartridge.mapper === 11) return new Mapper11(cartridge);
  if (cartridge.mapper === 13) return new Mapper13(cartridge);
  if (cartridge.mapper === 15) return new Mapper15(cartridge);
  if (cartridge.mapper === 16) return new Mapper16(cartridge);
  if (cartridge.mapper === 19 || cartridge.mapper === 210) return new Mapper19(cartridge);
  if (cartridge.mapper === 166 || cartridge.mapper === 167) return new Mapper166(cartridge);
  if (cartridge.mapper === 228) return new Mapper228(cartridge);
  if (cartridge.mapper === 24 || cartridge.mapper === 26) return new MapperVRC6(cartridge);
  if (cartridge.mapper === 21 || cartridge.mapper === 22 || cartridge.mapper === 23 || cartridge.mapper === 25) {
    return new MapperVRC24(cartridge);
  }
  if (cartridge.mapper === 85) return new Mapper85(cartridge);
  if (cartridge.mapper === 34) return new Mapper34(cartridge);
  if (cartridge.mapper === 18) return new Mapper18(cartridge);
  if (cartridge.mapper === 64) return new Mapper64(cartridge);
  if (cartridge.mapper === 65) return new Mapper65(cartridge);
  if (cartridge.mapper === 68) return new Mapper68(cartridge);
  if (cartridge.mapper === 69) return new Mapper69(cartridge);
  if (cartridge.mapper === 67) return new Mapper67(cartridge);
  if (cartridge.mapper === 70) return new Mapper70_152(cartridge, false);
  if (cartridge.mapper === 74 || cartridge.mapper === 192) {
    const mapper4Options = cartridge && cartridge.mapperOptions
      ? (cartridge.mapperOptions.mapper4 || null)
      : null;
    return new MapperCore4Core(cartridge, mapper4Options);
  }
  if (cartridge.mapper === 73) return new Mapper73(cartridge);
  if (cartridge.mapper === 75) return new Mapper75(cartridge);
  if (cartridge.mapper === 76) return new Mapper76(cartridge);
  if (cartridge.mapper === 77) return new Mapper77(cartridge);
  if (cartridge.mapper === 78) return new Mapper78(cartridge);
  if (cartridge.mapper === 72) return new Mapper72_92(cartridge, false);
  if (cartridge.mapper === 92) return new Mapper72_92(cartridge, true);
  if (cartridge.mapper === 79) return new Mapper79(cartridge);
  if (cartridge.mapper === 80) return new Mapper80(cartridge);
  if (cartridge.mapper === 82) return new Mapper82(cartridge);
  if (cartridge.mapper === 83 || cartridge.mapper === 90) return new Mapper83(cartridge);
  if (cartridge.mapper === 91) return new Mapper91(cartridge);
  if (cartridge.mapper === 86) return new Mapper86(cartridge);
  if (cartridge.mapper === 87) return new Mapper87(cartridge);
  if (cartridge.mapper === 88) return new Mapper88(cartridge);
  if (cartridge.mapper === 89) return new Mapper89(cartridge);
  if (cartridge.mapper === 93) return new Mapper93(cartridge);
  if (cartridge.mapper === 94) return new Mapper94(cartridge);
  if (cartridge.mapper === 95) return new Mapper95(cartridge);
  if (cartridge.mapper === 96) return new Mapper96(cartridge);
  if (cartridge.mapper === 97) return new Mapper97(cartridge);
  if (cartridge.mapper === 105) return new Mapper1(cartridge);
  if (cartridge.mapper === 113) return new Mapper79(cartridge);
  if (cartridge.mapper === 180) return new Mapper180(cartridge);
  if (cartridge.mapper === 185) return new Mapper185(cartridge);
  if (cartridge.mapper === 206) {
    const mapper4Options = cartridge && cartridge.mapperOptions
      ? (cartridge.mapperOptions.mapper4 || null)
      : null;
    return new Mapper206(cartridge, mapper4Options);
  }
  if (cartridge.mapper === 119) {
    const mapper4Options = cartridge && cartridge.mapperOptions
      ? (cartridge.mapperOptions.mapper4 || null)
      : null;
    return new Mapper119(cartridge, mapper4Options);
  }
  if (cartridge.mapper === 159) return new Mapper16({ ...cartridge, submapper: 5 });
  if (cartridge.mapper === 157) return new Mapper16({ ...cartridge, submapper: 5 });
  if (cartridge.mapper === 153) return new Mapper16({ ...cartridge, submapper: 5 });
  if (cartridge.mapper === 154) return new Mapper154(cartridge);
  if (cartridge.mapper === 155) return new Mapper155(cartridge);
  if (cartridge.mapper === 232) return new Mapper232(cartridge);
  if (cartridge.mapper === 118) {
    const mapper4Options = cartridge && cartridge.mapperOptions
      ? (cartridge.mapperOptions.mapper4 || null)
      : null;
    return new Mapper118(cartridge, mapper4Options);
  }
  if (cartridge.mapper === 32) return new Mapper32(cartridge);
  if (cartridge.mapper === 33) return new Mapper33(cartridge);
  if (cartridge.mapper === 140) return new Mapper140(cartridge);
  if (cartridge.mapper === 152) return new Mapper70_152(cartridge, true);
  if (cartridge.mapper === 184) return new Mapper184(cartridge);
  if (cartridge.mapper === 186) return new Mapper186(cartridge);
  if (cartridge.mapper === 188) return new Mapper188(cartridge);
  if (cartridge.mapper === 48) return new Mapper48(cartridge);
  if (cartridge.mapper === 66) return new Mapper66(cartridge);
  if (cartridge.mapper === 71) return new Mapper71(cartridge);
  if (cartridge.mapper === 207) return new Mapper207(cartridge);
  if (cartridge.mapper === 547) return new Mapper547(cartridge);
  throw new Error(`Unsupported mapper ${cartridge.mapper}. Supported mappers: 0,1,2,3,4,5,6,7,9,10,11,13,15,16,18,19,21,22,23,24,25,26,32,33,34,48,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,82,83,85,86,87,88,89,90,91,92,93,94,95,96,97,105,113,118,119,140,152,153,154,155,157,159,166,167,180,184,185,186,188,192,206,207,210,228,232,547.`);
}

const mapperCoreExports = {
  MapperBase: MapperCoreBaseCore,
  Mapper0,
  Mapper1,
  Mapper2,
  Mapper3,
  Mapper5,
  Mapper6,
  Mapper4: MapperCore4Core,
  Mapper7,
  Mapper9,
  Mapper10,
  Mapper11,
  Mapper13,
  Mapper15,
  Mapper16,
  Mapper18,
  Mapper19,
  Mapper166,
  Mapper228,
  MapperVRC6,
  MapperVRC24,
  Mapper85,
  Mapper232,
  Mapper34,
  Mapper64,
  Mapper65,
  Mapper67,
  Mapper68,
  Mapper69,
  Mapper70_152,
  Mapper73,
  Mapper72_92,
  Mapper75,
  Mapper76,
  Mapper77,
  Mapper78,
  Mapper79,
  Mapper80,
  Mapper82,
  Mapper83,
  Mapper91,
  Mapper86,
  Mapper87,
  Mapper88,
  Mapper89,
  Mapper93,
  Mapper94,
  Mapper95,
  Mapper96,
  Mapper97,
  Mapper154,
  Mapper155,
  Mapper118,
  Mapper119,
  Mapper180,
  Mapper185,
  Mapper186,
  Mapper188,
  Mapper206,
  Mapper32,
  Mapper33,
  Mapper140,
  Mapper184,
  Mapper48,
  MapperTaitoTc0190Base,
  Mapper66,
  Mapper71,
  Mapper207,
  Mapper547,
  createMapper,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mapperCoreExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMapper = mapperCoreExports;
}
