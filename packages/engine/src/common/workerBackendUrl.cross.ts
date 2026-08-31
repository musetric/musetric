const backendParamName = 'musetricBackend';

export const setWorkerBackendUrlHash = (
  workerUrl: URL,
  backendUrl: string,
): void => {
  workerUrl.hash = `${backendParamName}=${encodeURIComponent(backendUrl)}`;
};

export const getWorkerBackendUrlHash = (): string | undefined => {
  const { hash } = new URL(self.location.href);
  if (hash.length === 0) {
    return undefined;
  }
  const value = new URLSearchParams(hash.slice(1)).get(backendParamName);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};
