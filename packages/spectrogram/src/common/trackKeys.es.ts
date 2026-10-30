export const allTrackKeys = ['lead', 'recording'] as const;
export type TrackKey = (typeof allTrackKeys)[number];

export const mapTrackKeys = <Value>(
  fn: (key: TrackKey, index: number) => Value,
): Record<TrackKey, Value> => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const result = {} as Record<TrackKey, Value>;
  allTrackKeys.forEach((key, index) => {
    result[key] = fn(key, index);
  });
  return result;
};
