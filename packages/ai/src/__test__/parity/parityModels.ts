import modelPins from '../../modelPins.json' with { type: 'json' };

export type ParityPinName = keyof typeof modelPins;

export type ParityModelFile = {
  name: string;
  sha256: string;
  bytes: number;
};

export type ParityGraphValue = string | number;

export type ParityBundle = {
  modelId: string;
  revision: string;
  directory: string;
  files: Record<string, ParityModelFile>;
  graph: Record<string, ParityGraphValue>;
};

const toBundle = (
  name: string,
  pin: (typeof modelPins)[ParityPinName],
): ParityBundle => ({
  modelId: pin.repository,
  revision: pin.revision,
  directory: name,
  files: pin.files,
  graph: pin.graph,
});

export const findBundle = (name: ParityPinName): ParityBundle =>
  toBundle(name, modelPins[name]);

export const readBundles = (): ParityBundle[] =>
  Object.entries(modelPins).map((entry) => toBundle(...entry));

export const findFile = (
  bundle: ParityBundle,
  role: string,
): ParityModelFile => {
  const file = Object.hasOwn(bundle.files, role)
    ? bundle.files[role]
    : undefined;
  if (file === undefined) {
    throw new Error(`${bundle.modelId} pins no ${role} file`);
  }
  return file;
};
