#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, matchesGlob } from 'node:path';

type Section = {
  except: string[];
};

const readSection = (rawChecks: unknown, name: string): Section => {
  const rawSection: unknown =
    typeof rawChecks === 'object' && rawChecks
      ? Object.entries(rawChecks).find((entry) => entry[0] === name)?.[1]
      : undefined;
  if (rawSection === undefined) {
    return { except: [] };
  }
  if (
    typeof rawSection !== 'object' ||
    !rawSection ||
    !('except' in rawSection) ||
    !Array.isArray(rawSection.except)
  ) {
    throw new Error(
      `package.json: checks.${name} must be { "except": [glob, ...] }`,
    );
  }
  const rawItems: unknown[] = rawSection.except;
  const except = rawItems.filter(
    (rawItem): rawItem is string => typeof rawItem === 'string',
  );
  if (except.length !== rawItems.length) {
    throw new Error(`package.json: checks.${name}.except lists globs only`);
  }
  return { except };
};

const readChecksConfig = (): unknown => {
  const rawPackage: unknown = JSON.parse(readFileSync('package.json', 'utf8'));
  return typeof rawPackage === 'object' && rawPackage && 'checks' in rawPackage
    ? rawPackage.checks
    : undefined;
};

const listFiles = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '' && existsSync(file));

const isExcepted = (file: string, section: Section): boolean =>
  section.except.some((glob) => matchesGlob(file, glob));

const readLines = (file: string): string[] => {
  const bytes = readFileSync(file);
  return bytes.includes(0) ? [] : bytes.toString('utf8').split('\n');
};

const foreignLetter = /(?=\p{L})\P{ASCII}/u;

type Finding = {
  file: string;
  line: number;
  message: string;
};

const checkEnglish = (files: string[], section: Section): Finding[] =>
  files
    .filter((file) => !isExcepted(file, section))
    .flatMap((file) =>
      readLines(file).flatMap((text, index) => {
        const letter = foreignLetter.exec(text)?.[0];
        return letter === undefined
          ? []
          : [
              {
                file,
                line: index + 1,
                message: `the letter ${letter} is outside the English alphabet`,
              },
            ];
      }),
    );

const noticesFile = 'thirdPartyNotices.md';

const checkNotices = (files: string[]): Finding[] =>
  files
    .filter((file) => file === noticesFile)
    .flatMap((file) =>
      readLines(file).flatMap((text, index) =>
        text.startsWith('- Local files:')
          ? [...text.matchAll(/`([^`]+)`/g)]
              .map((match) => match[1])
              .filter((path) => !existsSync(path))
              .map((path) => ({
                file,
                line: index + 1,
                message: `${path} does not exist`,
              }))
          : [],
      ),
    );

const linkTarget = (destination: string): string => {
  const [path] = destination.split(/[#?]/);
  return path;
};

const resolvesLink = (file: string, target: string): boolean =>
  existsSync(
    target.startsWith('/') ? `.${target}` : join(dirname(file), target),
  );

const linkPatterns = [
  /\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g,
  /^\[[^\]]+\]:\s+(\S+)/gm,
];

const checkLinks = (files: string[], section: Section): Finding[] =>
  files
    .filter((file) => file.endsWith('.md') && !isExcepted(file, section))
    .flatMap((file) =>
      readLines(file).flatMap((text, index) =>
        linkPatterns
          .flatMap((pattern) => [...text.matchAll(pattern)])
          .map((match) => linkTarget(match[1]))
          .filter(
            (target) =>
              target !== '' &&
              !/^[a-z][a-z\d+.-]*:/i.test(target) &&
              !resolvesLink(file, target),
          )
          .map((target) => ({
            file,
            line: index + 1,
            message: `the link to ${target} does not resolve`,
          })),
      ),
    );

type Check = {
  run: (files: string[]) => Finding[];
  advice: string;
};

const createChecks = (rawChecks: unknown): Map<string, Check> =>
  new Map([
    [
      'english',
      {
        run: (files) => checkEnglish(files, readSection(rawChecks, 'english')),
        advice:
          'Write it in English. Where another language is part of what a file means, such as multilingual data and its tests, a copy of a license, third-party code or translated values, list the file in checks.english.except of package.json.',
      },
    ],
    [
      'notices',
      {
        run: checkNotices,
        advice: `Name in ${noticesFile} the files that exist now.`,
      },
    ],
    [
      'links',
      {
        run: (files) => checkLinks(files, readSection(rawChecks, 'links')),
        advice:
          'Point the link at a file of the repository, or list a page whose links are not files of the repository in checks.links.except of package.json.',
      },
    ],
  ]);

const [name = ''] = process.argv.slice(2);
const checks = createChecks(readChecksConfig());
const check = checks.get(name);

if (check === undefined) {
  console.log(`Usage: musetric-checks <${[...checks.keys()].join('|')}>`);
  process.exitCode = 2;
} else {
  const findings = check.run(listFiles());
  for (const finding of findings) {
    console.log(`${finding.file}:${finding.line}: ${finding.message}`);
  }
  console.log(
    findings.length === 0
      ? `${name}: ok`
      : `${name}: ${findings.length} found. ${check.advice}`,
  );
  process.exitCode = findings.length === 0 ? 0 : 1;
}
