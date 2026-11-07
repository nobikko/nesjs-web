class PpuIoPipeline {
  constructor(host) {
    this.host = host;
    this._useDirectRenderMask = !Object.prototype.hasOwnProperty.call(host, 'isPpuRenderingEnabled');
    this._aleReadMetaScratch = {
      observe: true,
      origin: null,
      stage: null,
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
    this._aleWriteMetaScratch = {
      observe: true,
      origin: null,
      stage: null,
      slot: null,
      ale: true,
      rawAddr: 0,
      busAddr: 0,
    };
  }

  advanceCpuIoBusDecay(cpuCycles) {
    const ppu = this.host.ppuState;
    const count = cpuCycles | 0;
    if (count <= 0) return;
    if ((ppu.ioBusDecayCpu | 0) <= 0) return;

    let decayHigh = ppu.ioBusDecayHighCpu | 0;
    if (decayHigh > 0) {
      decayHigh -= count;
      if (decayHigh <= 0) {
        ppu.ioBus &= 0x1f;
        decayHigh = 0;
      }
      ppu.ioBusDecayHighCpu = decayHigh;
    }
    let decayLow = ppu.ioBusDecayLowCpu | 0;
    if (decayLow > 0) {
      decayLow -= count;
      if (decayLow <= 0) {
        ppu.ioBus &= 0xe0;
        decayLow = 0;
      }
      ppu.ioBusDecayLowCpu = decayLow;
    }
    ppu.ioBusDecayCpu = decayHigh >= decayLow ? decayHigh : decayLow;
  }

  queue2007Read() {
    this.host.ppuState.read2007Pulse = true;
  }

  queue2007Write() {
    this.host.ppuState.write2007Pulse = true;
  }

  latchBusAddress(addr14) {
    const ppu = this.host.ppuState;
    const a = addr14 & 0x3fff;
    ppu.vramAddressLowLatch = a & 0xff;
    ppu.vramAddressBus = ((a & 0x3f00) | (ppu.vramAddressLowLatch & 0xff)) & 0x3fff;
    ppu.vramAleActive = true;
  }

  resolveLatchedBusAddress(addr14) {
    const ppu = this.host.ppuState;
    const a = addr14 & 0x3fff;
    return ((a & 0x3f00) | (ppu.vramAddressLowLatch & 0xff)) & 0x3fff;
  }

  ppuReadWithAle(addr, accessMeta = null) {
    const rawAddr = addr & 0x3fff;
    const ppu = this.host.ppuState;
    ppu.vramAddressLowLatch = rawAddr & 0xff;
    const busAddr = ((rawAddr & 0x3f00) | (ppu.vramAddressLowLatch & 0xff)) & 0x3fff;
    ppu.vramAddressBus = busAddr;
    ppu.vramAleActive = true;
    let meta;
    if (accessMeta && accessMeta.__aleMeta === true) {
      accessMeta.ale = true;
      accessMeta.rawAddr = rawAddr;
      accessMeta.busAddr = busAddr;
      meta = accessMeta;
    } else {
      meta = this._aleReadMetaScratch;
      if (accessMeta && typeof accessMeta === 'object') {
        meta.observe = accessMeta.observe !== false;
        meta.origin = accessMeta.origin == null ? null : accessMeta.origin;
        meta.stage = accessMeta.stage == null ? null : accessMeta.stage;
        meta.slot = (typeof accessMeta.slot === 'number') ? (accessMeta.slot | 0) : null;
      } else {
        meta.observe = true;
        meta.origin = null;
        meta.stage = null;
        meta.slot = null;
      }
      meta.ale = true;
      meta.rawAddr = rawAddr;
      meta.busAddr = busAddr;
    }
    const value = this.host.ppuAddressSpace.read(busAddr, meta) & 0xff;
    ppu.vramAleActive = false;
    return value;
  }

  ppuWriteWithAle(addr, value, accessMeta = null) {
    const rawAddr = addr & 0x3fff;
    const ppu = this.host.ppuState;
    ppu.vramAddressLowLatch = rawAddr & 0xff;
    const busAddr = ((rawAddr & 0x3f00) | (ppu.vramAddressLowLatch & 0xff)) & 0x3fff;
    ppu.vramAddressBus = busAddr;
    ppu.vramAleActive = true;
    let meta;
    if (accessMeta && accessMeta.__aleMeta === true) {
      accessMeta.ale = true;
      accessMeta.rawAddr = rawAddr;
      accessMeta.busAddr = busAddr;
      meta = accessMeta;
    } else {
      meta = this._aleWriteMetaScratch;
      if (accessMeta && typeof accessMeta === 'object') {
        meta.observe = accessMeta.observe !== false;
        meta.origin = accessMeta.origin == null ? null : accessMeta.origin;
        meta.stage = accessMeta.stage == null ? null : accessMeta.stage;
        meta.slot = (typeof accessMeta.slot === 'number') ? (accessMeta.slot | 0) : null;
      } else {
        meta.observe = true;
        meta.origin = null;
        meta.stage = null;
        meta.slot = null;
      }
      meta.ale = true;
      meta.rawAddr = rawAddr;
      meta.busAddr = busAddr;
    }
    this.host.ppuAddressSpace.write(busAddr, value & 0xff, meta);
    ppu.vramAleActive = false;
  }

  clockTimingState() {
    const host = this.host;
    const ppu = host.ppuState;
    const rendering = this._useDirectRenderMask
      ? ((ppu.mask & 0x18) !== 0)
      : host.isPpuRenderingEnabled();
    // MiSTer ppu.sv keeps 3-bit render/obj/bg shift registers (re_sr/eo_sr/eb_sr).
    // Bit1 drives current-cycle rendering enable; bit2 is delayed rendering.
    ppu.renderEnableShift = ((ppu.renderEnableShift << 1) | (rendering ? 1 : 0)) & 0x07;
    ppu.bgEnableShift = ((ppu.bgEnableShift << 1) | ((ppu.mask & 0x08) ? 1 : 0)) & 0x07;
    ppu.objEnableShift = ((ppu.objEnableShift << 1) | ((ppu.mask & 0x10) ? 1 : 0)) & 0x07;
    if (ppu.pendingMaskWriteValid === true) {
      ppu.mask = ppu.pendingMaskWriteValue & 0xff;
      ppu.pendingMaskWriteValid = false;
    }
    const readPulse = ppu.read2007Pulse ? 1 : 0;
    const writePulse = ppu.write2007Pulse ? 1 : 0;
    if (readPulse) {
      ppu.pending2007ReadValid = !!ppu.queued2007ReadValid;
      ppu.pending2007ReadAddr = ppu.queued2007ReadAddr & 0x3fff;
      ppu.pending2007ReadBufferAddr = ppu.queued2007ReadBufferAddr & 0x3fff;
      ppu.pending2007ReadBusReady = false;
      ppu.pending2007ReadBusValue = 0;
      ppu.queued2007ReadValid = false;
    }
    if (writePulse) {
      ppu.pending2007WriteValid = !!ppu.queued2007WriteValid;
      ppu.pending2007WriteAddr = ppu.queued2007WriteAddr & 0x3fff;
      ppu.pending2007WriteValue = ppu.queued2007WriteValue & 0xff;
      ppu.pending2007WriteCommitted = false;
      ppu.queued2007WriteValid = false;
    }
    ppu.read2007Delayed = (((ppu.read2007Delayed & 0x1f) << 1) | readPulse) & 0x1f;
    ppu.write2007Delayed = (((ppu.write2007Delayed & 0x1f) << 1) | writePulse) & 0x1f;
    ppu.read2007Pulse = false;
    ppu.write2007Pulse = false;
    ppu.read2007Shift = ppu.read2007Delayed & 0x1f;
    ppu.write2007Shift = ppu.write2007Delayed & 0x1f;
    ppu.read2007Pending = (ppu.read2007Delayed & 0x1f) !== 0;
    ppu.write2007Pending = (ppu.write2007Delayed & 0x1f) !== 0;
    this.process2007DelayedOps();
  }

  process2007DelayedOps() {
    const host = this.host;
    const ppu = host.ppuState;
    const readD = ppu.read2007Delayed & 0x1f;
    const writeD = ppu.write2007Delayed & 0x1f;
    const alePhase = ((readD | writeD) & 0x02) !== 0;

    ppu.vramAleActive = alePhase;

    if (alePhase && ppu.pending2007ReadValid) {
      this.latchBusAddress(ppu.pending2007ReadAddr & 0x3fff);
    }
    if (alePhase && ppu.pending2007WriteValid) {
      this.latchBusAddress(ppu.pending2007WriteAddr & 0x3fff);
    }

    if ((writeD & 0x04) !== 0 && ppu.pending2007WriteValid && !ppu.pending2007WriteCommitted) {
      const busAddr = this.resolveLatchedBusAddress(ppu.pending2007WriteAddr & 0x3fff);
      host.ppuWrite(
        busAddr,
        ppu.pending2007WriteValue & 0xff,
        {
          origin: 'cpu_2007',
          stage: 'write_bus',
          ale: !!alePhase,
          rawAddr: ppu.pending2007WriteAddr & 0x3fff,
          busAddr,
        }
      );
      ppu.pending2007WriteCommitted = true;
    }

    if ((readD & 0x04) !== 0 && ppu.pending2007ReadValid && !ppu.pending2007ReadBusReady) {
      const busAddr = this.resolveLatchedBusAddress(ppu.pending2007ReadBufferAddr & 0x3fff);
      ppu.pending2007ReadBusValue = host.ppuRead(
        busAddr,
        {
          origin: 'cpu_2007',
          stage: 'read_bus',
          ale: !!alePhase,
          rawAddr: ppu.pending2007ReadBufferAddr & 0x3fff,
          busAddr,
        }
      ) & 0xff;
      // MiSTer-style ALE/vram_r overlap: when the ALE phase and the VRAM read
      // phase align on the same delayed $2007 read step, the external low-byte
      // latch captures read data instead of the low address byte.
      if (alePhase) {
        ppu.vramAddressLowLatch = ppu.pending2007ReadBusValue & 0xff;
        ppu.vramAddressBus = ((ppu.pending2007ReadBufferAddr & 0x3f00) | (ppu.vramAddressLowLatch & 0xff)) & 0x3fff;
      }
      ppu.pending2007ReadBusReady = true;
    }

    if ((readD & 0x08) !== 0 && ppu.pending2007ReadValid) {
      if (ppu.pending2007ReadBusReady) {
        ppu.dataBuffer = ppu.pending2007ReadBusValue & 0xff;
      }
      ppu.pending2007ReadValid = false;
      ppu.pending2007ReadBusReady = false;
      ppu.pending2007ReadBusValue = 0;
      host.incrementPpuVAfterDataAccess();
    }

    if ((writeD & 0x08) !== 0 && ppu.pending2007WriteValid) {
      ppu.pending2007WriteValid = false;
      ppu.pending2007WriteCommitted = false;
      host.incrementPpuVAfterDataAccess();
    }
  }
}

const ppuIoPipelineExports = { PpuIoPipeline };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuIoPipelineExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuIoPipeline = ppuIoPipelineExports;
}
