export type TileShape = {
  rowSize: number;
  columnSize: number;
};

export const selectBalancedTileShape = (
  packedWindowSize: number,
  maxTileSize: number,
): TileShape | undefined => {
  let best:
    | (TileShape & {
        score: number;
      })
    | undefined = undefined;

  for (
    let divisor = 1;
    divisor <= Math.min(maxTileSize, packedWindowSize);
    divisor++
  ) {
    if (packedWindowSize % divisor !== 0) {
      continue;
    }

    const quotient = packedWindowSize / divisor;
    if (quotient > maxTileSize) {
      continue;
    }

    const rowSize = Math.max(divisor, quotient);
    const columnSize = Math.min(divisor, quotient);
    const tileSize = Math.max(rowSize, columnSize);
    const balance = Math.abs(rowSize - columnSize);
    const evenPenalty = rowSize % 2 === 0 ? 0 : 1;
    const score = tileSize * 1_000_000 + balance * 10 + evenPenalty;

    if (best === undefined || score < best.score) {
      best = { rowSize, columnSize, score };
    }
  }

  if (best === undefined) {
    return undefined;
  }

  return { rowSize: best.rowSize, columnSize: best.columnSize };
};
