# Musetric Landing

Simple static landing for `musetric.com`.

## Local development

```sh
yarn workspace @musetric/landing dev
```

Open `http://localhost:3003`.

## Build

```sh
yarn workspace @musetric/landing build:project
```

The static output is created in `packages/landing/dist`.

Public policy pages are available at `/privacy` and `/support`.

## Cloudflare Pages

Use Git deployment from the repository root.

- Framework preset: `Vite`
- Build command: `yarn workspace @musetric/landing build:project`
- Build output directory: `packages/landing/dist`
- Production branch: your main production branch

After the first successful deploy, add `musetric.com` in the Pages project
under `Custom domains`.
