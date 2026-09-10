export const fetchOk = async (
  url: string,
  label: string,
): Promise<Response> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  return response;
};

export const fetchFloat32 = async (
  url: string,
  label: string,
): Promise<Float32Array<ArrayBuffer>> => {
  const response = await fetchOk(url, label);
  return new Float32Array(await response.arrayBuffer());
};

export const floatsFromBytes = (
  bytes: Uint8Array,
): Float32Array<ArrayBuffer> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
};

export const jsonBytes = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));
