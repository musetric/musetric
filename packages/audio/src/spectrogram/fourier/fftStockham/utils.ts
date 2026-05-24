const createTrigTable = (windowSize: number): Float32Array<ArrayBuffer> => {
  const halfN = windowSize >> 1;
  const table = new Float32Array(halfN * 2);
  for (let j = 0; j < halfN; j++) {
    const angle = (2 * Math.PI * j) / windowSize;
    table[2 * j] = Math.cos(angle);
    table[2 * j + 1] = Math.sin(angle);
  }
  return table;
};

export const utilsStockham = { createTrigTable };
