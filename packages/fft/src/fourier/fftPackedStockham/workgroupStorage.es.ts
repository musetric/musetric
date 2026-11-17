const pingPongStorageLimit = 8192;

export const maxPingPongPackedWindowSize = (storageSize: number): number =>
  Math.floor(Math.min(storageSize, pingPongStorageLimit) / 16);
