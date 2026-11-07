const APU_LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6,
  160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22,
  192, 24, 72, 26, 16, 28, 32, 30,
];
const DMC_NTSC_PITCH_LUT = [
  0x19d, 0x0a2, 0x185, 0x1b6,
  0x0ef, 0x1f8, 0x17c, 0x117,
  0x120, 0x076, 0x11e, 0x13e,
  0x162, 0x123, 0x0e3, 0x0d5,
];

class ApuDomain {
  constructor(host, FrameSequencerCtor) {
    this.host = host;
    this.frame = new FrameSequencerCtor();
    this._frameOnCpuPhaseTickFn = (this.frame && typeof this.frame.onCpuPhaseTick === 'function')
      ? this.frame.onCpuPhaseTick.bind(this.frame)
      : null;
    this.framePhaseDriven = false;
    this._dmcDmaSnapshot = { trigger: false, addr: 0 };
    this.reset();
  }

  reset() {
    this.frame.reset();
    this.framePhaseDriven = false;
    this.apuRegisters = new Uint8Array(0x20);
    this.apuEnableBuffer = 0;
    this.apuEnableBuffer1 = 0;
    this.apuPulse1Enabled = false;
    this.apuPulse1LengthCounter = 0;
    this.apuPulse1LengthHalt = false;
    this.apuPulse2Enabled = false;
    this.apuPulse2LengthCounter = 0;
    this.apuPulse2LengthHalt = false;
    this.apuTriangleEnabled = false;
    this.apuTriangleLengthCounter = 0;
    this.apuTriangleLengthHalt = false;
    this.apuNoiseEnabled = false;
    this.apuNoiseLengthCounter = 0;
    this.apuNoiseLengthHalt = false;
    this.dmcEnabled = false;
    this.dmcRateIndex = 0;
    this.dmcIrqEnabled = false;
    this.dmcIrqFlag = false;
    this.dmcLoop = false;
    this.dmcLsfr = 0;
    this.dmcClockPending = false;
    this.dmcBitCounter = 0;
    this.dmcSampleBuffer = 0;
    this.dmcShiftRegister = 0;
    this.dmcOutputLevel = 0;
    this.dmcOutputLevelNext = 0;
    this.dmcSilence = true;
    this.dmcRequestPending = false;
    this.dmcEnableStage1 = false;
    this.dmcEnableStage2 = false;
    this.dmcEnableStage3 = false;
    this.dmcDisableRequestHold = 0;
    this.dmcHaveBuffer = false;
    this.dmcAckQueued = false;
    this.dmcAckQueuedData = 0;
    this.dmcSampleAddress = 0xc000;
    this.dmcSampleLength = 0;
    this.dmcCurrentAddress = 0xc000;
    this.dmcBytesRemaining = 0;
    this.dmcLastFetchedByte = 0x00;
  }

  isIrqAsserted() {
    return this.frame.isIrqAsserted() || this.dmcIrqFlag;
  }

  _dmcLsfrReload() {
    return DMC_NTSC_PITCH_LUT[this.dmcRateIndex & 0x0f] || 0x19d;
  }

  _dmcLsfrStep(value) {
    const lsfr = value & 0x1ff;
    const feedback = (((lsfr >> 8) & 1) ^ ((lsfr >> 4) & 1)) | (lsfr === 0 ? 1 : 0);
    return (((lsfr & 0xff) << 1) | feedback) & 0x1ff;
  }

  performDmcSampleFetch(contextHints = null) {
    const host = this.host;
    const dmcReadAddr = this.dmcCurrentAddress & 0xffff;
    const context = host.busArbiter.createDmcDmaReadContext(dmcReadAddr, contextHints);
    const dmcValue = host.cpuRead(dmcReadAddr, context) & 0xff;
    this.dmcLastFetchedByte = dmcValue;
    this.dmcAckQueued = true;
    this.dmcAckQueuedData = dmcValue & 0xff;
    this._updateDmcRequestLine();
  }

  hasPendingDmcDma() {
    this._updateDmcRequestLine();
    return !!this.dmcRequestPending;
  }

  getDmcDmaSnapshot() {
    const out = this._dmcDmaSnapshot;
    out.trigger = !!this.dmcRequestPending;
    out.addr = this.dmcCurrentAddress & 0xffff;
    return out;
  }

