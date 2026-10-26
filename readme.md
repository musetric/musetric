# Musetric

Musetric is a vocal training application.

## Development

```bash
yarn
yarn dev
```

`yarn dev` serves the frontend on `https://localhost:3001` and reloads it on every change, but builds the executor bundle and the server once, when it starts: restart it after a change to `packages/server`, or to `packages/ai` and the GPU packages the executor bundles.

The server runs the models in a headless Chrome, Edge or Chromium that it starts itself, so one of them must be installed; `--browser` points it at a specific one.

The server compiles libopus from source, so CMake must be on `PATH`. On Windows, the Visual Studio Build Tools ship it under `Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin`.

## License

Musetric's source code is [MIT licensed](https://github.com/musetric/musetric/blob/main/license.md).
The Musetric name and logo are trademarks and are not covered by the MIT license — see [trademark.md](trademark.md).
Third-party notices are listed in [thirdPartyNotices.md](thirdPartyNotices.md).
