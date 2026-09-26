export type ForeignProbeReport =
  | { kind: 'started' }
  | { kind: 'wait'; submittedAt: number; ms: number }
  | { kind: 'failed'; message: string };

const formatMs = (value: number): string => `${value.toFixed(3)}ms`;

const formatCv = (value: number): string => `${value.toFixed(2)}%`;

export type PitchPerfMetric = {
  label: string;
  mean: number;
  cv: number;
  sampleCount: number;
  reference: string | undefined;
};

export type PitchPerfRow = {
  spectrum: string;
  metrics: PitchPerfMetric[];
};

const findMetric = (
  row: PitchPerfRow,
  label: string | undefined,
): PitchPerfMetric | undefined =>
  row.metrics.find((metric) => metric.label === label);

const formatMean = (row: PitchPerfRow, label: string): string => {
  const metric = findMetric(row, label);
  if (!metric) {
    return '-';
  }
  const reference = findMetric(row, metric.reference);
  if (!reference || reference.mean <= 0) {
    return formatMs(metric.mean);
  }
  return `${formatMs(metric.mean)} x${(metric.mean / reference.mean).toFixed(2)}`;
};

export type PitchPerfTable = {
  columns: number;
  frameColumns: number;
  rows: PitchPerfRow[];
};

const tableLabels = (table: PitchPerfTable): string[] => {
  const labels: string[] = [];
  for (const row of table.rows) {
    for (const metric of row.metrics) {
      if (!labels.includes(metric.label)) {
        labels.push(metric.label);
      }
    }
  }
  return labels;
};

const formatKernelTable = (table: PitchPerfTable): string => {
  const labels = tableLabels(table);
  const header = `| spectrum | ${labels.join(' | ')} |`;
  const separator = `| --- | ${labels.map(() => '---').join(' | ')} |`;
  const meanRows = [header, separator];
  const cvRows = [header, separator];
  for (const row of table.rows) {
    const means = labels.map((label) => formatMean(row, label));
    const cvs = labels.map((label) => {
      const metric = findMetric(row, label);
      return metric ? formatCv(metric.cv) : '-';
    });
    meanRows.push(`| ${row.spectrum} | ${means.join(' | ')} |`);
    cvRows.push(`| ${row.spectrum} | ${cvs.join(' | ')} |`);
  }
  return [
    `### ${table.columns} columns, a frame of ${table.frameColumns}`,
    '',
    meanRows.join('\n'),
    '',
    'CV (%)',
    '',
    cvRows.join('\n'),
  ].join('\n');
};

export type PitchPerfProbe = {
  count: number;
  p50: number;
  p95: number;
  worst: number;
};

const formatProbe = (probe: PitchPerfProbe): string =>
  `${probe.p50.toFixed(1)} / ${probe.p95.toFixed(1)} / ${probe.worst.toFixed(1)} ms over ${probe.count} probes`;

export type PitchPerfSample = {
  mean: number;
  cv: number;
};

export type PitchPerfRender = {
  columns: number;
  full: PitchPerfSample;
  frame: PitchPerfSample;
  foreignAlone: PitchPerfProbe;
  foreignFull: PitchPerfProbe;
};

const formatRender = (render: PitchPerfRender): string =>
  [
    `### Render of ${render.columns} columns`,
    '',
    '| | wall | CV |',
    '| --- | --- | --- |',
    `| full | ${formatMs(render.full.mean)} | ${formatCv(render.full.cv)} |`,
    `| playback frame | ${formatMs(render.frame.mean)} | ${formatCv(render.frame.cv)} |`,
    '',
    `Foreign job wait p50 / p95 / worst: alone ${formatProbe(render.foreignAlone)}; during full renders ${formatProbe(render.foreignFull)}.`,
  ].join('\n');

export type PitchPerfResult = {
  kernels: PitchPerfTable[];
  render: PitchPerfRender;
};

export const formatPitchPerfMarkdown = (result: PitchPerfResult): string =>
  [...result.kernels.map(formatKernelTable), formatRender(result.render)].join(
    '\n\n',
  );
