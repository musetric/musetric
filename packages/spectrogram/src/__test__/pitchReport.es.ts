import { type PitchOverview } from './pitchAccuracy.es.js';
import {
  type PitchLineOverview,
  type PitchLineWindow,
} from './pitchLine.es.js';

const fixed =
  (digits: number) =>
  (value: number): string =>
    value.toFixed(digits);

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const strong = (text: string): string => `**${text}**`;

type Column<Values> = {
  title: string;
  value: (values: Values) => number;
  format: (value: number) => string;
};

const accuracyColumns: Column<PitchOverview>[] = [
  { title: 'rpa', value: (v) => v.rpa, format: fixed(3) },
  { title: 'rca', value: (v) => v.rca, format: fixed(3) },
  { title: 'recall', value: (v) => v.voicingRecall, format: fixed(3) },
  { title: 'false alarm', value: (v) => v.falseAlarm, format: fixed(3) },
  { title: 'bias ¢', value: (v) => v.biasCents, format: fixed(1) },
  { title: 'spread ¢', value: (v) => v.spreadCents, format: fixed(1) },
  { title: 'octave', value: (v) => v.octaveRate, format: fixed(3) },
  { title: 'gap flip', value: (v) => v.gapFlipRate, format: fixed(3) },
  { title: 'note break', value: (v) => v.noteBreakRate, format: fixed(3) },
];

const lineTimeColumns: Column<PitchLineOverview>[] = [
  { title: 'clean', value: (v) => v.cleanShare, format: percent },
  { title: 'missing', value: (v) => v.missingShare, format: percent },
  { title: 'wrong', value: (v) => v.wrongShare, format: percent },
  { title: 'jerky', value: (v) => v.jerkyShare, format: percent },
  { title: 'rattling', value: (v) => v.rattlingShare, format: percent },
  { title: 'rattle ¢', value: (v) => v.rattleCents, format: fixed(1) },
  { title: 'rattle p90 ¢', value: (v) => v.rattleP90Cents, format: fixed(1) },
];

const lineEventColumns: Column<PitchLineOverview>[] = [
  { title: 'steps', value: (v) => v.stepsPerMinute, format: fixed(1) },
  { title: 'leaps', value: (v) => v.leapsPerMinute, format: fixed(1) },
  { title: 'holes', value: (v) => v.holesPerMinute, format: fixed(1) },
  { title: 'long holes', value: (v) => v.longHolesPerMinute, format: fixed(1) },
  { title: 'specks', value: (v) => v.specksPerMinute, format: fixed(1) },
  { title: 'islands', value: (v) => v.islandsPerMinute, format: fixed(1) },
  { title: 'tails', value: (v) => v.tailsPerMinute, format: fixed(1) },
  { title: 'onset ms', value: (v) => v.onsetDelayMs, format: fixed(0) },
  { title: 'onset p90 ms', value: (v) => v.onsetDelayP90Ms, format: fixed(0) },
  { title: 'missed onsets', value: (v) => v.missedOnsetShare, format: percent },
];

const tableOf = <Values>(
  rows: { name: string; values: Values }[],
  columns: Column<Values>[],
): string => {
  const cells = (values: (column: Column<Values>) => string): string =>
    columns.map(values).join(' | ');
  const lines = [
    `| track | ${cells((column) => column.title)} |`,
    `| --- | ${cells(() => '---:')} |`,
    ...rows.map(
      (row) =>
        `| ${row.name} | ${cells((column) => column.format(column.value(row.values)))} |`,
    ),
  ];
  if (rows.length > 1) {
    const mean = (column: Column<Values>): number =>
      rows.reduce((sum, row) => sum + column.value(row.values), 0) /
      rows.length;
    const title = strong(`mean of ${rows.length}`);
    const means = cells((column) => strong(column.format(mean(column))));
    lines.push(`| ${title} | ${means} |`);
  }
  return lines.join('\n');
};

const windowRow = (name: string, window: PitchLineWindow): string => {
  const span = `${window.fromSeconds.toFixed(0)}–${window.toSeconds.toFixed(0)} s`;
  const shares = [
    window.badShare,
    window.missingShare,
    window.wrongShare,
    window.jerkyShare,
    window.rattlingShare,
  ].map(percent);
  return `| ${name} ${span} | ${window.singingSeconds.toFixed(1)} | ${shares.join(' | ')} |`;
};

export type PitchTrackReport = {
  name: string;
  accuracy: PitchOverview;
  line: PitchLineOverview;
  worst: PitchLineWindow[];
};

const worstTable = (reports: PitchTrackReport[], count: number): string => {
  const windows = reports
    .flatMap((report) =>
      report.worst.map((window) => ({ name: report.name, window })),
    )
    .sort((a, b) => b.window.badShare - a.window.badShare)
    .slice(0, count);
  return [
    '| window | singing s | not clean | missing | wrong | jerky | rattling |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...windows.map((entry) => windowRow(entry.name, entry.window)),
  ].join('\n');
};

export const formatPitchReport = (
  reports: PitchTrackReport[],
  worstCount: number,
): string => {
  const rows = <Values>(part: (report: PitchTrackReport) => Values) =>
    reports.map((report) => ({ name: report.name, values: part(report) }));
  return [
    '### Accuracy',
    tableOf(
      rows((report) => report.accuracy),
      accuracyColumns,
    ),
    '### Line: share of the singing time',
    tableOf(
      rows((report) => report.line),
      lineTimeColumns,
    ),
    '### Line: events per minute of singing',
    tableOf(
      rows((report) => report.line),
      lineEventColumns,
    ),
    '### Worst windows',
    worstTable(reports, worstCount),
  ].join('\n\n');
};
