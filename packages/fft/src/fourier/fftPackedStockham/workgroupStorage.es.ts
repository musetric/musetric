const pingPongStorageLimit = 16384;

export const maxPingPongPackedWindowSize = (storageSize: number): number =>
  Math.floor(Math.min(storageSize, pingPongStorageLimit) / 16);
