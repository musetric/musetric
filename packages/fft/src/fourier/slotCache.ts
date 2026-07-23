export const createSlotCache = <T>(build: (slot: number) => T) => {
  const cache = new Map<number, T>();
  return (slot: number): T => {
    let cached = cache.get(slot);
    if (cached === undefined) {
      cached = build(slot);
      cache.set(slot, cached);
    }
    return cached;
  };
};
