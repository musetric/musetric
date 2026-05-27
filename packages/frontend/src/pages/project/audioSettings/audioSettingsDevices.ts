export const audioSettingsMeterScale = 8;

export const stopAudioSettingsStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

export const getAudioSettingsDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};
