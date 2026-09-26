import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modelsRsPath = fileURLToPath(
  import.meta.resolve('../../../../server/src/analysis/models.rs'),
);

const readString = (body: string, key: string): string =>
  new RegExp(`${key}:\\s*"([^"]+)"`).exec(body)?.[1] ?? '';

export type ParityModelFile = {
  name: string;
  sha256: string;
  bytes: number;
};

const readFiles = (
  body: string,
  names: Map<string, string>,
): ParityModelFile[] =>
  [
    ...body.matchAll(
      /\(\s*([A-Z_]+|"[^"]+"),\s*"([0-9a-f]{64})",\s*([\d_]+),?\s*\)/g,
    ),
  ].map((match) => ({
    name: names.get(match[1]) ?? match[1].replaceAll('"', ''),
    sha256: match[2],
    bytes: Number(match[3].replaceAll('_', '')),
  }));

const readConstants = (source: string): Map<string, string> =>
  new Map(
    [...source.matchAll(/const ([A-Z_]+): &str = "([^"]+)";/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );

export type ParityBundle = {
  constant: string;
  modelId: string;
  revision: string;
  directory: string;
  sampleRate: number;
  files: ParityModelFile[];
};

const readBundles = (
  source: string,
  names: Map<string, string>,
): ParityBundle[] =>
  [
    ...source.matchAll(
      /const ([A-Z_]+): ModelBundle = ModelBundle \{([\s\S]*?)\n\};/g,
    ),
  ].map((match) => ({
    constant: match[1],
    modelId: readString(match[2], 'model_id'),
    revision: readString(match[2], 'revision'),
    directory: readString(match[2], 'directory'),
    sampleRate: Number(/sample_rate:\s*(\d+)/.exec(match[2])?.[1] ?? 0),
    files: readFiles(match[2], names),
  }));

export type ParityGraphValue = string | number;

const readValue = (raw: string): ParityGraphValue => {
  const text = raw.trim();
  if (text.startsWith('"')) {
    return text.slice(1, -1);
  }
  const [numerator, ...divisors] = text.split('/').map(Number);
  return divisors.reduce((quotient, divisor) => quotient / divisor, numerator);
};

const readGeometry = (source: string, name: string): Record<string, number> => {
  const match = new RegExp(
    `const ${name}: ChunkGeometry = geometry\\((\\d+), (\\d+), (\\d+), (\\d+)\\);`,
  ).exec(source);
  const [nFft, hop, frames, channels] = (match?.slice(1) ?? []).map(Number);
  return { nFft, hop, frames, channels, chunkSamples: hop * (frames - 1) };
};

const graphHeader = /fn (\w+)_graph\(\) -> Value \{/g;

export type ParityModels = {
  constants: Map<string, string>;
  bundles: ParityBundle[];
  graphs: Record<string, Record<string, ParityGraphValue>>;
};

const readGraphs = (source: string): ParityModels['graphs'] => {
  const graphs: ParityModels['graphs'] = {};
  for (const match of source.matchAll(graphHeader)) {
    const start = match.index + match[0].length;
    const body = source.slice(start, source.indexOf('\n}', start));
    const geometry = /merge\(\s*(\w+)\.fields\(\)/.exec(body);
    const fields = Object.fromEntries(
      [...body.matchAll(/"(\w+)": ([^,\n{]+),/g)].map((field) => [
        field[1],
        readValue(field[2]),
      ]),
    );
    graphs[match[1]] = {
      ...(geometry ? readGeometry(source, geometry[1]) : {}),
      ...fields,
    };
  }
  return graphs;
};

export const findBundle = (
  models: ParityModels,
  constant: string,
): ParityBundle => {
  const bundle = models.bundles.find(
    (candidate) => candidate.constant === constant,
  );
  if (!bundle) {
    throw new Error(`models.rs has no bundle ${constant}`);
  }
  return bundle;
};

export const findFile = (models: ParityModels, constant: string): string => {
  const name = models.constants.get(constant);
  if (name === undefined) {
    throw new Error(`models.rs has no file name ${constant}`);
  }
  return name;
};

export const readParityModels = (): ParityModels => {
  const source = readFileSync(modelsRsPath, 'utf8');
  const constants = readConstants(source);
  return {
    constants,
    bundles: readBundles(source, constants),
    graphs: readGraphs(source),
  };
};
