let MapperA12EdgeFilterCore = null;
if (typeof require !== 'undefined') {
  try {
    ({ MapperA12EdgeFilter: MapperA12EdgeFilterCore } = require('./mapper-a12-edge-filter'));
  } catch (_err) {
    MapperA12EdgeFilterCore = null;
  }
}
if (!MapperA12EdgeFilterCore && typeof globalThis !== 'undefined' && globalThis.NESCoreMapperA12EdgeFilter) {
  MapperA12EdgeFilterCore = globalThis.NESCoreMapperA12EdgeFilter.MapperA12EdgeFilter;
}

class MapperBase {
  constructor(a12LowTicks = 8) {
    this.a12Filter = MapperA12EdgeFilterCore ? new MapperA12EdgeFilterCore(a12LowTicks) : null;
  }

  reset() {
    if (this.a12Filter && typeof this.a12Filter.reset === 'function') {
      this.a12Filter.reset();
    }
  }

  isIrqAsserted() {
    return false;
  }

  getMirroringMode(defaultMode) {
    return defaultMode || 'horizontal';
  }

  cpuReadLow(_addr, _openBus) {
    return null;
  }

  cpuWriteLow(_addr, _value) {
    return false;
  }

  onCpuPhaseTick(_phase) {}

  onMasterClockTick(_tick) {}

  onCartCe(_tick) {}

  onPpuDotTick(_dot) {}

  onCpuBusAccess(_access) {}

  onPpuAddressBus(access) {
    const ppuAddr = access && typeof access.busAddr === 'number'
      ? (access.busAddr & 0x3fff)
      : (access && typeof access.addr === 'number'
        ? (access.addr & 0x3fff)
        : 0);
    if (!this.a12Filter || typeof this.a12Filter.observeBus !== 'function') return;
    const dotClock = access && typeof access.dotClock === 'number'
      ? (access.dotClock >>> 0)
      : 0;
    const edge = this.a12Filter.observeBus(ppuAddr, dotClock);
    if (edge.qualifiedRise) {
      if (!access || typeof access !== 'object') {
        this.onQualifiedA12Rise(edge, { addr: ppuAddr, busAddr: ppuAddr, dotClock });
        return;
      }
      if ((access.addr & 0x3fff) === ppuAddr) {
        this.onQualifiedA12Rise(edge, access);
        return;
      }
      this.onQualifiedA12Rise(edge, {
        ...access,
        addr: ppuAddr,
      });
    }
  }

  onPpuAddressBusPattern(addr, dotClock) {
    const ppuAddr = (addr & 0x3fff);
    if (!this.a12Filter || typeof this.a12Filter.observeBus !== 'function') return;
    const edge = this.a12Filter.observeBus(ppuAddr, dotClock >>> 0);
    if (edge.qualifiedRise) {
      this.onQualifiedA12Rise(edge, {
        addr: ppuAddr,
        busAddr: ppuAddr,
        dotClock: dotClock >>> 0,
      });
    }
  }

  onQualifiedA12Rise(_edge, _access) {}
}

const mapperBaseExports = { MapperBase };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mapperBaseExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMapperBase = mapperBaseExports;
}
