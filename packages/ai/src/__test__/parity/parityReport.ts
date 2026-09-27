import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isParityStep, type ParityStep, wasmRuns } from './parityCases.js';
import {
  type ParityManifest,
  type ParityManifestTensor,
  readManifest,
  readManifestGpu,
  readTensorValues,
} from './parityFiles.js';
import {
  measureTensors,
  type ParityMeasure,
  type ParityTensor,
  type ParityThreshold,
  type ParityValue,
  passes,
  phoneThreshold,
} from './parityMeasure.js';

const deviceSources = new Set(['wasm', 'webgpu', 'product']);

const loadTensor = (
  dir: string,
  tensor: ParityManifestTensor | undefined,
): ParityTensor | undefined =>
  tensor && existsSync(resolve(dir, tensor.file))
    ? {
        dtype: tensor.dtype,
        shape: tensor.shape,
        values: readTensorValues(resolve(dir, tensor.file), tensor),
      }
    : undefined;

type LoadedCase = {
  dir: string;
  toolkit: ParityManifest;
  devices: Map<string, ParityManifest>;
};

const sourceTensor = (
  loaded: LoadedCase,
  device: string,
  key: string,
): ParityTensor | undefined => {
  const source = key.split('@')[1] ?? '';
  if (!deviceSources.has(source)) {
    return loadTensor(loaded.dir, loaded.toolkit.tensors[key]);
  }
  const manifest = loaded.devices.get(device);
  return loadTensor(resolve(loaded.dir, device), manifest?.tensors[key]);
};

export type ParityCheck = {
  row: number;
  boundary: string;
  reference: string;
  candidate: string;
  measure: ParityMeasure;
  weights?: string;
  tolerance?: number;
  atLeast?: number;
  atMost?: number;
};

const measureCell = (
  loaded: LoadedCase,
  check: ParityCheck,
  device: string,
): ParityValue => {
  const reference = sourceTensor(
    loaded,
    device,
    `${check.boundary}@${check.reference}`,
  );
  const candidate = sourceTensor(
    loaded,
    device,
    `${check.boundary}@${check.candidate}`,
  );
  if (!reference || !candidate) {
    return { kind: 'invalid', reason: 'missing' };
  }
  const weights =
    check.weights === undefined
      ? undefined
      : sourceTensor(loaded, device, check.weights);
  if (check.weights !== undefined && !weights) {
    return { kind: 'invalid', reason: `missing ${check.weights}` };
  }
  return measureTensors({
    measure: check.measure,
    reference,
    candidate,
    weights,
    tolerance: check.tolerance,
  });
};

const isDecibel = (check: ParityCheck): boolean =>
  check.measure === 'snr' || check.measure === 'weightedSnr';

export type ParityChecksFile = {
  marginDb: number;
  desktop: string;
  checks: Record<string, ParityCheck[]>;
};

type RowContext = {
  loaded: LoadedCase;
  step: ParityStep;
  checks: ParityChecksFile;
  devices: string[];
};

export type ParityCell = {
  device: string;
  value: ParityValue;
  threshold: ParityThreshold;
  passed: boolean;
};

export type ParityRow = {
  check: ParityCheck;
  cells: ParityCell[];
};

const buildRow = (context: RowContext, check: ParityCheck): ParityRow => {
  const declared: ParityThreshold = {
    atLeast: check.atLeast,
    atMost: check.atMost,
  };
  if (!deviceSources.has(check.candidate)) {
    const value = measureCell(context.loaded, check, '');
    return {
      check,
      cells: [
        {
          device: 'toolkit',
          value,
          threshold: declared,
          passed: value.kind === 'value' && passes(value.value, declared),
        },
      ],
    };
  }
  const devices =
    check.candidate === 'wasm'
      ? context.devices.filter((device) =>
          wasmRuns(context.step, device === context.checks.desktop),
        )
      : context.devices;
  const desktopValue = measureCell(
    context.loaded,
    check,
    context.checks.desktop,
  );
  const cells = devices.map((device): ParityCell => {
    const value =
      device === context.checks.desktop
        ? desktopValue
        : measureCell(context.loaded, check, device);
    const threshold =
      device !== context.checks.desktop &&
      isDecibel(check) &&
      desktopValue.kind === 'value'
        ? phoneThreshold({
            desktop: desktopValue.value,
            marginDb: context.checks.marginDb,
          })
        : declared;
    return {
      device,
      value,
      threshold,
      passed: value.kind === 'value' && passes(value.value, threshold),
    };
  });
  return { check, cells };
};

