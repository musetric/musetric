#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { API, type Diagnostic } from '@typescript/native/sync';

const advice =
  'Replace the deprecated API with the one its documentation names, as the editor shows where it strikes the name through.';

const listSolutions = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => basename(file) === 'tsconfig.json');

const toConfigFile = (base: string, reference: string): string => {
  const target = resolve(base, reference);
  return target.endsWith('.json') ? target : join(target, 'tsconfig.json');
};

const readReferences = (configFile: string): string[] => {
  const rawConfig: unknown = JSON.parse(readFileSync(configFile, 'utf8'));
  const rawReferences: unknown[] =
    typeof rawConfig === 'object' &&
    rawConfig &&
    'references' in rawConfig &&
    Array.isArray(rawConfig.references)
      ? rawConfig.references
      : [];
  return rawReferences.map((rawReference) => {
    if (
      typeof rawReference !== 'object' ||
      !rawReference ||
      !('path' in rawReference) ||
      typeof rawReference.path !== 'string'
    ) {
      throw new Error(`${configFile}: a reference must be { "path": string }`);
    }
    return toConfigFile(dirname(configFile), rawReference.path);
  });
};

type Finding = {
  file: string;
  line: number;
  message: string;
};

const toFinding = (diagnostic: Diagnostic): Finding => {
  const { fileName, startPosition, text } = diagnostic;
  if (fileName === undefined || startPosition === undefined) {
    throw new Error(`tsgo reported '${text}' without a position`);
  }
  return {
    file: relative(process.cwd(), fileName).split(sep).join('/'),
    line: startPosition.line + 1,
    message: text,
  };
};

const checkSolution = (api: API, solutionPath: string): Finding[] => {
  const solution = resolve(solutionPath);
  const references = readReferences(solution);
  const configs = references.length > 0 ? references : [solution];
  const snapshot = api.createSnapshot({
    openProjects: configs,
    ensurePrograms: true,
  });
  const checked = new Set<string>();
  const findings = configs.flatMap((config) => {
    const project = snapshot.getConfiguredProject(config);
    if (!project) {
      throw new Error(`${config}: tsgo opened no project`);
    }
    const files = project.parsedCommandLine.fileNames.filter(
      (file) => !checked.has(file),
    );
    for (const file of files) {
      checked.add(file);
    }
    return files.length === 0
      ? []
      : project.program
          .getSuggestionDiagnostics(files)
          .filter((diagnostic) => diagnostic.reportsDeprecated)
          .map(toFinding);
  });
  snapshot.dispose();
  return findings;
};

const api = new API({ cwd: process.cwd() });
const findings = listSolutions().flatMap((solution) =>
  checkSolution(api, solution),
);
api.close();

for (const finding of findings) {
  console.log(`${finding.file}:${finding.line}: ${finding.message}`);
}
console.log(
  findings.length === 0
    ? 'deprecated: ok'
    : `deprecated: ${findings.length} found. ${advice}`,
);
process.exitCode = findings.length === 0 ? 0 : 1;
