export const advanceOffsetFrameIndex = (
  offsetFrameIndex: number,
  limitFrameCount: number,
  advanceFrameCount: number,
) => {
  if (offsetFrameIndex >= limitFrameCount) {
    return {
      offsetFrameIndex: limitFrameCount,
      remainingFrameCount: advanceFrameCount,
    };
  }

  const offsetRemainingFrameCount = limitFrameCount - offsetFrameIndex;
  if (advanceFrameCount <= offsetRemainingFrameCount) {
    return {
      offsetFrameIndex: offsetFrameIndex + advanceFrameCount,
      remainingFrameCount: 0,
    };
  }

  return {
    offsetFrameIndex: limitFrameCount,
    remainingFrameCount: advanceFrameCount - offsetRemainingFrameCount,
  };
};

export const getAdvancedFrameCount = (
  processedFrameCount: number,
  outputFrameCount: number,
  remainingOutputFrameCount: number,
) => {
  if (remainingOutputFrameCount === outputFrameCount) {
    return processedFrameCount;
  }
  if (remainingOutputFrameCount === 0 || outputFrameCount === 0) {
    return 0;
  }
  return Math.round(
    (processedFrameCount * remainingOutputFrameCount) / outputFrameCount,
  );
};
