class PpuAddressSpace {
  constructor(host) {
    this.host = host;
    this._mapperBusAccessScratch = {
      addr: 0,
      rawAddr: 0,
      busAddr: 0,
      ale: false,
      origin: null,
      stage: null,
      isWrite: false,
      value: 0,
      scanline: 0,
      dot: 0,
      dotClock: 0,
      rendering: false,
    };
    this._mapperBusDispatch = null;
    this._refreshMapperBusDispatch();
  }

  _refreshMapperBusDispatch() {
    const host = this.host;
    const mapper = host ? host.mapper : null;
    const hooks = host ? host.mapperHooks : null;
    let mode = 0;
    if (mapper && typeof mapper.onPpuAddressBus === 'function') {
      const busHookEnabled = !hooks || hooks.onPpuAddressBus;
      if (!busHookEnabled) {
        mode = 0;
      } else if ((hooks && hooks.onPpuAddressBusDirectPattern) && typeof mapper.onPpuAddressBusPattern === 'function') {
        mode = 1;
      } else if (hooks && hooks.onPpuAddressBusPatternOnly) {
        mode = (typeof mapper.onPpuAddressBusPattern === 'function') ? 2 : 3;
      } else {
        mode = 4;
      }
    }
    this._mapperBusDispatch = { mode, mapper };
  }

  _notifyMapperPpuBus(addr, isWrite, value, accessMeta = null) {
    const host = this.host;
    const dispatch = this._mapperBusDispatch || (this._refreshMapperBusDispatch(), this._mapperBusDispatch);
    if (!dispatch || dispatch.mode === 0 || !dispatch.mapper) return;
    const mapper = dispatch.mapper;
    const dotClock = host.ppuState ? (host.ppuState.dotClock >>> 0) : 0;
    if (dispatch.mode === 1) {
      const busAddr = accessMeta && typeof accessMeta.busAddr === 'number'
        ? (accessMeta.busAddr & 0x3fff)
        : (addr & 0x3fff);
      mapper.onPpuAddressBusPattern(busAddr, dotClock);
      return;
    }
    const rawAddr = accessMeta && typeof accessMeta.rawAddr === 'number'
      ? (accessMeta.rawAddr & 0x3fff)
      : (addr & 0x3fff);
    const busAddr = accessMeta && typeof accessMeta.busAddr === 'number'
      ? (accessMeta.busAddr & 0x3fff)
      : (addr & 0x3fff);
    if (dispatch.mode === 2 || dispatch.mode === 3) {
      if (busAddr >= 0x2000) return;
      if (dispatch.mode === 2) {
        mapper.onPpuAddressBusPattern(busAddr, dotClock);
        return;
      }
      const compactAccess = this._mapperBusAccessScratch;
      compactAccess.addr = busAddr;
      compactAccess.busAddr = busAddr;
      compactAccess.rawAddr = rawAddr;
      compactAccess.dotClock = dotClock;
      mapper.onPpuAddressBus(compactAccess);
      return;
    }
    const ppu = host.ppuState || null;
    const access = this._mapperBusAccessScratch;
    access.addr = addr & 0x3fff;
    access.rawAddr = rawAddr;
    access.busAddr = busAddr;
    access.ale = !!(accessMeta && accessMeta.ale);
    const origin = accessMeta ? accessMeta.origin : null;
    access.origin = (origin == null || typeof origin === 'string') ? (origin || null) : String(origin);
    const stage = accessMeta ? accessMeta.stage : null;
    access.stage = (stage == null || typeof stage === 'string') ? (stage || null) : String(stage);
    access.isWrite = !!isWrite;
    access.value = value & 0xff;
    access.scanline = ppu ? (ppu.scanline | 0) : 0;
    access.dot = ppu ? (ppu.dot | 0) : 0;
    access.dotClock = dotClock;
    if (host.isPpuRenderingEnabledLatched && typeof host.isPpuRenderingEnabledLatched === 'function') {
      access.rendering = !!host.isPpuRenderingEnabledLatched();
    } else if (host.isPpuRenderingEnabled && typeof host.isPpuRenderingEnabled === 'function') {
      access.rendering = !!host.isPpuRenderingEnabled();
    } else if (ppu && typeof ppu.renderEnableShift === 'number') {
      access.rendering = (ppu.renderEnableShift & 0x02) !== 0;
    } else {
      access.rendering = !!(ppu && (ppu.mask & 0x18) !== 0);
    }
    mapper.onPpuAddressBus(access);
  }

