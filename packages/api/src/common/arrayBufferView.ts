import { z } from 'zod';

type ArrayBufferViewConstructor<T = ArrayBufferView<ArrayBuffer>> = new (
  buffer: ArrayBuffer,
) => T;

const arrayBufferViews: ArrayBufferViewConstructor[] = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
  BigInt64Array,
  BigUint64Array,
];

type SchemaConstructor<Schema> = ArrayBufferViewConstructor<z.infer<Schema>>;

export const getArrayBufferViewConstructor = <Schema>(
  schema: Schema,
): SchemaConstructor<Schema> | undefined => {
  if (schema instanceof z.ZodCustom) {
    const view = schema._zod.bag.Class;
    const constructor = arrayBufferViews.find((x) => x === view);
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return constructor as unknown as SchemaConstructor<Schema> | undefined;
  }
  return undefined;
};
