function parseINESBytes(bytes) {
  if (!bytes || typeof bytes.length !== 'number') {
    throw new Error('ROM bytes are required');
  }

  const rom = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (rom.length < 16) throw new Error('ROM too small');
  if (!(rom[0] === 0x4e && rom[1] === 0x45 && rom[2] === 0x53 && rom[3] === 0x1a)) {
    throw new Error('Invalid iNES magic');
  }

  let prgBanks = rom[4];
  let chrBanks = rom[5];
  const flags6 = rom[6];
  const flags7 = rom[7];
  const isNes2 = (flags7 & 0x0c) === 0x08;
  const mapperUpper = isNes2 ? ((rom[8] & 0x0f) << 8) : 0;
  const hasTrainer = (flags6 & 0x04) !== 0;
  const mapper = (flags6 >> 4) | (flags7 & 0xf0) | mapperUpper;
  const mirroring = (flags6 & 0x08) ? 'four' : ((flags6 & 0x01) ? 'vertical' : 'horizontal');
  const submapper = isNes2 ? ((rom[8] >> 4) & 0x0f) : 0;
  const timingMode = isNes2 ? (rom[12] & 0x03) : 0;
  const battery = (flags6 & 0x02) !== 0;

  // PRG-RAM sizing:
  // - iNES: byte8 is 8KB units (0 => 8KB default).
  // - NES2.0: byte10 nibbles are shift counts where size = 64 << shift bytes (0 => none).
  let prgRamSize = 0;
  let prgNvRamSize = 0;
  if (isNes2) {
    const prgRamShift = rom[10] & 0x0f;
    const prgNvRamShift = (rom[10] >> 4) & 0x0f;
    prgRamSize = prgRamShift === 0 ? 0 : (64 << prgRamShift);
    prgNvRamSize = prgNvRamShift === 0 ? 0 : (64 << prgNvRamShift);
  } else {
    const units = rom[8] & 0xff;
    prgRamSize = (units === 0 ? 1 : units) * 0x2000;
    prgNvRamSize = battery ? prgRamSize : 0;
  }

  let offset = 16;
  if (hasTrainer) offset += 512;

  let prgSize = prgBanks * 0x4000;
  let chrSize = chrBanks * 0x2000;
  const payloadSize = Math.max(0, rom.length - offset);
  const expectedSize = prgSize + chrSize;
  // Some legacy dumps carry malformed size bytes (common in old hacked/headered sets).
  // If header sizes do not fit the payload, infer a conservative iNES-like split from file size.
  if (expectedSize > payloadSize) {
    const inferredPrgBanks = Math.max(1, Math.min(0xff, Math.floor(payloadSize / 0x4000)));
    const inferredPrgSize = inferredPrgBanks * 0x4000;
    const rem = Math.max(0, payloadSize - inferredPrgSize);
    const inferredChrBanks = Math.max(0, Math.min(0xff, Math.floor(rem / 0x2000)));
    prgBanks = inferredPrgBanks;
    chrBanks = inferredChrBanks;
    prgSize = prgBanks * 0x4000;
    chrSize = chrBanks * 0x2000;
  }

  // Mesen-equivalent fallback for malformed legacy NROM dumps:
  // Some headered hacks declare 16KB PRG + 0KB CHR, but actual payload is 8KB PRG + 8KB CHR.
  // Detect only the narrow malformed shape to avoid impacting valid NROM-128 + CHR-RAM titles.
  if (
    mapper === 0 &&
    prgBanks === 1 &&
    chrBanks === 0 &&
    payloadSize === 0x4000
  ) {
    const rvLo16 = rom[offset + 0x3ffc] | 0;
    const rvHi16 = rom[offset + 0x3ffd] | 0;
    const reset16 = ((rvHi16 << 8) | rvLo16) & 0xffff;
    const headerVectorLooksInvalid = !(reset16 >= 0x8000 && reset16 <= 0xfffa);
    if (headerVectorLooksInvalid) {
      const rvLo8 = rom[offset + 0x1ffc] | 0;
      const rvHi8 = rom[offset + 0x1ffd] | 0;
      const reset8 = ((rvHi8 << 8) | rvLo8) & 0xffff;
      if (reset8 >= 0x8000 && reset8 <= 0xfffa) {
        prgSize = 0x2000;
        chrSize = 0x2000;
        chrBanks = 1;
      }
    }
  }

  const prgRom = new Uint8Array(rom.subarray(offset, offset + prgSize));
  offset += prgSize;

  const chrRom = chrSize > 0
    ? new Uint8Array(rom.subarray(offset, offset + chrSize))
    : new Uint8Array(0x2000);

  return {
    prgBanks,
    chrBanks,
    mapper,
    mirroring,
    nes2: isNes2,
    format: isNes2 ? 'nes2' : 'ines1',
    submapper,
    timingMode,
    battery,
    prgRamSize,
    prgNvRamSize,
    mapperOptions: {
      mapper4: isNes2 && mapper === 4 ? { submapper } : null,
    },
    prgRom,
    chrRom,
  };
}

const inesExports = { parseINESBytes };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = inesExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreINES = inesExports;
}
