import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatBenchMarkdown,
  formatBenchTimestamp,
  type FourierBenchDirection,
  type FourierBenchMode,
  type FourierBenchSummary,
} from '../src/fourier/__test__/bench.es.js';

const cwd = process.cwd();
const tmpCufftJsonPath = resolve(cwd, '.bench-cufft.json');
const outputDirectory = resolve(cwd, 'tmp/bench');

type BenchGroup = {
  direction: FourierBenchDirection;
  count: number;
  summariesByMode: Partial<Record<FourierBenchMode, FourierBenchSummary>>;
};

const directionPrefix: Record<FourierBenchDirection, string> = {
  forward: 'f',
  inverse: 'i',
};

const groupKey = (summary: FourierBenchSummary): string =>
  `${summary.direction}_${summary.count}`;

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
): Map<string, BenchGroup> => {
  const groups = new Map<string, BenchGroup>();

  for (const summary of summaries) {
    normalizeSummary(summary);
    const key = groupKey(summary);
    const group = groups.get(key) ?? {
      direction: summary.direction,
      count: summary.count,
      summariesByMode: {},
    };
    group.summariesByMode[summary.mode] = summary;
    groups.set(key, group);
  }

  return groups;
};

export const writeBenchReport = (
  webgpuSummaries: FourierBenchSummary[],
  cufftSummaries?: FourierBenchSummary[],
): void => {
  const groups = collectBenchSummaries([
    ...webgpuSummaries,
    ...(cufftSummaries ?? []),
  ]);

  mkdirSync(outputDirectory, { recursive: true });

  const sortedGroups = [...groups.values()].sort(
    (left, right) =>
      left.direction.localeCompare(right.direction) || left.count - right.count,
  );

  for (const { direction, count, summariesByMode } of sortedGroups) {
    if (Object.keys(summariesByMode).length < 1) {
      continue;
    }

    const [firstSummary] = Object.values(summariesByMode);
    const { timestamp } = firstSummary;

    const filePath = resolve(
      outputDirectory,
      `${directionPrefix[direction]}count${count}_${formatBenchTimestamp(timestamp)}.md`,
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
