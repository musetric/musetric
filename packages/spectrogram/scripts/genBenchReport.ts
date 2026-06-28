import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBenchTimestamp } from '@musetric/utils';
import {
  formatBenchMarkdown,
  type SpectrogramBenchSummary,
} from '../src/__test__/bench.es.js';

const cwd = process.cwd();
const outputDirectory = resolve(cwd, 'tmp/bench');

const writeBandReport = (
  bandCount: number,
  summaries: SpectrogramBenchSummary[],
): void => {
  if (summaries.length < 1) {
    return;
  }
  const [first] = summaries;
  const filePath = resolve(
    outputDirectory,
    `band${bandCount}_${formatBenchTimestamp(first.timestamp)}.md`,
  );
  writeFileSync(filePath, formatBenchMarkdown(summaries), 'utf-8');
  console.log(`Wrote ${filePath}`);
};

export const writeBenchReports = (
  summaries: SpectrogramBenchSummary[],
): void => {
  if (summaries.length < 1) {
    console.log('No benchmark summaries collected');
    return;
  }

  mkdirSync(outputDirectory, { recursive: true });

  const byBand = new Map<number, SpectrogramBenchSummary[]>();
  for (const summary of summaries) {
    const list = byBand.get(summary.bandCount) ?? [];
    list.push(summary);
    byBand.set(summary.bandCount, list);
  }

  const bandCounts = [...byBand.keys()].sort((a, b) => a - b);
  for (const bandCount of bandCounts) {
    const bandSummaries = byBand.get(bandCount);
    if (bandSummaries !== undefined) {
      writeBandReport(bandCount, bandSummaries);
    }
  }
};

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  try {
    writeBenchReports([]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed:', message);
    process.exit(1);
  }
}
