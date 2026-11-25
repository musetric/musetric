export const assertDefined = <T>(value: T, message: string): NonNullable<T> => {
  // eslint-disable-next-line musetric/no-null-literal
  if (value === undefined || value === null) {
    throw new Error(message);
  }
  return value;
};
