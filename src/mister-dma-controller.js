// Direct state-machine port of MiSTer NES DmaController (rtl/nes.v).
// This module only models controller state and cycle-level outputs.
class MisterDmaController {
  constructor() {
    this.reset();
  }

  reset() {
    this.dmcState = 0;
    this.sprState = 0;
    this.spriteDmaLastVal = 0;
    this.spriteDmaAddr = 0;
  }

  applySpriteTrigger(page) {
    this.spriteDmaAddr = ((page & 0xff) << 8) & 0xffff;
    this.sprState = 1;
  }

  clearDmcState() {
    this.dmcState = 0;
  }

  pauseCpu(dmcTrigger) {
    return ((this.sprState & 0x01) !== 0) || !!dmcTrigger || this.dmcState === 1;
  }

  tick(inputs) {
    const inSig = inputs || {};
    const ce = !!(inSig.ce == null ? ((!!inSig.putCe) || (!!inSig.getCe)) : inSig.ce);
    const putCycle = !!inSig.putCycle;
    const putCe = !!inSig.putCe;
    const getCe = !!inSig.getCe;
    const spriteTrigger = !!inSig.spriteTrigger;
    const dmcTrigger = !!inSig.dmcTrigger;
    const cpuRead = !!inSig.cpuRead;
    const dataFromCpu = (inSig.dataFromCpu == null ? 0 : inSig.dataFromCpu) & 0xff;
    const dmaDataToRam = (inSig.dmaDataToRam == null ? 0 : inSig.dmaDataToRam) & 0xff;
    const dmcDmaAddr = (inSig.dmcDmaAddr == null ? 0 : inSig.dmcDmaAddr) & 0xffff;

    const oldDmcState = this.dmcState & 0x01;
    const oldSprState = this.sprState & 0x03;
    const oldSpriteDmaAddr = this.spriteDmaAddr & 0xffff;
    const oldSpriteDmaLastVal = this.spriteDmaLastVal & 0xff;

    let nextDmcState = oldDmcState;
    let nextSprState = oldSprState;
    let nextSpriteDmaAddr = oldSpriteDmaAddr;
    let nextSpriteDmaLastVal = oldSpriteDmaLastVal;

    if (ce) {
      if (oldDmcState === 0 && dmcTrigger && cpuRead && putCe) nextDmcState = 1;
      if (oldDmcState === 1 && putCe) nextDmcState = 0;

      if (spriteTrigger) {
        nextSpriteDmaAddr = (dataFromCpu << 8) & 0xffff;
        nextSprState = 1;
      }
      if (oldSprState === 1 && cpuRead && getCe) nextSprState = 3;
      if ((oldSprState & 0x02) !== 0 && putCe && oldDmcState === 1) nextSprState = 1;
      if ((oldSprState & 0x02) !== 0 && getCe) {
        const nextLow = (oldSpriteDmaAddr & 0xff) + 1;
        nextSpriteDmaAddr = (oldSpriteDmaAddr & 0xff00) | (nextLow & 0xff);
        if ((nextLow & 0x100) !== 0) nextSprState = 0;
      }
      if ((oldSprState & 0x02) !== 0) {
        nextSpriteDmaLastVal = dmaDataToRam;
      }
    }

    this.dmcState = nextDmcState & 0x01;
    this.sprState = nextSprState & 0x03;
    this.spriteDmaAddr = nextSpriteDmaAddr & 0xffff;
    this.spriteDmaLastVal = nextSpriteDmaLastVal & 0xff;

    const dmcAck = (this.dmcState === 1 && !putCycle && dmcTrigger);
    const aoutEnable = dmcAck || ((this.sprState & 0x02) !== 0);
    const read = !putCycle;
    const dataToRam = this.spriteDmaLastVal & 0xff;
    const aout = dmcAck
      ? dmcDmaAddr
      : (!putCycle ? (this.spriteDmaAddr & 0xffff) : 0x2004);
    const pauseCpu = ((this.sprState & 0x01) !== 0) || dmcTrigger || this.dmcState === 1;

    return {
      pauseCpu,
      dmcAck,
      aoutEnable,
      read,
      aout: aout & 0xffff,
      dataToRam,
      dmcState: this.dmcState & 0x01,
      sprState: this.sprState & 0x03,
      oldDmcState,
      oldSprState,
    };
  }
}

const misterDmaControllerExports = { MisterDmaController };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = misterDmaControllerExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreMisterDmaController = misterDmaControllerExports;
}
