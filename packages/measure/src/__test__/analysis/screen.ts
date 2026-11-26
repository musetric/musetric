const staticTolerance = 2;
const edgeLevel = 12;
const edgeShare = 0.5;
const edgeReach = 2;

export type GrayScreen = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

export const toGrayScreen = (
  raw: Uint8Array,
  top: number,
  bottom: number,
): GrayScreen => {
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const width = view.getUint32(0, true);
  const offset = raw.length - width * view.getUint32(4, true) * 4;
  const height = bottom - top;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = offset + ((top + y) * width + x) * 4;
      pixels[y * width + x] =
        (raw[index] * 299 + raw[index + 1] * 587 + raw[index + 2] * 114) / 1000;
    }
  }
  return { width, height, pixels };
};

export type ScreenBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export const findThumbProgress = (
  screen: GrayScreen,
  rail: ScreenBox,
  thumbRadius: number,
): number => {
  const row = screen.width * Math.round(rail.top + rail.height / 2);
  const filled = screen.pixels[row + rail.left + 1];
  const empty = screen.pixels[row + rail.left + rail.width - 2];
  const threshold = (filled + empty) / 2;
  const last = Math.min(screen.width - 1, rail.left + rail.width + thumbRadius);
  let right = rail.left;
  for (let x = last; x > rail.left; x -= 1) {
    if (screen.pixels[row + x] > threshold) {
      right = x;
      break;
    }
  }
  return (right - thumbRadius - rail.left) / rail.width;
};

export const findStaticPixels = (screens: readonly GrayScreen[]) => {
  const [first, ...rest] = screens;
  const still = new Uint8Array(first.pixels.length).fill(1);
  for (const screen of rest) {
    for (let index = 0; index < still.length; index += 1) {
      if (
        Math.abs(screen.pixels[index] - first.pixels[index]) > staticTolerance
      ) {
        still[index] = 0;
      }
    }
  }
  return still;
};

export const maskFixedEdges = (
  screens: readonly GrayScreen[],
  still: Uint8Array,
) => {
  const counts = new Uint16Array(still.length);
  for (const screen of screens) {
    for (let index = 0; index + 1 < counts.length; index += 1) {
      if (
        Math.abs(screen.pixels[index + 1] - screen.pixels[index]) > edgeLevel
      ) {
        counts[index] += 1;
      }
    }
  }
  const masked = still.slice();
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] >= screens.length * edgeShare) {
      masked.fill(1, Math.max(0, index - edgeReach), index + edgeReach + 2);
    }
  }
  return masked;
};

const readSlopes = (
  screen: GrayScreen,
  still: Uint8Array,
  box: ScreenBox,
  rowStep: number,
) => {
  const width = box.width - 1;
  const rows = Math.floor(box.height / rowStep);
  const values = new Float32Array(rows * width);
  for (let row = 0; row < rows; row += 1) {
    const base = (box.top + row * rowStep) * screen.width + box.left;
    for (let x = 0; x < width; x += 1) {
      const index = base + x;
      if (still[index] === 0 && still[index + 1] === 0) {
        values[row * width + x] =
          screen.pixels[index + 1] - screen.pixels[index];
      }
    }
  }
  return { width, rows, values };
};

export type ScreenShift = {
  shift: number;
  score: number;
};

export type ShiftSearch = {
  frame: GrayScreen;
  reference: GrayScreen;
  still: Uint8Array;
  box: ScreenBox;
  rowStep: number;
  reach: number;
};

export const findShift = (search: ShiftSearch): ScreenShift => {
  const { frame, reference, still, box, rowStep, reach } = search;
  const shown = readSlopes(frame, still, box, rowStep);
  const known = readSlopes(reference, still, box, rowStep);
  const { width, rows } = shown;
  const maxShift = Math.floor(width * reach);
  let best: ScreenShift = { shift: 0, score: Number.NaN };
  for (let shift = -maxShift; shift <= maxShift; shift += 1) {
    const from = Math.max(0, -shift);
    const to = Math.min(width, width - shift);
    let product = 0;
    let shownEnergy = 0;
    let knownEnergy = 0;
    for (let row = 0; row < rows; row += 1) {
      const base = row * width;
      for (let x = from; x < to; x += 1) {
        const a = shown.values[base + x];
        const b = known.values[base + x + shift];
        product += a * b;
        shownEnergy += a * a;
        knownEnergy += b * b;
      }
    }
    const score = product / Math.sqrt(shownEnergy * knownEnergy);
    if (
      Number.isFinite(score) &&
      (Number.isNaN(best.score) || score > best.score)
    ) {
      best = { shift, score };
    }
  }
  return best;
};
