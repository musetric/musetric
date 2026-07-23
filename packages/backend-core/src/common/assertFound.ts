// eslint-disable-next-line musetric/no-classes
export class NotFoundError extends Error {
  public readonly statusCode = 404;
}

export type AssertFound = <T>(
  value: T,
  message: string,
) => asserts value is NonNullable<T>;

export const assertFound: AssertFound = (value, message) => {
  // eslint-disable-next-line musetric/no-null-literal
  if (value === null || value === undefined) {
    throw new NotFoundError(message);
  }
};
