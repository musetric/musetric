export type MeasureInput =
  | {
      kind: 'swipe';
      fromX: number;
      toX: number;
      y: number;
      durationMs: number;
    }
  | { kind: 'tap'; x: number; y: number };
