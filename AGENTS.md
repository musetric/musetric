# Musetric

## Context

- This repository is a Yarn monorepo. Node comes from `.node-version` and Yarn from `packageManager` in `package.json`, through corepack.
- Prefer existing Yarn scripts from the root or the target package `package.json`; use free-form commands only when no script exists for the required action.
- All commit and PR titles must comply with `.github/prTitle.config.yml`.
- Follow the existing ESLint and TypeScript config. Do not fight it.

## Test Material

Applies to everything published from this repository: code, tests, comments, commits, PRs, issues, documentation and model cards.

- Prefer material anyone can obtain: synthetic signals, public domain audio, and tracks under an open license such as CC0, CC BY or CC BY-SA, including tracks from public datasets.
- Name an openly licensed track by artist, title, source link and license, and give the attribution its license requires. Its lyrics, excerpt positions, durations and results may be quoted.
- A track under a non-commercial or no-derivatives license (NC, ND) may be used for measurements and named with its license, but do not publish its audio, stems, excerpts or lyrics.
- Never mention any other audio: no titles, artists, albums, lyrics, quoted transcriptions, file names, and no hashed or otherwise encoded forms of them.
- Do not describe material that cannot be shared: no duration, tempo, key, excerpt position or similar detail of an unnamed track.
- Name a property of such input only when it is the subject of the problem, and state it abstractly: "fails on tracks shorter than one chord window", "runs out of GPU memory on tracks longer than about 4 minutes".
- Otherwise report the observation without the input: "the step fails on Android; the cause is under investigation".
- Checkable evidence uses synthetic signals, openly licensed tracks or inputs committed with the change. A run on any other material may be reported only as its outcome, such as "matches desktop" or "still differs".

## Repository Map

- Musetric is split into a web app, a Rust host, audio-processing modules, and shared infrastructure packages.
- `packages/frontend`: the main React application.
- `packages/app`: the Tauri shell for desktop, Android and iOS; it links the Rust host and runs the frontend in a WebView.
- `packages/engine`: the audio engine the frontend drives: decoding, playback, recording sessions, calibration and the spectrogram, orchestrated in one state.
- `packages/audio`: browser-side audio: decoding, playback, recording, calibration, timeline and waveform, with workers and worklets.
- `packages/ai`: AI/WebGPU runtime code for source-separation and model-backed audio processing.
- `packages/fft`: the WebGPU FFT, its inverse and window functions.
- `packages/spectrogram`: the frequency spectrogram and the pitch line on WebGPU.
- `packages/cqt`: recursive WebGPU constant-Q transform driven by a caller-supplied plan.
- `packages/interaction`: pointer and viewport gestures: drag, inertia, pinch, seek and follow scrolling.
- `packages/api`: shared API contracts and client/server integration helpers.
- `packages/utils`: low-level shared utilities used across packages.
- `packages/spa-router`: shared SPA routing utilities.
- `packages/eslint-config`: the repository ESLint rules.
- `packages/checks`: repository checks published to npm for the other repositories of the organization: English letters only, the paths of the notices, and markdown links.
- `packages/performance`: performance-focused playground and measurement app for audio work.
- `packages/measure`: measurements of recording on a real device (timing, delay, sound) over the Chrome DevTools protocol.
- `packages/script`: build tooling shared by the packages, such as the favicons plugin.
- `packages/server`: the Rust host: http api, storage, processing queue and gpu executor, a self-contained Cargo workspace with its own toolchain pin and lockfile.

## Ground Rules

**Files**

- Use `camelCase` for directories and non-component files, and use `PascalCase` for every React component, including both the component identifier and the file that defines it.
- Keep files domain-specific and self-contained: do not create catch-all files like `types.ts` or `utils.ts`; keep an entity's types and functions together, and move broadly reusable sub-entities into their own domain files.
- If a file contains several small domain entities, do not interleave them; keep each entity grouped, and place the more foundational entity with its types, variables, and functions before the next one.
- Keep product `src` to product code. Scripts and their helpers, tests, test fixtures and test helpers, benchmarks and measurement code live in `scripts/` or in `__test__` folders, and product code never imports from them. A measurement point stays in product code only as the smallest hook a measure build needs, behind its build flag; whatever drives or reads that hook lives in `__test__`.

