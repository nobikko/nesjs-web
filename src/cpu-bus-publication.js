function publishCpuExternalBusValue(host, value) {
  const v = value & 0xff;
  if (host && typeof host.publishCpuExternalBusValue === 'function') {
    return host.publishCpuExternalBusValue(v) & 0xff;
  }
  if (host && host.cpuState) {
    host.cpuState.openBus = v;
    if (host.cpuState.bus) {
      host.cpuState.bus.openBusData = v;
      host.cpuState.bus.openBusReadValue = v;
      host.cpuState.bus.externalDataBus = v;
      host.cpuState.bus.externalBusValue = v;
    }
    return v;
  }
  if (host && host.state && host.state.bus) {
    host.state.bus.openBus = v;
    host.state.bus.openBusData = v;
    host.state.bus.openBusReadValue = v;
    host.state.bus.externalDataBus = v;
    host.state.bus.externalBusValue = v;
    return v;
  }
  return v;
}

function publishCpuInternalBusValue(host, value) {
  const v = value & 0xff;
  if (host && typeof host.publishCpuInternalBusValue === 'function') {
    return host.publishCpuInternalBusValue(v) & 0xff;
  }
  if (host && host.cpuState) {
    host.cpuState.openBus = v;
    if (host.cpuState.bus) {
      host.cpuState.bus.openBusData = v;
      host.cpuState.bus.internalBusValue = v;
    }
    return v;
  }
  if (host && host.state && host.state.bus) {
    host.state.bus.openBus = v;
    host.state.bus.openBusData = v;
    host.state.bus.internalBusValue = v;
    return v;
  }
  return v;
}

const cpuBusPublicationExports = {
  publishCpuExternalBusValue,
  publishCpuInternalBusValue,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = cpuBusPublicationExports;
}

if (typeof globalThis !== 'undefined') {
  globalThis.NESCoreCpuBusPublication = cpuBusPublicationExports;
}
