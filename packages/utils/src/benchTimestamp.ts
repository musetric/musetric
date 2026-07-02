const padTimestamp = (value: number): string => String(value).padStart(2, '0');

export const createBenchTimestamp = (value: Date = new Date()): string =>
  `${value.getFullYear()}${padTimestamp(value.getMonth() + 1)}${padTimestamp(value.getDate())}T${padTimestamp(value.getHours())}${padTimestamp(value.getMinutes())}${padTimestamp(value.getSeconds())}`;

export const formatBenchTimestamp = (timestamp: string): string =>
  `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(9, 11)}-${timestamp.slice(11, 13)}-${timestamp.slice(13, 15)}`;
