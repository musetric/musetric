# Musetric

Musetric is a vocal training application.

## Development

```bash
yarn
yarn dev
```

`yarn dev` serves the frontend on `https://localhost:3001` and reloads it on every change; restart it after a change to `packages/server`, or to `packages/ai` and the GPU packages the executor bundles.

It needs Chrome, Edge or Chromium installed (`--browser` points the server at a specific one) and CMake on `PATH`. On Windows, the Visual Studio Build Tools ship CMake under `Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin`.

## License

Musetric's source code is [MIT licensed](https://github.com/musetric/musetric/blob/main/license.md).
The Musetric name and logo are trademarks and are not covered by the MIT license — see [trademark.md](trademark.md).
Third-party notices are listed in [thirdPartyNotices.md](thirdPartyNotices.md).