  _shouldObserveMapperBus(accessMeta) {
    if (!accessMeta || typeof accessMeta !== 'object') return true;
    return accessMeta.observe !== false;
  }

  mirrorNametableAddr(addr) {
    const host = this.host;
    const a = addr & 0x0fff;
    if (host.mapper && typeof host.mapper.mapNametableAddr === 'function') {
      const mapped = host.mapper.mapNametableAddr(a);
      if (typeof mapped === 'number' && Number.isFinite(mapped)) {
        return mapped & 0x0fff;
      }
    }
    const table = (a >> 10) & 0x03;
    const offset = a & 0x03ff;
    const defaultMode = host.cartridge ? host.cartridge.mirroring : 'horizontal';
    const mirroring = host.mapper && typeof host.mapper.getMirroringMode === 'function'
      ? host.mapper.getMirroringMode(defaultMode)
      : defaultMode;

    if (mirroring === 'four') {
      return a & 0x0fff;
    }

    if (mirroring === 'vertical') {
      const physTable = table & 0x01;
      return (physTable * 0x400) + offset;
    }
    if (mirroring === 'horizontal') {
      const physTable = (table >> 1) & 0x01;
      return (physTable * 0x400) + offset;
    }
    if (mirroring === 'single0') {
      return offset;
    }
    if (mirroring === 'single1') {
      return 0x400 + offset;
    }
    return a & 0x07ff;
  }

  read(addr, accessMeta = null) {
    const host = this.host;
    const a = addr & 0x3fff;
    const observeBus = this._shouldObserveMapperBus(accessMeta);
    if (a < 0x2000) {
      const value = host.mapper.ppuRead(a) & 0xff;
      if (observeBus) this._notifyMapperPpuBus(a, false, value, accessMeta);
      return value;
    }
    if (a < 0x3f00) {
      let value;
      if (host.mapper && host.mapper.readNametable) {
        const mapped = host.mapper.readNametable(a);
        if (typeof mapped === 'number') {
          value = mapped & 0xff;
        }
      }
      if (value === undefined) {
        value = host.vram[this.mirrorNametableAddr(a)] & 0xff;
      }
      if (host.mapper && host.mapper.onNametableRead) {
        host.mapper.onNametableRead(a, value);
      }
      if (observeBus) this._notifyMapperPpuBus(a, false, value, accessMeta);
      return value;
    }

    const palAddr = a & 0x1f;
    const mirrored = (palAddr === 0x10 || palAddr === 0x14 || palAddr === 0x18 || palAddr === 0x1c)
      ? palAddr - 0x10
      : palAddr;
    const value = host.palette[mirrored] & 0x3f;
    if (observeBus) this._notifyMapperPpuBus(a, false, value, accessMeta);
    return value;
  }

  write(addr, value, accessMeta = null) {
    const host = this.host;
    const a = addr & 0x3fff;
    const v = value & 0xff;
    const observeBus = this._shouldObserveMapperBus(accessMeta);

    if (a < 0x2000) {
      host.mapper.ppuWrite(a, v);
      if (observeBus) this._notifyMapperPpuBus(a, true, v, accessMeta);
      return;
    }
    if (a < 0x3f00) {
      if (host.mapper && host.mapper.writeNametable && host.mapper.writeNametable(a, v)) {
        if (observeBus) this._notifyMapperPpuBus(a, true, v, accessMeta);
        return;
      }
      host.vram[this.mirrorNametableAddr(a)] = v;
      if (observeBus) this._notifyMapperPpuBus(a, true, v, accessMeta);
      return;
    }

    const palAddr = a & 0x1f;
    const mirrored = (palAddr === 0x10 || palAddr === 0x14 || palAddr === 0x18 || palAddr === 0x1c)
      ? palAddr - 0x10
      : palAddr;
    host.palette[mirrored] = v & 0x3f;
    if (observeBus) this._notifyMapperPpuBus(a, true, v, accessMeta);
  }
}

const ppuAddressSpaceExports = { PpuAddressSpace };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ppuAddressSpaceExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCorePpuAddressSpace = ppuAddressSpaceExports;
}
