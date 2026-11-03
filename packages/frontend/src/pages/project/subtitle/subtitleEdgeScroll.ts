const minZonePixels = 24;
const zoneRatio = 0.15;
const armPixels = 12;
const maxStrength = 2;
const viewsPerSecond = 0.8;
const maxStepSeconds = 0.05;

export type SubtitleEdgeScroll = {
  begin: (clientY: number) => void;
  move: (clientY: number) => void;
  stop: () => void;
};

export const createSubtitleEdgeScroll = (
  element: HTMLElement,
  onScroll: () => void,
): SubtitleEdgeScroll => {
  let clientY = 0;
  let highest = 0;
  let lowest = 0;
  let frame: number | undefined = undefined;
  let last = 0;
  let position = 0;

  const getStrength = () => {
    const rect = element.getBoundingClientRect();
    const zone = Math.max(minZonePixels, rect.height * zoneRatio);
    const y = clientY - rect.top;
    if (y < zone && lowest - clientY >= armPixels) {
      return -Math.min(maxStrength, ((zone - y) / zone) ** 2);
    }
    if (y > rect.height - zone && clientY - highest >= armPixels) {
      return Math.min(maxStrength, ((y - rect.height + zone) / zone) ** 2);
    }
    return 0;
  };

  const tick = (now: number) => {
    const strength = getStrength();
    if (strength === 0) {
      frame = undefined;
      return;
    }
    const seconds = Math.min(maxStepSeconds, (now - last) / 1000);
    last = now;
    const before = element.scrollTop;
    if (Math.abs(position - before) >= 1) {
      position = before;
    }
    position += strength * element.clientHeight * viewsPerSecond * seconds;
    element.scrollTop = position;
    if (element.scrollTop !== before) {
      onScroll();
    }
    frame = requestAnimationFrame(tick);
  };

  return {
    begin: (nextClientY) => {
      clientY = nextClientY;
      highest = nextClientY;
      lowest = nextClientY;
    },
    move: (nextClientY) => {
      clientY = nextClientY;
      highest = Math.min(highest, nextClientY);
      lowest = Math.max(lowest, nextClientY);
      if (frame === undefined && getStrength() !== 0) {
        last = performance.now();
        position = element.scrollTop;
        frame = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      frame = undefined;
    },
  };
};
