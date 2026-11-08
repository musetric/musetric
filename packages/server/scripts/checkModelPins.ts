import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelsFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/analysis/models.rs',
);
const hub = 'https://huggingface.co';
const requestTimeout = 15_000;

type PinnedFile = {
  name: string;
  sha256: string;
  size: number;
};

type ModelPin = {
  modelId: string;
  revision: string;
  files: PinnedFile[];
  unread: number;
};

const readPins = (source: string): ModelPin[] => {
  const names = new Map(
    [...source.matchAll(/const ([A-Z][A-Z0-9_]*): &str = "([^"]+)";/g)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const starts = [
    ...source.matchAll(/model_id: "([^"]+)",\s+revision: "([0-9a-f]{40})"/g),
  ];
  return starts.map((start, index) => {
    const end = starts[index + 1]?.index ?? source.length;
    const bundle = source.slice(start.index, end);
    const files = [
      ...bundle.matchAll(
        /\(\s*("[^"]+"|[A-Z][A-Z0-9_]*),\s*"([0-9a-f]{64})",\s*([\d_]+),?\s*\)/g,
      ),
    ].map((match) => {
      const [, token, sha256, size] = match;
      const name = token.startsWith('"')
        ? token.slice(1, -1)
        : names.get(token);
      if (name === undefined) {
        throw new Error(`models.rs names no file for ${token}`);
      }
      return {
        name,
        sha256,
        size: Number(size.replaceAll('_', '')),
      };
    });
    const listed = bundle.match(/"[0-9a-f]{64}"/g)?.length ?? 0;
    return {
      modelId: start[1],
      revision: start[2],
      files,
      unread: listed - files.length,
    };
  });
};

const pins = readPins(readFileSync(modelsFile, 'utf8'));

const fetchOk = async (url: string): Promise<Response> => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(requestTimeout),
  });
  if (!response.ok) {
    throw new Error(`Hugging Face answered ${response.status} for ${url}`);
  }
  return response;
};

const readHeads = async (): Promise<Map<string, string>> => {
  const response = await fetchOk(
    `${hub}/api/models?author=musetric&expand%5B%5D=sha&limit=1000`,
  );
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error('Hugging Face sent no list of models');
  }
  const models: unknown[] = raw;
  const heads = new Map<string, string>();
  for (const model of models) {
    if (
      typeof model === 'object' &&
      model &&
      'id' in model &&
      'sha' in model &&
      typeof model.id === 'string' &&
      typeof model.sha === 'string'
    ) {
      heads.set(model.id, model.sha);
    }
  }
  return heads;
};

type TreeFile = {
  size: number;
  lfsSha256: string | undefined;
};

const readTree = async (pin: ModelPin): Promise<Map<string, TreeFile>> => {
  const response = await fetchOk(
    `${hub}/api/models/${pin.modelId}/tree/${pin.revision}`,
  );
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Hugging Face sent no file list of ${pin.modelId}`);
  }
  const entries: unknown[] = raw;
  const tree = new Map<string, TreeFile>();
  for (const entry of entries) {
    if (
      typeof entry === 'object' &&
      entry &&
      'path' in entry &&
      'size' in entry &&
      typeof entry.path === 'string' &&
      typeof entry.size === 'number'
    ) {
      const lfs = 'lfs' in entry ? entry.lfs : undefined;
      tree.set(entry.path, {
        size: entry.size,
        lfsSha256:
          typeof lfs === 'object' &&
          lfs &&
          'oid' in lfs &&
          typeof lfs.oid === 'string'
            ? lfs.oid
            : undefined,
      });
    }
  }
  return tree;
};

const hashFile = async (pin: ModelPin, name: string): Promise<string> => {
  const response = await fetchOk(
    `${hub}/${pin.modelId}/resolve/${pin.revision}/${name}`,
  );
  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex');
};

const checkFile = async (
  pin: ModelPin,
  tree: Map<string, TreeFile>,
  file: PinnedFile,
): Promise<string[]> => {
  const where = `${pin.modelId}: ${file.name}`;
  const found = tree.get(file.name);
  if (found === undefined) {
    return [
      `${where} is pinned, but revision ${pin.revision} has no such file.`,
    ];
  }
  const sha256 = found.lfsSha256 ?? (await hashFile(pin, file.name));
  const faults: string[] = [];
  if (sha256 !== file.sha256) {
    faults.push(
      `${where}: models.rs pins sha256 ${file.sha256}, but revision ${pin.revision} has ${sha256}.`,
    );
  }
  if (found.size !== file.size) {
    faults.push(
      `${where}: models.rs pins ${file.size} bytes, but revision ${pin.revision} has ${found.size}.`,
    );
  }
  return faults;
};

const checkFiles = async (pin: ModelPin): Promise<string[]> => {
  if (pin.files.length === 0 || pin.unread !== 0) {
    return [
      `${pin.modelId}: the check reads ${pin.files.length} pinned files in models.rs and cannot read ${pin.unread} more.`,
    ];
  }
  const tree = await readTree(pin);
  const faults = await Promise.all(
    pin.files.map(async (file) => checkFile(pin, tree, file)),
  );
  return faults.flat();
};

const heads = await readHeads();

type PinVerdict = ModelPin & {
  head: string | undefined;
  faults: string[];
};

const verdicts: PinVerdict[] = await Promise.all(
  pins.map(async (pin) => {
    const head = heads.get(pin.modelId);
    return {
      ...pin,
      head,
      faults: head === undefined ? [] : await checkFiles(pin),
    };
  }),
);

const readMark = (verdict: PinVerdict): string => {
  if (verdict.head !== verdict.revision) {
    return 'stale';
  }
  return verdict.faults.length > 0 ? 'wrong' : 'ok   ';
};

const failed = verdicts.filter((verdict) => readMark(verdict) !== 'ok   ');
for (const verdict of verdicts) {
  console.log(`${readMark(verdict)} ${verdict.modelId} ${verdict.revision}`);
}
for (const verdict of failed) {
  if (verdict.head === undefined) {
    console.log(
      `${verdict.modelId}: the organization on Hugging Face has no repository of that name.`,
    );
  } else if (verdict.head !== verdict.revision) {
    console.log(
      `${verdict.modelId}: models.rs pins ${verdict.revision}, but main on Hugging Face is ${verdict.head}. A pin is always the head of main: pin ${verdict.head}, with the sha256 and size of every file it lists.`,
    );
  }
  for (const fault of verdict.faults) {
    console.log(fault);
  }
}
if (pins.length === 0) {
  console.log(`No model pins found in ${modelsFile}.`);
}
process.exitCode = failed.length === 0 && pins.length > 0 ? 0 : 1;
