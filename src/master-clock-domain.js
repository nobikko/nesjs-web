const MASTER_CLOCK_FLAG_PPU_CE = 0x01;
const MASTER_CLOCK_FLAG_HALF_CE = 0x02;
const MASTER_CLOCK_FLAG_CPU_CE = 0x04;
const masterClockStepFlags = new Uint8Array(13);
for (let s = 1; s <= 12; s += 1) {
  let flags = 0;
  if (s === 4 || s === 8 || s === 12) flags |= MASTER_CLOCK_FLAG_PPU_CE;
  if (s === 6 || s === 12) flags |= MASTER_CLOCK_FLAG_HALF_CE;
  if (s === 12) flags |= MASTER_CLOCK_FLAG_CPU_CE;
  masterClockStepFlags[s] = flags & 0xff;
}

class MasterClockDomain {
  constructor(nes) {
    this.nes = nes;
    this.masterClock = 0;
    this.subClock = 0;
  }

  reset() {
    this.masterClock = 0;
    this.subClock = 0;
  }

  _advanceMasterClocks(masterClocks, options = null) {
    const nes = this.nes;
    const cpuState = nes.cpuState;
    const phaseState = cpuState && cpuState.phase ? cpuState.phase : null;
    if (!phaseState || typeof phaseState.beginHalfTick !== 'function') {
      throw new Error('CPU phase clock state not initialized');
    }
    const count = masterClocks | 0;
    if (count <= 0) return 0;
    const opts = options || null;
    const onMasterTick = (opts && typeof opts.onMasterTick === 'function') ? opts.onMasterTick : null;
    const accessFn = (opts && typeof opts.accessFn === 'function') ? opts.accessFn : null;
    const accessSubClock = accessFn ? ((opts.accessSubClock | 0) || 8) : 0;
    const hasMasterTickHook = typeof nes.onMasterClockTick === 'function';
    const hasCpuPhaseTick = typeof nes.onCpuPhaseTick === 'function';
    const useInlineMasterHook = !onMasterTick
      && !!nes.useInlineMasterClockTick
      && typeof nes.onMasterClockTickInline === 'function';
    const needsMasterTickObjectHook = hasMasterTickHook && !useInlineMasterHook;
    const hasDecayAdvance = typeof nes.advancePpuIoBusDecay === 'function';
    const canDirectPpuTick = !!(
      nes._fastDirectDomains === true &&
      nes.ppuDotEngine &&
      typeof nes.ppuDotEngine.tick === 'function'
    );
    const ppuTickTarget = canDirectPpuTick ? nes.ppuDotEngine : null;
    let masterClock = this.masterClock >>> 0;
    let subClock = this.subClock | 0;
    const total = count >>> 0;
    const useFastPath = !onMasterTick && !accessFn && !needsMasterTickObjectHook;
    if (useFastPath) {
      if (useInlineMasterHook) {
        let remaining = count | 0;
        while (remaining >= 12 && subClock === 0) {
          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(1, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(2, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(3, false);

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);
          nes.onMasterClockTickInline(4, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(5, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(6, false);
          {
            const phase = phaseState.beginHalfTick(masterClock, 6);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(7, false);

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);
          nes.onMasterClockTickInline(8, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(9, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(10, false);

          masterClock = (masterClock + 1) >>> 0;
          nes.onMasterClockTickInline(11, false);

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);
          nes.onMasterClockTickInline(12, true);
          {
            const phase = phaseState.beginHalfTick(masterClock, 12);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }
          nes.tickApu(1);
          cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
          if (hasDecayAdvance) {
            nes.advancePpuIoBusDecay(1);
          }
          subClock = 0;
          remaining -= 12;
        }

        for (let i = 0; i < remaining; i += 1) {
          masterClock = (masterClock + 1) >>> 0;
          subClock += 1;
          const flags = masterClockStepFlags[subClock] | 0;
          const cpuCe = (flags & MASTER_CLOCK_FLAG_CPU_CE) !== 0;
          if ((flags & MASTER_CLOCK_FLAG_PPU_CE) !== 0) {
            if (ppuTickTarget) ppuTickTarget.tick(1);
            else nes.tickPPU(1);
          }
          nes.onMasterClockTickInline(subClock, cpuCe);
          if ((flags & MASTER_CLOCK_FLAG_HALF_CE) !== 0) {
            const phase = phaseState.beginHalfTick(masterClock, subClock);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }
          if (cpuCe) {
            subClock = 0;
            nes.tickApu(1);
            cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
            if (hasDecayAdvance) {
              nes.advancePpuIoBusDecay(1);
            }
          }
        }
      } else {
        let remaining = count | 0;
        while (remaining >= 12 && subClock === 0) {
          masterClock = (masterClock + 1) >>> 0;
          masterClock = (masterClock + 1) >>> 0;
          masterClock = (masterClock + 1) >>> 0;

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);

          masterClock = (masterClock + 1) >>> 0;

          masterClock = (masterClock + 1) >>> 0;
          {
            const phase = phaseState.beginHalfTick(masterClock, 6);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }

          masterClock = (masterClock + 1) >>> 0;

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);

          masterClock = (masterClock + 1) >>> 0;
          masterClock = (masterClock + 1) >>> 0;
          masterClock = (masterClock + 1) >>> 0;

          masterClock = (masterClock + 1) >>> 0;
          if (ppuTickTarget) ppuTickTarget.tick(1);
          else nes.tickPPU(1);
          {
            const phase = phaseState.beginHalfTick(masterClock, 12);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }
          nes.tickApu(1);
          cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
          if (hasDecayAdvance) {
            nes.advancePpuIoBusDecay(1);
          }
          subClock = 0;
          remaining -= 12;
        }

        for (let i = 0; i < remaining; i += 1) {
          masterClock = (masterClock + 1) >>> 0;
          subClock += 1;
          const flags = masterClockStepFlags[subClock] | 0;
          const cpuCe = (flags & MASTER_CLOCK_FLAG_CPU_CE) !== 0;
          if ((flags & MASTER_CLOCK_FLAG_PPU_CE) !== 0) {
            if (ppuTickTarget) ppuTickTarget.tick(1);
            else nes.tickPPU(1);
          }
          if ((flags & MASTER_CLOCK_FLAG_HALF_CE) !== 0) {
            const phase = phaseState.beginHalfTick(masterClock, subClock);
            if (hasCpuPhaseTick) {
              nes.onCpuPhaseTick(phase);
            }
            phaseState.commitHalfTick();
          }
          if (cpuCe) {
            subClock = 0;
            nes.tickApu(1);
            cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
            if (hasDecayAdvance) {
              nes.advancePpuIoBusDecay(1);
            }
          }
        }
      }
      this.masterClock = masterClock >>> 0;
      this.subClock = subClock | 0;
      return count;
    }

    for (let i = 0; i < count; i += 1) {
      masterClock = (masterClock + 1) >>> 0;
      subClock += 1;
      const flags = masterClockStepFlags[subClock] | 0;
      const ppuCe = (flags & MASTER_CLOCK_FLAG_PPU_CE) !== 0;
      const halfCe = (flags & MASTER_CLOCK_FLAG_HALF_CE) !== 0;
      const cpuCe = (flags & MASTER_CLOCK_FLAG_CPU_CE) !== 0;
      const cartCe = subClock === 10;
      const runAccessNow = !!(accessFn && subClock === accessSubClock);
      if (needsMasterTickObjectHook || onMasterTick || halfCe || runAccessNow) {
        this.masterClock = masterClock >>> 0;
        this.subClock = subClock | 0;
      }

      if (useInlineMasterHook) {
        nes.onMasterClockTickInline(subClock, cpuCe);
      } else if (needsMasterTickObjectHook) {
        nes.onMasterClockTick({
          masterClock,
          subClock: subClock >>> 0,
          cartCe,
          cpuCe,
          ppuCe,
          halfCe,
        });
      }

      if (ppuCe) {
        if (ppuTickTarget) ppuTickTarget.tick(1);
        else nes.tickPPU(1);
      }

      if (halfCe) {
        const phase = phaseState.beginHalfTick(masterClock, subClock);
        if (hasCpuPhaseTick) {
          nes.onCpuPhaseTick(phase);
        }
        phaseState.commitHalfTick();
      }

      if (onMasterTick) {
        onMasterTick({
          masterClock,
          subClock: subClock >>> 0,
          step: (i + 1) >>> 0,
          total,
        });
      }

      if (runAccessNow) {
        accessFn();
      }

      if (cpuCe) {
        subClock = 0;
        this.subClock = 0;
        nes.tickApu(1);
        cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
        if (hasDecayAdvance) {
          nes.advancePpuIoBusDecay(1);
        }
      }
    }
    this.masterClock = masterClock >>> 0;
    this.subClock = subClock | 0;
    return count;
  }

  advanceMasterClocks(masterClocks) {
    return this._advanceMasterClocks(masterClocks | 0);
  }

  advanceCpuBusCycle() {
    return this._advanceMasterClocks(12);
  }

  _canUseDirectCpuAccessPath() {
    const nes = this.nes;
    if (!nes || !nes.cpuState || !nes.cpuState.phase) return false;
    if ((this.subClock | 0) !== 0) return false;
    const useInlineMasterHook = !!nes.useInlineMasterClockTick
      && typeof nes.onMasterClockTickInline === 'function';
    const hasMasterTickHook = typeof nes.onMasterClockTick === 'function';
    return !hasMasterTickHook || useInlineMasterHook;
  }

  _advanceCpuBusCycleDirectAccess(addr, isWrite, value = 0) {
    const nes = this.nes;
    const cpuState = nes.cpuState;
    const phaseState = cpuState && cpuState.phase ? cpuState.phase : null;
    if (!phaseState || typeof phaseState.beginHalfTick !== 'function') {
      throw new Error('CPU phase clock state not initialized');
    }
    const a = addr & 0xffff;
    const v = value & 0xff;
    const useInlineMasterHook = !!nes.useInlineMasterClockTick
      && typeof nes.onMasterClockTickInline === 'function';
    const hasCpuPhaseTick = typeof nes.onCpuPhaseTick === 'function';
    const hasDecayAdvance = typeof nes.advancePpuIoBusDecay === 'function';
    const canDirectPpuTick = !!(
      nes._fastDirectDomains === true &&
      nes.ppuDotEngine &&
      typeof nes.ppuDotEngine.tick === 'function'
    );
    const ppuTickTarget = canDirectPpuTick ? nes.ppuDotEngine : null;
    let masterClock = this.masterClock >>> 0;
    let readValue = 0;

    if (useInlineMasterHook) {
      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(1, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(2, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(3, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(4, false);
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(5, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(6, false);
      {
        const phase = phaseState.beginHalfTick(masterClock, 6);
        if (hasCpuPhaseTick) {
          nes.onCpuPhaseTick(phase);
        }
        phaseState.commitHalfTick();
      }

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(7, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(8, false);
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);
      if (isWrite) {
        nes.cpuWrite(a, v);
      } else {
        readValue = nes.cpuRead(a) & 0xff;
      }

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(9, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(10, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(11, false);

      masterClock = (masterClock + 1) >>> 0;
      nes.onMasterClockTickInline(12, true);
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);
      {
        const phase = phaseState.beginHalfTick(masterClock, 12);
        if (hasCpuPhaseTick) {
          nes.onCpuPhaseTick(phase);
        }
        phaseState.commitHalfTick();
      }
    } else {
      masterClock = (masterClock + 1) >>> 0;
      masterClock = (masterClock + 1) >>> 0;
      masterClock = (masterClock + 1) >>> 0;

      masterClock = (masterClock + 1) >>> 0;
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);

      masterClock = (masterClock + 1) >>> 0;

      masterClock = (masterClock + 1) >>> 0;
      {
        const phase = phaseState.beginHalfTick(masterClock, 6);
        if (hasCpuPhaseTick) {
          nes.onCpuPhaseTick(phase);
        }
        phaseState.commitHalfTick();
      }

      masterClock = (masterClock + 1) >>> 0;

      masterClock = (masterClock + 1) >>> 0;
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);
      if (isWrite) {
        nes.cpuWrite(a, v);
      } else {
        readValue = nes.cpuRead(a) & 0xff;
      }

      masterClock = (masterClock + 1) >>> 0;
      masterClock = (masterClock + 1) >>> 0;
      masterClock = (masterClock + 1) >>> 0;

      masterClock = (masterClock + 1) >>> 0;
      if (ppuTickTarget) ppuTickTarget.tick(1);
      else nes.tickPPU(1);
      {
        const phase = phaseState.beginHalfTick(masterClock, 12);
        if (hasCpuPhaseTick) {
          nes.onCpuPhaseTick(phase);
        }
        phaseState.commitHalfTick();
      }
    }

    nes.tickApu(1);
    cpuState.cycleCounter = ((cpuState.cycleCounter | 0) + 1) >>> 0;
    if (hasDecayAdvance) {
      nes.advancePpuIoBusDecay(1);
    }

    this.masterClock = masterClock >>> 0;
    this.subClock = 0;
    return readValue & 0xff;
  }

  advanceCpuBusCycleRead(addr) {
    if (!this._canUseDirectCpuAccessPath()) {
      return this.advanceCpuBusCycleWithAccess(() => this.nes.cpuRead(addr & 0xffff) & 0xff, 8) & 0xff;
    }
    return this._advanceCpuBusCycleDirectAccess(addr, false, 0) & 0xff;
  }

  advanceCpuBusCycleWrite(addr, value) {
    if (!this._canUseDirectCpuAccessPath()) {
      this.advanceCpuBusCycleWithAccess(() => {
        this.nes.cpuWrite(addr & 0xffff, value & 0xff);
      }, 8);
      return;
    }
    this._advanceCpuBusCycleDirectAccess(addr, true, value & 0xff);
  }

  advanceCpuBusCycleWithAccess(accessFn, accessSubClock = 8) {
    const runAccess = typeof accessFn === 'function' ? accessFn : null;
    const targetSubClock = accessSubClock | 0;
    let didRunAccess = false;
    let accessResult;
    this._advanceMasterClocks(12, runAccess ? {
      accessFn: () => {
        if (didRunAccess) return;
        didRunAccess = true;
        accessResult = runAccess();
      },
      accessSubClock: targetSubClock,
    } : null);
    if (runAccess && !didRunAccess) {
      accessResult = runAccess();
    }
    return accessResult;
  }

  advanceCpuInternalCycles(cycles) {
    const cpuCycles = cycles | 0;
    if (cpuCycles <= 0) return 0;
    this._advanceMasterClocks(cpuCycles * 12);
    return cpuCycles;
  }

  advanceDmaCpuCycle() {
    this._advanceMasterClocks(12);
  }

  advanceCpuStallCycles(stallCycles) {
    const stall = stallCycles | 0;
    if (stall <= 0) return;
    this._advanceMasterClocks(stall * 12);
  }
}

const masterClockDomainExports = { MasterClockDomain };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = masterClockDomainExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMasterClock = masterClockDomainExports;
}
