export type CanvasCacheConfig = {
  paddingLeftFactor: number;
  paddingRightFactor: number;
};

export type CanvasCache = {
  shouldRender: (progress: number) => boolean;
  updateCache: (progress: number) => void;
  updateTransform: (
    progress: number,
    container: HTMLElement,
    canvas: HTMLElement,
  ) => void;
  invalidate: () => void;
};

export const createCanvasCache = (config: CanvasCacheConfig): CanvasCache => {
  const { paddingLeftFactor, paddingRightFactor } = config;
  const totalFactor = 1 + paddingLeftFactor + paddingRightFactor;

  let cacheStart = -1;
  let cacheEnd = -1;

  const setCacheRange = (progress: number) => {
    cacheStart = Math.max(0, progress - paddingLeftFactor);
    cacheEnd = Math.min(1, progress + paddingRightFactor);
  };

  return {
    shouldRender: (progress) => {
      return progress < cacheStart || progress > cacheEnd;
    },

    updateCache: (progress) => {
      setCacheRange(progress);
    },

    updateTransform: (progress, container, canvas) => {
      const containerWidth = container.clientWidth;
      const canvasWidth = canvas.clientWidth;
      const cacheDuration = cacheEnd - cacheStart;

      if (cacheDuration <= 0) {
        return;
      }

      const progressInCache = (progress - cacheStart) / cacheDuration;
      const canvasPosition = progressInCache * canvasWidth;
      const targetPosition =
        ((paddingLeftFactor + 1) / totalFactor) * containerWidth;
      const translateX = targetPosition - canvasPosition;

      canvas.style.transform = `translateX(${translateX}px)`;
    },

    invalidate: () => {
      cacheStart = -1;
      cacheEnd = -1;
    },
  };
};

export const defaultCacheConfig: CanvasCacheConfig = {
  paddingLeftFactor: 0,
  paddingRightFactor: 0.5,
};
