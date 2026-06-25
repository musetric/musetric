export type CallEveryFixture = {
  name: string;
  callCount: number;
  resolveIndices: number[];
};

export const callEveryFixtures: CallEveryFixture[] = [
  {
    name: 'All queued calls resolve in order',
    callCount: 3,
    resolveIndices: [0, 1, 2],
  },
  {
    name: 'All queued calls resolve after final enqueue',
    callCount: 3,
    resolveIndices: [2, 2, 2],
  },
  {
    name: 'Queued calls resolve sequentially after batched releases',
    callCount: 3,
    resolveIndices: [1, 1, 2],
  },
  {
    name: 'Many queued calls resolve sequentially across batches',
    callCount: 10,
    resolveIndices: [3, 3, 4, 6, 6, 8, 9, 9, 9, 9],
  },
];
