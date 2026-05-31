export const hasValue = <T>(value: T): value is NonNullable<T> =>
  // eslint-disable-next-line musetric/no-null-literal
  value !== null && value !== undefined;
