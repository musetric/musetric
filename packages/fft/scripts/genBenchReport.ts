import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatBenchMarkdown,
  formatBenchTimestamp,
  type FourierBenchMode,
  type FourierBenchSummary,
} from '../src/fourier/__test__/bench.es.js';

const cwd = process.cwd();
const tmpCufftJsonPath = resolve(cwd, '.bench-cufft.json');
const outputDirectory = resolve(cwd, 'tmp/bench');

const normalizeSummary = (summary: FourierBenchSummary): void => {
  summary.means = summary.means.map((value) =>
    typeof value === 'number' ? value : Number.NaN,
  );
  summary.cvs = summary.cvs.map((value) =>
    typeof value === 'number' ? value : Number.NaN,
  );
};

const collectBenchSummaries = (
  summaries: FourierBenchSummary[],
): Map<number, Partial<Record<FourierBenchMode, FourierBenchSummary>>> => {
  const summariesByCount = new Map<
    number,
    Partial<Record<FourierBenchMode, FourierBenchSummary>>
  >();

  for (const summary of summaries) {
    normalizeSummary(summary);
    const summariesByMode = summariesByCount.get(summary.count) ?? {};
    summariesByMode[summary.mode] = summary;
    summariesByCount.set(summary.count, summariesByMode);
  }

  return summariesByCount;
};

export const writeBenchReport = (
  webgpuSummaries: FourierBenchSummary[],
  cufftSummaries?: FourierBenchSummary[],
): void => {
  const summariesByCount = collectBenchSummaries(webgpuSummaries);

  if (cufftSummaries !== undefined) {
    for (const summary of cufftSummaries) {
      normalizeSummary(summary);
      const summariesByMode = summariesByCount.get(summary.count) ?? {};
      summariesByMode[summary.mode] = summary;
      summariesByCount.set(summary.count, summariesByMode);
    }
  }

  mkdirSync(outputDirectory, { recursive: true });

  for (const [count, summariesByMode] of [...summariesByCount.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    const summaryKeys = Object.keys(summariesByMode);

    if (summaryKeys.length < 1) {
      continue;
    }

    const [firstSummary] = Object.values(summariesByMode);
    const { timestamp } = firstSummary;

    const filePath = resolve(
      outputDirectory,
      `count${count}_${formatBenchTimestamp(timestamp)}.md`,
    );

    writeFileSync(filePath, formatBenchMarkdown(summariesByMode), 'utf-8');
    console.log(`Wrote ${filePath}`);
  }

  rmSync(tmpCufftJsonPath, { force: true });
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    writeBenchReport([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed:', message);
    process.exit(1);
  }
}
