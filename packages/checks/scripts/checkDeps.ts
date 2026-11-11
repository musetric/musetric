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

type Holder = {
  manifest: Manifest;
  range: string;
};

const collectHolders = (
  manifests: Manifest[],
  field: DependencyField,
): Map<string, Holder[]> => {
  const holders = new Map<string, Holder[]>();
  for (const manifest of manifests) {
    for (const [ident, range] of rangesOf(manifest, field)) {
      holders.set(ident, [...(holders.get(ident) ?? []), { manifest, range }]);
    }
  }
  return holders;
};

type Finding = {
  file: string;
  line: number;
  message: string;
};

const checkHolders = (
  field: DependencyField,
  ident: string,
  users: Holder[],
): Finding[] =>
  users.flatMap((user) => {
    const others = users
      .filter((other) => other.range !== user.range)
      .map((other) => `${other.range} in ${other.manifest.file}`);
    return others.length === 0
      ? []
      : [
          {
            file: user.manifest.file,
            line: dependencyLine(user.manifest, field, ident),
            message: `${field} ${ident} is ${user.range} here and ${others.join(', ')}`,
          },
        ];
  });

const checkOneRange = (manifests: Manifest[]): Finding[] => {
  const findings: Finding[] = [];
  for (const field of dependencyFields) {
    for (const [ident, users] of collectHolders(manifests, field)) {
      findings.push(...checkHolders(field, ident, users));
    }
  }
  return findings;
};

const checkPeersOf = (
  manifest: Manifest,
  field: DependencyField,
  workspace: Manifest,
  workspaces: Map<string, Manifest>,
): Finding[] => {
  const findings: Finding[] = [];
  for (const [peer, peerRange] of rangesOf(workspace, 'peerDependencies')) {
    const expected = workspaces.has(peer) ? peerRange : 'catalog:';
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

const checkWorkspacePeers = (manifests: Manifest[]): Finding[] => {
  const workspaces = new Map(
    manifests.map((manifest) => [manifest.name, manifest]),
  );
  const findings: Finding[] = [];
  for (const manifest of manifests) {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      findings.push(...checkConsumer(manifest, field, workspaces));
    }
  }
  return findings;
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

const findings = [
  ...checkOneRange(manifests),
  ...checkWorkspacePeers(manifests),
];

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}: ${finding.message}`);
}
console.log(
  findings.length === 0
    ? 'deps: ok'
    : `deps: ${findings.length} found. Give a dependency the same range in every package.json, and list in a package the peers of the workspace packages it depends on: catalog: for an external peer, the range of the workspace for a workspace peer.`,
);
process.exitCode = findings.length === 0 ? 0 : 1;
