export type Rgb = {
  red: number;
  green: number;
  blue: number;
};

export type ViewColors = {
  foreground: string;
  background: string;
};

export const parseHexColor = (hex: string): Rgb => {
  let h = hex.startsWith('#') ? hex.slice(1) : hex;
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const n = parseInt(h, 16);
  return { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 };
};