  ackDmcDma() {
    if (!this.hasPendingDmcDma()) return false;
    return true;
  }

  _updateDmcRequestLine() {
    const nextRequest = (!!this.dmcEnableStage3) && !this.dmcHaveBuffer;
    if (nextRequest && (this.dmcDisableRequestHold | 0) > 0) {
      this.dmcRequestPending = false;
      this.dmcDisableRequestHold = ((this.dmcDisableRequestHold | 0) - 1) & 0x7fff;
      return;
    }
    this.dmcRequestPending = nextRequest;
  }

  _writeApuRegister(address, value) {
    this.apuRegisters[address & 0x1f] = value & 0xff;
  }

  _lengthValueFromIndex(index) {
    return APU_LENGTH_TABLE[index & 0x1f] & 0xff;
  }

  _loadPulse1LengthFromIndex(index) {
    this.apuPulse1LengthCounter = this._lengthValueFromIndex(index);
  }

  _loadPulse2LengthFromIndex(index) {
    this.apuPulse2LengthCounter = this._lengthValueFromIndex(index);
  }

  _loadTriangleLengthFromIndex(index) {
    this.apuTriangleLengthCounter = this._lengthValueFromIndex(index);
  }

  _loadNoiseLengthFromIndex(index) {
    this.apuNoiseLengthCounter = this._lengthValueFromIndex(index);
  }

  _clockLengthCounters() {
    if (!this.apuPulse1LengthHalt && this.apuPulse1LengthCounter > 0) {
      this.apuPulse1LengthCounter -= 1;
    }
    if (!this.apuPulse2LengthHalt && this.apuPulse2LengthCounter > 0) {
      this.apuPulse2LengthCounter -= 1;
    }
    if (!this.apuTriangleLengthHalt && this.apuTriangleLengthCounter > 0) {
      this.apuTriangleLengthCounter -= 1;
    }
    if (!this.apuNoiseLengthHalt && this.apuNoiseLengthCounter > 0) {
      this.apuNoiseLengthCounter -= 1;
    }
  }

