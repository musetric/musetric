import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const modelsFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/analysis/models.rs',
);

type ModelPin = {
  modelId: string;
  revision: string;
};

const pins: ModelPin[] = [
  ...readFileSync(modelsFile, 'utf8').matchAll(
    /model_id: "([^"]+)",\s+revision: "([0-9a-f]{40})"/g,
  ),
].map((match) => ({ modelId: match[1], revision: match[2] }));

const readHeads = async (): Promise<Map<string, string>> => {
  const response = await fetch(
    'https://huggingface.co/api/models?author=musetric&expand%5B%5D=sha&limit=1000',
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new Error(`Hugging Face answered ${response.status}`);
  }
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

const heads = await readHeads();

type PinVerdict = ModelPin & {
  head: string | undefined;
};

const verdicts: PinVerdict[] = pins.map((pin) => ({
  ...pin,
  head: heads.get(pin.modelId),
}));

const stale = verdicts.filter((verdict) => verdict.head !== verdict.revision);
for (const verdict of verdicts) {
  console.log(
    `${verdict.head === verdict.revision ? 'ok   ' : 'stale'} ${verdict.modelId} ${verdict.revision}`,
  );
}
for (const verdict of stale) {
  console.log(
    verdict.head
      ? `${verdict.modelId}: models.rs pins ${verdict.revision}, but main on Hugging Face is ${verdict.head}. A pin is always the head of main: pin ${verdict.head}, with the sha256 and size of every file it lists.`
      : `${verdict.modelId}: the organization on Hugging Face has no repository of that name.`,
  );
}
if (pins.length === 0) {
  console.log(`No model pins found in ${modelsFile}.`);
}
process.exitCode = stale.length === 0 && pins.length > 0 ? 0 : 1;
