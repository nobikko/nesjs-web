class ControllerBus {
  constructor(host) {
    this.host = host || null;
    this.reset();
  }

  reset() {
    this.joypadStrobe = 0;
    this.joypadOutput = 0;
    this.joypadOutputBit0 = 0;
    this.joypadLastWriteValue = 0;
    this.joypadLastWriteBit = 0;
    this.joypad1Buttons = 0;
    this.joypad1Shift = 0;
    this.pendingOutputWrite = false;
    this.pendingOutputValue = 0;
    this.pendingOutputBit = 0;
  }

  setController1(buttons) {
    let v = 0;
    if (buttons.a) v |= 0x01;
    if (buttons.b) v |= 0x02;
    if (buttons.select) v |= 0x04;
    if (buttons.start) v |= 0x08;
    if (buttons.up) v |= 0x10;
    if (buttons.down) v |= 0x20;
    if (buttons.left) v |= 0x40;
    if (buttons.right) v |= 0x80;
    this.joypad1Buttons = v;
    if (this.joypadOutputBit0) {
      this.joypad1Shift = this.joypad1Buttons;
    }
  }

  isPutCycle() {
    if (
      this.host &&
      this.host.cpuState &&
      this.host.cpuState.phase
    ) {
      const phase = this.host.cpuState.phase;
      if (typeof phase.getOrPut === 'boolean') {
        return !phase.getOrPut;
      }
      if (typeof phase.putCycle === 'boolean') {
        return !!phase.putCycle;
      }
    }
    throw new Error('CPU phase state not available for controller bus');
  }

  _resolvePutCycle(context) {
    if (context && context.isPutCycle != null) {
      return !!context.isPutCycle;
    }
    return this.isPutCycle();
  }

  _queueOutputValue(value) {
    const v = value & 0x07;
    this.pendingOutputValue = v;
    this.pendingOutputBit = v & 1;
    this.pendingOutputWrite = true;
  }

  applyOutputValue(value) {
    const v = value & 0x07;
    const b = v & 1;
    const prev = this.joypadOutputBit0 & 1;
    this.joypadOutput = v;
    this.joypadOutputBit0 = b;
    this.joypadStrobe = b;
    if (b) {
      this.joypad1Shift = this.joypad1Buttons;
    } else if (prev && !b) {
      this.joypad1Shift = this.joypad1Buttons;
    }
  }

  _applyPendingOutputIfPutCe(isPutCe) {
    if (!this.pendingOutputWrite) return;
    if (!isPutCe) return;
    this.applyOutputValue(this.pendingOutputValue & 0x07);
    this.pendingOutputWrite = false;
  }

  onCpuPhaseTick(phase) {
    const putCe = !!(phase && phase.putCe);
    this._applyPendingOutputIfPutCe(putCe);
  }

  clockBusCycle() {}

  _shiftPort1OneStep() {
    if (this.joypadOutputBit0) {
      this.joypad1Shift = this.joypad1Buttons;
      return;
    }
    this.joypad1Shift = ((this.joypad1Shift >> 1) | 0x80) & 0xff;
  }

  pulseClock4016(context) {
    this._applyPendingOutputIfPutCe(this._resolvePutCycle(context));
    this._shiftPort1OneStep();
  }

  pulseClock4017(context) {
    this._applyPendingOutputIfPutCe(this._resolvePutCycle(context));
  }

  write4016(value, context) {
    this.joypadLastWriteValue = value & 0x07;
    this.joypadLastWriteBit = this.joypadLastWriteValue & 1;
    this._queueOutputValue(this.joypadLastWriteValue);
    this._applyPendingOutputIfPutCe(this._resolvePutCycle(context));
  }

  read4016Raw(context) {
    this._applyPendingOutputIfPutCe(this._resolvePutCycle(context));
    let bit;
    if (this.joypadOutputBit0) {
      bit = this.joypad1Buttons & 0x01;
    } else {
      bit = this.joypad1Shift & 0x01;
    }
    return bit & 0x01;
  }

  read4017Raw(context) {
    this._applyPendingOutputIfPutCe(this._resolvePutCycle(context));
    // Port 2 is currently treated as disconnected: D0..D4 = 0.
    return 0;
  }
}

const controllerBusExports = { ControllerBus };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = controllerBusExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreControllerBus = controllerBusExports;
}
