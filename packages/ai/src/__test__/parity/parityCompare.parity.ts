import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inject, it } from 'vitest';
import {
  formatReport,
  type ParityChecksFile,
  reportCase,
} from './parityReport.js';

type ParityCompareRequest = {
  outDir: string;
  cases: string[];
  devices: string[];
  checks: ParityChecksFile;
};

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface ProvidedContext {
    parityCompare?: ParityCompareRequest;
  }
}

declare module '@vitest/runner' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface TaskMeta {
    parityCompare?: string;
    parityFailed?: number;
  }
}

const keepNonFinite = (_key: string, value: unknown): unknown =>
  typeof value === 'number' && !Number.isFinite(value) ? String(value) : value;

it('compares every boundary with its threshold', (context) => {
  const request = inject('parityCompare');
  if (!request) {
    return;
  }
  const reports = request.cases.map((caseName) =>
    reportCase({
      outDir: request.outDir,
      caseName,
      devices: request.devices,
      checks: request.checks,
    }),
  );
  const markdown = formatReport(reports, request.devices);
  writeFileSync(resolve(request.outDir, 'report.md'), markdown + '\n');
  writeFileSync(
    resolve(request.outDir, 'report.json'),
    JSON.stringify(reports, keepNonFinite, 2) + '\n',
  );
  context.task.meta.parityCompare = markdown;
  context.task.meta.parityFailed = reports
    .flatMap((report) => report.rows.flatMap((row) => row.cells))
    .filter((cell) => !cell.passed).length;
});
