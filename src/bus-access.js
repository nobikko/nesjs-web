const BUS_ACCESS_ACTOR_CPU = 'cpu';
const BUS_ACCESS_ACTOR_RDY_REPEAT = 'rdy_repeat';
const BUS_ACCESS_ACTOR_OAM_DMA = 'oam_dma';
const BUS_ACCESS_ACTOR_DMC_DMA = 'dmc_dma';

const BUS_ACCESS_IO_DIRECT = 'direct';
const BUS_ACCESS_IO_NONE = 'none';
const BUS_ACCESS_IO_CPU_BUS_MIRROR = 'cpu_bus_mirror';

function createBusAccessContext(options) {
  const opts = options || {};
  const addr = opts.addr == null ? 0 : (opts.addr & 0xffff);
  return {
    actor: opts.actor || BUS_ACCESS_ACTOR_CPU,
    addr,
    cpuAddressBus: opts.cpuAddressBus == null ? addr : (opts.cpuAddressBus & 0xffff),
    externalBusValue: opts.externalBusValue == null ? null : (opts.externalBusValue & 0xff),
    currentCycle: opts.currentCycle == null ? null : (opts.currentCycle >>> 0),
    isPutCycle: opts.isPutCycle == null ? null : !!opts.isPutCycle,
    // Keep mode inference in normalizeBusAccessContext(actor, ...).
    ioReadMode: opts.ioReadMode == null ? null : opts.ioReadMode,
    ioWriteMode: opts.ioWriteMode == null ? null : opts.ioWriteMode,
  };
}

function normalizeBusAccessContext(context, addr, isWrite) {
  const a = addr & 0xffff;
  if (context && context.__normalizedBusAccess === true) {
    return context;
  }

  const ctx = context || {};
  const actor = ctx.actor || BUS_ACCESS_ACTOR_CPU;
  let ioReadMode = ctx.ioReadMode;
  let ioWriteMode = ctx.ioWriteMode;
  if (!ioReadMode) {
    if (actor === BUS_ACCESS_ACTOR_OAM_DMA) ioReadMode = BUS_ACCESS_IO_CPU_BUS_MIRROR;
    else if (actor === BUS_ACCESS_ACTOR_DMC_DMA) ioReadMode = BUS_ACCESS_IO_CPU_BUS_MIRROR;
    else ioReadMode = BUS_ACCESS_IO_DIRECT;
  }
  if (!ioWriteMode) {
    ioWriteMode = actor === BUS_ACCESS_ACTOR_CPU ? BUS_ACCESS_IO_DIRECT : BUS_ACCESS_IO_NONE;
  }

  return {
    __normalizedBusAccess: true,
    actor,
    addr: ctx.addr == null ? a : (ctx.addr & 0xffff),
    cpuAddressBus: ctx.cpuAddressBus == null ? a : (ctx.cpuAddressBus & 0xffff),
    externalBusValue: ctx.externalBusValue == null ? null : (ctx.externalBusValue & 0xff),
    currentCycle: ctx.currentCycle == null ? null : (ctx.currentCycle >>> 0),
    isPutCycle: ctx.isPutCycle == null ? false : !!ctx.isPutCycle,
    ioReadMode,
    ioWriteMode,
    isWrite: !!isWrite,
  };
}

const busAccessExports = {
  BUS_ACCESS_ACTOR_CPU,
  BUS_ACCESS_ACTOR_RDY_REPEAT,
  BUS_ACCESS_ACTOR_OAM_DMA,
  BUS_ACCESS_ACTOR_DMC_DMA,
  BUS_ACCESS_IO_DIRECT,
  BUS_ACCESS_IO_NONE,
  BUS_ACCESS_IO_CPU_BUS_MIRROR,
  createBusAccessContext,
  normalizeBusAccessContext,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = busAccessExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreBusAccess = busAccessExports;
}
