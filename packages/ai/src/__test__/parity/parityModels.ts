import chordsPin from '../../runtime/chords/pin.json' with { type: 'json' };
import keyPin from '../../runtime/key/pin.json' with { type: 'json' };
import rhythmPin from '../../runtime/rhythm/pin.json' with { type: 'json' };
import vocalsPin from '../../runtime/vocals/pin.json' with { type: 'json' };
import whisperPin from '../../runtime/whisper/pin.json' with { type: 'json' };

const modelPins = {
  separation: vocalsPin,
  transcription: whisperPin,
  chords: chordsPin,
  rhythm: rhythmPin,
  key: keyPin,
};

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
