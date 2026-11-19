import { type CalibrationClick } from '@musetric/engine';

export type JudgedClick = {
  index: number;
  click: CalibrationClick;
};

export const getLastJudgedClick = (
  clicks: CalibrationClick[],
): JudgedClick | undefined => {
  const index = clicks.findLastIndex((click) => click !== 'pending');
  return index < 0 ? undefined : { index, click: clicks[index] };
};
