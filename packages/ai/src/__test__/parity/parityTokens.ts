type TokenRows = {
  ids: number[];
  times: number[];
};

const tokenRows = (
  values: Float32Array | Int32Array,
  width: number,
): TokenRows => {
  const ids: number[] = [];
  const times: number[] = [];
  for (let offset = 0; offset < values.length; offset += width) {
    ids.push(values[offset]);
    times.push(width > 1 ? values[offset + 1] : 0);
  }
  return { ids, times };
};

const editTable = (reference: number[], candidate: number[]): Uint32Array[] => {
  const table = [
    Uint32Array.from({ length: candidate.length + 1 }, (_, column) => column),
  ];
  for (let row = 1; row <= reference.length; row += 1) {
    const previous = table[row - 1];
    const current = new Uint32Array(candidate.length + 1);
    current[0] = row;
    for (let column = 1; column <= candidate.length; column += 1) {
      const kept = reference[row - 1] === candidate[column - 1] ? 0 : 1;
      current[column] = Math.min(
        previous[column - 1] + kept,
        previous[column] + 1,
        current[column - 1] + 1,
      );
    }
    table.push(current);
  }
  return table;
};

const matchedPairs = (
  reference: number[],
  candidate: number[],
  table: Uint32Array[],
): [number, number][] => {
  const pairs: [number, number][] = [];
  let row = reference.length;
  let column = candidate.length;
  while (row > 0 && column > 0) {
    const diagonal = table[row - 1][column - 1];
    const equal = reference[row - 1] === candidate[column - 1];
    if (equal && table[row][column] === diagonal) {
      pairs.push([row - 1, column - 1]);
    }
    if (table[row][column] === diagonal + (equal ? 0 : 1)) {
      row -= 1;
      column -= 1;
    } else if (table[row][column] === table[row - 1][column] + 1) {
      row -= 1;
    } else {
      column -= 1;
    }
  }
  return pairs;
};

export type TokenLists = {
  reference: Float32Array | Int32Array;
  candidate: Float32Array | Int32Array;
  width: number;
};

export const tokenErrorRate = (lists: TokenLists): number => {
  const reference = tokenRows(lists.reference, lists.width).ids;
  const candidate = tokenRows(lists.candidate, lists.width).ids;
  const distance = editTable(reference, candidate)[reference.length][
    candidate.length
  ];
  return reference.length === 0 ? distance : distance / reference.length;
};

export const alignedTimeOffset = (lists: TokenLists): number => {
  const reference = tokenRows(lists.reference, lists.width);
  const candidate = tokenRows(lists.candidate, lists.width);
  const pairs = matchedPairs(
    reference.ids,
    candidate.ids,
    editTable(reference.ids, candidate.ids),
  );
  if (pairs.length === 0) {
    return reference.ids.length === 0 && candidate.ids.length === 0
      ? 0
      : Infinity;
  }
  return Math.max(
    ...pairs.map((pair) =>
      Math.abs(reference.times[pair[0]] - candidate.times[pair[1]]),
    ),
  );
};
