export type RecordingLayout = {
  checkWidth: number;
  nameWidth: number;
  rowHeight: number;
  waveHeight: number;
  rulerHeight: number;
  sidePadding: number;
};

export const getRecordingLayout = (compact: boolean): RecordingLayout => ({
  checkWidth: 36,
  nameWidth: compact ? 104 : 136,
  rowHeight: compact ? 52 : 44,
  waveHeight: compact ? 32 : 28,
  rulerHeight: 22,
  sidePadding: 16,
});

export const getRecordingColumns = (layout: RecordingLayout): string =>
  `${layout.checkWidth}px ${layout.nameWidth}px minmax(0, 1fr)`;
