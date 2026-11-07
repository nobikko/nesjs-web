// Shared data-bus merge helpers inspired by MiSTer NES rtl/nes.v.
class CpuDataBusCombiner {
  static mergeApuStatus(apuStatusValue, externalBusValue) {
    const apu = apuStatusValue & 0xff;
    const ext = externalBusValue & 0xff;
    // {apu_dout[7:6], from_data_bus[5], apu_dout[4:0]}
    return ((apu & 0xc0) | (ext & 0x20) | (apu & 0x1f)) & 0xff;
  }

  static mergeControllerPort(portValue, externalBusValue) {
    const port = portValue & 0x1f;
    const ext = externalBusValue & 0xff;
    // {from_data_bus[7:5], joypad_data[4:0]}
    return ((ext & 0xe0) | port) & 0xff;
  }
}

const cpuDataBusExports = { CpuDataBusCombiner };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuDataBusExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuDataBus = cpuDataBusExports;
}
