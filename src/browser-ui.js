(() => {
  const AUDIO_VERBOSE_LOG = false;
  const ENABLE_SCRIPT_AUDIO_DRIVE_TIMER = true;
  const SHOW_EXTENDED_DEBUG = false;
  const BROWSER_AUDIO_USE_PHASE_TICK = false;
  const EXPOSE_RUNTIME_COUNTERS = true;
  const RENDERER_FIFO_CAPACITY_SAMPLES = 48000;
  const CoreNES = (globalThis.NESCoreNES && globalThis.NESCoreNES.NES) ? globalThis.NESCoreNES.NES : null;
  const BrowserUiEmulationBackendNs = (
    globalThis.NESCoreEmulationBackend &&
    typeof globalThis.NESCoreEmulationBackend.createPreferredEmulationBackend === 'function'
  )
    ? globalThis.NESCoreEmulationBackend
    : null;

  function readNesRuntimeSnapshot(nes, out = null) {
    if (!nes) return out || null;
    const snapshot = out || {};
    const cpu = nes.cpu || null;
    const cpuState = nes.cpuState || null;
    const ppuState = nes.ppuState || null;
    const cartridge = nes.cartridge || null;
    const controllers = nes.controllers || null;
    snapshot.frameCounter = ppuState ? (ppuState.frameCounter >>> 0) : 0;
    snapshot.cpuCycleCounter = cpuState ? (cpuState.cycleCounter >>> 0) : 0;
    snapshot.cpuPc = cpu ? (cpu.pc & 0xffff) : 0;
    snapshot.cpuStopped = !!(cpu && cpu.stopped);
    snapshot.unsupportedOpcodeCount = (cpu && typeof cpu.unsupportedOpcodeCount === 'number')
      ? (cpu.unsupportedOpcodeCount >>> 0)
      : 0;
    snapshot.ppuStatus = ppuState ? (ppuState.status & 0xff) : 0;
    snapshot.mapper = (cartridge && typeof cartridge.mapper === 'number')
      ? (cartridge.mapper | 0)
      : -1;
    snapshot.joypad1Buttons = (controllers && typeof controllers.joypad1Buttons === 'number')
      ? (controllers.joypad1Buttons & 0xff)
      : 0;
    return snapshot;
  }

  function shouldForceJsCoreForMapper(mapperId) {
    // Known regression: mapper 206 can render black on wasm backend.
    return (mapperId | 0) === 206;
  }

  function shouldPreferWasmCore(nes) {
    if (coreBackendPreference === 'js') return false;
    if (coreBackendPreference === 'wasm') return true;
    const mapperId = (nes && nes.cartridge && typeof nes.cartridge.mapper === 'number')
      ? (nes.cartridge.mapper | 0)
      : -1;
    return !shouldForceJsCoreForMapper(mapperId);
  }

  function createBrowserEmulationBackend(nes) {
    if (BrowserUiEmulationBackendNs) {
      try {
        const preferWasm = shouldPreferWasmCore(nes);
        const backend = BrowserUiEmulationBackendNs.createPreferredEmulationBackend(nes, {
          preferWasm,
          forceEnable: true,
          preferNativeWasm: preferWasm,
        });
        if (
          backend &&
          typeof backend.setController1 === 'function' &&
          typeof backend.runCpuCycles === 'function' &&
          typeof backend.runFrame === 'function'
        ) {
          return backend;
        }
      } catch (_err) {
        // Fallback to local JS adapter below.
      }
    }
    const stateSnapshot = readNesRuntimeSnapshot(nes, {});
    const frameResult = {
      frameAdvanced: false,
      usedFallback: false,
      beforeCpuCycles: 0,
      afterCpuCycles: 0,
      cpuCycles: 0,
      frameCounter: 0,
    };
    const framesResult = {
      ran: 0,
      usedFallbackFrames: 0,
      noAdvanceFrames: 0,
      beforeFrameCounter: 0,
      afterFrameCounter: 0,
      beforeCpuCycles: 0,
      afterCpuCycles: 0,
      frameCounter: 0,
    };
    return {
      getName() {
        return 'js(local)';
      },
      setController1(buttons) {
        nes.setController1(buttons);
      },
      setFamilyBasicKeyboardState(keyState) {
        if (typeof nes.setFamilyBasicKeyboardState !== 'function') return false;
        return !!nes.setFamilyBasicKeyboardState(keyState || null);
      },
      setFamilyBasicKey(code, pressed) {
        if (typeof nes.setFamilyBasicKey !== 'function') return false;
        return !!nes.setFamilyBasicKey(code, !!pressed);
      },
      isFamilyBasicKeyboardAvailable() {
        if (typeof nes.isFamilyBasicKeyboardAvailable !== 'function') return false;
        return !!nes.isFamilyBasicKeyboardAvailable();
      },
      isFamilyBasicKeyboardDeviceEnabled() {
        if (typeof nes.isFamilyBasicKeyboardDeviceEnabled !== 'function') return false;
        return !!nes.isFamilyBasicKeyboardDeviceEnabled();
      },
      setFamilyBasicKeyboardDeviceEnabled(enabled) {
        if (typeof nes.setFamilyBasicKeyboardDeviceEnabled !== 'function') return false;
        return !!nes.setFamilyBasicKeyboardDeviceEnabled(!!enabled);
      },
      isFamilyBasicCassetteAvailable() {
        if (typeof nes.isFamilyBasicCassetteAvailable !== 'function') return false;
        return !!nes.isFamilyBasicCassetteAvailable();
      },
      isFamilyBasicCassetteDeviceEnabled() {
        if (typeof nes.isFamilyBasicCassetteDeviceEnabled !== 'function') return false;
        return !!nes.isFamilyBasicCassetteDeviceEnabled();
      },
      setFamilyBasicCassetteDeviceEnabled(enabled) {
        if (typeof nes.setFamilyBasicCassetteDeviceEnabled !== 'function') return false;
        return !!nes.setFamilyBasicCassetteDeviceEnabled(!!enabled);
      },
      setFamilyBasicCassetteMode(mode) {
        if (typeof nes.setFamilyBasicCassetteMode !== 'function') return false;
        return !!nes.setFamilyBasicCassetteMode(mode);
      },
      rewindFamilyBasicCassette() {
        if (typeof nes.rewindFamilyBasicCassette !== 'function') return false;
        return !!nes.rewindFamilyBasicCassette();
      },
      clearFamilyBasicCassette() {
        if (typeof nes.clearFamilyBasicCassette !== 'function') return false;
        return !!nes.clearFamilyBasicCassette();
      },
      loadFamilyBasicCassetteBits(bits) {
        if (typeof nes.loadFamilyBasicCassetteBits !== 'function') return false;
        return !!nes.loadFamilyBasicCassetteBits(bits);
      },
      exportFamilyBasicCassetteBits() {
        if (typeof nes.exportFamilyBasicCassetteBits !== 'function') return [];
        return nes.exportFamilyBasicCassetteBits();
      },
      getFamilyBasicCassetteState() {
        if (typeof nes.getFamilyBasicCassetteState !== 'function') return null;
        return nes.getFamilyBasicCassetteState();
      },
      runCpuCycles(cycles) {
        return nes.runCpuCycles(cycles | 0);
      },
      runFrame(maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
        const beforeFrameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : 0;
        const beforeCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
        const maxCycles = maxCpuCycles | 0;
        const fallbackCycles = fallbackCpuCycles | 0;
        const step = nes.runUntilNextVBlank(maxCycles);
        let usedFallback = false;
        let frameAdvanced = !!(step && step.frameAdvanced);
        if (!frameAdvanced) {
          nes.runCpuCycles(fallbackCycles);
          usedFallback = true;
          const afterFallbackFrameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : beforeFrameCounter;
          frameAdvanced = afterFallbackFrameCounter !== beforeFrameCounter;
        }
        const afterCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : beforeCpuCycles;
        const afterFrameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : beforeFrameCounter;
        const out = frameResult;
        out.frameAdvanced = frameAdvanced;
        out.usedFallback = usedFallback;
        out.beforeCpuCycles = beforeCpuCycles;
        out.afterCpuCycles = afterCpuCycles;
        out.cpuCycles = ((step && typeof step.cpuCycles === 'number') ? (step.cpuCycles >>> 0) : 0) + (usedFallback ? (fallbackCycles >>> 0) : 0);
        out.frameCounter = afterFrameCounter;
        return out;
      },
      runFrames(frameCount, maxCpuCycles = 120000, fallbackCpuCycles = 12000) {
        const target = frameCount | 0;
        const beforeFrameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : 0;
        const beforeCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : 0;
        if (target <= 0) {
          const outEmpty = framesResult;
          outEmpty.ran = 0;
          outEmpty.usedFallbackFrames = 0;
          outEmpty.noAdvanceFrames = 0;
          outEmpty.beforeFrameCounter = beforeFrameCounter;
          outEmpty.afterFrameCounter = beforeFrameCounter;
          outEmpty.beforeCpuCycles = beforeCpuCycles;
          outEmpty.afterCpuCycles = beforeCpuCycles;
          outEmpty.frameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : 0;
          return outEmpty;
        }
        let ran = 0;
        let usedFallbackFrames = 0;
        let noAdvanceFrames = 0;
        let noAdvanceStreak = 0;
        const maxNoAdvanceStreak = Math.max(8, target << 2);
        while (ran < target) {
          const step = this.runFrame(maxCpuCycles, fallbackCpuCycles);
          if (step && step.usedFallback) usedFallbackFrames += 1;
          if (step && step.frameAdvanced) {
            ran += 1;
            noAdvanceStreak = 0;
          } else {
            noAdvanceFrames += 1;
            noAdvanceStreak += 1;
            if (noAdvanceStreak >= maxNoAdvanceStreak) break;
          }
        }
        const afterCpuCycles = nes.cpuState ? (nes.cpuState.cycleCounter >>> 0) : beforeCpuCycles;
        const afterFrameCounter = nes.ppuState ? (nes.ppuState.frameCounter >>> 0) : beforeFrameCounter;
        const out = framesResult;
        out.ran = ran;
        out.usedFallbackFrames = usedFallbackFrames;
        out.noAdvanceFrames = noAdvanceFrames;
        out.beforeFrameCounter = beforeFrameCounter;
        out.afterFrameCounter = afterFrameCounter;
        out.beforeCpuCycles = beforeCpuCycles;
        out.afterCpuCycles = afterCpuCycles;
        out.frameCounter = afterFrameCounter;
        return out;
      },
      getStateSnapshot() {
        return readNesRuntimeSnapshot(nes, stateSnapshot);
      },
    };
  }

  const APU_LENGTH_TABLE = [
    10, 254, 20, 2, 40, 4, 80, 6,
    160, 8, 60, 10, 14, 12, 26, 14,
    12, 16, 24, 18, 48, 20, 96, 22,
    192, 24, 72, 26, 16, 28, 32, 30,
  ];
  const APU_DUTY_TABLE = [
    [0, 1, 0, 0, 0, 0, 0, 0],
    [0, 1, 1, 0, 0, 0, 0, 0],
    [0, 1, 1, 1, 1, 0, 0, 0],
    [1, 0, 0, 1, 1, 1, 1, 1],
  ];
  const APU_TRI_TABLE = [
    15, 14, 13, 12, 11, 10, 9, 8,
    7, 6, 5, 4, 3, 2, 1, 0,
    0, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 11, 12, 13, 14, 15,
  ];
  const APU_NOISE_PERIOD = [
    4, 8, 16, 32, 64, 96, 128, 160,
    202, 254, 380, 508, 762, 1016, 2034, 4068,
  ];
  const APU_DMC_RATE = [
    428, 380, 340, 320, 286, 254, 226, 214,
    190, 160, 142, 128, 106, 84, 72, 54,
  ];
  // Sunsoft 5B (AY-3-8910/YM2149 style) logarithmic-ish volume curve.
  const APU_S5B_VOLUME_TABLE = new Float32Array([
    0.0000, 0.0040, 0.0060, 0.0085,
    0.0120, 0.0170, 0.0240, 0.0340,
    0.0480, 0.0680, 0.0960, 0.1360,
    0.1920, 0.2720, 0.3860, 0.5480,
  ]);
  const APU_PULSE_MIX_TABLE = new Float32Array(31);
  const APU_TND_MIX_TABLE = new Float32Array(16 * 16 * 128);
  for (let pulse = 0; pulse <= 30; pulse += 1) {
    APU_PULSE_MIX_TABLE[pulse] = pulse === 0 ? 0 : (95.88 / ((8128 / pulse) + 100));
  }
  for (let tri = 0; tri <= 15; tri += 1) {
    for (let noise = 0; noise <= 15; noise += 1) {
      for (let dmc = 0; dmc <= 127; dmc += 1) {
        const idx = (tri << 11) | (noise << 7) | dmc;
        const tnd = (tri / 8227) + (noise / 12241) + (dmc / 22638);
        APU_TND_MIX_TABLE[idx] = tnd === 0 ? 0 : (159.79 / ((1 / tnd) + 100));
      }
    }
  }

  class APUSunsoft5B {
    constructor() {
      this.reset();
    }

    reset() {
      this.selectedReg = 0;
      this.regs = new Uint8Array(16);
      this.tonePeriod = new Uint16Array(3);
      this.toneCounter = new Uint16Array(3);
      this.toneState = new Uint8Array(3);
      this.noisePeriod = 1;
      this.noiseCounter = 1;
      this.noiseLfsr = 1;
      this.noiseBit = 1;
      this.envelopePeriod = 1;
      this.envelopeCounter = 1;
      this.envelopeValue = 0;
      this.envelopeDirection = 1;
      this.envelopeContinue = false;
      this.envelopeAttack = false;
      this.envelopeAlternate = false;
      this.envelopeHold = false;
      this.envelopeHalted = false;
      this.clockDivider = 0;
      this.clockDividerReload = 16;
      this.currentOutput = 0;
      for (let i = 0; i < 3; i += 1) {
        this.tonePeriod[i] = 1;
        this.toneCounter[i] = 1;
        this.toneState[i] = 1;
      }
    }

    _tonePeriodForChannel(index) {
      const lo = this.regs[(index << 1)] & 0xff;
      const hi = this.regs[(index << 1) + 1] & 0x0f;
      return ((hi << 8) | lo) & 0x0fff;
    }

    _updateTonePeriod(index) {
      let period = this._tonePeriodForChannel(index);
      if (period <= 0) period = 1;
      this.tonePeriod[index] = period & 0xffff;
      if (this.toneCounter[index] <= 0) {
        this.toneCounter[index] = this.tonePeriod[index];
      }
    }

    _updateNoisePeriod() {
      let period = this.regs[6] & 0x1f;
      if (period <= 0) period = 1;
      this.noisePeriod = period;
      if (this.noiseCounter <= 0) this.noiseCounter = this.noisePeriod;
    }

    _updateEnvelopePeriod() {
      let period = ((this.regs[12] << 8) | this.regs[11]) & 0xffff;
      if (period <= 0) period = 1;
      this.envelopePeriod = period;
      if (this.envelopeCounter <= 0) this.envelopeCounter = this.envelopePeriod;
    }

    _restartEnvelope(shape) {
      const v = shape & 0x0f;
      this.envelopeContinue = (v & 0x08) !== 0;
      this.envelopeAttack = (v & 0x04) !== 0;
      this.envelopeAlternate = (v & 0x02) !== 0;
      this.envelopeHold = (v & 0x01) !== 0;
      this.envelopeHalted = false;
      this.envelopeDirection = this.envelopeAttack ? 1 : -1;
      this.envelopeValue = this.envelopeAttack ? 0 : 15;
      this.envelopeCounter = this.envelopePeriod;
    }

    writeCpu(addr, value) {
      const a = addr & 0xe000;
      const v = value & 0xff;
      if (a === 0xc000) {
        this.selectedReg = v & 0x0f;
        return true;
      }
      if (a === 0xe000) {
        const reg = this.selectedReg & 0x0f;
        this.regs[reg] = v;
        if (reg <= 5) {
          this._updateTonePeriod(reg >> 1);
        } else if (reg === 6) {
          this._updateNoisePeriod();
        } else if (reg === 11 || reg === 12) {
          this._updateEnvelopePeriod();
        } else if (reg === 13) {
          this._restartEnvelope(v);
        }
        return true;
      }
      return false;
    }

    _clockToneNoiseEnvelope() {
      for (let i = 0; i < 3; i += 1) {
        let c = (this.toneCounter[i] | 0) - 1;
        if (c <= 0) {
          c = this.tonePeriod[i] | 0;
          this.toneState[i] ^= 1;
        }
        this.toneCounter[i] = c & 0xffff;
      }

      let nc = (this.noiseCounter | 0) - 1;
      if (nc <= 0) {
        nc = this.noisePeriod | 0;
        const feedback = ((this.noiseLfsr ^ (this.noiseLfsr >> 3)) & 0x01);
        this.noiseLfsr = ((this.noiseLfsr >> 1) | (feedback << 16)) & 0x1ffff;
        this.noiseBit = this.noiseLfsr & 0x01;
      }
      this.noiseCounter = nc & 0xffff;

      if (!this.envelopeHalted) {
        let ec = (this.envelopeCounter | 0) - 1;
        if (ec <= 0) {
          ec = this.envelopePeriod | 0;
          this.envelopeValue += this.envelopeDirection;
          if (this.envelopeValue < 0 || this.envelopeValue > 15) {
            if (!this.envelopeContinue) {
              this.envelopeHalted = true;
              this.envelopeValue = this.envelopeAttack ? 15 : 0;
            } else if (this.envelopeHold) {
              this.envelopeHalted = true;
              this.envelopeValue = this.envelopeDirection > 0 ? 15 : 0;
            } else {
              if (this.envelopeAlternate) this.envelopeDirection = -this.envelopeDirection;
              this.envelopeValue = this.envelopeDirection > 0 ? 0 : 15;
            }
          }
        }
        this.envelopeCounter = ec & 0xffff;
      }
    }

    _computeOutput() {
      const mixer = this.regs[7] & 0x3f;
      const envVol = this.envelopeValue & 0x0f;
      let sum = 0;
      for (let i = 0; i < 3; i += 1) {
        const toneEnabled = ((mixer >> i) & 0x01) === 0;
        const noiseEnabled = ((mixer >> (i + 3)) & 0x01) === 0;
        const tonePass = (!toneEnabled) || (this.toneState[i] !== 0);
        const noisePass = (!noiseEnabled) || (this.noiseBit !== 0);
        if (!tonePass || !noisePass) continue;
        const volReg = this.regs[8 + i] & 0x1f;
        const volIdx = (volReg & 0x10) ? envVol : (volReg & 0x0f);
        sum += APU_S5B_VOLUME_TABLE[volIdx] || 0;
      }
      this.currentOutput = sum * 0.10;
    }

    clockCpuCycles(cycles) {
      let remain = cycles | 0;
      if (remain <= 0) return;
      while (remain > 0) {
        this.clockDivider += 1;
        if (this.clockDivider >= this.clockDividerReload) {
          this.clockDivider = 0;
          this._clockToneNoiseEnvelope();
          this._computeOutput();
        }
        remain -= 1;
      }
    }

    output() {
      return this.currentOutput;
    }
  }

  class APUEnvelope {
    constructor(){
      this.loop = false;
      this.constant = false;
      this.period = 0;
      this.start = false;
      this.divider = 0;
      this.decay = 0;
    }
    write(v){
      this.loop = (v & 0x20) !== 0;
      this.constant = (v & 0x10) !== 0;
      this.period = v & 0x0f;
    }
    restart(){
      this.start = true;
    }
    clock(){
      if (this.start) {
        this.start = false;
        this.decay = 15;
        this.divider = this.period + 1;
        return;
      }
      if (this.divider > 0) this.divider -= 1;
      if (this.divider === 0) {
        this.divider = this.period + 1;
        if (this.decay > 0) this.decay -= 1;
        else if (this.loop) this.decay = 15;
      }
    }
    output(){
      return this.constant ? this.period : this.decay;
    }
  }

  class APUPulse {
    constructor(channel1){
      this.channel1 = channel1;
      this.enabled = false;
      this.lengthCounter = 0;
      this.lengthHalt = false;
      this.duty = 0;
      this.seq = 0;
      this.timer = 0;
      this.timerCounter = 0;

      this.sweepEnabled = false;
      this.sweepPeriod = 0;
      this.sweepNegate = false;
      this.sweepShift = 0;
      this.sweepReload = false;
      this.sweepDivider = 0;

      this.envelope = new APUEnvelope();
    }
    setEnabled(on){
      this.enabled = on;
      if (!on) this.lengthCounter = 0;
    }
    writeControl(v){
      this.duty = (v >> 6) & 0x03;
      this.lengthHalt = (v & 0x20) !== 0;
      this.envelope.write(v);
    }
    writeSweep(v){
      this.sweepEnabled = (v & 0x80) !== 0;
      this.sweepPeriod = (v >> 4) & 0x07;
      this.sweepNegate = (v & 0x08) !== 0;
      this.sweepShift = v & 0x07;
      this.sweepReload = true;
    }
    writeTimerLow(v){
      this.timer = (this.timer & 0x700) | v;
    }
    writeTimerHigh(v){
      this.timer = (this.timer & 0x0ff) | ((v & 0x07) << 8);
      // NES APU loads length on high-register write regardless of prior enable.
      this.lengthCounter = APU_LENGTH_TABLE[(v >> 3) & 0x1f];
      this.seq = 0;
      this.envelope.restart();
    }
    targetPeriod(){
      const delta = this.timer >> this.sweepShift;
      if (!this.sweepNegate) return this.timer + delta;
      return this.timer - delta - (this.channel1 ? 1 : 0);
    }
    sweepMuted(){
      const target = this.targetPeriod();
      return this.timer < 8 || target > 0x7ff;
    }
    clockTimer(){
      if (this.timerCounter === 0) {
        this.timerCounter = ((this.timer + 1) << 1);
        this.seq = (this.seq + 1) & 7;
      } else {
        this.timerCounter -= 1;
      }
    }
    clockQuarter(){
      this.envelope.clock();
    }
    clockHalf(){
      if (!this.lengthHalt && this.lengthCounter > 0) this.lengthCounter -= 1;

      if (this.sweepDivider === 0) {
        if (this.sweepEnabled && this.sweepShift > 0 && !this.sweepMuted()) {
          this.timer = this.targetPeriod() & 0x7ff;
        }
        this.sweepDivider = this.sweepPeriod + 1;
      } else {
        this.sweepDivider -= 1;
      }
      if (this.sweepReload) {
        this.sweepReload = false;
        this.sweepDivider = this.sweepPeriod + 1;
      }
    }
    output(){
      if (!this.enabled || this.lengthCounter === 0) return 0;
      if (this.sweepMuted()) return 0;
      if (APU_DUTY_TABLE[this.duty][this.seq] === 0) return 0;
      return this.envelope.output();
    }
  }

  class APUTriangle {
    constructor(){
      this.enabled = false;
      this.lengthCounter = 0;
      this.controlFlag = false;
      this.linearReloadValue = 0;
      this.linearCounter = 0;
      this.linearReloadFlag = false;
      this.timer = 0;
      this.timerCounter = 0;
      this.seq = 0;
    }
    setEnabled(on){
      this.enabled = on;
      if (!on) this.lengthCounter = 0;
    }
    writeControl(v){
      this.controlFlag = (v & 0x80) !== 0;
      this.linearReloadValue = v & 0x7f;
    }
    writeTimerLow(v){
      this.timer = (this.timer & 0x700) | v;
    }
    writeTimerHigh(v){
      this.timer = (this.timer & 0x0ff) | ((v & 0x07) << 8);
      // NES APU loads length on high-register write regardless of prior enable.
      this.lengthCounter = APU_LENGTH_TABLE[(v >> 3) & 0x1f];
      this.linearReloadFlag = true;
    }
    clockTimer(){
      if (this.timerCounter === 0) {
        this.timerCounter = this.timer + 1;
        if (this.lengthCounter > 0 && this.linearCounter > 0) {
          this.seq = (this.seq + 1) & 31;
        }
      } else {
        this.timerCounter -= 1;
      }
    }
    clockQuarter(){
      if (this.linearReloadFlag) this.linearCounter = this.linearReloadValue;
      else if (this.linearCounter > 0) this.linearCounter -= 1;
      if (!this.controlFlag) this.linearReloadFlag = false;
    }
    clockHalf(){
      if (!this.controlFlag && this.lengthCounter > 0) this.lengthCounter -= 1;
    }
    output(){
      if (!this.enabled || this.lengthCounter === 0 || this.linearCounter === 0) return 0;
      return APU_TRI_TABLE[this.seq];
    }
  }

  class APUNoise {
    constructor(){
      this.enabled = false;
      this.lengthCounter = 0;
      this.lengthHalt = false;
      this.mode = false;
      this.period = APU_NOISE_PERIOD[0];
      this.timerCounter = 0;
      this.shift = 1;
      this.envelope = new APUEnvelope();
    }
    setEnabled(on){
      this.enabled = on;
      if (!on) this.lengthCounter = 0;
    }
    writeControl(v){
      this.lengthHalt = (v & 0x20) !== 0;
      this.envelope.write(v);
    }
    writePeriod(v){
      this.mode = (v & 0x80) !== 0;
      this.period = APU_NOISE_PERIOD[v & 0x0f];
    }
    writeLength(v){
      // NES APU loads length on length-register write regardless of prior enable.
      this.lengthCounter = APU_LENGTH_TABLE[(v >> 3) & 0x1f];
      this.envelope.restart();
    }
    clockTimer(){
      if (this.timerCounter === 0) {
        this.timerCounter = this.period;
        const tap = this.mode ? 6 : 1;
        const feedback = (this.shift ^ (this.shift >> tap)) & 1;
        this.shift = (this.shift >> 1) | (feedback << 14);
      } else {
        this.timerCounter -= 1;
      }
    }
    clockQuarter(){
      this.envelope.clock();
    }
    clockHalf(){
      if (!this.lengthHalt && this.lengthCounter > 0) this.lengthCounter -= 1;
    }
    output(){
      if (!this.enabled || this.lengthCounter === 0) return 0;
      if ((this.shift & 1) !== 0) return 0;
      return this.envelope.output();
    }
  }

  class APUDMC {
    constructor(bus){
      this.bus = bus;
      this.enabled = false;
      this.irqEnable = false;
      this.loop = false;
      this.rate = APU_DMC_RATE[0];
      this.timerCounter = 0;
      this.outputLevel = 0;
      this.sampleAddress = 0xC000;
      this.sampleLength = 1;
      this.currentAddress = 0xC000;
      this.bytesRemaining = 0;
      this.sampleBuffer = 0;
      this.sampleBufferEmpty = true;
      this.shiftRegister = 0;
      this.bitsRemaining = 8;
      this.silence = true;
      this.irqFlag = false;
    }
    writeControl(v){
      this.irqEnable = (v & 0x80) !== 0;
      if (!this.irqEnable) this.irqFlag = false;
      this.loop = (v & 0x40) !== 0;
      this.rate = APU_DMC_RATE[v & 0x0f];
    }
    writeDirectLoad(v){
      this.outputLevel = v & 0x7f;
    }
    writeSampleAddress(v){
      this.sampleAddress = 0xC000 | ((v & 0xff) << 6);
    }
    writeSampleLength(v){
      this.sampleLength = ((v & 0xff) << 4) | 1;
    }
    setEnabled(on){
      this.enabled = on;
      if (!on) {
        this.bytesRemaining = 0;
      } else if (this.bytesRemaining === 0) {
        this.restart();
      }
    }
    restart(){
      this.currentAddress = this.sampleAddress;
      this.bytesRemaining = this.sampleLength;
    }
    fillBuffer(){
      if (!this.sampleBufferEmpty || this.bytesRemaining === 0) return;
      // Audio-only DMC fetch: avoid mutating CPU open-bus/state from outside CPU cycles.
      if (this.bus && this.bus.mapper && typeof this.bus.mapper.cpuRead === 'function') {
        this.sampleBuffer = this.bus.mapper.cpuRead(this.currentAddress & 0xffff) & 0xff;
      } else {
        this.sampleBuffer = 0;
      }
      this.sampleBufferEmpty = false;
      this.currentAddress = (this.currentAddress + 1) & 0xffff;
      if (this.currentAddress < 0x8000) this.currentAddress |= 0x8000;
      this.bytesRemaining -= 1;
      if (this.bytesRemaining === 0) {
        if (this.loop) this.restart();
        else if (this.irqEnable) this.irqFlag = true;
      }
    }
    clockTimer(){
      if (!this.enabled) return;
      if (this.timerCounter === 0) {
        this.timerCounter = this.rate;
        if (!this.silence) {
          if ((this.shiftRegister & 1) && this.outputLevel <= 125) this.outputLevel += 2;
          else if (!(this.shiftRegister & 1) && this.outputLevel >= 2) this.outputLevel -= 2;
        }
        this.shiftRegister >>= 1;
        this.bitsRemaining -= 1;
        if (this.bitsRemaining === 0) {
          this.bitsRemaining = 8;
          if (this.sampleBufferEmpty) {
            this.silence = true;
          } else {
            this.silence = false;
            this.shiftRegister = this.sampleBuffer;
            this.sampleBufferEmpty = true;
            this.fillBuffer();
          }
        }
      } else {
        this.timerCounter -= 1;
      }
      this.fillBuffer();
    }
    output(){
      return this.outputLevel;
    }
  }

  class ApuDeltaSynth {
    constructor(cpuClock, sampleRate) {
      this.cpuClock = cpuClock;
      this.sampleRate = sampleRate;
      this.stepCycles = cpuClock / sampleRate;
      this.currentCycle = 0;
      this.nextSampleCycle = this.stepCycles;

      this.targetLevel = 0;
      this.appliedLevel = 0;

      this.eventCapacity = 8192;
      this.eventCycle = new Float64Array(this.eventCapacity);
      this.eventDelta = new Float32Array(this.eventCapacity);
      this.eventRead = 0;
      this.eventWrite = 0;
      this.eventCount = 0;

      this.masterGain = 0.7;
      this.lpState = 0;
      this.hpPrevIn = 0;
      this.hpPrevOut = 0;
      this.lowPassAlpha = 0.5;
      this.highPassAlpha = 0.996;
      this._updateFilterCoeffs();
    }

    _updateFilterCoeffs() {
      const sr = Math.max(8000, this.sampleRate | 0);
      const lpHz = Math.min(14000, sr * 0.45);
      const hpHz = 25;
      this.lowPassAlpha = 1.0 - Math.exp((-2.0 * Math.PI * lpHz) / sr);
      this.highPassAlpha = Math.exp((-2.0 * Math.PI * hpHz) / sr);
    }

    setSampleRate(rate) {
      const next = Number(rate);
      if (!Number.isFinite(next) || next < 8000 || next > 192000) return;
      this.sampleRate = next;
      this.stepCycles = this.cpuClock / this.sampleRate;
      this.nextSampleCycle = this.currentCycle + this.stepCycles;
      this._updateFilterCoeffs();
    }

    setMasterGain(gain) {
      const g = Number(gain);
      this.masterGain = Number.isFinite(g) ? g : 0.7;
    }

    reset() {
      this.currentCycle = 0;
      this.nextSampleCycle = this.stepCycles;
      this.targetLevel = 0;
      this.appliedLevel = 0;
      this.eventRead = 0;
      this.eventWrite = 0;
      this.eventCount = 0;
      this.lpState = 0;
      this.hpPrevIn = 0;
      this.hpPrevOut = 0;
    }

    _pushEvent(cycleStamp, delta) {
      if (this.eventCount >= this.eventCapacity) {
        this.eventRead = (this.eventRead + 1) % this.eventCapacity;
        this.eventCount -= 1;
      }
      this.eventCycle[this.eventWrite] = cycleStamp;
      this.eventDelta[this.eventWrite] = delta;
      this.eventWrite = (this.eventWrite + 1) % this.eventCapacity;
      this.eventCount += 1;
    }

    enqueueLevel(level) {
      const next = Number.isFinite(level) ? level : 0;
      const delta = next - this.targetLevel;
      if (Math.abs(delta) <= 1e-9) return;
      this._pushEvent(this.currentCycle, delta);
      this.targetLevel = next;
    }

    _applyEventsUntil(cyclePos) {
      while (this.eventCount > 0) {
        const c = this.eventCycle[this.eventRead];
        if (c > cyclePos) break;
        this.appliedLevel += this.eventDelta[this.eventRead];
        this.eventRead = (this.eventRead + 1) % this.eventCapacity;
        this.eventCount -= 1;
      }
    }

    _renderOneSample() {
      this._applyEventsUntil(this.nextSampleCycle);
      this.lpState += this.lowPassAlpha * (this.appliedLevel - this.lpState);
      const hpIn = this.lpState;
      const hpOut = hpIn - this.hpPrevIn + (this.highPassAlpha * this.hpPrevOut);
      this.hpPrevIn = hpIn;
      this.hpPrevOut = hpOut;
      let out = hpOut * this.masterGain * 3;
      if (out > 1) out = 1;
      else if (out < -1) out = -1;
      return out;
    }

    advanceCycles(cycles, pushSampleFn) {
      const c = cycles | 0;
      if (c <= 0 || typeof pushSampleFn !== 'function') return;
      this.currentCycle += c;
      let guard = 0;
      while (this.nextSampleCycle <= this.currentCycle && guard < 4096) {
        pushSampleFn(this._renderOneSample());
        this.nextSampleCycle += this.stepCycles;
        guard += 1;
      }
    }
  }

  class NESApu {
    constructor(bus){
      this.bus = bus;
      this.cpuClock = 1789773;
      this.mapperId = (bus && bus.cartridge && typeof bus.cartridge.mapper === 'number')
        ? (bus.cartridge.mapper | 0)
        : -1;
      this.sampleRate = 44100;
      this.frameCycle = 0;
      this.frameMode5 = false;
      this.frameIrqInhibit = false;
      this.frameIrqFlag = false;
      this._initSampleQueue(8192);
      this.underrunCount = 0;
      this.masterGain = 0.7;
      this.cpuCyclesClocked = 0;
      this.generatedSamples = 0;
      this.consumedSamples = 0;
      this.recentSamplePeak = 0;
      this.recentMixInputPeak = 0;
      this.recentSampleCounter = 0;
      this.holdSample = 0;
      this.droppedSamples = 0;
      this.prevPulse1Out = 0;
      this.prevPulse2Out = 0;
      this.prevTriOut = 0;
      this.prevNoiseOut = 0;
      this.prevDmcOut = 0;
      this.prevExpansionOut = 0;
      this.currentMixedLevel = 0;
      this.deltaSynth = new ApuDeltaSynth(this.cpuClock, this.sampleRate);
      this.deltaSynth.setMasterGain(this.masterGain);
      this._pushFromSynth = (sample) => this.pushSample(sample);

      this.p1 = new APUPulse(true);
      this.p2 = new APUPulse(false);
      this.tri = new APUTriangle();
      this.noise = new APUNoise();
      this.dmc = new APUDMC(bus);
      this.expansionAudio = (this.mapperId === 69) ? new APUSunsoft5B() : null;
    }
    _initSampleQueue(capacity){
      let cap = 1;
      const want = Math.max(1024, capacity | 0);
      while (cap < want) cap <<= 1;
      this.sampleQueueCapacity = cap;
      this.sampleQueueMask = cap - 1;
      this.sampleQueue = new Float32Array(cap);
      this.sampleQueueRead = 0;
      this.sampleQueueWrite = 0;
      this.sampleQueueCount = 0;
    }
    setSampleRate(rate){
      const next = Number(rate);
      if (!Number.isFinite(next) || next < 8000 || next > 192000) return;
      const normalized = next;
      if (Math.abs(normalized - this.sampleRate) < 0.5) return;
      this.sampleRate = normalized;
      // Keep queue short to reduce browser-side latency accumulation.
      this._initSampleQueue(Math.ceil(this.sampleRate * 0.2));
      if (this.deltaSynth) {
        this.deltaSynth.setSampleRate(this.sampleRate);
      }
    }
    clearSampleQueue(){
      this.sampleQueueRead = 0;
      this.sampleQueueWrite = 0;
      this.sampleQueueCount = 0;
    }
    getSampleQueueLength(){
      return this.sampleQueueCount | 0;
    }
    reset(){
      this.frameCycle = 0;
      this.frameMode5 = false;
      this.frameIrqInhibit = false;
      this.frameIrqFlag = false;
      this.clearSampleQueue();
      this.underrunCount = 0;
      this.writeRegister(0x4015, 0x00);
      this.writeRegister(0x4017, 0x00);
      this.cpuCyclesClocked = 0;
      this.generatedSamples = 0;
      this.consumedSamples = 0;
      this.recentSamplePeak = 0;
      this.recentMixInputPeak = 0;
      this.recentSampleCounter = 0;
      this.holdSample = 0;
      this.droppedSamples = 0;
      this.prevPulse1Out = 0;
      this.prevPulse2Out = 0;
      this.prevTriOut = 0;
      this.prevNoiseOut = 0;
      this.prevDmcOut = 0;
      this.prevExpansionOut = 0;
      this.currentMixedLevel = 0;
      if (this.expansionAudio && typeof this.expansionAudio.reset === 'function') {
        this.expansionAudio.reset();
      }
      if (this.deltaSynth) {
        this.deltaSynth.reset();
        this.deltaSynth.setMasterGain(this.masterGain);
      }
    }
    irqLine(){ return this.frameIrqFlag || this.dmc.irqFlag; }
    readStatus(){
      let v = 0;
      if (this.p1.lengthCounter > 0) v |= 0x01;
      if (this.p2.lengthCounter > 0) v |= 0x02;
      if (this.tri.lengthCounter > 0) v |= 0x04;
      if (this.noise.lengthCounter > 0) v |= 0x08;
      if (this.dmc.bytesRemaining > 0) v |= 0x10;
      if (this.frameIrqFlag) v |= 0x40;
      if (this.dmc.irqFlag) v |= 0x80;
      this.frameIrqFlag = false;
      return v;
    }
    peekStatus(){
      let v = 0;
      if (this.p1.lengthCounter > 0) v |= 0x01;
      if (this.p2.lengthCounter > 0) v |= 0x02;
      if (this.tri.lengthCounter > 0) v |= 0x04;
      if (this.noise.lengthCounter > 0) v |= 0x08;
      if (this.dmc.bytesRemaining > 0) v |= 0x10;
      if (this.frameIrqFlag) v |= 0x40;
      if (this.dmc.irqFlag) v |= 0x80;
      return v;
    }
    writeRegister(addr, value){
      const a = addr & 0xffff;
      const v = value & 0xff;
      switch (a) {
        case 0x4000: this.p1.writeControl(v); break;
        case 0x4001: this.p1.writeSweep(v); break;
        case 0x4002: this.p1.writeTimerLow(v); break;
        case 0x4003: this.p1.writeTimerHigh(v); break;
        case 0x4004: this.p2.writeControl(v); break;
        case 0x4005: this.p2.writeSweep(v); break;
        case 0x4006: this.p2.writeTimerLow(v); break;
        case 0x4007: this.p2.writeTimerHigh(v); break;
        case 0x4008: this.tri.writeControl(v); break;
        case 0x400A: this.tri.writeTimerLow(v); break;
        case 0x400B: this.tri.writeTimerHigh(v); break;
        case 0x400C: this.noise.writeControl(v); break;
        case 0x400E: this.noise.writePeriod(v); break;
        case 0x400F: this.noise.writeLength(v); break;
        case 0x4010: this.dmc.writeControl(v); break;
        case 0x4011: this.dmc.writeDirectLoad(v); break;
        case 0x4012: this.dmc.writeSampleAddress(v); break;
        case 0x4013: this.dmc.writeSampleLength(v); break;
        case 0x4015: {
          this.p1.setEnabled((v & 0x01) !== 0);
          this.p2.setEnabled((v & 0x02) !== 0);
          this.tri.setEnabled((v & 0x04) !== 0);
          this.noise.setEnabled((v & 0x08) !== 0);
          this.dmc.setEnabled((v & 0x10) !== 0);
          this.dmc.irqFlag = false;
          break;
        }
        case 0x4017: {
          this.frameMode5 = (v & 0x80) !== 0;
          this.frameIrqInhibit = (v & 0x40) !== 0;
          if (this.frameIrqInhibit) this.frameIrqFlag = false;
          this.frameCycle = 0;
          if (this.frameMode5) {
            this.clockQuarterFrame();
            this.clockHalfFrame();
          }
          break;
        }
        default:
          break;
      }
    }
    writeMapperRegister(addr, value){
      if (!this.expansionAudio || typeof this.expansionAudio.writeCpu !== 'function') return false;
      return !!this.expansionAudio.writeCpu(addr & 0xffff, value & 0xff);
    }
    clockQuarterFrame(){
      this.p1.clockQuarter();
      this.p2.clockQuarter();
      this.tri.clockQuarter();
      this.noise.clockQuarter();
    }
    clockHalfFrame(){
      this.p1.clockHalf();
      this.p2.clockHalf();
      this.tri.clockHalf();
      this.noise.clockHalf();
    }
    clockFrameSequencer(){
      this.frameCycle += 1;
      if (this.frameMode5) {
        if (this.frameCycle === 3729 || this.frameCycle === 11186 || this.frameCycle === 18641) {
          this.clockQuarterFrame();
        }
        if (this.frameCycle === 7457 || this.frameCycle === 18641) {
          this.clockHalfFrame();
        }
        if (this.frameCycle >= 18641) this.frameCycle = 0;
      } else {
        if (this.frameCycle === 3729 || this.frameCycle === 7457 || this.frameCycle === 11186 || this.frameCycle === 14915) {
          this.clockQuarterFrame();
        }
        if (this.frameCycle === 7457 || this.frameCycle === 14915) {
          this.clockHalfFrame();
        }
        if (this.frameCycle === 14915 && !this.frameIrqInhibit) {
          this.frameIrqFlag = true;
        }
        if (this.frameCycle >= 14915) this.frameCycle = 0;
      }
    }
    mixSample(p1, p2, tri, noise, dmc, expansion = 0){
      const pulseSum = (p1 + p2) | 0;
      const pulseOut = APU_PULSE_MIX_TABLE[pulseSum] || 0;
      const tndIdx = ((tri & 0x0f) << 11) | ((noise & 0x0f) << 7) | (dmc & 0x7f);
      const tndOut = APU_TND_MIX_TABLE[tndIdx] || 0;
      const mixed = pulseOut + tndOut + (+expansion || 0);
      const mixAbs = Math.abs(mixed);
      if (mixAbs > this.recentMixInputPeak) this.recentMixInputPeak = mixAbs;
      return mixed;
    }
    pushSample(v){
      if (this.sampleQueueCount >= this.sampleQueueCapacity) {
        this.sampleQueueRead = (this.sampleQueueRead + 1) & this.sampleQueueMask;
        this.sampleQueueCount -= 1;
        this.droppedSamples = (this.droppedSamples + 1) >>> 0;
      }
      this.sampleQueue[this.sampleQueueWrite] = v;
      this.sampleQueueWrite = (this.sampleQueueWrite + 1) & this.sampleQueueMask;
      this.sampleQueueCount += 1;
      this.generatedSamples = (this.generatedSamples + 1) >>> 0;
      const abs = Math.abs(v);
      if (abs > this.recentSamplePeak) this.recentSamplePeak = abs;
      this.recentSampleCounter = (this.recentSampleCounter + 1) >>> 0;
      if ((this.recentSampleCounter & 0x03ff) === 0) {
        this.recentSamplePeak *= 0.9;
        this.recentMixInputPeak *= 0.9;
      }
    }
    dropQueuedSamples(dropCount){
      const drop = Math.max(0, Math.min(this.sampleQueueCount | 0, dropCount | 0));
      if (drop <= 0) return 0;
      this.sampleQueueRead = (this.sampleQueueRead + drop) & this.sampleQueueMask;
      this.sampleQueueCount -= drop;
      this.droppedSamples = (this.droppedSamples + drop) >>> 0;
      return drop;
    }
    popSample(){
      if (this.sampleQueueCount <= 0) {
        this.underrunCount = (this.underrunCount + 1) >>> 0;
        return this.holdSample;
      }
      const v = this.sampleQueue[this.sampleQueueRead];
      this.sampleQueueRead = (this.sampleQueueRead + 1) & this.sampleQueueMask;
      this.sampleQueueCount -= 1;
      this.consumedSamples = (this.consumedSamples + 1) >>> 0;
      this.holdSample = v;
      return v;
    }
    pullSamples(maxSamples){
      const want = Math.max(0, maxSamples | 0);
      if (want === 0 || this.sampleQueueCount <= 0) return null;
      const take = Math.min(want, this.sampleQueueCount | 0);
      const out = new Float32Array(take);
      for (let i = 0; i < take; i += 1) {
        out[i] = this.sampleQueue[this.sampleQueueRead];
        this.sampleQueueRead = (this.sampleQueueRead + 1) & this.sampleQueueMask;
      }
      this.sampleQueueCount -= take;
      this.consumedSamples = (this.consumedSamples + take) >>> 0;
      return out;
    }
    drainSamplesTo(pushSampleFn, maxSamples){
      if (typeof pushSampleFn !== 'function') return 0;
      const want = Math.max(0, maxSamples | 0);
      if (want <= 0 || this.sampleQueueCount <= 0) return 0;
      const take = Math.min(want, this.sampleQueueCount | 0);
      let last = this.holdSample;
      for (let i = 0; i < take; i += 1) {
        const sample = this.sampleQueue[this.sampleQueueRead];
        this.sampleQueueRead = (this.sampleQueueRead + 1) & this.sampleQueueMask;
        pushSampleFn(sample);
        last = sample;
      }
      this.sampleQueueCount -= take;
      this.consumedSamples = (this.consumedSamples + take) >>> 0;
      this.holdSample = last;
      return take;
    }
    drainSamplesCopyTo(target, targetOffset, maxSamples){
      if (!target || typeof target.length !== 'number') return 0;
      const outLen = target.length | 0;
      const offset = Math.max(0, targetOffset | 0);
      if (offset >= outLen) return 0;
      const want = Math.max(0, maxSamples | 0);
      if (want <= 0 || this.sampleQueueCount <= 0) return 0;
      const take = Math.min(want, this.sampleQueueCount | 0, (outLen - offset) | 0);
      if (take <= 0) return 0;
      const queue = this.sampleQueue;
      const queueCap = queue.length | 0;
      let read = this.sampleQueueRead | 0;
      let write = offset | 0;
      let remain = take | 0;
      let last = this.holdSample;
      while (remain > 0) {
        const chunk = Math.min(remain, queueCap - read);
        target.set(queue.subarray(read, read + chunk), write);
        last = queue[(read + chunk - 1) | 0];
        write += chunk;
        read = (read + chunk) & this.sampleQueueMask;
        remain -= chunk;
      }
      this.sampleQueueRead = read;
      this.sampleQueueCount -= take;
      this.consumedSamples = (this.consumedSamples + take) >>> 0;
      this.holdSample = last;
      return take;
    }
    consumeSamples(out){
      const n = out.length | 0;
      let i = 0;
      while (i < n) {
        if (this.sampleQueueCount > 0) {
          const sample = this.sampleQueue[this.sampleQueueRead];
          out[i] = sample;
          this.sampleQueueRead = (this.sampleQueueRead + 1) & this.sampleQueueMask;
          this.sampleQueueCount -= 1;
          this.consumedSamples = (this.consumedSamples + 1) >>> 0;
          this.holdSample = sample;
        } else {
          out[i] = this.holdSample;
          this.underrunCount = (this.underrunCount + 1) >>> 0;
        }
        i += 1;
      }
    }
    getRecentSamplePeak(){
      return +this.recentSamplePeak || 0;
    }
    getRecentMixInputPeak(){
      return +this.recentMixInputPeak || 0;
    }
    clock(cpuCycles){
      this.cpuCyclesClocked = (this.cpuCyclesClocked + (cpuCycles | 0)) >>> 0;
      for (let i = 0; i < cpuCycles; i += 1) {
        this.p1.clockTimer();
        this.p2.clockTimer();
        this.tri.clockTimer();
        this.noise.clockTimer();
        this.dmc.clockTimer();
        if (this.expansionAudio && typeof this.expansionAudio.clockCpuCycles === 'function') {
          this.expansionAudio.clockCpuCycles(1);
        }
        this.clockFrameSequencer();

        const p1 = this.p1.output();
        const p2 = this.p2.output();
        const tri = this.tri.output();
        const noise = this.noise.output();
        const dmc = this.dmc.output();
        const expansion = (this.expansionAudio && typeof this.expansionAudio.output === 'function')
          ? (+this.expansionAudio.output() || 0)
          : 0;

        if (
          p1 !== this.prevPulse1Out
          || p2 !== this.prevPulse2Out
          || tri !== this.prevTriOut
          || noise !== this.prevNoiseOut
          || dmc !== this.prevDmcOut
          || Math.abs(expansion - this.prevExpansionOut) > 1e-7
        ) {
          this.prevPulse1Out = p1;
          this.prevPulse2Out = p2;
          this.prevTriOut = tri;
          this.prevNoiseOut = noise;
          this.prevDmcOut = dmc;
          this.prevExpansionOut = expansion;
          const mixed = this.mixSample(p1, p2, tri, noise, dmc, expansion);
          this.currentMixedLevel = mixed;
          this.deltaSynth.enqueueLevel(mixed);
        }

        this.deltaSynth.advanceCycles(1, this._pushFromSynth);
      }
    }
  }

  class WebAudioOutput {
    constructor(backendPreference = 'auto'){
      this.ctx = null;
      this.master = null;
      this.processor = null;
      this.workletNode = null;
      this.running = false;
      this.apu = null;
      this.audioBackend = 'none';
      this.backendPreference = backendPreference;
      this.isFileOrigin = false;
      try {
        this.isFileOrigin = !!(window && window.location && window.location.protocol === 'file:');
      } catch (_err) {
        this.isFileOrigin = false;
      }
      this.workletBufferedFrames = 0;
      this.workletUnderruns = 0;
      this.workletProcessedFrames = 0;
      this.rendererFifo = null;
      this.rendererFifoMask = 0;
      this.rendererFifoRead = 0;
      this.rendererFifoWrite = 0;
      this.rendererFifoCount = 0;
      this.rendererHoldSample = 0;
      this.rendererUnderrunHoldStreak = 0;
      this.rendererUnderruns = 0;
      this.rendererDropped = 0;
      this._pushRendererSampleBound = (v) => this._pushRendererSample(v);
    }
    _initRendererFifo(capacityFrames){
      let cap = 1;
      const wanted = Math.max(RENDERER_FIFO_CAPACITY_SAMPLES, capacityFrames | 0);
      while (cap < wanted) cap <<= 1;
      this.rendererFifo = new Float32Array(cap);
      this.rendererFifoMask = cap - 1;
      this.rendererFifoRead = 0;
      this.rendererFifoWrite = 0;
      this.rendererFifoCount = 0;
      this.rendererHoldSample = 0;
      this.rendererUnderruns = 0;
      this.rendererDropped = 0;
    }
    _resetRendererFifo(clearStats = true){
      this.rendererFifoRead = 0;
      this.rendererFifoWrite = 0;
      this.rendererFifoCount = 0;
      this.rendererHoldSample = 0;
      this.rendererUnderrunHoldStreak = 0;
      if (clearStats) {
        this.rendererUnderruns = 0;
        this.rendererDropped = 0;
      }
    }
    _getScriptBlockSize(){
      if (this.processor && Number.isFinite(this.processor.bufferSize)) {
        return Math.max(256, this.processor.bufferSize | 0);
      }
      return this.isFileOrigin ? 2048 : 1024;
    }
    _getScriptTargetFrames(multiplier = 1.0){
      const sr = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 48000;
      const block = this._getScriptBlockSize();
      const requestedMul = Number.isFinite(multiplier) ? Math.max(1, multiplier) : 1.0;
      // File-origin ScriptProcessor is jitter-prone; keep a slightly deeper queue.
      // Avoid over-buffering because it increases perceived control/audio latency.
      const floorMul = this.isFileOrigin ? 2.0 : 1.5;
      const mul = Math.max(floorMul, requestedMul);
      const floorSeconds = this.isFileOrigin ? 0.04 : 0.03;
      return Math.max(Math.floor(block * mul), Math.floor(sr * floorSeconds));
    }
    _getScriptRefillTargetFrames(){
      const block = this._getScriptBlockSize();
      // Refill target is intentionally lower than startup/steady target to
      // avoid timer-driven CPU overrun when the main loop is already behind.
      return this.isFileOrigin
        ? Math.max(block, Math.floor(block * 1.2))
        : Math.max(block, Math.floor(block * 1.1));
    }
    _pushRendererSample(v){
      if (!this.rendererFifo) return;
      if (this.rendererFifoCount >= this.rendererFifo.length) {
        this.rendererDropped = (this.rendererDropped + 1) >>> 0;
        // Input-side policy: keep queued audio intact, drop new sample.
        return;
      }
      this.rendererFifo[this.rendererFifoWrite] = v;
      this.rendererFifoWrite = (this.rendererFifoWrite + 1) & this.rendererFifoMask;
      this.rendererFifoCount += 1;
    }
    _pushRendererChunk(chunk){
      if (!chunk || !this.rendererFifo) return;
      const len = chunk.length | 0;
      if (len <= 0) return;
      const fifo = this.rendererFifo;
      const capacity = fifo.length | 0;
      const free = (capacity - (this.rendererFifoCount | 0)) | 0;
      if (free <= 0) {
        this.rendererDropped = (this.rendererDropped + len) >>> 0;
        return;
      }
      const take = len <= free ? len : free;
      const write = this.rendererFifoWrite | 0;
      const first = Math.min(take, capacity - write);
      fifo.set(chunk.subarray(0, first), write);
      const remain = take - first;
      if (remain > 0) {
        fifo.set(chunk.subarray(first, first + remain), 0);
      }
      this.rendererFifoWrite = (write + take) & this.rendererFifoMask;
      this.rendererFifoCount += take;
      const dropped = len - take;
      if (dropped > 0) {
        this.rendererDropped = (this.rendererDropped + dropped) >>> 0;
      }
    }
    _dropRendererFrames(count){
      const drop = Math.max(0, Math.min(this.rendererFifoCount | 0, count | 0));
      if (drop <= 0) return 0;
      this.rendererFifoRead = (this.rendererFifoRead + drop) & this.rendererFifoMask;
      this.rendererFifoCount -= drop;
      this.rendererDropped = (this.rendererDropped + drop) >>> 0;
      return drop;
    }
    _trimRendererForRealtime(blockSize){
      const n = Math.max(1, blockSize | 0);
      // Keep output queue short on script backend to avoid control/audio latency growth.
      const maxBuffered = Math.max(n * 2, Math.floor(n * 2.5));
      if (this.rendererFifoCount > maxBuffered) {
        this._dropRendererFrames((this.rendererFifoCount - maxBuffered) | 0);
      }
    }
    _popRendererSample(){
      if (!this.rendererFifo || this.rendererFifoCount <= 0) {
        this.rendererUnderruns = (this.rendererUnderruns + 1) >>> 0;
        this.rendererUnderrunHoldStreak = (this.rendererUnderrunHoldStreak + 1) >>> 0;
        // Keep previous sample through underruns to avoid clicky zero-fill artifacts.
        return this.rendererHoldSample;
      }
      const v = this.rendererFifo[this.rendererFifoRead];
      this.rendererFifoRead = (this.rendererFifoRead + 1) & this.rendererFifoMask;
      this.rendererFifoCount -= 1;
      this.rendererHoldSample = v;
      this.rendererUnderrunHoldStreak = 0;
      return v;
    }
    _pullRendererTo(out){
      const n = out.length | 0;
      if (n <= 0) return;
      const hold = this.rendererHoldSample;
      if (!this.rendererFifo) {
        this.rendererUnderrunHoldStreak = (this.rendererUnderrunHoldStreak + n) >>> 0;
        out.fill(hold);
        this.rendererUnderruns = (this.rendererUnderruns + n) >>> 0;
        return;
      }
      const available = this.rendererFifoCount | 0;
      if (available <= 0) {
        this.rendererUnderrunHoldStreak = (this.rendererUnderrunHoldStreak + n) >>> 0;
        out.fill(hold);
        this.rendererUnderruns = (this.rendererUnderruns + n) >>> 0;
        return;
      }
      const take = Math.min(n, available);
      const fifo = this.rendererFifo;
      const capacity = fifo.length | 0;
      const read = this.rendererFifoRead | 0;
      const first = Math.min(take, capacity - read);
      out.set(fifo.subarray(read, read + first), 0);
      const remain = take - first;
      if (remain > 0) {
        out.set(fifo.subarray(0, remain), first);
      }
      this.rendererFifoRead = (read + take) & this.rendererFifoMask;
      this.rendererFifoCount -= take;
      this.rendererHoldSample = out[take - 1];
      if (take >= n) {
        this.rendererUnderrunHoldStreak = 0;
        return;
      }
      const deficit = n - take;
      this.rendererUnderrunHoldStreak = (this.rendererUnderrunHoldStreak + deficit) >>> 0;
      out.fill(this.rendererHoldSample, take);
      this.rendererUnderruns = (this.rendererUnderruns + deficit) >>> 0;
    }
    _pullRendererChunk(maxSamples){
      const n = Math.max(0, maxSamples | 0);
      if (!this.rendererFifo || n <= 0 || this.rendererFifoCount <= 0) return null;
      const take = Math.min(n, this.rendererFifoCount | 0);
      const out = new Float32Array(take);
      const fifo = this.rendererFifo;
      const capacity = fifo.length | 0;
      const read = this.rendererFifoRead | 0;
      const first = Math.min(take, capacity - read);
      out.set(fifo.subarray(read, read + first), 0);
      const remain = take - first;
      if (remain > 0) {
        out.set(fifo.subarray(0, remain), first);
      }
      this.rendererFifoRead = (read + take) & this.rendererFifoMask;
      this.rendererFifoCount -= take;
      this.rendererHoldSample = out[take - 1];
      this.rendererUnderrunHoldStreak = 0;
      return out;
    }
    _pumpApuToRenderer(targetFrames){
      if (!this.apu || !this.rendererFifo) return;
      const target = Math.max(0, Math.min(this.rendererFifo.length | 0, targetFrames | 0));
      if ((this.rendererFifoCount | 0) >= target) return;
      const fifo = this.rendererFifo;
      const fifoCap = fifo.length | 0;
      let guard = 0;
      while ((this.rendererFifoCount | 0) < target && guard < 8) {
        const fifoFree = (fifoCap - (this.rendererFifoCount | 0)) | 0;
        if (fifoFree <= 0) break;
        const apuAvailable = (this.apu && typeof this.apu.getSampleQueueLength === 'function')
          ? (this.apu.getSampleQueueLength() | 0)
          : 0;
        if (apuAvailable <= 0) break;
        const need = Math.max(1, Math.min((target - (this.rendererFifoCount | 0)) | 0, fifoFree, 2048, apuAvailable));
        const write = this.rendererFifoWrite | 0;
        const first = Math.min(need, fifoCap - write);
        let moved = 0;
        if (typeof this.apu.drainSamplesCopyTo === 'function') {
          const firstMoved = this.apu.drainSamplesCopyTo(fifo, write, first) | 0;
          moved += firstMoved;
          if (firstMoved === first && moved < need) {
            const secondNeed = (need - moved) | 0;
            if (secondNeed > 0) {
              moved += this.apu.drainSamplesCopyTo(fifo, 0, secondNeed) | 0;
            }
          }
        } else if (typeof this.apu.drainSamplesTo === 'function') {
          moved = this.apu.drainSamplesTo(this._pushRendererSampleBound, need) | 0;
        } else if (typeof this.apu.pullSamples === 'function') {
          const chunk = this.apu.pullSamples(need);
          if (!chunk || chunk.length <= 0) break;
          this._pushRendererChunk(chunk);
          moved = chunk.length | 0;
        } else {
          break;
        }
        if (moved <= 0) break;
        if (typeof this.apu.drainSamplesCopyTo === 'function') {
          this.rendererFifoWrite = (write + moved) & this.rendererFifoMask;
          this.rendererFifoCount += moved;
        }
        guard += 1;
      }
    }
    attachApu(apu){
      this.apu = apu;
      if (this.backendPreference === 'none') return;
      if (this.apu && this.ctx && typeof this.apu.setSampleRate === 'function') {
        this.apu.setSampleRate(this.ctx.sampleRate);
      }
      if (this.running) {
        const sr = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 48000;
        const scriptBackend = this.isScriptBackend();
        const target = scriptBackend
          ? this._getScriptTargetFrames(1.0)
          : Math.max(4096, Math.floor(sr * 0.12));
        this._pumpApuToRenderer(target);
      }
      if (this.workletNode && this.running) {
        this._pumpWorkletFromApu();
      }
    }
    getBackendLabel(){
      return this.audioBackend;
    }
    isScriptBackend(){
      return !!(this.audioBackend && this.audioBackend.indexOf('ScriptProcessor') === 0);
    }
    getBufferedFrames(){
      if (this.backendPreference === 'none') return 0;
      if (this.workletNode) return this.workletBufferedFrames | 0;
      return this.rendererFifo ? (this.rendererFifoCount | 0) : -1;
    }
    getUnderrunCount(){
      if (this.backendPreference === 'none') return 0;
      if (this.workletNode) return this.workletUnderruns >>> 0;
      return this.rendererUnderruns >>> 0;
    }
    getDroppedCount(){
      if (this.backendPreference === 'none') return 0;
      return this.rendererDropped >>> 0;
    }
    _pumpWorkletFromApu(){
      if (!this.workletNode || !this.running) return;
      const sampleRate = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 48000;
      const sourceTarget = Math.max(1024, Math.floor(sampleRate * 0.08));
      this._pumpApuToRenderer(sourceTarget);
      const targetBuffered = Math.max(512, Math.floor(sampleRate * 0.04));
      const chunkSize = 1024;
      let guard = 0;
      while (this.workletBufferedFrames < targetBuffered && guard < 6) {
        const chunk = this._pullRendererChunk(chunkSize);
        if (!chunk || chunk.length <= 0) break;
        this.workletNode.port.postMessage(
          { type: 'push', buffer: chunk.buffer, length: chunk.length },
          [chunk.buffer]
        );
        this.workletBufferedFrames += chunk.length;
        guard += 1;
      }
    }
    async ensureStarted(){
      if (this.backendPreference === 'none') {
        this.audioBackend = 'none';
        return true;
      }
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        try {
          this.ctx = new Ctx({ latencyHint: 'interactive' });
        } catch (_err) {
          this.ctx = new Ctx();
        }
        this.master = this.ctx.createGain();
        this.master.gain.value = 0;
        this._initRendererFifo(RENDERER_FIFO_CAPACITY_SAMPLES);

        const forceScript = this.backendPreference === 'script'
          || (this.backendPreference === 'auto' && this.isFileOrigin);
        const preferWorklet = !forceScript;
        let workletReady = false;
        if (preferWorklet && this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
          try {
            const workletUrl = new URL('src/nes-audio-worklet-processor.js', window.location.href).toString();
            await this.ctx.audioWorklet.addModule(workletUrl);
            this.workletNode = new AudioWorkletNode(this.ctx, 'nes-audio-worklet', {
              numberOfInputs: 0,
              numberOfOutputs: 1,
              outputChannelCount: [1],
              processorOptions: { capacity: 131072 },
            });
            this.workletNode.port.onmessage = (event) => {
              const msg = event && event.data ? event.data : null;
              if (!msg || msg.type !== 'stats') return;
              this.workletBufferedFrames = msg.buffered | 0;
              this.workletUnderruns = msg.underruns >>> 0;
              this.workletProcessedFrames = msg.processed >>> 0;
            };
            this.workletNode.connect(this.master);
            this.audioBackend = 'AudioWorklet';
            workletReady = true;
          } catch (err) {
            console.warn('[audio] AudioWorklet unavailable, fallback to ScriptProcessor', err);
            this.workletNode = null;
          }
        }

        if (!workletReady) {
          const bufferSize = this.isFileOrigin ? 4096 : 1024;
          this.processor = this.ctx.createScriptProcessor(bufferSize, 0, 2);
          this.processor.onaudioprocess = (e) => {
            const outL = e.outputBuffer.getChannelData(0);
            const outR = e.outputBuffer.numberOfChannels > 1
              ? e.outputBuffer.getChannelData(1)
              : null;
            if (!this.running || !this.apu) {
              outL.fill(this.rendererHoldSample);
              if (outR) outR.fill(this.rendererHoldSample);
              return;
            }
            const target = this._getScriptTargetFrames(1.0);
            this._pumpApuToRenderer(target);
            this._trimRendererForRealtime(outL.length);
            this._pullRendererTo(outL);
            if (outR) outR.set(outL);
          };
          this.processor.connect(this.master);
          if (this.backendPreference === 'script') this.audioBackend = 'ScriptProcessor(forced)';
          else if (this.isFileOrigin) this.audioBackend = 'ScriptProcessor(file-origin)';
          else this.audioBackend = 'ScriptProcessor';
        }

        this.master.connect(this.ctx.destination);
        if (this.apu && typeof this.apu.setSampleRate === 'function') {
          this.apu.setSampleRate(this.ctx.sampleRate);
        }
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return true;
    }
    setRunning(on){
      const wasRunning = !!this.running;
      this.running = !!on;
      if (this.backendPreference === 'none') return;
      if (!this.master || !this.ctx) return;
      if (this.running && !wasRunning) {
        // New run: keep prefilled samples, but reset runtime counters.
        this.rendererUnderruns = 0;
        this.rendererDropped = 0;
      }
      this.master.gain.setTargetAtTime(this.running ? 0.9 : 0, this.ctx.currentTime, 0.01);
      if (this.workletNode) {
        if (this.running) {
          this._pumpWorkletFromApu();
        } else {
          this.workletBufferedFrames = 0;
          this.workletNode.port.postMessage({ type: 'reset' });
        }
      }
      if (this.running) {
        const sr = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 48000;
        const scriptBackend = this.isScriptBackend();
        const target = scriptBackend
          ? this._getScriptTargetFrames(1.0)
          : Math.max(4096, Math.floor(sr * 0.12));
        this._pumpApuToRenderer(target);
      } else {
        this._resetRendererFifo(false);
      }
      if (!this.running && this.apu && typeof this.apu.clearSampleQueue === 'function') {
        this.apu.clearSampleQueue();
      }
    }
    updateFromApu(_apu){
      const sr = (this.ctx && this.ctx.sampleRate) ? this.ctx.sampleRate : 48000;
      const scriptBackend = this.isScriptBackend();
      const sourceTarget = this.running
        ? (scriptBackend ? this._getScriptTargetFrames(1.0) : Math.max(4096, Math.floor(sr * 0.12)))
        : (scriptBackend ? this._getScriptTargetFrames(1.5) : Math.max(8192, Math.floor(sr * 0.20)));
      this._pumpApuToRenderer(sourceTarget);
      // Long starvation can sound like a hard-held tone. Apply tiny decay at
      // frame/update cadence (not inside audio callback) to avoid extra jitter.
      if (
        this.rendererFifoCount <= 0
        && this.rendererUnderrunHoldStreak > 8192
      ) {
        this.rendererHoldSample *= 0.995;
      }
      if (this.workletNode) {
        if (this.running) this._pumpWorkletFromApu();
      }
    }
  }

  class BrowserApuFrontendAdapter {
    constructor(nes){
      this.nes = nes;
      this.browserApu = new NESApu(nes);
      this.noAdvanceStreak = 0;
      this.stallWarned = false;
      this.phaseTicksSeen = false;
      this.apuWriteCount = 0;
      this.apuWriteStats = {
        wAny: 0,
        wOther: 0,
        w4003: 0,
        w4007: 0,
        w400b: 0,
        w400f: 0,
        w4015: 0,
        w4017: 0,
        last4015: 0,
        lastAddr: 0,
        lastValue: 0,
      };
      if (!BROWSER_AUDIO_USE_PHASE_TICK) {
        this.onCpuPhaseTick = null;
      }
    }
    onAttach(){
      this.browserApu.reset();
      this.noAdvanceStreak = 0;
      this.stallWarned = false;
      this.phaseTicksSeen = false;
      this.apuWriteCount = 0;
      this.apuWriteStats.wAny = 0;
      this.apuWriteStats.wOther = 0;
      this.apuWriteStats.w4003 = 0;
      this.apuWriteStats.w4007 = 0;
      this.apuWriteStats.w400b = 0;
      this.apuWriteStats.w400f = 0;
      this.apuWriteStats.w4015 = 0;
      this.apuWriteStats.w4017 = 0;
      this.apuWriteStats.last4015 = 0;
      this.apuWriteStats.lastAddr = 0;
      this.apuWriteStats.lastValue = 0;
    }
    onReset(){
      this.browserApu.reset();
      this.noAdvanceStreak = 0;
      this.stallWarned = false;
      this.phaseTicksSeen = false;
    }
    onCpuWrite(_nes, addr, value){
      const a = addr & 0xffff;
      const v = value & 0xff;
      if (this.browserApu && typeof this.browserApu.writeMapperRegister === 'function') {
        this.browserApu.writeMapperRegister(a, v);
      }
      if ((a >= 0x4000 && a <= 0x4013) || a === 0x4015 || a === 0x4017) {
        this.browserApu.writeRegister(a, v);
        this.apuWriteCount = (this.apuWriteCount + 1) >>> 0;
        this.apuWriteStats.wAny = (this.apuWriteStats.wAny + 1) >>> 0;
        this.apuWriteStats.lastAddr = a & 0xffff;
        this.apuWriteStats.lastValue = v & 0xff;
        if (a === 0x4003) this.apuWriteStats.w4003 = (this.apuWriteStats.w4003 + 1) >>> 0;
        else if (a === 0x4007) this.apuWriteStats.w4007 = (this.apuWriteStats.w4007 + 1) >>> 0;
        else if (a === 0x400b) this.apuWriteStats.w400b = (this.apuWriteStats.w400b + 1) >>> 0;
        else if (a === 0x400f) this.apuWriteStats.w400f = (this.apuWriteStats.w400f + 1) >>> 0;
        else if (a === 0x4015) {
          this.apuWriteStats.w4015 = (this.apuWriteStats.w4015 + 1) >>> 0;
          this.apuWriteStats.last4015 = v & 0xff;
        } else if (a === 0x4017) this.apuWriteStats.w4017 = (this.apuWriteStats.w4017 + 1) >>> 0;
        else this.apuWriteStats.wOther = (this.apuWriteStats.wOther + 1) >>> 0;
      }
    }
    onCpuPhaseTick(_nes, phase){
      if (!phase || !phase.cpuCe) return;
      this.phaseTicksSeen = true;
      this.browserApu.clock(1);
      if (this.stallWarned && AUDIO_VERBOSE_LOG) {
        console.info(`[audio] CPU cycle advance recovered after ${this.noAdvanceStreak} stale ticks`);
      }
      this.noAdvanceStreak = 0;
      this.stallWarned = false;
    }
    onCpuCyclesAdvanced(_nes, cpuCycles){
      const advanced = cpuCycles | 0;
      // Fallback path for cores that do not emit phase callbacks.
      if (!this.phaseTicksSeen && advanced > 0) {
        this.browserApu.clock(advanced);
        if (this.stallWarned && AUDIO_VERBOSE_LOG) {
          console.info(`[audio] CPU cycle advance recovered after ${this.noAdvanceStreak} stale ticks`);
        }
        this.noAdvanceStreak = 0;
        this.stallWarned = false;
      }
    }
    noteNoCpuAdvance(sourceTag){
      this.noAdvanceStreak += 1;
      if (!this.stallWarned && this.noAdvanceStreak >= 120) {
        this.stallWarned = true;
        if (AUDIO_VERBOSE_LOG) {
          console.warn(`[audio] No CPU cycle advance for ${this.noAdvanceStreak} consecutive ticks (${sourceTag}); audio may be silent.`);
        }
      }
    }
  }

  function createBrowserNES(cart){
    if (!CoreNES) throw new Error("NES core not loaded. Please serve src/nes.js with index.html");
    const nes = new CoreNES(cart);
    nes.performanceFastMode = true;
    if (audioBackendPreference !== 'none') {
      const audioAdapter = new BrowserApuFrontendAdapter(nes);
      nes.registerFrontendAdapter(audioAdapter);
      nes.browserApu = audioAdapter.browserApu;
      nes.browserAudioAdapter = audioAdapter;
    } else {
      nes.browserApu = null;
      nes.browserAudioAdapter = null;
    }

    return nes;
  }
  const renderCore = globalThis.NESCoreRender;
  if (!renderCore || !renderCore.renderFrameRgb || !renderCore.blitRgbToImageData) {
    throw new Error('Render core not loaded. Please serve src/render.js with index.html');
  }
  const SCREEN_WIDTH = 256;
  const SCREEN_HEIGHT = 240;
  const SCREEN_PIXEL_COUNT = SCREEN_WIDTH * SCREEN_HEIGHT;

  function renderFrameToImageData(nes,img){
    const ppu = nes && nes.ppuState ? nes.ppuState : null;
    const frameColor = ppu && ppu.frameColor ? ppu.frameColor : null;
    if (frameColor && typeof renderCore.blitFrameColorToImageData === 'function') {
      const backdrop = (nes && nes.palette && nes.palette.length > 0) ? (nes.palette[0] & 0x3f) : 0x0f;
      renderCore.blitFrameColorToImageData(frameColor, img, backdrop);
      return;
    }
    const frame=renderCore.renderFrameRgb(nes);
    renderCore.blitRgbToImageData(frame,img);
  }

  function create2dFramePresenter(canvasEl){
    const context2d = canvasEl.getContext('2d');
    if (!context2d) return null;
    const imageData = context2d.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    return {
      getBackendName() {
        return '2d';
      },
      present(nes) {
        renderFrameToImageData(nes, imageData);
        context2d.putImageData(imageData, 0, 0);
      },
    };
  }

  function createWebglShader(gl, shaderType, source) {
    const shader = gl.createShader(shaderType);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'unknown shader compile error';
      gl.deleteShader(shader);
      throw new Error(log);
    }
    return shader;
  }

  function createWebglProgram(gl, vertexSource, fragmentSource) {
    const vs = createWebglShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fs = createWebglShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'unknown program link error';
      gl.deleteProgram(program);
      throw new Error(log);
    }
    return program;
  }

  function createWebglFramePresenter(canvasEl){
    const gl = canvasEl.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;

    const vertexSource = `
      attribute vec2 aPos;
      varying vec2 vUv;
      void main() {
        vUv = (aPos + 1.0) * 0.5;
        vUv.y = 1.0 - vUv.y;
        gl_Position = vec4(aPos, 0.0, 1.0);
      }
    `;
    const fragmentSource = `
      precision mediump float;
      varying vec2 vUv;
      uniform sampler2D uFrameIndex;
      uniform sampler2D uPalette;
      void main() {
        float idx = texture2D(uFrameIndex, vUv).r * 255.0;
        float paletteU = (floor(idx + 0.5) + 0.5) / 64.0;
        vec3 rgb = texture2D(uPalette, vec2(paletteU, 0.5)).rgb;
        gl_FragColor = vec4(rgb, 1.0);
      }
    `;

    const program = createWebglProgram(gl, vertexSource, fragmentSource);
    if (!program) return null;
    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, 'aPos');
    if (posLoc < 0) throw new Error('WebGL attribute aPos not found');
    const frameLoc = gl.getUniformLocation(program, 'uFrameIndex');
    const paletteLoc = gl.getUniformLocation(program, 'uPalette');
    if (!frameLoc || !paletteLoc) throw new Error('WebGL uniforms not found');

    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) throw new Error('WebGL buffer create failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const frameTexA = gl.createTexture();
    const frameTexB = gl.createTexture();
    const paletteTex = gl.createTexture();
    if (!frameTexA || !frameTexB || !paletteTex) throw new Error('WebGL texture create failed');

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

    const frameTextures = [frameTexA, frameTexB];
    for (let i = 0; i < frameTextures.length; i += 1) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, frameTextures[i]);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        SCREEN_WIDTH,
        SCREEN_HEIGHT,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        null,
      );
    }

    const paletteRgb = (renderCore.NES_PALETTE_RGB instanceof Uint8Array && renderCore.NES_PALETTE_RGB.length >= 64 * 3)
      ? renderCore.NES_PALETTE_RGB
      : null;
    if (!paletteRgb) throw new Error('Render palette not available for WebGL presenter');

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, paletteTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      64,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      paletteRgb,
    );

    gl.uniform1i(frameLoc, 0);
    gl.uniform1i(paletteLoc, 1);
    gl.viewport(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const fallbackFrame = new Uint8Array(SCREEN_PIXEL_COUNT);
    let fallbackColor = -1;
    let frameTexIndex = 0;
    return {
      getBackendName() {
        return 'webgl';
      },
      present(nes) {
        const ppu = nes && nes.ppuState ? nes.ppuState : null;
        const frameColor = ppu && ppu.frameColor ? ppu.frameColor : null;
        const src = (frameColor && frameColor.length === SCREEN_PIXEL_COUNT) ? frameColor : null;
        frameTexIndex ^= 1;
        const frameTex = frameTextures[frameTexIndex];
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, frameTex);
        if (src) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, gl.LUMINANCE, gl.UNSIGNED_BYTE, src);
        } else {
          const backdrop = (nes && nes.palette && nes.palette.length > 0) ? (nes.palette[0] & 0x3f) : 0x0f;
          if (backdrop !== fallbackColor) {
            fallbackFrame.fill(backdrop & 0x3f);
            fallbackColor = backdrop;
          }
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, gl.LUMINANCE, gl.UNSIGNED_BYTE, fallbackFrame);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      },
    };
  }

  function createFramePresenter(canvasEl, preference = 'auto'){
    const pref = String(preference || 'auto').trim().toLowerCase();
    if (pref === '2d' || pref === 'canvas') {
      return create2dFramePresenter(canvasEl);
    }
    if (pref === 'webgl' || pref === 'gl' || pref === 'gpu' || pref === 'auto') {
      try {
        const webglPresenter = createWebglFramePresenter(canvasEl);
        if (webglPresenter) return webglPresenter;
      } catch (_err) {
        // Fallback to 2D presenter below.
      }
    }
    return create2dFramePresenter(canvasEl);
  }

  const parseINES = (bytes) => {
    const inesCore = globalThis.NESCoreINES;
    if (!inesCore || !inesCore.parseINESBytes) {
      throw new Error('iNES parser not loaded. Please serve src/ines.js with index.html');
    }
    return inesCore.parseINESBytes(bytes);
  };

  const romInput=document.getElementById('romInput');
  const runBtn=document.getElementById('runBtn');
  const pauseBtn=document.getElementById('pauseBtn');
  const resetBtn=document.getElementById('resetBtn');
  const stepBtn=document.getElementById('stepBtn');
  const recStartBtn=document.getElementById('recStartBtn');
  const recStopBtn=document.getElementById('recStopBtn');
  const recPlayBtn=document.getElementById('recPlayBtn');
  const recExportBtn=document.getElementById('recExportBtn');
  const recImportInput=document.getElementById('recImportInput');
  const recInfoEl=document.getElementById('recInfo');
  const statusEl=document.getElementById('status');
  const infoEl=document.getElementById('info');
  const debugEl=document.getElementById('debug');
  const pcKeyboardModeEl=document.getElementById('pcKeyboardMode');
  const fbKeyboardToggle=document.getElementById('fbKeyboardToggle');
  const fbCassetteToggle=document.getElementById('fbCassetteToggle');
  const fbTapePlayBtn=document.getElementById('fbTapePlayBtn');
  const fbTapeRecBtn=document.getElementById('fbTapeRecBtn');
  const fbTapeStopBtn=document.getElementById('fbTapeStopBtn');
  const fbTapeRewBtn=document.getElementById('fbTapeRewBtn');
  const fbTapeExportBtn=document.getElementById('fbTapeExportBtn');
  const fbTapeImportInput=document.getElementById('fbTapeImportInput');
  const fbTapeInfo=document.getElementById('fbTapeInfo');
  const canvas=document.getElementById('screen');
  function resolveRenderBackendPreference(){
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = String(params.get('render') || '').trim().toLowerCase();
      if (raw === '2d' || raw === 'canvas') return '2d';
      if (raw === 'webgl' || raw === 'gl' || raw === 'gpu') return 'webgl';
    } catch (_err) {
      // Keep auto mode on URL parsing failure.
    }
    return 'auto';
  }

  const renderBackendPreference = resolveRenderBackendPreference();
  const framePresenter = createFramePresenter(canvas, renderBackendPreference);
  if (!framePresenter || typeof framePresenter.present !== 'function') {
    throw new Error('Frame presenter init failed');
  }

  function resolveAudioBackendPreference(){
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = String(params.get('audio') || '').trim().toLowerCase();
      if (raw === 'none' || raw === 'off' || raw === 'mute' || raw === '0') return 'none';
      if (raw === 'script' || raw === 'sp' || raw === 'legacy') return 'script';
      if (raw === 'worklet' || raw === 'aw') return 'worklet';
    } catch (_err) {
      // Keep auto mode on URL parsing failure.
    }
    return 'auto';
  }

  function resolveCoreBackendPreference(){
    try {
      const params = new URLSearchParams(window.location.search || '');
      const raw = String(params.get('core') || '').trim().toLowerCase();
      if (raw === 'js' || raw === 'javascript') return 'js';
      if (raw === 'wasm' || raw === 'webassembly') return 'wasm';
    } catch (_err) {
      // Keep auto mode on URL parsing failure.
    }
    return 'auto';
  }

  function getLaunchQueryParams(){
    try {
      return new URLSearchParams(window.location.search || '');
    } catch (_err) {
      return new URLSearchParams('');
    }
  }

  const audioBackendPreference = resolveAudioBackendPreference();
  const coreBackendPreference = resolveCoreBackendPreference();
  const audioOutput = new WebAudioOutput(audioBackendPreference);

  let nes=null, emuBackend=null, running=false, raf=0;
  let audioDriveTimer=0;
  let lastFrameTs=0;
  let frameAccMs=0;
  let lastAudioRecoveryTs=0;
  let runtimeStartTs=0;
  let runtimeCpuCyclesTotal=0;
  let runtimeCpuCyclesLastRaw=0;
  let runtimeCpuCyclesReady=false;
  let runtimeStartCpuCyclesTotal=0;
  let hudPresentDivider=0;
  let debugPresentDivider=0;
  let recUiPresentDivider=0;
  let tapeUiPresentDivider=0;
  let tapeUiLastBackend = null;
  let tapeUiLastDeviceEnabled = null;
  let tapeUiLastInfoText = '';
  let tapeUiLastButtonsMask = -1;
  let fpsWarmupStartTs=0;
  let fpsCurrent=0;
  let fpsWindowStartTs=0;
  let fpsWindowFrames=0;
  let fps60=0;
  let fps600=0;
  const fpsRingCapacity = 1024;
  const fpsRingMask = fpsRingCapacity - 1;
  const fpsRingTimes = new Float64Array(fpsRingCapacity);
  let fpsRingHead=0;
  let fpsRingCount=0;
  let lastFpsStatusUpdateTs=0;
  const fpsWarmupMs = 3000;
  const targetFrameMs=1000/60.0988;
  const ntscCpuClockHz = 1789773;
  const ntscFramesPerSecond = 60.0988;
  const ntscCyclesPerFrame = ntscCpuClockHz / ntscFramesPerSecond;
  const keys={a:false,b:false,select:false,start:false,up:false,down:false,left:false,right:false};
  const expansionKeys = Object.create(null);
  let pcKeyboardMode = (pcKeyboardModeEl && pcKeyboardModeEl.value === 'family') ? 'family' : 'pad';
  let familyBasicKeyboardUiEnabled = !!(fbKeyboardToggle ? fbKeyboardToggle.checked : true);
  let familyBasicCassetteUiEnabled = !!(fbCassetteToggle ? fbCassetteToggle.checked : true);
  let loadedRomName='';
  let recordingActive=false;
  let replayActive=false;
  let replayIndex=0;
  let recordingData=null;

  function getActiveEmulationBackendName() {
    if (!emuBackend || typeof emuBackend.getName !== 'function') return 'js';
    try {
      return String(emuBackend.getName() || 'js');
    } catch (_err) {
      return 'js';
    }
  }

  function getActiveRenderBackendName() {
    if (!framePresenter || typeof framePresenter.getBackendName !== 'function') return '2d';
    try {
      return String(framePresenter.getBackendName() || '2d');
    } catch (_err) {
      return '2d';
    }
  }

  function resetFpsMeter() {
    fpsWarmupStartTs = 0;
    fpsCurrent = 0;
    fpsWindowStartTs = 0;
    fpsWindowFrames = 0;
    fps60 = 0;
    fps600 = 0;
    fpsRingHead = 0;
    fpsRingCount = 0;
    fpsRingTimes.fill(0);
    lastFpsStatusUpdateTs = 0;
  }

  function pushFpsSample(ts) {
    fpsRingTimes[fpsRingHead & fpsRingMask] = ts;
    fpsRingHead = (fpsRingHead + 1) & fpsRingMask;
    if (fpsRingCount < fpsRingCapacity) fpsRingCount += 1;
  }

  function computeFpsFromFrameWindow(windowFrames, nowTs) {
    const need = (windowFrames | 0) + 1;
    if (fpsRingCount < need) return 0;
    const latestIdx = (fpsRingHead - 1) & fpsRingMask;
    const firstIdx = (latestIdx - (windowFrames | 0)) & fpsRingMask;
    const firstTs = fpsRingTimes[firstIdx];
    const elapsed = nowTs - firstTs;
    if (!(elapsed > 0)) return 0;
    return ((windowFrames | 0) * 1000) / elapsed;
  }

  function noteFramePresented(ts) {
    const now = Number(ts);
    if (!Number.isFinite(now)) return;
    if (fpsWarmupStartTs <= 0) {
      fpsWarmupStartTs = now;
      return;
    }
    const warmupElapsed = now - fpsWarmupStartTs;
    if (warmupElapsed < fpsWarmupMs) {
      return;
    }
    pushFpsSample(now);
    fps60 = computeFpsFromFrameWindow(60, now);
    fps600 = computeFpsFromFrameWindow(600, now);
    if (fpsWindowStartTs <= 0) {
      fpsWindowStartTs = now;
      fpsWindowFrames = 1;
      return;
    }
    fpsWindowFrames += 1;
    const windowElapsed = now - fpsWindowStartTs;
    if (windowElapsed >= 1000) {
      fpsCurrent = (fpsWindowFrames * 1000) / windowElapsed;
      fpsWindowStartTs = now;
      fpsWindowFrames = 0;
    }
  }

  function getFps60Text() {
    if (!(fps60 > 0)) return '--';
    return fps60.toFixed(2);
  }

  function getFps600Text() {
    if (!(fps600 > 0)) return '--';
    return fps600.toFixed(2);
  }

  function getCurrentFpsText() {
    if (!(fpsCurrent > 0)) return '--';
    return fpsCurrent.toFixed(2);
  }

  function getNowMs(ts = NaN) {
    const n = Number(ts);
    if (Number.isFinite(n)) return n;
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function getCurrentCpuCycleCounterFast() {
    if (nes && nes.cpuState && typeof nes.cpuState.cycleCounter === 'number') {
      return nes.cpuState.cycleCounter >>> 0;
    }
    const snapshot = getRuntimeStateSnapshot();
    if (snapshot && typeof snapshot.cpuCycleCounter === 'number') {
      return snapshot.cpuCycleCounter >>> 0;
    }
    return 0;
  }

  function resetRuntimeCpuCycleTracker(raw = NaN) {
    runtimeCpuCyclesTotal = 0;
    runtimeCpuCyclesReady = false;
    const n = Number(raw);
    if (Number.isFinite(n)) {
      runtimeCpuCyclesLastRaw = (n >>> 0);
      runtimeCpuCyclesReady = true;
      return;
    }
    runtimeCpuCyclesLastRaw = getCurrentCpuCycleCounterFast();
    runtimeCpuCyclesReady = true;
  }

  function noteRuntimeCpuCycleRaw(raw) {
    const current = (raw >>> 0);
    if (!runtimeCpuCyclesReady) {
      runtimeCpuCyclesLastRaw = current;
      runtimeCpuCyclesReady = true;
      return 0;
    }
    const delta = ((current - runtimeCpuCyclesLastRaw) >>> 0);
    runtimeCpuCyclesLastRaw = current;
    runtimeCpuCyclesTotal += delta;
    return delta;
  }

  function noteRuntimeCpuCycleNow() {
    return noteRuntimeCpuCycleRaw(getCurrentCpuCycleCounterFast());
  }

  function resetRuntimePacingAnchor(ts = NaN) {
    runtimeStartTs = getNowMs(ts);
    runtimeStartCpuCyclesTotal = runtimeCpuCyclesTotal;
  }

  function getRuntimeCpuLeadFrames(ts = NaN) {
    if (!runtimeStartTs) return 0;
    const now = getNowMs(ts);
    const elapsedMs = now - runtimeStartTs;
    if (!(elapsedMs > 0)) return 0;
    const elapsedFrames = elapsedMs / targetFrameMs;
    const cpuCyclesElapsed = runtimeCpuCyclesTotal - runtimeStartCpuCyclesTotal;
    const emulatedFrames = cpuCyclesElapsed / ntscCyclesPerFrame;
    return emulatedFrames - elapsedFrames;
  }

  function setRunningStatus(backendLabel, ts = NaN, force = false) {
    if (!running) return;
    const now = Number(ts);
    if (!force && Number.isFinite(now) && lastFpsStatusUpdateTs > 0 && (now - lastFpsStatusUpdateTs) < 250) {
      return;
    }
    statusEl.textContent=`Running (${backendLabel}, core=${getActiveEmulationBackendName()}, renderer=${getActiveRenderBackendName()}) | FPS 1s=${getCurrentFpsText()} 60f=${getFps60Text()} 600f=${getFps600Text()}`;
    if (Number.isFinite(now)) lastFpsStatusUpdateTs = now;
  }

  function getRuntimeStateSnapshot() {
    if (emuBackend && typeof emuBackend.getStateSnapshot === 'function') {
      try {
        const snapshot = emuBackend.getStateSnapshot();
        if (snapshot && typeof snapshot === 'object') return snapshot;
      } catch (_err) {
        // Fall through to local NES snapshot.
      }
    }
    return readNesRuntimeSnapshot(nes);
  }

  function getRuntimeCpuCycleCounter() {
    const snapshot = getRuntimeStateSnapshot();
    if (snapshot && typeof snapshot.cpuCycleCounter === 'number') {
      return snapshot.cpuCycleCounter >>> 0;
    }
    return (nes && nes.cpuState) ? (nes.cpuState.cycleCounter >>> 0) : 0;
  }

  function encodeButtons(b){
    let v=0;
    if(b.a) v|=0x01;
    if(b.b) v|=0x02;
    if(b.select) v|=0x04;
    if(b.start) v|=0x08;
    if(b.up) v|=0x10;
    if(b.down) v|=0x20;
    if(b.left) v|=0x40;
    if(b.right) v|=0x80;
    return v&0xff;
  }

  function decodeButtons(v){
    return {
      a:(v&0x01)!==0, b:(v&0x02)!==0, select:(v&0x04)!==0, start:(v&0x08)!==0,
      up:(v&0x10)!==0, down:(v&0x20)!==0, left:(v&0x40)!==0, right:(v&0x80)!==0,
    };
  }

  function applyButtons(dst,src){
    dst.a=!!src.a; dst.b=!!src.b; dst.select=!!src.select; dst.start=!!src.start;
    dst.up=!!src.up; dst.down=!!src.down; dst.left=!!src.left; dst.right=!!src.right;
  }

  function updateRecorderUi(){
    const hasRec=!!(recordingData&&Array.isArray(recordingData.frames)&&recordingData.frames.length>0);
    if(recStartBtn) recStartBtn.disabled=!nes || recordingActive || replayActive;
    if(recStopBtn) recStopBtn.disabled=!nes || (!recordingActive && !replayActive);
    if(recPlayBtn) recPlayBtn.disabled=!nes || !hasRec || recordingActive || replayActive;
    if(recExportBtn) recExportBtn.disabled=!hasRec;
    if(recInfoEl){
      if(recordingActive) recInfoEl.textContent=`Recording... ${recordingData.frames.length} frames`;
      else if(replayActive) recInfoEl.textContent=`Replaying... ${replayIndex}/${recordingData.frames.length} frames`;
      else if(hasRec) recInfoEl.textContent=`Recorded ${recordingData.frames.length} frames (${recordingData.romName||'unknown ROM'})`;
      else recInfoEl.textContent='No recording.';
    }
  }

  function stopRecorderModes(){
    recordingActive=false;
    replayActive=false;
    replayIndex=0;
    updateRecorderUi();
  }

  function keyToBtn(code){
    if(code==='KeyZ') return 'a';
    if(code==='KeyX') return 'b';
    if(code==='Enter') return 'start';
    if(code==='ShiftLeft'||code==='ShiftRight') return 'select';
    if(code==='ArrowUp') return 'up';
    if(code==='ArrowDown') return 'down';
    if(code==='ArrowLeft') return 'left';
    if(code==='ArrowRight') return 'right';
    return null;
  }

  function clearAllKeys() {
    keys.a = false;
    keys.b = false;
    keys.select = false;
    keys.start = false;
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    if (emuBackend && typeof emuBackend.setFamilyBasicKeyboardState === 'function') {
      for (const code in expansionKeys) {
        if (!Object.prototype.hasOwnProperty.call(expansionKeys, code)) continue;
        delete expansionKeys[code];
      }
      emuBackend.setFamilyBasicKeyboardState(expansionKeys);
    }
  }

  function syncFamilyBasicKeyboardToggleUi() {
    if (!fbKeyboardToggle) return;
    const available = !!(
      emuBackend &&
      typeof emuBackend.isFamilyBasicKeyboardAvailable === 'function' &&
      emuBackend.isFamilyBasicKeyboardAvailable()
    );
    fbKeyboardToggle.disabled = !available;
    fbKeyboardToggle.checked = available ? !!familyBasicKeyboardUiEnabled : false;
    if (!available) return;
    if (typeof emuBackend.setFamilyBasicKeyboardDeviceEnabled === 'function') {
      emuBackend.setFamilyBasicKeyboardDeviceEnabled(!!familyBasicKeyboardUiEnabled);
    }
    if (
      familyBasicKeyboardUiEnabled &&
      typeof emuBackend.setFamilyBasicKeyboardState === 'function'
    ) {
      emuBackend.setFamilyBasicKeyboardState(expansionKeys);
    }
  }

  function setExpansionKeyboardKey(code, down) {
    if (!familyBasicKeyboardUiEnabled) return false;
    if (!emuBackend) return false;
    if (typeof emuBackend.setFamilyBasicKey === 'function') {
      const handled = !!emuBackend.setFamilyBasicKey(code, !!down);
      if (handled) {
        expansionKeys[code] = !!down;
      }
      return handled;
    }
    if (typeof emuBackend.setFamilyBasicKeyboardState === 'function') {
      expansionKeys[code] = !!down;
      return !!emuBackend.setFamilyBasicKeyboardState(expansionKeys);
    }
    return false;
  }

  function _syncFamilyBasicCassetteButtons(available) {
    const hasBackend = !!emuBackend;
    const enabled = !!(hasBackend && available && familyBasicCassetteUiEnabled);
    const buttonsMask =
      (available ? 1 : 0) |
      (enabled ? 2 : 0) |
      ((familyBasicCassetteUiEnabled ? 1 : 0) << 2);
    if (buttonsMask === tapeUiLastButtonsMask) return;
    tapeUiLastButtonsMask = buttonsMask;
    if (fbCassetteToggle) {
      fbCassetteToggle.disabled = !available;
      fbCassetteToggle.checked = available ? !!familyBasicCassetteUiEnabled : false;
    }
    if (fbTapePlayBtn) fbTapePlayBtn.disabled = !enabled;
    if (fbTapeRecBtn) fbTapeRecBtn.disabled = !enabled;
    if (fbTapeStopBtn) fbTapeStopBtn.disabled = !enabled;
    if (fbTapeRewBtn) fbTapeRewBtn.disabled = !enabled;
    if (fbTapeExportBtn) fbTapeExportBtn.disabled = !enabled;
    if (fbTapeImportInput) fbTapeImportInput.disabled = !enabled;
  }

  function syncFamilyBasicCassetteUi(force = false) {
    const available = !!(
      emuBackend &&
      typeof emuBackend.isFamilyBasicCassetteAvailable === 'function' &&
      emuBackend.isFamilyBasicCassetteAvailable()
    );
    _syncFamilyBasicCassetteButtons(available);
    if (!available || !emuBackend) {
      tapeUiLastBackend = emuBackend || null;
      tapeUiLastDeviceEnabled = null;
      if (fbTapeInfo && (force || tapeUiLastInfoText !== 'Tape: n/a')) {
        tapeUiLastInfoText = 'Tape: n/a';
        fbTapeInfo.textContent = tapeUiLastInfoText;
      }
      return;
    }
    const shouldApplyDeviceState = (
      force ||
      tapeUiLastBackend !== emuBackend ||
      tapeUiLastDeviceEnabled !== !!familyBasicCassetteUiEnabled
    );
    if (
      shouldApplyDeviceState &&
      typeof emuBackend.setFamilyBasicCassetteDeviceEnabled === 'function'
    ) {
      emuBackend.setFamilyBasicCassetteDeviceEnabled(!!familyBasicCassetteUiEnabled);
      tapeUiLastBackend = emuBackend;
      tapeUiLastDeviceEnabled = !!familyBasicCassetteUiEnabled;
    }
    let state = null;
    if (typeof emuBackend.getFamilyBasicCassetteState === 'function') {
      try {
        state = emuBackend.getFamilyBasicCassetteState();
      } catch (_err) {
        state = null;
      }
    }
    if (fbTapeInfo) {
      let nextText = '';
      if (!state) {
        nextText = `Tape: ${familyBasicCassetteUiEnabled ? 'enabled' : 'disabled'}`;
      } else {
        const mode = String(state.mode || 'stop');
        const pos = (state.pos | 0);
        const len = (state.length | 0);
        nextText = `Tape: ${mode} ${pos}/${len}`;
      }
      if (force || nextText !== tapeUiLastInfoText) {
        tapeUiLastInfoText = nextText;
        fbTapeInfo.textContent = nextText;
      }
    }
  }

  function tickFamilyBasicCassetteUi() {
    if (((tapeUiPresentDivider++ & 0x3f) !== 0)) return;
    syncFamilyBasicCassetteUi(false);
  }

  function _normalizeTapeBitsFromPayload(payload) {
    let bits = null;
    if (Array.isArray(payload)) {
      bits = payload;
    } else if (payload && typeof payload === 'object' && Array.isArray(payload.bits)) {
      bits = payload.bits;
    }
    if (!bits) return null;
    const out = new Array(bits.length);
    for (let i = 0; i < bits.length; i += 1) out[i] = bits[i] ? 1 : 0;
    return out;
  }

  function prefillAudioForStartup(maxFrames = 16, targetBufferedFrames = 4096){
    if (!nes || !audioOutput || typeof audioOutput.getBufferedFrames !== 'function') return 0;
    let runs = 0;
    let buffered = audioOutput.getBufferedFrames();
    while (runs < (maxFrames | 0)) {
      if (buffered >= 0 && buffered >= (targetBufferedFrames | 0)) break;
      emulateOneFrame();
      buffered = audioOutput.getBufferedFrames();
      runs += 1;
    }
    return runs;
  }

  async function startRuntime(triggerLabel = 'Run'){
    if(!nes) return;
    if (!running) {
      resetRuntimeCpuCycleTracker();
    }
    console.log(`[startRuntime:${triggerLabel}] PRE ctx.state=${audioOutput.ctx?.state} audioRunning=${audioOutput.running} globalRunning=${running}`);
    await audioOutput.ensureStarted();
    console.log(`[startRuntime:${triggerLabel}] POST-ensure ctx.state=${audioOutput.ctx?.state}`);
    audioOutput.attachApu(nes.browserApu || null);
    const backendLabel = audioOutput.getBackendLabel ? audioOutput.getBackendLabel() : 'audio';
    const noAudioBackend = backendLabel === 'none';
    if (!running) {
      // Prime output queue before unmuting to avoid startup underruns.
      // Skip prefill on ROM switch — the long synchronous task (~100ms for 12 frames)
      // triggers Chrome's animation budget throttling on high-refresh displays.
      const isWarmRestart = (triggerLabel === 'ROM switch' || triggerLabel === 'Reset');
      if (!noAudioBackend && !isWarmRestart) {
        const scriptBackend = !!(audioOutput && audioOutput.isScriptBackend && audioOutput.isScriptBackend());
        const startupTarget = scriptBackend
          ? (audioOutput && typeof audioOutput._getScriptTargetFrames === 'function'
            ? audioOutput._getScriptTargetFrames(1.0)
            : 2048)
          : 4096;
        prefillAudioForStartup(12, startupTarget);
      }
    }
    audioOutput.setRunning(true);
    _loopUseTimeout = false;
    if(!running){
      running=true;
      lastFrameTs=0;
      frameAccMs=0;
      hudPresentDivider=0;
      debugPresentDivider=0;
      recUiPresentDivider=0;
      tapeUiPresentDivider=0;
      resetRuntimePacingAnchor();
      resetFpsMeter();
      if (audioDriveTimer) {
        clearInterval(audioDriveTimer);
        audioDriveTimer = 0;
      }
      if (ENABLE_SCRIPT_AUDIO_DRIVE_TIMER && audioOutput && audioOutput.isScriptBackend && audioOutput.isScriptBackend()) {
        const timerMs = (audioOutput && audioOutput.isFileOrigin) ? 20 : 14;
        audioDriveTimer = setInterval(() => {
          if (!running || !nes) return;
          const scriptBackend = !!(audioOutput && audioOutput.isScriptBackend && audioOutput.isScriptBackend());
          if (!scriptBackend) return;
          try {
            const cpuLeadFrames = getRuntimeCpuLeadFrames();
            const sampleRate = (nes.browserApu && typeof nes.browserApu.sampleRate === 'number')
              ? nes.browserApu.sampleRate
              : 48000;
            const cyclesPerSample = Math.max(28, Math.min(64, Math.ceil(1789773 / sampleRate)));
            const scriptBlock = Math.max(256, ((audioOutput.processor && audioOutput.processor.bufferSize) ? (audioOutput.processor.bufferSize | 0) : 1024));
            const target = (typeof audioOutput._getScriptRefillTargetFrames === 'function')
              ? Math.max(scriptBlock, (audioOutput._getScriptRefillTargetFrames() | 0))
              : scriptBlock;
            const buffered = audioOutput.getBufferedFrames();
            const refillThreshold = Math.max(scriptBlock, target - (scriptBlock >> 1));
            if (buffered >= 0 && buffered < refillThreshold) {
              const deficit = Math.max(1, (target - buffered) | 0);
              runScriptAudioRefillBursts(deficit, cyclesPerSample, scriptBlock, cpuLeadFrames, false);
            }
          } catch (err) {
            running = false;
            cancelLoop();
            audioOutput.setRunning(false);
            if (audioDriveTimer) {
              clearInterval(audioDriveTimer);
              audioDriveTimer = 0;
            }
            statusEl.textContent=`Runtime error: ${err.message}`;
            console.error(err);
          }
        }, timerMs);
      }
      setRunningStatus(backendLabel, (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(), true);
      scheduleLoop();
    } else {
      setRunningStatus(backendLabel, (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(), true);
    }
  }

  addEventListener('keydown',(e)=>{
    if (pcKeyboardMode === 'family') {
      // Hardware-aligned level semantics: keep asserted until keyup.
      // Ignore browser auto-repeat pulses.
      if (e.repeat) { e.preventDefault(); return; }
      if (setExpansionKeyboardKey(e.code, true)) e.preventDefault();
      return;
    }
    const b=keyToBtn(e.code);
    if (!b) {
      return;
    }
    if (e.repeat && b !== 'start') {
      e.preventDefault();
      return;
    }
    keys[b]=true;
    if (b === 'start' && nes && !running) {
      startRuntime('Start key').catch((err) => {
        statusEl.textContent=`Audio start failed: ${err.message}`;
        console.error(err);
      });
    }
    e.preventDefault();
  });
  addEventListener('keyup',(e)=>{
    if (pcKeyboardMode === 'family') {
      if (setExpansionKeyboardKey(e.code, false)) e.preventDefault();
      return;
    }
    const b=keyToBtn(e.code);
    if(!b) {
      return;
    }
    keys[b]=false;
    e.preventDefault();
  });
  addEventListener('blur', () => {
    clearAllKeys();
  });
  addEventListener('visibilitychange', () => {
    if (typeof document !== 'undefined' && document.hidden) {
      clearAllKeys();
    }
  });

  function emulateFrameBatch(frameCount){
    if(!nes) return;
    if(!emuBackend) emuBackend = createBrowserEmulationBackend(nes);
    const target = frameCount | 0;
    if (target <= 0) return 0;
    let ran = 0;

    if (!replayActive) {
      const frameButtons = keys;
      const hasRecorder = !!(recordingActive && recordingData);
      const recCode = hasRecorder ? (encodeButtons(frameButtons) & 0xff) : 0;
      emuBackend.setController1(frameButtons);
      let noAdvanceFrames = 0;
      if (typeof emuBackend.runFrames === 'function') {
        const batchStep = emuBackend.runFrames(target, 120000, 12000);
        ran = batchStep && typeof batchStep.ran === 'number' ? (batchStep.ran | 0) : target;
        if (ran < 0) ran = 0;
        if (ran > target) ran = target;
        noAdvanceFrames = (batchStep && typeof batchStep.noAdvanceFrames === 'number')
          ? (batchStep.noAdvanceFrames | 0)
          : 0;
      } else {
        let noAdvanceStreak = 0;
        const maxNoAdvanceStreak = Math.max(8, target << 2);
        while (ran < target) {
          const step = emuBackend.runFrame(120000, 12000);
          const beforeCycles = step && typeof step.beforeCpuCycles === 'number'
            ? (step.beforeCpuCycles >>> 0)
            : getRuntimeCpuCycleCounter();
          const afterCycles = step && typeof step.afterCpuCycles === 'number'
            ? (step.afterCpuCycles >>> 0)
            : getRuntimeCpuCycleCounter();
          if (afterCycles === beforeCycles) {
            noAdvanceFrames += 1;
          }
          if (step && step.frameAdvanced) {
            ran += 1;
            noAdvanceStreak = 0;
          } else {
            noAdvanceStreak += 1;
            if (noAdvanceStreak >= maxNoAdvanceStreak) break;
          }
        }
      }
      if (hasRecorder && ran > 0) {
        for (let i = 0; i < ran; i += 1) {
          recordingData.frames.push(recCode);
        }
      }
      if (noAdvanceFrames > 0 && nes.browserAudioAdapter && nes.browserAudioAdapter.noteNoCpuAdvance) {
        nes.browserAudioAdapter.noteNoCpuAdvance('drawOneFrame');
      }
    } else {
      let noAdvanceStreak = 0;
      const maxNoAdvanceStreak = Math.max(8, target << 2);
      while (ran < target) {
        let frameButtons = keys;
        let nextReplayIndex = replayIndex;
        if (recordingData) {
          const recVal = replayIndex < recordingData.frames.length ? recordingData.frames[replayIndex] : 0;
          frameButtons = decodeButtons(recVal | 0);
          nextReplayIndex = replayIndex + 1;
        }
        emuBackend.setController1(frameButtons);
        const step = emuBackend.runFrame(120000, 12000);
        const beforeCycles = step && typeof step.beforeCpuCycles === 'number'
          ? (step.beforeCpuCycles >>> 0)
          : getRuntimeCpuCycleCounter();
        const afterCycles = step && typeof step.afterCpuCycles === 'number'
          ? (step.afterCpuCycles >>> 0)
          : getRuntimeCpuCycleCounter();
        if (afterCycles === beforeCycles && nes.browserAudioAdapter && nes.browserAudioAdapter.noteNoCpuAdvance) {
          nes.browserAudioAdapter.noteNoCpuAdvance('drawOneFrame');
        }
        if (step && step.frameAdvanced) {
          ran += 1;
          noAdvanceStreak = 0;
          if (recordingData) {
            replayIndex = nextReplayIndex;
            if (replayIndex >= recordingData.frames.length) {
              replayActive = false;
              statusEl.textContent = 'Replay finished';
            }
          }
        } else {
          noAdvanceStreak += 1;
          if (noAdvanceStreak >= maxNoAdvanceStreak) break;
        }
      }
    }
    if (ran > 0) {
      noteRuntimeCpuCycleNow();
      audioOutput.updateFromApu(nes.browserApu || null);
    }
    if (EXPOSE_RUNTIME_COUNTERS && typeof globalThis !== 'undefined') {
      const snapshot = getRuntimeStateSnapshot();
      globalThis.__nesFrameCounter = (snapshot && typeof snapshot.frameCounter === 'number')
        ? (snapshot.frameCounter >>> 0)
        : 0;
      globalThis.__nesCpuPc = (snapshot && typeof snapshot.cpuPc === 'number')
        ? (snapshot.cpuPc & 0xffff)
        : 0;
    }
    return ran;
  }

  function emulateOneFrame(){
    return emulateFrameBatch(1);
  }

  function emulateAudioSlice(cpuCycles = 1200){
    if(!nes) return;
    if(!emuBackend) emuBackend = createBrowserEmulationBackend(nes);
    emuBackend.setController1(keys);
    emuBackend.runCpuCycles(cpuCycles | 0);
    noteRuntimeCpuCycleNow();
    audioOutput.updateFromApu(nes.browserApu || null);
  }

  function runScriptAudioRefillBursts(deficitSamples, cyclesPerSample, scriptBlock, cpuLeadFrames, panicMode = false){
    const deficit = deficitSamples | 0;
    if (deficit <= 0) return 0;
    if (!panicMode && cpuLeadFrames < -1.25) {
      // Don't advance emulation from timer refill while visual side is behind.
      return 0;
    }
    const baseFrames = Math.max(32, Math.min(128, (scriptBlock >> 4) | 0));
    let bursts = Math.ceil(deficit / baseFrames);
    const maxBursts = panicMode ? 4 : 3;
    if (cpuLeadFrames < -1.5) {
      bursts = 1;
    } else if (cpuLeadFrames < -0.75) {
      bursts = Math.min(2, bursts);
    } else if (cpuLeadFrames > 2.0) {
      bursts = Math.min(2, bursts);
    } else {
      bursts = Math.min(maxBursts, bursts);
    }
    if (bursts < 1) bursts = 1;
    let sliceCycles = Math.round(baseFrames * cyclesPerSample);
    if (sliceCycles < 240) sliceCycles = 240;
    if (sliceCycles > 2800) sliceCycles = 2800;
    for (let i = 0; i < bursts; i += 1) {
      emulateAudioSlice(sliceCycles | 0);
    }
    return bursts | 0;
  }

  function recoverAudioQueueIfNeeded(scriptBackend, noAudioBackend, nowTs, frameLagMs = 0){
    if(!nes || noAudioBackend) return;
    if(!audioOutput || typeof audioOutput.getBufferedFrames !== 'function') return;
    // Timer-driven refill is primary for ScriptProcessor, but keep RAF panic-recovery
    // enabled as a backup path when the timer cannot keep up.
    if (scriptBackend) {
      const cpuLeadFrames = getRuntimeCpuLeadFrames(nowTs);
      if (cpuLeadFrames < -1.5) return;
      if (cpuLeadFrames > -0.25) return;
    }

    let sourceBuffered = audioOutput.getBufferedFrames() | 0;
    if (sourceBuffered < 0) return;
    const scriptBlock = scriptBackend
      ? Math.max(256, ((audioOutput.processor && audioOutput.processor.bufferSize) ? (audioOutput.processor.bufferSize | 0) : 1024))
      : 1024;
    const sourceTarget = scriptBackend
      ? Math.max(scriptBlock, Math.floor(scriptBlock * 1.15))
      : 3072;
    const sourcePanic = scriptBackend ? Math.max(768, Math.floor(scriptBlock * 0.60)) : 1024;
    if (sourceBuffered >= sourcePanic) return;

    const ts = Number(nowTs);
    const minRecoveryIntervalMs = scriptBackend ? 18 : 20;
    if (Number.isFinite(ts) && (ts - lastAudioRecoveryTs) < minRecoveryIntervalMs) return;
    lastAudioRecoveryTs = Number.isFinite(ts) ? ts : 0;

    // Script backend refill is done in small fixed-size bursts to reduce
    // long single-slice stalls and audible jitter under load.
    const deficitSamples = Math.max(0, sourceTarget - sourceBuffered);
    const sampleRate = (nes.browserApu && typeof nes.browserApu.sampleRate === 'number')
      ? nes.browserApu.sampleRate
      : 48000;
    const cyclesPerSample = Math.max(28, Math.min(64, Math.ceil(1789773 / sampleRate)));
    if (scriptBackend) {
      const cpuLeadFrames = getRuntimeCpuLeadFrames(nowTs);
      runScriptAudioRefillBursts(deficitSamples, cyclesPerSample, scriptBlock, cpuLeadFrames, true);
    } else {
      const minCycles = 3000;
      const maxCycles = 18000;
      let sliceCycles = deficitSamples * cyclesPerSample;
      if (sliceCycles < minCycles) sliceCycles = minCycles;
      if (sliceCycles > maxCycles) sliceCycles = maxCycles;
      emulateAudioSlice(sliceCycles | 0);
    }
  }

  function presentFrame(){
    if(!nes) return;
    framePresenter.present(nes);
    const shouldRefreshHud = ((hudPresentDivider++ & 0x07) === 0);
    const shouldRefreshDebug = ((debugPresentDivider++ & 0x1f) === 0);
    if (!shouldRefreshHud && !shouldRefreshDebug) {
      tickFamilyBasicCassetteUi();
      if ((recordingActive || replayActive) && ((recUiPresentDivider++ & 0x0f) === 0)) {
        updateRecorderUi();
      }
      return;
    }
    const ppu = nes.ppuState;
    const snapshot = getRuntimeStateSnapshot();
    const frameCounter = (snapshot && typeof snapshot.frameCounter === 'number')
      ? (snapshot.frameCounter >>> 0)
      : (ppu ? (ppu.frameCounter >>> 0) : 0);
    const cpuPc = (snapshot && typeof snapshot.cpuPc === 'number')
      ? (snapshot.cpuPc & 0xffff)
      : (nes.cpu ? (nes.cpu.pc & 0xffff) : 0);
    const mapper = (snapshot && typeof snapshot.mapper === 'number')
      ? (snapshot.mapper | 0)
      : ((nes.cartridge && typeof nes.cartridge.mapper === 'number') ? (nes.cartridge.mapper | 0) : -1);
    if (shouldRefreshHud) {
      infoEl.textContent=`Frame ${frameCounter} | PC ${cpuPc.toString(16).padStart(4,'0')} | Mapper ${mapper}`;
    }
    if (!shouldRefreshDebug) return;
    const ppuStatus = (snapshot && typeof snapshot.ppuStatus === 'number')
      ? (snapshot.ppuStatus & 0xff)
      : (ppu ? (ppu.status & 0xff) : 0);
    const padState = (snapshot && typeof snapshot.joypad1Buttons === 'number')
      ? (snapshot.joypad1Buttons & 0xff)
      : ((nes.controllers && typeof nes.controllers.joypad1Buttons === 'number')
        ? (nes.controllers.joypad1Buttons & 0xff)
        : 0);
    const cpuStopped = (snapshot && typeof snapshot.cpuStopped === 'boolean')
      ? snapshot.cpuStopped
      : !!(nes.cpu && nes.cpu.stopped);
    const unsupportedOpcodeCount = (snapshot && typeof snapshot.unsupportedOpcodeCount === 'number')
      ? (snapshot.unsupportedOpcodeCount >>> 0)
      : ((nes.cpu && typeof nes.cpu.unsupportedOpcodeCount === 'number')
        ? (nes.cpu.unsupportedOpcodeCount >>> 0)
        : 0);
    const audioApuStatus = nes.browserApu ? nes.browserApu.peekStatus().toString(16).padStart(2,'0') : '--';
    const audioQueueLen = nes.browserApu && typeof nes.browserApu.getSampleQueueLength === 'function'
      ? nes.browserApu.getSampleQueueLength()
      : -1;
    const audioUnderruns = nes.browserApu && typeof nes.browserApu.underrunCount === 'number'
      ? nes.browserApu.underrunCount >>> 0
      : 0;
    const audioPeak = nes.browserApu && typeof nes.browserApu.getRecentSamplePeak === 'function'
      ? nes.browserApu.getRecentSamplePeak()
      : 0;
    const outputBackend = (audioOutput && typeof audioOutput.getBackendLabel === 'function')
      ? audioOutput.getBackendLabel()
      : 'none';
    const outputBuffered = (audioOutput && typeof audioOutput.getBufferedFrames === 'function')
      ? audioOutput.getBufferedFrames()
      : -1;
    const outputUnderruns = (audioOutput && typeof audioOutput.getUnderrunCount === 'function')
      ? audioOutput.getUnderrunCount()
      : 0;
    const outputDropped = (audioOutput && typeof audioOutput.getDroppedCount === 'function')
      ? audioOutput.getDroppedCount()
      : 0;
    if (SHOW_EXTENDED_DEBUG) {
      const audioCycles = nes.browserApu && typeof nes.browserApu.cpuCyclesClocked === 'number'
        ? nes.browserApu.cpuCyclesClocked >>> 0
        : 0;
      const audioGenerated = nes.browserApu && typeof nes.browserApu.generatedSamples === 'number'
        ? nes.browserApu.generatedSamples >>> 0
        : 0;
      const audioConsumed = nes.browserApu && typeof nes.browserApu.consumedSamples === 'number'
        ? nes.browserApu.consumedSamples >>> 0
        : 0;
      const audioMixInPeak = nes.browserApu && typeof nes.browserApu.getRecentMixInputPeak === 'function'
        ? nes.browserApu.getRecentMixInputPeak()
        : 0;
      const audioWrites = nes.browserAudioAdapter && typeof nes.browserAudioAdapter.apuWriteCount === 'number'
        ? nes.browserAudioAdapter.apuWriteCount >>> 0
        : 0;
      const writeStats = (nes.browserAudioAdapter && nes.browserAudioAdapter.apuWriteStats)
        ? nes.browserAudioAdapter.apuWriteStats
        : null;
      const w4015 = writeStats ? (writeStats.w4015 >>> 0) : 0;
      const last4015 = writeStats ? (writeStats.last4015 & 0xff) : 0;
      const wAny = writeStats ? (writeStats.wAny >>> 0) : 0;
      const wOther = writeStats ? (writeStats.wOther >>> 0) : 0;
      const lastAddr = writeStats ? (writeStats.lastAddr & 0xffff) : 0;
      const lastValue = writeStats ? (writeStats.lastValue & 0xff) : 0;
      const wLenReload = writeStats
        ? ((writeStats.w4003 + writeStats.w4007 + writeStats.w400b + writeStats.w400f) >>> 0)
        : 0;
      debugEl.textContent=`CPU stopped=${cpuStopped ? 'yes' : 'no'} | unsupported=${unsupportedOpcodeCount} | PPUSTATUS=${ppuStatus.toString(16).padStart(2,'0')} | APUSTATUS=${audioApuStatus} | AQLEN=${audioQueueLen} | AU=${audioUnderruns} | ACYC=${audioCycles} | AGEN=${audioGenerated} | ACON=${audioConsumed} | API=${audioMixInPeak.toFixed(4)} | APK=${audioPeak.toFixed(4)} | AWR=${audioWrites} | WAPU=${wAny}/${wOther} | W4015=${w4015}:${last4015.toString(16).padStart(2,'0')} | WLEN=${wLenReload} | LAST=${lastAddr.toString(16).padStart(4,'0')}:${lastValue.toString(16).padStart(2,'0')} | AOB=${outputBackend} | AOBUF=${outputBuffered} | AOU=${outputUnderruns} | AOD=${outputDropped} | RND=${getActiveRenderBackendName()} | pad=${padState.toString(16).padStart(2,'0')} `;
    } else {
      debugEl.textContent=`PPUST=${ppuStatus.toString(16).padStart(2,'0')} | APUST=${audioApuStatus} | Q=${audioQueueLen} | AU=${audioUnderruns} | APK=${audioPeak.toFixed(4)} | AOB=${outputBackend} | OBU=${outputBuffered} | OAU=${outputUnderruns} | OAD=${outputDropped} | RND=${getActiveRenderBackendName()} | pad=${padState.toString(16).padStart(2,'0')}`;
    }
    if ((recordingActive || replayActive) && ((recUiPresentDivider++ & 0x0f) === 0)) {
      updateRecorderUi();
    }
    tickFamilyBasicCassetteUi();
  }

  let _loopUseTimeout = false;
  function scheduleLoop() {
    if (_loopUseTimeout) {
      raf = setTimeout(() => loop(performance.now()), 4);
    } else {
      raf = requestAnimationFrame(loop);
    }
  }
  function cancelLoop() {
    if (!raf) return;
    if (_loopUseTimeout) clearTimeout(raf);
    else cancelAnimationFrame(raf);
    raf = 0;
  }
  function loop(ts){
    try {
      if(!running) return;
      if(!lastFrameTs) lastFrameTs=ts;
      let delta=ts-lastFrameTs;
      lastFrameTs=ts;
      if(delta>100) delta=100;
      frameAccMs+=delta;
      const scriptBackend = !!(audioOutput && audioOutput.isScriptBackend && audioOutput.isScriptBackend());
      const backendLabel = (audioOutput && typeof audioOutput.getBackendLabel === 'function')
        ? audioOutput.getBackendLabel()
        : '';
      const noAudioBackend = backendLabel === 'none';
      if (noAudioBackend || scriptBackend) {
        recoverAudioQueueIfNeeded(scriptBackend, noAudioBackend, ts, frameAccMs);
        let maxFramesPerTick;
        if (scriptBackend) {
          // ScriptProcessor emulation takes ~15ms per frame, leaving <2ms
          // headroom in a 16.7ms vsync.  If we ever do 2 frames (30ms work)
          // Chrome sees the long task and drops RAF to 33ms permanently.
          // Capping to 1 frame per tick means a 33ms RAF only costs 15ms,
          // giving Chrome 18ms of headroom to recover to 16ms intervals.
          maxFramesPerTick = 1;
          if (frameAccMs > targetFrameMs * 1.5) frameAccMs = targetFrameMs * 1.5;
        } else {
          maxFramesPerTick = noAudioBackend ? 4 : 2;
          const maxAccum = targetFrameMs * 8;
          if (frameAccMs > maxAccum) frameAccMs = maxAccum;
        }
        let safety = 0;
        while (frameAccMs >= targetFrameMs && safety < maxFramesPerTick) {
          frameAccMs -= targetFrameMs;
          safety += 1;
        }
        let renderedFrames = 0;
        if (safety > 0) {
          renderedFrames = emulateFrameBatch(safety) | 0;
          if (renderedFrames < 0) renderedFrames = 0;
          if (renderedFrames < safety) {
            frameAccMs += (safety - renderedFrames) * targetFrameMs;
          }
        }
        if (renderedFrames > 0) {
          presentFrame();
          noteFramePresented(ts);
        }
        setRunningStatus(backendLabel, ts, false);
        scheduleLoop();
        return;
      }

      let maxFramesPerTick = 4;
      let safety=0;
      while(frameAccMs>=targetFrameMs && safety<maxFramesPerTick){
        frameAccMs-=targetFrameMs;
        safety+=1;
      }
      let renderedFrames = 0;
      if (safety > 0) {
        renderedFrames = emulateFrameBatch(safety) | 0;
        if (renderedFrames < 0) renderedFrames = 0;
        if (renderedFrames < safety) {
          frameAccMs += (safety - renderedFrames) * targetFrameMs;
        }
      }
      if (renderedFrames > 0) {
        presentFrame();
        noteFramePresented(ts);
      }
      setRunningStatus(backendLabel, ts, false);
      scheduleLoop();
    } catch (err) {
      running=false;
      cancelLoop();
      if (audioDriveTimer) {
        clearInterval(audioDriveTimer);
        audioDriveTimer = 0;
      }
      audioOutput.setRunning(false);
      statusEl.textContent=`Runtime error: ${err.message}`;
      infoEl.textContent=`Stopped at PC ${nes?.cpu?.pc?.toString(16).padStart(4,'0') || '????'}`;
      console.error(err);
    }
  }

  function setButtonsEnabled(on){
    runBtn.disabled=!on;
    pauseBtn.disabled=!on;
    if (resetBtn) resetBtn.disabled=!on;
    stepBtn.disabled=!on;
    updateRecorderUi();
  }

  function stopRuntime(){
    const wasRunning = running;
    running = false;
    cancelLoop();
    if (audioDriveTimer) { clearInterval(audioDriveTimer); audioDriveTimer = 0; }
    if (nes && nes.browserApu && typeof nes.browserApu.clearSampleQueue === 'function') {
      try { nes.browserApu.clearSampleQueue(); } catch (_err) {}
    }
    if (audioOutput && typeof audioOutput._dropRendererFrames === 'function') {
      const pending = (audioOutput.rendererFifoCount | 0);
      if (pending > 0) audioOutput._dropRendererFrames(pending);
    }
    if (audioOutput && audioOutput._resetRendererFifo) {
      try { audioOutput._resetRendererFifo(false); } catch (_err) {}
    }
    lastFrameTs = 0;
    frameAccMs = 0;
    lastAudioRecoveryTs = 0;
    runtimeStartTs = 0;
    runtimeStartCpuCyclesTotal = 0;
    resetRuntimeCpuCycleTracker(0);
    resetFpsMeter();
    tapeUiPresentDivider = 0;
    loopDiagCounter = 0;
  }

  function loadCartridgeFromBytes(bytes, romLabel = ''){
    const cart=parseINES(bytes);
    cart.romLabel = String(romLabel || '');
    const wasRunning = !!running;
    stopRecorderModes();
    if (wasRunning) {
      // Hot-swap: keep RAF loop alive, just swap NES instances in-place.
      // Stopping and restarting the runtime triggers Chrome RAF throttling
      // on high-refresh displays with ScriptProcessor audio backend.
      if (audioDriveTimer) { clearInterval(audioDriveTimer); audioDriveTimer = 0; }
      // Keep renderer FIFO intact — old samples will play out naturally (~170ms).
      // Clearing the FIFO causes silence which triggers Chrome's audio-silence
      // RAF throttling on ScriptProcessor backends.
      nes = null;
      emuBackend = null;
      nes = createBrowserNES(cart);
      emuBackend = createBrowserEmulationBackend(nes);
      syncFamilyBasicKeyboardToggleUi();
      syncFamilyBasicCassetteUi(true);
      nes.reset();
      lastFrameTs = 0;
      frameAccMs = 0;
      lastAudioRecoveryTs = 0;
      resetRuntimeCpuCycleTracker();
      resetRuntimePacingAnchor();
      resetFpsMeter();
      _loopUseTimeout = false;
      loadedRomName = String(romLabel || '');
      recordingData = null;
      audioOutput.attachApu(nes.browserApu || null);
      // Prefill APU sample queue so the renderer FIFO stays saturated.
      // Without this, the audioDriveTimer detects buf < target and runs
      // heavy emulateAudioSlice work that competes with RAF for main-thread
      // time, causing recurring 33ms deltas and a vicious 30fps spiral.
      if (audioOutput && audioOutput.isScriptBackend && audioOutput.isScriptBackend()) {
        const scriptTarget = (typeof audioOutput._getScriptTargetFrames === 'function')
          ? audioOutput._getScriptTargetFrames(1.0) : 8192;
        prefillAudioForStartup(12, scriptTarget);
      }
      // Don't recreate audioDriveTimer — its periodic emulateAudioSlice
      // competes with RAF for main-thread time, causing vsync misses that
      // cascade into 30fps. The RAF loop's recoverAudioQueueIfNeeded handles
      // audio recovery without the timer's jitter.
      presentFrame();
      setButtonsEnabled(true);
      const shownLabel = loadedRomName || '(query)';
      statusEl.textContent = `Loaded: ${shownLabel}`;
      infoEl.textContent = `Mapper ${cart.mapper}, PRG ${cart.prgBanks} x16KB, CHR ${cart.chrBanks} x8KB, ${cart.mirroring} mirroring`;
      return;
    }
    stopRuntime();
    try { audioOutput.attachApu(null); } catch (_err) {}
    if (emuBackend) { emuBackend = null; }
    if (nes) { nes = null; }
    nes=createBrowserNES(cart);
    emuBackend=createBrowserEmulationBackend(nes);
    syncFamilyBasicKeyboardToggleUi();
    syncFamilyBasicCassetteUi(true);
    nes.reset();
    resetRuntimePacingAnchor();
    loadedRomName=String(romLabel || '');
    recordingData=null;
    audioOutput.attachApu(nes.browserApu || null);
    presentFrame();
    setButtonsEnabled(true);
    const shownLabel = loadedRomName || '(query)';
    statusEl.textContent=`Loaded: ${shownLabel}`;
    infoEl.textContent=`Mapper ${cart.mapper}, PRG ${cart.prgBanks} x16KB, CHR ${cart.chrBanks} x8KB, ${cart.mirroring} mirroring`;
  }

  romInput.addEventListener('change', async () => {
    const f=romInput.files?.[0]; if(!f) return;
    try {
      const buf=await f.arrayBuffer();
      loadCartridgeFromBytes(new Uint8Array(buf), f.name || '');
    } catch(err){
      statusEl.textContent=`Load failed: ${err.message}`;
      infoEl.textContent='';
      console.error(err);
      stopRuntime();
      stopRecorderModes();
      try { audioOutput.attachApu(null); } catch (_err) {}
      nes=null; emuBackend=null; loadedRomName=''; recordingData=null; setButtonsEnabled(false);
      syncFamilyBasicCassetteUi(true);
    }
  });

  if (fbKeyboardToggle) {
    fbKeyboardToggle.disabled = true;
    fbKeyboardToggle.addEventListener('change', () => {
      familyBasicKeyboardUiEnabled = !!fbKeyboardToggle.checked;
      if (!emuBackend) return;
      if (
        typeof emuBackend.setFamilyBasicKeyboardDeviceEnabled === 'function' &&
        !familyBasicKeyboardUiEnabled
      ) {
        for (const code in expansionKeys) {
          if (!Object.prototype.hasOwnProperty.call(expansionKeys, code)) continue;
          delete expansionKeys[code];
        }
        emuBackend.setFamilyBasicKeyboardDeviceEnabled(false);
      } else {
        syncFamilyBasicKeyboardToggleUi();
      }
    });
  }

  if (fbCassetteToggle) {
    fbCassetteToggle.disabled = true;
    fbCassetteToggle.addEventListener('change', () => {
      familyBasicCassetteUiEnabled = !!fbCassetteToggle.checked;
      if (!emuBackend) return;
      if (
        typeof emuBackend.setFamilyBasicCassetteDeviceEnabled === 'function'
      ) {
        emuBackend.setFamilyBasicCassetteDeviceEnabled(!!familyBasicCassetteUiEnabled);
      }
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapePlayBtn) {
    fbTapePlayBtn.addEventListener('click', () => {
      if (!emuBackend || !familyBasicCassetteUiEnabled) return;
      if (typeof emuBackend.setFamilyBasicCassetteMode === 'function') {
        emuBackend.setFamilyBasicCassetteMode('play');
      }
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapeRecBtn) {
    fbTapeRecBtn.addEventListener('click', () => {
      if (!emuBackend || !familyBasicCassetteUiEnabled) return;
      if (typeof emuBackend.setFamilyBasicCassetteMode === 'function') {
        emuBackend.setFamilyBasicCassetteMode('record');
      }
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapeStopBtn) {
    fbTapeStopBtn.addEventListener('click', () => {
      if (!emuBackend || !familyBasicCassetteUiEnabled) return;
      if (typeof emuBackend.setFamilyBasicCassetteMode === 'function') {
        emuBackend.setFamilyBasicCassetteMode('stop');
      }
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapeRewBtn) {
    fbTapeRewBtn.addEventListener('click', () => {
      if (!emuBackend || !familyBasicCassetteUiEnabled) return;
      if (typeof emuBackend.rewindFamilyBasicCassette === 'function') {
        emuBackend.rewindFamilyBasicCassette();
      }
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapeExportBtn) {
    fbTapeExportBtn.addEventListener('click', () => {
      if (!emuBackend || !familyBasicCassetteUiEnabled) return;
      if (typeof emuBackend.exportFamilyBasicCassetteBits !== 'function') return;
      const bits = emuBackend.exportFamilyBasicCassetteBits() || [];
      const payload = {
        version: 1,
        type: 'family-basic-cassette-bits',
        romName: loadedRomName || '',
        bits,
      };
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `family-basic-tape-${bits.length}b.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      syncFamilyBasicCassetteUi(true);
    });
  }

  if (fbTapeImportInput) {
    fbTapeImportInput.addEventListener('change', async () => {
      const f = fbTapeImportInput.files && fbTapeImportInput.files[0];
      if (!f || !emuBackend || !familyBasicCassetteUiEnabled) return;
      try {
        const text = await f.text();
        const parsed = JSON.parse(text);
        const bits = _normalizeTapeBitsFromPayload(parsed);
        if (!bits) throw new Error('invalid tape json: expected { bits: [...] }');
        if (typeof emuBackend.loadFamilyBasicCassetteBits !== 'function') {
          throw new Error('cassette loader not available');
        }
        emuBackend.loadFamilyBasicCassetteBits(bits);
        if (typeof emuBackend.setFamilyBasicCassetteMode === 'function') {
          emuBackend.setFamilyBasicCassetteMode('stop');
        }
        if (typeof emuBackend.rewindFamilyBasicCassette === 'function') {
          emuBackend.rewindFamilyBasicCassette();
        }
        statusEl.textContent = `Tape loaded (${bits.length} bits)`;
      } catch (err) {
        statusEl.textContent = `Tape load failed: ${err.message}`;
      } finally {
        fbTapeImportInput.value = '';
        syncFamilyBasicCassetteUi(true);
      }
    });
  }

  if (pcKeyboardModeEl) {
    pcKeyboardModeEl.addEventListener('change', () => {
      pcKeyboardMode = (pcKeyboardModeEl.value === 'family') ? 'family' : 'pad';
      clearAllKeys();
    });
  }
  if(recStartBtn) recStartBtn.addEventListener('click',()=>{
    if(!nes) return;
    recordingData={ version:1, romName:loadedRomName||'', mapper:nes.cartridge?.mapper??-1, frames:[] };
    recordingActive=true;
    replayActive=false;
    replayIndex=0;
    statusEl.textContent='Recording started';
    updateRecorderUi();
  });

  if(recStopBtn) recStopBtn.addEventListener('click',()=>{
    const wasRecording=recordingActive;
    const wasReplay=replayActive;
    stopRecorderModes();
    if(wasRecording) statusEl.textContent='Recording stopped';
    else if(wasReplay) statusEl.textContent='Replay stopped';
  });

  if(recPlayBtn) recPlayBtn.addEventListener('click',()=>{
    if(!nes || !recordingData || !Array.isArray(recordingData.frames) || recordingData.frames.length===0) return;
    running=false;
    cancelLoop();
    if (audioDriveTimer) {
      clearInterval(audioDriveTimer);
      audioDriveTimer = 0;
    }
    audioOutput.setRunning(false);
    nes.reset();
    applyButtons(keys,{a:false,b:false,select:false,start:false,up:false,down:false,left:false,right:false});
    replayActive=true;
    recordingActive=false;
    replayIndex=0;
    statusEl.textContent='Replay started';
    updateRecorderUi();
  });

  if(recExportBtn) recExportBtn.addEventListener('click',()=>{
    if(!recordingData || !Array.isArray(recordingData.frames) || recordingData.frames.length===0) return;
    const out={ ...recordingData, exportedAt:new Date().toISOString() };
    const blob=new Blob([JSON.stringify(out)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    const romPart=(recordingData.romName||'rom').replace(/[^a-z0-9_.-]+/gi,'_');
    a.download=`input-record-${romPart}-${recordingData.frames.length}f.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },0);
  });

  if(recImportInput) recImportInput.addEventListener('change', async ()=>{
    const f=recImportInput.files?.[0];
    if(!f) return;
    try {
      const txt=await f.text();
      const obj=JSON.parse(txt);
      if(!obj || !Array.isArray(obj.frames)) throw new Error('Invalid recording format');
      recordingData={
        version:obj.version||1,
        romName:typeof obj.romName==='string'?obj.romName:'',
        mapper:typeof obj.mapper==='number'?obj.mapper:-1,
        frames:obj.frames.map(v=>Number(v)&0xff),
      };
      stopRecorderModes();
      statusEl.textContent=`Recording loaded (${recordingData.frames.length} frames)`;
      updateRecorderUi();
    } catch (err){
      statusEl.textContent=`Recording import failed: ${err.message}`;
    } finally {
      recImportInput.value='';
    }
  });
  runBtn.addEventListener('click',()=>{ startRuntime('Run button').catch((err)=>{ statusEl.textContent=`Audio start failed: ${err.message}`; console.error(err); }); });
  pauseBtn.addEventListener('click',()=>{
    running=false;
    cancelLoop();
    runtimeStartTs = 0;
    runtimeStartCpuCyclesTotal = 0;
    resetRuntimeCpuCycleTracker(0);
    if (audioDriveTimer) {
      clearInterval(audioDriveTimer);
      audioDriveTimer = 0;
    }
    audioOutput.setRunning(false);
    statusEl.textContent='Paused';
  });
  if (resetBtn) resetBtn.addEventListener('click',()=>{
    if(!nes) return;
    try {
      const wasRunning = !!running;
      stopRuntime();
      stopRecorderModes();
      nes.reset();
      resetRuntimePacingAnchor();
      applyButtons(keys,{a:false,b:false,select:false,start:false,up:false,down:false,left:false,right:false});
      framePresenter.present(nes);
      if (wasRunning) {
        statusEl.textContent = 'Reset (restarting)';
        startRuntime('Reset').catch((err)=>{ statusEl.textContent=`Audio start failed: ${err.message}`; console.error(err); });
      } else {
        statusEl.textContent = 'Reset';
      }
    } catch (err) {
      statusEl.textContent=`Reset failed: ${err.message}`;
      console.error(err);
    }
  });

  (async () => {
    const params = getLaunchQueryParams();
    const romQuery = String(params.get('rom') || '').trim();
    if (!romQuery) return;
    try {
      const res = await fetch(romQuery);
      if (!res.ok) throw new Error(`HTTP ${res.status} while fetching ROM`);
      const buf = await res.arrayBuffer();
      loadCartridgeFromBytes(new Uint8Array(buf), romQuery);
      const autoRunRaw = String(params.get('autorun') || '').trim().toLowerCase();
      const shouldAutoRun = autoRunRaw === '1' || autoRunRaw === 'true' || autoRunRaw === 'yes';
      if (shouldAutoRun) {
        await startRuntime('AutoRun');
      }
    } catch (err) {
      statusEl.textContent=`Auto-load failed: ${err.message}`;
      console.error(err);
    }
  })();
  stepBtn.addEventListener('click',()=>{
    running=false;
    cancelLoop();
    runtimeStartTs = 0;
    runtimeStartCpuCyclesTotal = 0;
    resetRuntimeCpuCycleTracker(0);
    if (audioDriveTimer) {
      clearInterval(audioDriveTimer);
      audioDriveTimer = 0;
    }
    audioOutput.setRunning(false);
    try {
      const ran = emulateOneFrame() | 0;
      if (ran > 0) {
        presentFrame();
        statusEl.textContent='Stepped one frame';
      } else {
        statusEl.textContent='Step skipped (no frame advance)';
      }
    } catch (err) {
      statusEl.textContent=`Runtime error: ${err.message}`;
      infoEl.textContent=`Stopped at PC ${nes?.cpu?.pc?.toString(16).padStart(4,'0') || '????'}`;
      console.error(err);
    }
  });
})();
