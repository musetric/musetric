# @musetric/cqt

Recursive constant-Q transform on WebGPU, reproducing `librosa.cqt`. The package
keeps PCM, resampling, FFT projection and CQT features on the caller's
`GPUDevice`; it never creates a device and never reads features back to the CPU.

## Plan

A `CqtPlan` drives the transform: the octave schedule, the sparse per-octave
FFT basis and the resampling FIR, baked offline into a binary artifact.

```ts
const plan = await verifyCqtPlanArtifact(bytes);
const cqt = createCqt(device).get({ input, output, sampleCount, plan });
```

- The package defines and decodes the format and verifies the payload against
  the SHA-256 the artifact carries; it ships no plan: choosing, distributing
  and pinning one belong to whoever owns the model.
- One pass takes the whole input, up to `maxStorageBufferBindingSize / 4`
  samples; over it `createCqt` throws a `RangeError`, and splitting the input
  is the caller's decision.

## Tests

`src/cqt/__test__/cqt.test.ts` generates its signals in `fixture.ts` and checks
them against librosa 0.11.0: its peak magnitude per bin in `reference.ts` and
its plan for the same configuration in `plan.ts`. Parity on broadband input
and at the signal edges is left to the consumer.
