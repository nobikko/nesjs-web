class MapperA12EdgeFilter {
  constructor(minLowTicks = 8) {
    this.minLowTicks = minLowTicks | 0;
    this._edgeScratch = {
      a12: false,
      rising: false,
      falling: false,
      lowTicks: 0,
      qualifiedRise: false,
    };
    this.reset();
  }

  reset() {
    this.initialized = false;
    this.lastA12 = false;
    this.lastDotClock = 0;
    this.lowSinceDotClock = 0;
  }

  observeBus(addr, dotClock) {
    const dot = (typeof dotClock === 'number') ? (dotClock >>> 0) : (this.lastDotClock >>> 0);
    const a12 = ((addr >> 12) & 0x01) !== 0;
    const out = this._edgeScratch;

    if (!this.initialized) {
      this.initialized = true;
      this.lastA12 = a12;
      this.lastDotClock = dot;
      this.lowSinceDotClock = dot;
      out.a12 = a12;
      out.rising = false;
      out.falling = false;
      out.lowTicks = 0;
      out.qualifiedRise = false;
      return out;
    }

    const rising = !this.lastA12 && a12;
    const falling = this.lastA12 && !a12;
    let lowTicks = 0;
    let qualifiedRise = false;

    if (rising) {
      lowTicks = (dot - this.lowSinceDotClock) >>> 0;
      qualifiedRise = lowTicks >= (this.minLowTicks >>> 0);
    }

    if (!a12 && falling) {
      this.lowSinceDotClock = dot;
    }

    this.lastA12 = a12;
    this.lastDotClock = dot;
    out.a12 = a12;
    out.rising = rising;
    out.falling = falling;
    out.lowTicks = lowTicks;
    out.qualifiedRise = qualifiedRise;
    return out;
  }

  observeBusFast(addr, dotClock) {
    const dot = (typeof dotClock === 'number') ? (dotClock >>> 0) : (this.lastDotClock >>> 0);
    const a12 = ((addr >> 12) & 0x01) !== 0;
    if (!this.initialized) {
      this.initialized = true;
      this.lastA12 = a12;
      this.lastDotClock = dot;
      this.lowSinceDotClock = dot;
      return false;
    }
    const rising = !this.lastA12 && a12;
    const falling = this.lastA12 && !a12;
    let qualifiedRise = false;
    if (rising) {
      const lowTicks = (dot - this.lowSinceDotClock) >>> 0;
      qualifiedRise = lowTicks >= (this.minLowTicks >>> 0);
    }
    if (!a12 && falling) {
      this.lowSinceDotClock = dot;
    }
    this.lastA12 = a12;
    this.lastDotClock = dot;
    return qualifiedRise;
  }

  observe(access) {
    const addr = access && typeof access.addr === 'number' ? access.addr : 0;
    const dotClock = access && typeof access.dotClock === 'number'
      ? (access.dotClock >>> 0)
      : (this.lastDotClock >>> 0);
    return this.observeBus(addr, dotClock);
  }
}

const mapperA12EdgeFilterExports = { MapperA12EdgeFilter };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = mapperA12EdgeFilterExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMapperA12EdgeFilter = mapperA12EdgeFilterExports;
}
