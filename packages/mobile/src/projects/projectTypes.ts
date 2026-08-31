import { type PayloadSegment } from '@musetric/ai/dom';

export const isObject = (value: unknown): value is object =>
  typeof value === 'object' && Boolean(value);

export const hasStringProperties = (
  value: object,
  names: readonly string[],
): boolean =>
  names.every((name) => typeof Reflect.get(value, name) === 'string');

export type MobileProjectCue = {
  id: string;
  start: number;
  text: string;
};

export const isProjectCue = (value: unknown): value is MobileProjectCue => {
  if (!isObject(value)) {
    return false;
  }
  const start: unknown = Reflect.get(value, 'start');
  return (
    typeof Reflect.get(value, 'id') === 'string' &&
    typeof start === 'number' &&
    start >= 0 &&
    typeof Reflect.get(value, 'text') === 'string'
  );
};

export type MobileProjectRecording = {
  id: string;
  path: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
};

export const isProjectRecording = (
  value: unknown,
): value is MobileProjectRecording =>
  isObject(value) &&
  hasStringProperties(value, [
    'contentType',
    'createdAt',
    'filename',
    'id',
    'path',
  ]) &&
  typeof Reflect.get(value, 'size') === 'number';

export type MobileProjectStemId = 'lead' | 'backing' | 'instrumental';

export type MobileProjectStem = {
  id: MobileProjectStemId;
  path: string;
  contentType: string;
  size: number;
};

export const isProjectStem = (value: unknown): value is MobileProjectStem =>
  isObject(value) &&
  (Reflect.get(value, 'id') === 'lead' ||
    Reflect.get(value, 'id') === 'backing' ||
    Reflect.get(value, 'id') === 'instrumental') &&
  hasStringProperties(value, ['contentType', 'path']) &&
  typeof Reflect.get(value, 'size') === 'number';

const isTranscriptionWord = (value: unknown): boolean =>
  isObject(value) &&
  typeof Reflect.get(value, 'start') === 'number' &&
  typeof Reflect.get(value, 'end') === 'number' &&
  typeof Reflect.get(value, 'text') === 'string';

export const isPayloadSegment = (value: unknown): value is PayloadSegment => {
  if (!isObject(value)) {
    return false;
  }
  const words: unknown = Reflect.get(value, 'words');
  return (
    typeof Reflect.get(value, 'start') === 'number' &&
    typeof Reflect.get(value, 'end') === 'number' &&
    typeof Reflect.get(value, 'text') === 'string' &&
    Array.isArray(words) &&
    words.every(isTranscriptionWord)
  );
};

export const isOptionalArray = <Item>(
  value: unknown,
  validate: (item: unknown) => item is Item,
): boolean =>
  value === undefined || (Array.isArray(value) && value.every(validate));