  _clockDmcCycle(phaseInput) {
    const phase = phaseInput;
    if (!phase) return;
    const putCe = !!phase.aclk1Delayed;
    const getCe = !!phase.aclk1;
    const old1 = !!this.dmcEnableStage1;
    const old2 = !!this.dmcEnableStage2;
    if (putCe) {
      const enabled = this.apuEnableBuffer1 & 0x1f;
      const pulse1Enabled = (enabled & 0x01) !== 0;
      const pulse2Enabled = (enabled & 0x02) !== 0;
      const triangleEnabled = (enabled & 0x04) !== 0;
      const noiseEnabled = (enabled & 0x08) !== 0;
      this.apuPulse1Enabled = pulse1Enabled;
      this.apuPulse2Enabled = pulse2Enabled;
      this.apuTriangleEnabled = triangleEnabled;
      this.apuNoiseEnabled = noiseEnabled;
      if (!pulse1Enabled) {
        this.apuPulse1LengthCounter = 0;
      }
      if (!pulse2Enabled) {
        this.apuPulse2LengthCounter = 0;
      }
      if (!triangleEnabled) {
        this.apuTriangleLengthCounter = 0;
      }
      if (!noiseEnabled) {
        this.apuNoiseLengthCounter = 0;
      }
      this.dmcEnableStage1 = !!this.dmcEnabled;
      this.dmcEnableStage2 = !!old1;
      let nextLsfr = this._dmcLsfrStep(this.dmcLsfr);
      if (this.dmcClockPending) {
        const oldShift = this.dmcShiftRegister & 0xff;
        const oldBits = this.dmcBitCounter & 0x07;
        this.dmcClockPending = false;
        nextLsfr = this._dmcLsfrReload();
        this.dmcShiftRegister = (oldShift >>> 1) & 0x7f;
        this.dmcBitCounter = (oldBits + 1) & 0x07;
        if (oldBits === 0x07) {
          this.dmcSilence = !this.dmcHaveBuffer;
          this.dmcShiftRegister = this.dmcSampleBuffer & 0xff;
          this.dmcHaveBuffer = false;
        }
        if (!this.dmcSilence) {
          let hi = (this.dmcOutputLevelNext >>> 1) & 0x3f;
          if ((oldShift & 0x01) === 0) {
            if (hi > 0) hi -= 1;
          } else if (hi < 0x3f) {
            hi += 1;
          }
          this.dmcOutputLevel = ((hi << 1) | (this.dmcOutputLevelNext & 0x01)) & 0x7f;
        }
      }
      if (this.dmcAckQueued) {
        const dmcValue = this.dmcAckQueuedData & 0xff;
        const oldBytesRemaining = this.dmcBytesRemaining & 0x0fff;
        const dmcReadAddr = this.dmcCurrentAddress & 0xffff;
        this.dmcAckQueued = false;
        this.dmcSampleBuffer = dmcValue;
        this.dmcHaveBuffer = true;
        if (oldBytesRemaining > 0) {
          this.dmcBytesRemaining = (oldBytesRemaining - 1) & 0x0fff;
          this.dmcCurrentAddress = dmcReadAddr === 0xffff ? 0x8000 : ((dmcReadAddr + 1) & 0xffff);
        } else {
          this.dmcCurrentAddress = this.dmcSampleAddress & 0xffff;
          this.dmcBytesRemaining = this.dmcSampleLength & 0x0fff;
          this.dmcEnabled = !!this.dmcLoop;
          if (!this.dmcLoop && this.dmcIrqEnabled) {
            this.dmcIrqFlag = true;
          }
        }
      }
      this.dmcLsfr = nextLsfr & 0x1ff;
    }
    if (getCe) {
      this.apuEnableBuffer1 = this.apuEnableBuffer & 0x1f;
      const enabled = this.apuEnableBuffer & 0x1f;
      this.apuPulse1Enabled = (enabled & 0x01) !== 0;
      this.apuPulse2Enabled = (enabled & 0x02) !== 0;
      this.apuTriangleEnabled = (enabled & 0x04) !== 0;
      this.apuNoiseEnabled = (enabled & 0x08) !== 0;
      this.dmcEnableStage1 = !!this.dmcEnabled;
      this.dmcEnableStage3 = !!old2;
      this.dmcOutputLevelNext = this.dmcOutputLevel & 0x7f;
      if ((this.dmcLsfr & 0x1ff) === 0x100) {
        this.dmcClockPending = true;
      }
    }
    this._updateDmcRequestLine();
  }

  tick(cycles) {
    const count = cycles | 0;
    if (count <= 0) return;
    if (!this.framePhaseDriven) {
      this.frame.tick(count, () => this._clockLengthCounters());
    }
  }

  onCpuPhaseTick(phase) {
    let halfFrameLengthClock = false;
    if (phase && phase.cpuCe) {
      this.framePhaseDriven = true;
      const frameOnCpuPhaseTick = this._frameOnCpuPhaseTickFn;
      if (frameOnCpuPhaseTick) {
        frameOnCpuPhaseTick(phase, () => {
          halfFrameLengthClock = true;
        });
      }
    }
    this._clockDmcCycle(phase);
    if (halfFrameLengthClock) {
      this._clockLengthCounters();
    }
  }

  isPhaseDriven() {
    return !!this.framePhaseDriven;
  }

  cyclesToNextDmcFetch() {
    return this.hasPendingDmcDma() ? 0 : 0x7fffffff;
  }

  onCpuWriteObserved(_addr, _value) {}

  onExternalCpuBusCycle() {
    // DMC timer/start/disable are clocked on explicit CPU phase ticks.
  }

  read4015(_externalBusValue, isControllerPutCycle) {
    const frameIrqVisible = this.frame && typeof this.frame.on4015Read === 'function'
      ? !!this.frame.on4015Read(!!isControllerPutCycle)
      : false;
    const value =
      (this.apuPulse1LengthCounter > 0 ? 0x01 : 0x00) |
      (this.apuPulse2LengthCounter > 0 ? 0x02 : 0x00) |
      (this.apuTriangleLengthCounter > 0 ? 0x04 : 0x00) |
      (this.apuNoiseLengthCounter > 0 ? 0x08 : 0x00) |
      (this.dmcEnabled ? 0x10 : 0x00) |
      (frameIrqVisible ? 0x40 : 0x00) |
      (this.dmcIrqFlag ? 0x80 : 0x00);
    return value & 0xff;
  }

