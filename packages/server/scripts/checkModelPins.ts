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

const constantPattern =
  /const ([A-Z][A-Z0-9_]*): &(?:'static )?str =\s*"([^"]+)";/g;
const pinPattern = /model_id: "([^"]+)",\s+revision: "([0-9a-f]{40})"/;
const entryPattern =
  /\(\s*("[^"]+"|[A-Z][A-Z0-9_]*),\s*"([0-9a-f]{64})",\s*([\d_]+),?\s*\)/g;
const filesStart = 'files: &[';

const readFilesArray = (bundle: string): string => {
  const start = bundle.indexOf(filesStart);
  if (start < 0) {
    return '';
  }
  const end = bundle.indexOf('],', start);
  return end < 0 ? '' : bundle.slice(start + filesStart.length, end);
};

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
    [...source.matchAll(constantPattern)].map((match) => [match[1], match[2]]),
  );
  return source
    .split('ModelBundle {')
    .slice(1)
    .flatMap((bundle) => {
      const pin = pinPattern.exec(bundle);
      if (!pin) {
        return [];
      }
      const array = readFilesArray(bundle);
      const files = [...array.matchAll(entryPattern)].map((match) => {
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
      const entries = array.match(/\(/g)?.length ?? 0;
      return [
        {
          modelId: pin[1],
          revision: pin[2],
          files,
          unread: entries - files.length,
        },
      ];
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

type ListedModel = {
  id: string;
  head: string;
};

const readListing = async (): Promise<Map<string, ListedModel>> => {
  const response = await fetchOk(
    `${hub}/api/models?author=musetric&expand%5B%5D=sha&limit=1000`,
  );
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error('Hugging Face sent no list of models');
  }
  const models: unknown[] = raw;
  const listing = new Map<string, ListedModel>();
  for (const model of models) {
    if (
      typeof model === 'object' &&
      model &&
      'id' in model &&
      'sha' in model &&
      typeof model.id === 'string' &&
      typeof model.sha === 'string'
    ) {
      listing.set(model.id, { id: model.id, head: model.sha });
    }
  }
  return listing;
};

const nextPage = (response: Response): string | undefined => {
  const link = response.headers
    .get('link')
    ?.split(',')
    .find((part) => part.includes('rel="next"'));
  return link === undefined
    ? undefined
    : new URL(link.slice(link.indexOf('<') + 1, link.indexOf('>')), hub).href;
};

type TreeFile = {
  path: string;
  size: number;
  lfsSha256: string | undefined;
};

const readTreePage = async (
  url: string,
  model: ListedModel,
  tree: Map<string, TreeFile>,
): Promise<string | undefined> => {
  const response = await fetchOk(url);
  const raw: unknown = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Hugging Face sent no file list of ${model.id}`);
  }
  const entries: unknown[] = raw;
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
        path: entry.path,
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
  return nextPage(response);
};

const readTree = async (model: ListedModel): Promise<Map<string, TreeFile>> => {
  const tree = new Map<string, TreeFile>();
  let page: string | undefined =
    `${hub}/api/models/${model.id}/tree/${model.head}?recursive=true`;
  while (page !== undefined) {
    page = await readTreePage(page, model, tree);
  }
  return tree;
};

const hashFile = async (model: ListedModel, path: string): Promise<string> => {
  const response = await fetchOk(
    `${hub}/${model.id}/resolve/${model.head}/${path.split('/').map(encodeURIComponent).join('/')}`,
  );
  return createHash('sha256')
    .update(Buffer.from(await response.arrayBuffer()))
    .digest('hex');
};

const checkFile = async (
  pin: ModelPin,
  model: ListedModel,
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
  const sha256 = found.lfsSha256 ?? (await hashFile(model, found.path));
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

const checkFiles = async (
  pin: ModelPin,
  model: ListedModel,
): Promise<string[]> => {
  if (pin.files.length === 0 || pin.unread !== 0) {
    return [
      `${pin.modelId}: the check reads ${pin.files.length} pinned files in models.rs and cannot read ${pin.unread} more.`,
    ];
  }
  try {
    const tree = await readTree(model);
    const faults = await Promise.all(
      pin.files.map(async (file) => checkFile(pin, model, tree, file)),
    );
    return faults.flat();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`${pin.modelId}: its files could not be read: ${reason}`];
  }
};

const listing = await readListing();

type PinVerdict = ModelPin & {
  head: string | undefined;
  faults: string[];
};

const verdicts: PinVerdict[] = await Promise.all(
  pins.map(async (pin) => {
    const listed = listing.get(pin.modelId);
    return {
      ...pin,
      head: listed?.head,
      faults:
        listed?.head === pin.revision ? await checkFiles(pin, listed) : [],
    };
  }),
);

const isStale = (verdict: PinVerdict): boolean =>
  verdict.head !== verdict.revision;

const isWrong = (verdict: PinVerdict): boolean => verdict.faults.length > 0;

const readMark = (verdict: PinVerdict): string => {
  if (isStale(verdict)) {
    return 'stale';
  }
  return isWrong(verdict) ? 'wrong' : 'ok   ';
};

const failed = verdicts.filter(
  (verdict) => isStale(verdict) || isWrong(verdict),
);
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