export type ParityReportRequest = {
  outDir: string;
  caseName: string;
  devices: string[];
  checks: ParityChecksFile;
};

export type ParityCaseReport = {
  name: string;
  step: string;
  gpus: Record<string, string>;
  rows: ParityRow[];
};

export const reportCase = (request: ParityReportRequest): ParityCaseReport => {
  const dir = resolve(request.outDir, 'cases', request.caseName);
  const toolkit = readManifest(resolve(dir, 'manifest.json'));
  const devices = new Map<string, ParityManifest>();
  const gpus: Record<string, string> = {};
  for (const device of request.devices) {
    const path = resolve(dir, device, 'manifest.json');
    if (existsSync(path)) {
      devices.set(device, readManifest(path));
      gpus[device] = readManifestGpu(path);
    }
  }
  const { step } = toolkit;
  if (!isParityStep(step)) {
    throw new Error(`${request.caseName} is of an unknown step ${step}`);
  }
  const context: RowContext = {
    loaded: { dir, toolkit, devices },
    step,
    checks: request.checks,
    devices: request.devices,
  };
  return {
    name: request.caseName,
    step,
    gpus,
    rows: (request.checks.checks[step] ?? []).map((check) =>
      buildRow(context, check),
    ),
  };
};

const formats: Record<ParityMeasure, (value: number) => string> = {
  snr: (value) => `${value.toFixed(1)} dB`,
  weightedSnr: (value) => `${value.toFixed(1)} dB`,
  maxAbs: (value) => value.toExponential(2),
  differing: String,
  argmaxDiffering: String,
  agreement: (value) => value.toFixed(3),
  fMeasure: (value) => value.toFixed(3),
  tokenErrorRate: (value) => value.toFixed(3),
  timeOffset: (value) => `${value.toFixed(2)} s`,
};

const formatValue = (cell: ParityCell, check: ParityCheck): string =>
  cell.value.kind === 'invalid'
    ? `✗ ${cell.value.reason}`
    : `${cell.passed ? '✓' : '✗'} ${formats[check.measure](cell.value.value)}`;

const formatThreshold = (
  threshold: ParityThreshold,
  measure: ParityMeasure,
): string =>
  [
    threshold.atLeast === undefined
      ? ''
      : `≥ ${formats[measure](threshold.atLeast)}`,
    threshold.atMost === undefined
      ? ''
      : `≤ ${formats[measure](threshold.atMost)}`,
  ]
    .filter((part) => part !== '')
    .join(', ');

export const formatReport = (
  reports: ParityCaseReport[],
  devices: string[],
): string => {
  const lines: string[] = [];
  for (const report of reports) {
    lines.push(`### ${report.name} (${report.step})`, '');
    for (const [device, gpu] of Object.entries(report.gpus)) {
      lines.push(`- ${device}: ${gpu}`);
    }
    lines.push(
      '',
      `| Row | Boundary | Candidate vs reference | Measure | Toolkit | ${devices.join(' | ')} |`,
      `| --- | --- | --- | --- | --- |${devices.map(() => ' --- |').join('')}`,
    );
    for (const row of report.rows) {
      const cell = (device: string): string => {
        const found = row.cells.find(
          (candidate) => candidate.device === device,
        );
        return found
          ? `${formatValue(found, row.check)} (${formatThreshold(found.threshold, row.check.measure)})`
          : '';
      };
      lines.push(
        `| ${row.check.row} | ${row.check.boundary} | ${row.check.candidate} vs ${row.check.reference} | ${row.check.measure} | ${cell('toolkit')} | ${devices.map(cell).join(' | ')} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
};
