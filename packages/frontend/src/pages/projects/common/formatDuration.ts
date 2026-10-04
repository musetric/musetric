export const formatDuration = (durationInSeconds: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationInSeconds));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};
