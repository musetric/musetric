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

const readHead = async (modelId: string): Promise<string> => {
  const response = await fetch(
    `https://huggingface.co/api/models/${modelId}/revision/main`,
    { signal: AbortSignal.timeout(15_000) },
  );
  if (!response.ok) {
    throw new Error(`${modelId}: Hugging Face answered ${response.status}`);
  }
  const raw: unknown = await response.json();
  if (
    typeof raw !== 'object' ||
    !raw ||
    !('sha' in raw) ||
    typeof raw.sha !== 'string'
  ) {
    throw new Error(`${modelId}: Hugging Face sent no revision of main`);
  }
  return raw.sha;
};

type PinVerdict = ModelPin & {
  head: string;
};

const verdicts: PinVerdict[] = await Promise.all(
  pins.map(async (pin) => ({ ...pin, head: await readHead(pin.modelId) })),
);

const stale = verdicts.filter((verdict) => verdict.head !== verdict.revision);
for (const verdict of verdicts) {
  console.log(
    `${verdict.head === verdict.revision ? 'ok   ' : 'stale'} ${verdict.modelId} ${verdict.revision}`,
  );
}
for (const verdict of stale) {
  console.log(
    `${verdict.modelId}: models.rs pins ${verdict.revision}, but main on Hugging Face is ${verdict.head}. A pin is always the head of main: pin ${verdict.head}, with the sha256 and size of every file it lists.`,
  );
}
if (pins.length === 0) {
  console.log(`No model pins found in ${modelsFile}.`);
}
process.exitCode = stale.length === 0 && pins.length > 0 ? 0 : 1;
