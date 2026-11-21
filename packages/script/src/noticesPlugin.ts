import { writeFileSync } from 'node:fs';
import license from 'rollup-plugin-license';
import { type Plugin } from 'vite';

const ownScope = '@musetric/';

const source = (dependency: license.Dependency): string => {
  const { repository, homepage } = dependency;
  if (typeof repository === 'string') {
    return repository;
  }
  return repository?.url ?? homepage ?? 'not given';
};

const fence = (text: string): string =>
  ['````text', text.trim(), '````'].join('\n');

const renderDependency = (dependency: license.Dependency): string =>
  [
    `## ${dependency.name} ${dependency.version}`,
    [
      `- License: ${dependency.license ?? 'not given'}`,
      `- Source: ${source(dependency)}`,
    ].join('\n'),
    fence(dependency.licenseText ?? 'The package ships no license file.'),
    ...(dependency.noticeText ? [fence(dependency.noticeText)] : []),
  ].join('\n\n');

const render = (dependencies: license.Dependency[]): string =>
  [
    '# Notices of packages',
    'The npm packages compiled into this bundle, each under the license given for it, as rollup-plugin-license finds them. `pnpm fix:notices` writes this file again.',
    ...dependencies
      .filter((dependency) => dependency.name?.startsWith(ownScope) === false)
      .toSorted((left, right) =>
        `${left.name}@${left.version}`.localeCompare(
          `${right.name}@${right.version}`,
          'en',
        ),
      )
      .map(renderDependency),
  ].join('\n\n') + '\n';

const allowedLicenses =
  '(MIT OR Apache-2.0 OR ISC OR BSD-2-Clause OR BSD-3-Clause OR 0BSD OR Zlib OR MPL-2.0 OR CC0-1.0 OR Unlicense OR BlueOak-1.0.0 OR OFL-1.1)';

export const notices = (file: string): Plugin =>
  license({
    thirdParty: {
      multipleVersions: true,
      allow: {
        test: allowedLicenses,
        failOnUnlicensed: true,
        failOnViolation: true,
      },
      output: (dependencies) => {
        writeFileSync(file, render(dependencies));
      },
    },
  });
