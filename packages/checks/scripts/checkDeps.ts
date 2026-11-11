import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const dependencyFields = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const;

type DependencyField = (typeof dependencyFields)[number];

const readRanges = (
  file: string,
  rawPackage: object,
  field: DependencyField,
): Map<string, string> => {
  const ranges = new Map<string, string>();
  const rawField: unknown = Object.entries(rawPackage).find(
    (entry) => entry[0] === field,
  )?.[1];
  if (rawField === undefined) {
    return ranges;
  }
  if (typeof rawField !== 'object' || !rawField) {
    throw new Error(`${file}: ${field} must map names to ranges`);
  }
  for (const entry of Object.entries(rawField)) {
    const [ident, range]: [string, unknown] = entry;
    if (typeof range !== 'string') {
      throw new Error(`${file}: ${field}.${ident} must be a range`);
    }
    ranges.set(ident, range);
  }
  return ranges;
};

type Manifest = {
  file: string;
  name: string;
  lines: string[];
  ranges: Map<DependencyField, Map<string, string>>;
};

const readManifest = (file: string): Manifest => {
  const text = readFileSync(file, 'utf8');
  const rawPackage: unknown = JSON.parse(text);
  if (
    typeof rawPackage !== 'object' ||
    !rawPackage ||
    !('name' in rawPackage) ||
    typeof rawPackage.name !== 'string'
  ) {
    throw new Error(`${file}: a package needs a name`);
  }
  const ranges = new Map<DependencyField, Map<string, string>>();
  for (const field of dependencyFields) {
    ranges.set(field, readRanges(file, rawPackage, field));
  }
  return { file, name: rawPackage.name, lines: text.split('\n'), ranges };
};

const rangesOf = (
  manifest: Manifest,
  field: DependencyField,
): Map<string, string> => manifest.ranges.get(field) ?? new Map();

const dependencyLine = (
  manifest: Manifest,
  field: DependencyField,
  ident: string,
): number => {
  const fieldIndex = manifest.lines.findIndex((text) =>
    text.trimStart().startsWith(`"${field}":`),
  );
  const index = manifest.lines.findIndex(
    (text, position) =>
      position > fieldIndex && text.trimStart().startsWith(`"${ident}":`),
  );
  return index === -1 ? 1 : index + 1;
};

const fieldLine = (manifest: Manifest, field: DependencyField): number =>
  manifest.lines.findIndex((text) =>
    text.trimStart().startsWith(`"${field}":`),
  ) + 1;

const catalogRange = 'catalog:';
const workspaceRange = 'workspace:*';

const expectedRange = (
  ident: string,
  workspaces: Map<string, Manifest>,
): string => (workspaces.has(ident) ? workspaceRange : catalogRange);

type Finding = {
  file: string;
  line: number;
  message: string;
};

const checkFieldRanges = (
  manifest: Manifest,
  field: DependencyField,
  workspaces: Map<string, Manifest>,
): Finding[] =>
  [...rangesOf(manifest, field)].flatMap((entry) => {
    const [ident, range] = entry;
    const expected = expectedRange(ident, workspaces);
    return range === expected
      ? []
      : [
          {
            file: manifest.file,
            line: dependencyLine(manifest, field, ident),
            message: `${field} ${ident} is ${range}, not ${expected}`,
          },
        ];
  });

const checkRanges = (
  manifests: Manifest[],
  workspaces: Map<string, Manifest>,
): Finding[] =>
  manifests.flatMap((manifest) =>
    dependencyFields.flatMap((field) =>
      checkFieldRanges(manifest, field, workspaces),
    ),
  );

const dependencyOwners = new Set([
  '@musetric/eslint-config',
  '@musetric/checks',
]);

const checkDependencyOwners = (manifests: Manifest[]): Finding[] =>
  manifests
    .filter(
      (manifest) =>
        rangesOf(manifest, 'dependencies').size > 0 &&
        !dependencyOwners.has(manifest.name),
    )
    .map((manifest) => ({
      file: manifest.file,
      line: fieldLine(manifest, 'dependencies'),
      message: `${manifest.name} has dependencies, which only ${[...dependencyOwners].join(' and ')} ship`,
    }));

const checkPeersOf = (
  manifest: Manifest,
  field: DependencyField,
  workspace: Manifest,
  workspaces: Map<string, Manifest>,
): Finding[] => {
  const findings: Finding[] = [];
  for (const peer of rangesOf(workspace, 'peerDependencies').keys()) {
    const expected = expectedRange(peer, workspaces);
    if (
      peer !== workspace.name &&
      rangesOf(manifest, field).get(peer) !== expected
    ) {
      findings.push({
        file: manifest.file,
        line: dependencyLine(manifest, field, workspace.name),
        message: `${field} ${peer} must be ${expected}, since ${workspace.name} takes it as a peer`,
      });
    }
  }
  return findings;
};

const checkConsumer = (
  manifest: Manifest,
  field: DependencyField,
  workspaces: Map<string, Manifest>,
): Finding[] =>
  [...rangesOf(manifest, field).keys()].flatMap((ident) => {
    const workspace = workspaces.get(ident);
    return workspace === undefined || workspace === manifest
      ? []
      : checkPeersOf(manifest, field, workspace, workspaces);
  });

const checkWorkspacePeers = (
  manifests: Manifest[],
  workspaces: Map<string, Manifest>,
): Finding[] => {
  const findings: Finding[] = [];
  for (const manifest of manifests) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      findings.push(...checkConsumer(manifest, field, workspaces));
    }
  }
  return findings;
};

const workspaceFile = 'pnpm-workspace.yaml';

const checkOverrides = (): Finding[] => {
  if (!existsSync(workspaceFile)) {
    return [];
  }
  const lines = readFileSync(workspaceFile, 'utf8').split('\n');
  const start = lines.indexOf('overrides:') + 1;
  if (start === 0) {
    return [];
  }
  const end = lines.findIndex(
    (text, index) => index >= start && !text.startsWith('  '),
  );
  return lines
    .slice(start, end === -1 ? lines.length : end)
    .flatMap((text, offset) => {
      const [, ident = '', range = ''] =
        /^ {2}'?([^':]+)'?: '?([^']*)'?$/.exec(text) ?? [];
      return range === catalogRange
        ? []
        : [
            {
              file: workspaceFile,
              line: start + offset + 1,
              message: `overrides ${ident} is ${range}, not ${catalogRange}`,
            },
          ];
    });
};

const manifests = execFileSync(
  'git',
  ['ls-files', '-z', '--', '*package.json'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter((file) => basename(file) === 'package.json' && existsSync(file))
  .map(readManifest);

const workspaces = new Map(
  manifests.map((manifest) => [manifest.name, manifest]),
);

const findings = [
  ...checkRanges(manifests, workspaces),
  ...checkDependencyOwners(manifests),
  ...checkWorkspacePeers(manifests, workspaces),
  ...checkOverrides(),
];

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}: ${finding.message}`);
}
console.log(
  findings.length === 0
    ? 'deps: ok'
    : `deps: ${findings.length} found. Take a version from the catalog with catalog: in every dependency, peer and override, and a workspace package with workspace:*. Only ${[...dependencyOwners].join(' and ')} ship dependencies; another package lists peerDependencies and devDependencies, and lists the peers of the workspace packages it depends on.`,
);
process.exitCode = findings.length === 0 ? 0 : 1;
