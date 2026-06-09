# Musetric

Musetric is a vocal training application.

## Development

```bash
yarn
yarn dev
```

## Check

```bash
yarn
yarn check:security
yarn fix:deps
yarn check:ts
yarn fix:lint
yarn fix:translations
yarn fix:format
yarn test
```

## Third-party Components

### FFT Algorithm (CPU & GPU)

- **Source:** https://github.com/indutny/fft.js by Fedor Indutny (MIT)
- **Usage:** Fast Fourier Transform - CPU implementation adapted, GPU version ported

### Musetric Toolkit

- **Repository:** https://github.com/popelenkow/musetric-toolkit
- **Usage:** Companion CLI for running audio processing workflows and worker scripts

## License

Musetric is [MIT licensed](https://github.com/popelenkow/Musetric/blob/main/license.md).
