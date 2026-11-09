import { createHash } from 'node:crypto';
import modelPins from '../src/modelPins.json' with { type: 'json' };

const pinsFile = 'packages/ai/src/modelPins.json';
const hub = 'https://huggingface.co';
const requestTimeout = 15_000;

type PinnedFile = {
  name: string;
  sha256: string;
  bytes: number;
};

type ModelPin = {
  modelId: string;
  revision: string;
  files: PinnedFile[];
};

const pins: ModelPin[] = Object.values(modelPins).map((pin) => ({
  modelId: pin.repository,
  revision: pin.revision,
  files: Object.values(pin.files),
}));

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
      `${where}: ${pinsFile} pins sha256 ${file.sha256}, but revision ${pin.revision} has ${sha256}.`,
    );
  }
  if (found.size !== file.bytes) {
    faults.push(
      `${where}: ${pinsFile} pins ${file.bytes} bytes, but revision ${pin.revision} has ${found.size}.`,
    );
  }
  return faults;
};

const checkFiles = async (
  pin: ModelPin,
  model: ListedModel,
): Promise<string[]> => {
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
      `${verdict.modelId}: ${pinsFile} pins ${verdict.revision}, but main on Hugging Face is ${verdict.head}. A pin is always the head of main: pin ${verdict.head}, with the sha256 and size of every file it lists.`,
    );
  }
  for (const fault of verdict.faults) {
    console.log(fault);
  }
}
process.exitCode = failed.length === 0 ? 0 : 1;
