import { type SQLOutputValue } from 'node:sqlite';

export type Row = Record<string, SQLOutputValue>;
export type Buckets = Partial<Record<string, Row>>;
export const bucketizeRow = (row: Row): Buckets => {
  const buckets: Buckets = {};

  Object.entries(row).forEach((entry) => {
    const [key, value] = entry;
    const [entity, property] = key.split('_');
    const bucket = buckets[entity] ?? {};
    bucket[property] = value;
    buckets[entity] = bucket;
  });

  return buckets;
};
