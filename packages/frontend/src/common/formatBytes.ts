import { type TFunction } from 'i18next';

const byteUnits = ['b', 'kb', 'mb', 'gb', 'tb'] as const;
export type ByteUnit = (typeof byteUnits)[number];

const getUnitLabels = (t: TFunction): Record<ByteUnit, string> => ({
  b: t('common.units.bytes.b'),
  kb: t('common.units.bytes.kb'),
  mb: t('common.units.bytes.mb'),
  gb: t('common.units.bytes.gb'),
  tb: t('common.units.bytes.tb'),
});

const getUnitIndexByValue = (value: number): number => {
  if (value <= 0) {
    return 0;
  }
  return Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    byteUnits.length - 1,
  );
};

const getDividerByIndex = (index: number): number => 1024 ** index;

export const formatBytesWithUnit = (
  valueInBytes: number,
  t: TFunction,
): string => {
  const unitIndex = getUnitIndexByValue(valueInBytes);
  const unit = byteUnits[unitIndex];
  const divider = getDividerByIndex(unitIndex);
  const value = valueInBytes / divider;

  return `${value.toFixed(1)} ${getUnitLabels(t)[unit]}`;
};

export const formatBytesToUnit = (
  valueInBytes: number,
  baseValueInBytes: number,
) => {
  const unitIndex = getUnitIndexByValue(baseValueInBytes);
  const divider = getDividerByIndex(unitIndex);
  const value = valueInBytes / divider;

  return value.toFixed(1);
};
