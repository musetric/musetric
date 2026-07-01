/**
 * Workaround for eslint-plugin-sonarjs (as of 4.1.0).
 *
 * SonarJS resolves the `catalog:` protocol by reading catalogs only from a
 * package.json (`catalog`/`catalogs` fields) or a pnpm-workspace.yaml. It does
 * not know about Yarn's `.yarnrc.yml` catalogs, which is where our catalog is
 * defined. As a result it emits an unconditional `console.debug` for every
 * `catalog:` dependency in every workspace, spamming lint stdout.
 *
 * The messages are harmless (SonarJS falls back to the literal version string
 * and still knows the dependency names), so we drop just those lines. Remove
 * this once SonarJS supports Yarn catalogs or gates the log behind a debug flag.
 *
 * See: node_modules/eslint-plugin-sonarjs/cjs/helpers/dependency-manifests/resolvers/package-json.js
 */
let patched = false;

export const silenceSonarjsCatalogLog = (): void => {
  if (patched) {
    return;
  }
  patched = true;

  const original = console.debug.bind(console);
  console.debug = (...args: unknown[]): void => {
    const [first] = args;
    if (
      typeof first === 'string' &&
      first.includes('could not be resolved for catalog')
    ) {
      return;
    }
    original(...args);
  };
};