  write4000(value) {
    this._writeApuRegister(0x00, value);
    this.apuPulse1LengthHalt = (value & 0x20) !== 0;
  }

  write4001(value) {
    this._writeApuRegister(0x01, value);
  }

  write4002(value) {
    this._writeApuRegister(0x02, value);
  }

  write4003(value) {
    this._writeApuRegister(0x03, value);
    this._loadPulse1LengthFromIndex(value >> 3);
  }

  write4004(value) {
    this._writeApuRegister(0x04, value);
    this.apuPulse2LengthHalt = (value & 0x20) !== 0;
  }

  write4005(value) {
    this._writeApuRegister(0x05, value);
  }

  write4006(value) {
    this._writeApuRegister(0x06, value);
  }

  write4007(value) {
    this._writeApuRegister(0x07, value);
    this._loadPulse2LengthFromIndex(value >> 3);
  }

  write4008(value) {
    this._writeApuRegister(0x08, value);
    this.apuTriangleLengthHalt = (value & 0x80) !== 0;
  }

  write400a(value) {
    this._writeApuRegister(0x0a, value);
  }

  write400b(value) {
    this._writeApuRegister(0x0b, value);
    this._loadTriangleLengthFromIndex(value >> 3);
  }

  write400c(value) {
    this._writeApuRegister(0x0c, value);
    this.apuNoiseLengthHalt = (value & 0x20) !== 0;
  }

  write400e(value) {
    this._writeApuRegister(0x0e, value);
  }

  write400f(value) {
    this._writeApuRegister(0x0f, value);
    this._loadNoiseLengthFromIndex(value >> 3);
  }

  write4010(value) {
    this._writeApuRegister(0x10, value);
    this.dmcIrqEnabled = (value & 0x80) !== 0;
    this.dmcLoop = (value & 0x40) !== 0;
    this.dmcRateIndex = value & 0x0f;
    if (!this.dmcIrqEnabled) this.dmcIrqFlag = false;
  }

  write4011(value) {
    this._writeApuRegister(0x11, value);
    const v = value & 0x7f;
    this.dmcOutputLevel = v;
  }

  write4012(value) {
    this._writeApuRegister(0x12, value);
    this.dmcSampleAddress = 0xc000 | ((value & 0xff) << 6);
  }

  write4013(value) {
    this._writeApuRegister(0x13, value);
    this.dmcSampleLength = ((value & 0xff) << 4) & 0x0fff;
  }

  write4015(value) {
    this._writeApuRegister(0x15, value);
    // Writing to $4015 acknowledges the DMC IRQ.
    this.dmcIrqFlag = false;
    this.apuEnableBuffer = value & 0x1f;
    this.apuPulse1Enabled = (this.apuEnableBuffer & 0x01) !== 0;
    this.apuPulse2Enabled = (this.apuEnableBuffer & 0x02) !== 0;
    this.apuTriangleEnabled = (this.apuEnableBuffer & 0x04) !== 0;
    this.apuNoiseEnabled = (this.apuEnableBuffer & 0x08) !== 0;
    const nextEnabled = (value & 0x10) !== 0;
    if (nextEnabled && !this.dmcEnabled) {
      this.dmcCurrentAddress = this.dmcSampleAddress & 0xffff;
      this.dmcBytesRemaining = this.dmcSampleLength & 0x0fff;
    }
    this.dmcEnabled = nextEnabled;
    if (!nextEnabled) {
      this.dmcEnableStage3 = false;
      // If a disable hits while a DMC request is already visible, keep that
      // request suppressed through the next phase update to emulate the same-
      // edge write/trigger overlap observed on MiSTer's synchronous logic.
      if (this.dmcRequestPending) {
        this.dmcDisableRequestHold = 1;
      }
    }
    this._updateDmcRequestLine();
  }

  write4017(value, isPutCycle) {
    this._writeApuRegister(0x17, value);
    this.frame.on4017Write(value, !!isPutCycle, () => this._clockLengthCounters());
  }
}

const apuDomainExports = { ApuDomain };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = apuDomainExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreApuDomain = apuDomainExports;
}
