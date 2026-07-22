// @see node_modules/eslint-plugin-sonarjs/cjs/helpers/dependency-manifests/resolvers/package-json.js
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
