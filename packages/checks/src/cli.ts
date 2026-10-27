#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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

const scriptDirective =
  '^(//|/\\*)\\s*(eslint-|global\\s|globals\\s|exported\\s|@ts-(expect-error|ignore|nocheck|check)|/\\s*<reference|@(see|todo|fixme)(\\s|$))';

const pythonDirective =
  '^#(!|\\s*(noqa|ruff:|type:|fmt:|isort:|pragma|pyright:|mypy:))';

const comment = ['comment'];

type AstGrepRule = {
  id: string;
  language: string;
  rule: Record<string, unknown>;
  files?: string[];
};

const commentRule = (
  language: string,
  kinds: string[],
  allowed?: string,
): AstGrepRule => ({
  id: 'comment',
  language,
  rule: {
    any: kinds.map((kind) => ({ kind })),
    ...(allowed === undefined ? {} : { not: { regex: allowed } }),
  },
});

const astGrepRules: AstGrepRule[] = [
  commentRule('TypeScript', comment, scriptDirective),
  commentRule('Tsx', comment, scriptDirective),
  commentRule('JavaScript', comment, scriptDirective),
  commentRule('Rust', ['line_comment', 'block_comment']),
  commentRule('Python', comment, pythonDirective),
  commentRule('Yaml', comment),
  commentRule('Kotlin', ['line_comment', 'multiline_comment']),
  commentRule('Swift', ['comment', 'multiline_comment'], '^//\\s*swift-tools'),
  commentRule('Bash', comment, '^#(!|\\s*shellcheck\\s)'),
  commentRule('Css', comment),
  commentRule('Html', comment),
  commentRule('Json', comment),
  {
    id: 'wgsl-comment',
    language: 'TypeScript',
    files: ['**/*.wgsl.ts'],
    rule: {
      kind: 'string_fragment',
      inside: { kind: 'template_string' },
      regex: '//|/\\*',
    },
  },
  {
    id: 'docstring',
    language: 'Python',
    rule: {
      kind: 'string',
      inside: {
        kind: 'expression_statement',
        nthChild: { position: 1, ofRule: { not: { kind: 'comment' } } },
        inside: { any: [{ kind: 'module' }, { kind: 'block' }] },
      },
    },
  },
];

const inlineRules = astGrepRules
  .map((entry) =>
    JSON.stringify({
      ...entry,
      id: `${entry.id}-${entry.language.toLowerCase()}`,
      severity: 'warning',
      message: entry.id,
    }),
  )
  .join('\n---\n');

const astGrepBinary = (): string =>
  join(
    dirname(
      createRequire(import.meta.url).resolve('@ast-grep/cli/package.json'),
    ),
    process.platform === 'win32' ? 'ast-grep.exe' : 'ast-grep',
  );

const chunkPaths = (paths: string[], limit: number): string[][] =>
  paths.reduce<string[][]>((chunks, path) => {
    const last = chunks.at(-1);
    if (last && last.join(' ').length + path.length < limit) {
      last.push(path);
      return chunks;
    }
    return [...chunks, [path]];
  }, []);

const readStartLine = (range: unknown): number => {
  if (
    typeof range !== 'object' ||
    !range ||
    !('start' in range) ||
    typeof range.start !== 'object' ||
    !range.start ||
    !('line' in range.start) ||
    typeof range.start.line !== 'number'
  ) {
    throw new Error('ast-grep printed a finding without its start line');
  }
  return range.start.line;
};

const linesBeforeComment = (text: string): number =>
  text.slice(0, text.search(/\/\/|\/\*/)).split('\n').length - 1;

const readAstGrepFinding = (line: string): Finding => {
  const raw: unknown = JSON.parse(line);
  if (
    typeof raw !== 'object' ||
    !raw ||
    !('file' in raw) ||
    typeof raw.file !== 'string' ||
    !('ruleId' in raw) ||
    typeof raw.ruleId !== 'string' ||
    !('text' in raw) ||
    typeof raw.text !== 'string' ||
    !('range' in raw)
  ) {
    throw new Error(`ast-grep printed an unexpected finding: ${line}`);
  }
  const offset = raw.ruleId.startsWith('wgsl')
    ? linesBeforeComment(raw.text)
    : 0;
  return {
    file: raw.file.replaceAll('\\', '/'),
    line: readStartLine(raw.range) + 1 + offset,
    message: raw.ruleId.startsWith('docstring') ? 'a docstring' : 'a comment',
  };
};

const scanWithAstGrep = (files: string[]): Finding[] =>
  chunkPaths(files, 20_000).flatMap((chunk) => {
    const result = spawnSync(
      astGrepBinary(),
      ['scan', '--inline-rules', inlineRules, '--json=stream', ...chunk],
      { encoding: 'utf8', maxBuffer: 1 << 28 },
    );
    if (result.error || result.stderr.trim() !== '') {
      throw new Error(`ast-grep failed: ${result.error ?? result.stderr}`);
    }
    return result.stdout
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map(readAstGrepFinding);
  });

const tomlString =
  /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g;

type LineFormat = {
  file: RegExp;
  comment: RegExp;
  strings?: RegExp;
};

const lineFormats: LineFormat[] = [
  { file: /\.toml$/, comment: /#/, strings: tomlString },
  {
    file: /(^|\/)(\.gitignore|\.gitattributes|\.prettierignore|\.npmignore|\.dockerignore|CODEOWNERS)$/,
    comment: /^\s*#/,
  },
  { file: /(^|\/)requirements[^/]*\.txt$/, comment: /(^|\s)#/ },
  { file: /(^|\/)\.editorconfig$/, comment: /^\s*[#;]/ },
  { file: /\.(svg|xml|storyboard|xib|plist)$/, comment: /<!--/ },
];

const blankStrings = (text: string, strings: RegExp | undefined): string =>
  strings === undefined
    ? text
    : text.replace(strings, (match) => match.replace(/[^\n]/g, ' '));

const scanLineFormats = (files: string[]): Finding[] =>
  files.flatMap((file) => {
    const format = lineFormats.find((entry) => entry.file.test(file));
    if (format === undefined) {
      return [];
    }
    return blankStrings(readLines(file).join('\n'), format.strings)
      .split('\n')
      .flatMap((text, index) =>
        format.comment.test(text)
          ? [{ file, line: index + 1, message: 'a comment' }]
          : [],
      );
  });

const checkComments = (files: string[], section: Section): Finding[] => {
  const scanned = files.filter((file) => !isExcepted(file, section));
  return [...scanWithAstGrep(scanned), ...scanLineFormats(scanned)];
};

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
    [
      'comments',
      {
        run: (files) =>
          checkComments(files, readSection(rawChecks, 'comments')),
        advice:
          'Say it with names and types, or in the pull request, its issue or the commit message; a tool directive may stay. List third-party code in checks.comments.except of package.json.',
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
