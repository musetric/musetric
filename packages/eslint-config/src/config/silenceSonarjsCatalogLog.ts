// @see node_modules/eslint-plugin-sonarjs/cjs/helpers/dependency-manifests/resolvers/package-json.js
const createSonarjsCatalogLogSilencer = () => {
  let patched = false;

  return (): void => {
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
};

export const silenceSonarjsCatalogLog = createSonarjsCatalogLogSilencer();