**Imports And Exports**

- Re-export only when an `index` file is needed as a module entrypoint; use `export * from ...` for flat entrypoints or `export * as namespace from ...` for intentional conceptual isolation, and do not re-export from any other files.
- When importing from a folder that has an `index` entrypoint, prefer the folder entrypoint over importing an internal file through the folder boundary.
- Import local modules with the `.js` extension, never `.ts`, and do not enable `allowImportingTsExtensions`. A script that `node` runs directly stays in one file.
- Keep a type shared with heavy code in a small module without dependencies, also when it is imported only as a type.

**Contracts**

- Never coerce an invalid value into a valid default, such as `Math.max(0, count)` or `?? fallback` for a required value.
- A changed contract changes everywhere at once, without fallbacks kept for compatibility.

**Types**

- Do not inject global type declarations or package type declarations into ordinary source files.
- The only exception is narrow `declare module '...'` augmentation required by a library's extension model at a concrete integration point.
- Runtime-wide type changes must be introduced through files and boundaries intentionally included by the relevant tsconfig.

**Callbacks**

- Write callback implementations inline in API objects with callback fields or handlers, and inline in React JSX props.
- Do not extract callbacks for trivial direct logic, even when the same small code is repeated; extract a callback only when it hides non-trivial complexity or defines a reusable domain entity.

**Components**

- Do not add component layers: a new component must own real state, logic, or a domain entity, not just forward props to another component.
- Keep a component in the folder of the feature that renders it; do not lift it into shared folders such as `components/` or build a generic abstraction for one concrete use.
- Build markup from Material UI components. Do not write raw DOM elements such as `div`, `span`, or `p` in JSX; use a plain React DOM element only in extreme necessity, when no Material UI component can do the job.
- Use Material UI components directly where they are rendered. Do not wrap them in project components or shared `sx` and prop presets, such as a custom button or a captioned icon button.
- Do not introduce unnecessary Material UI customization. Prefer the built-in variants, spacing, and visual design by default, but preserve existing behavior and established UI output when custom styling is already serving a real purpose.
- When a Material UI component already exposes a dedicated prop for a layout or visual option, prefer that prop over `sx` only if the result stays behaviorally and visually equivalent; use `sx` whenever it is needed to preserve the current result or to express styling that the component props do not cover.
- Do not add `minHeight` or `minWidth` without extreme necessity.

**Shaders**

- A value that a caller may change reaches a shader through its `params` uniform, never through the shader's text. An interpolation in a WGSL template carries only what the compiler needs before the shader runs: shared WGSL code, binding indices, array sizes, and the counts that unroll code.
- Every dispatch in one submit reads its own `params` slot, through a dynamic offset (`dynamic-uniform` in `packages/spectrogram/src/common/computeBufferEntries.ts`) or a bind group per slot (`packages/fft/src/fourier/slotCache.ts`).

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
- `yarn fix:lint`: lint checks with automatic fixes; before a pull request, lint the changed files once without the cache.
- `yarn fix:translations`: update translation extraction results.
- `yarn fix:format`: apply repository formatting.
- `yarn check:rust`: Rust formatting, Clippy, and tests, when `packages/server` was touched.
- `yarn test`: the tests of every package.
- `yarn check:deps:dupe` and `yarn check:deps:security`, when dependencies changed: Yarn constraints and duplicate versions in the lockfile, which `yarn fix:deps:dupe` fixes, and advisories of high severity.
- `yarn check:english`, `yarn check:notices` and `yarn check:links`: letters outside English, files the notices name that are gone, and links that do not resolve; a file where another language is part of its meaning goes to `checks.english.except` of the root `package.json`.
- `yarn check:comments`: comments and docstrings in any language, beyond tool directives and `@see`, `@todo` and `@fixme`; third-party code goes to `checks.comments.except` of the root `package.json`.
- `yarn check:dupe` and `yarn check:editorconfig`: duplicated code and editor settings, through the global jscpd and editorconfig-checker binaries at the versions `.github/actions/baseQuality` pins.
