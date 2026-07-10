# Musetric

## Context

- This repository is a Yarn monorepo. Use `yarn@4.17.1`.
- Prefer existing Yarn scripts from the root or the target package `package.json`; use free-form commands only when no script exists for the required action.

## Commits & PR Titles

- Name commits and PR titles per `.github/prTitle.config.yml`.

## Repository Map

- Musetric is split into a web app, a backend, audio-processing modules, and shared infrastructure packages.
- `packages/frontend`: the main React application.
- `packages/backend`: the Fastify server, orchestration, and runtime services.
- `packages/audio`: browser-side audio, waveform, spectrogram, workers, and worklets.
- `packages/ai`: AI/WebGPU runtime code for source-separation and model-backed audio processing.
- `packages/api`: shared API contracts and client/server integration helpers.
- `packages/backend-db`: backend data access, entities, and schema-related code.
- `packages/utils`: low-level shared utilities used across packages.
- `packages/toolkit`: backend-oriented media and processing helpers.
- `packages/spa-router`: shared SPA routing utilities.
- `packages/eslint-config`: the repository ESLint rules.
- `packages/performance`: performance-focused playground and measurement app for audio work.

## Ground Rules

**Syntax**

- Follow the existing ESLint and TypeScript config. Do not fight it.
- Use `camelCase` for directories and non-component files, and use `PascalCase` for every React component, including both the component identifier and the file that defines it.
- Do not use `null`, except `useRef(null)`. Use `undefined`, explicit state objects, or another project-native shape everywhere else.
- Do not use classes, `this`, `switch`, method syntax in object literals, non-null assertions, or inline destructuring of function parameters.

**Files**

- Keep files domain-specific and self-contained: do not create catch-all files like `types.ts` or `utils.ts`; keep an entity's types and functions together, and move broadly reusable sub-entities into their own domain files.
- If a file contains several small domain entities, do not interleave them; keep each entity grouped, and place the more foundational entity with its types, variables, and functions before the next one.

**Imports And Exports**

- Export values and types inline at declaration, and do not use default exports except in tool config scripts that require them.
- Re-export only when an `index` file is needed as a module entrypoint; use `export * from ...` for flat entrypoints or `export * as namespace from ...` for intentional conceptual isolation, and do not re-export from any other files.
- Import entities without renaming them; rename an import only when there is a real local name conflict and it cannot be avoided by another reasonable import approach.
- When importing from a folder that has an `index` entrypoint, prefer the folder entrypoint over importing an internal file through the folder boundary.

**Types**

- Do not inject global type declarations or package type declarations into ordinary source files.
- The only exception is narrow `declare module '...'` augmentation required by a library's extension model at a concrete integration point.
- Runtime-wide type changes must be introduced through files and boundaries intentionally included by the relevant tsconfig.

**Callbacks**

- Write callback implementations inline in API objects with callback fields or handlers, and inline in React JSX props.
- Do not extract callbacks for trivial direct logic, even when the same small code is repeated; extract a callback only when it hides non-trivial complexity or defines a reusable domain entity.

**MUI**

- Do not introduce unnecessary Material UI customization. Prefer the built-in variants, spacing, and visual design by default, but preserve existing behavior and established UI output when custom styling is already serving a real purpose.
- When a Material UI component already exposes a dedicated prop for a layout or visual option, prefer that prop over `sx` only if the result stays behaviorally and visually equivalent; use `sx` whenever it is needed to preserve the current result or to express styling that the component props do not cover.

**Component Layout**

- Do not add `minHeight` or `minWidth` without extreme necessity.

## Runtime Boundaries

- Runtime boundaries are defined by `tsconfigs/` and each package `tsconfig.*.json`.
- `tsconfig.src.json`: regular package source code in that package's default runtime context; must extend `tsconfigs/base.json`.
- `tsconfig.script.json`: package-local tooling and Node.js script files that are not package runtime source code.
- Use a more specific boundary only when the code belongs to a narrower runtime than `tsconfig.src.json`.
- `*.es.ts`: portable ES code safe for any runtime boundary in the repository.
- `*.cross.ts`: code shared by multiple runtimes, but not guaranteed safe for every runtime in the repository.
- Prefer `*.es.ts` over `*.cross.ts` when that is possible without breaking the file's core purpose.
- `*.dom.ts`: browser DOM code.
- `*.worker.ts`: Web Worker code.
- `*.worklet.ts`: AudioWorklet code.
- `*.node.ts`: Node.js code.
- `__test__`: test-only folder.

## Before Finishing

If code was changed, run the relevant repository-root scripts before finishing.

- `yarn check:unused`: detect unused files, dependencies, and exports.
- `yarn check:ts`: TypeScript checks across the monorepo.
- `yarn fix:lint`: lint checks with automatic fixes.
- `yarn fix:translations`: update translation extraction results.
- `yarn fix:format`: apply repository formatting.
