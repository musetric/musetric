# Musetric

Musetric is a vocal training application.

## Development

```bash
pnpm install
pnpm dev
```

`pnpm dev` serves the frontend on `https://localhost:3001` and reloads it on every change; restart it after a change to `packages/server`, or to `packages/ai` and the GPU packages the executor bundles.

It needs Chrome, Edge or Chromium installed (`--browser` points the server at a specific one).

## License

Musetric's source code is [MIT licensed](https://github.com/musetric/musetric/blob/main/license.md).
The Musetric name and logo are trademarks and are not covered by the MIT license — see [trademark.md](trademark.md).
Third-party notices are listed in [thirdPartyNotices.md](thirdPartyNotices.md), and the licenses of the crates and packages compiled into each build are in the `notices` folder of [the app](packages/app/notices) and of [`@musetric/dsp`](packages/dsp/notices).
