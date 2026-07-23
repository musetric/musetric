export type TrigTables = {
  fft: GPUBuffer;
  r2c: GPUBuffer;
};

export const disposeTrigTables = (tables: TrigTables): void => {
  tables.fft.destroy();
  tables.r2c.destroy();
};
