export type CallLatestFixture = {
  name: string;
  callCount: number;
  resolveIndices: number[];
};

export const callLatestFixtures: CallLatestFixture[] = [
  {
    name: 'All calls resolve in order',
    callCount: 3,
    resolveIndices: [0, 1, 2],
  },
  {
    name: 'Only last call resolves',
    callCount: 3,
    resolveIndices: [2, 2],
  },
  {
    name: 'First call resolves then last call resolves',
    callCount: 3,
    resolveIndices: [0, 2, 2],
  },
  {
    name: 'Middle call resolves then last call resolves',
    callCount: 3,
    resolveIndices: [1, 1, 2],
  },
  {
    name: 'Multiple calls resolve with final call winning',
    callCount: 10,
    resolveIndices: [3, 3, 4, 9, 9],
  },
  {
    name: 'First call and middle calls resolve then final call resolves',
    callCount: 10,
    resolveIndices: [0, 4, 5, 6, 8, 8, 9],
  },
];
