# @musetric/cqt

Recursive constant-Q transform on WebGPU, reproducing `librosa.cqt`. The package
keeps PCM, resampling, FFT projection and CQT features on the caller's
`GPUDevice`; it never creates a device and never reads features back to the CPU.

## Plan

The transform is driven entirely by a `CqtPlan`: the octave schedule, the sparse
per-octave FFT basis, and the resampling FIR. `librosa` cannot run in a browser,
so those constants are baked offline into a binary artifact and handed to
`createCqt` by the caller.

```ts
const plan = await verifyCqtPlanArtifact(bytes);
const cqt = createCqt(device).get({ input, output, sampleCount, plan });
```

The package ships no plan of its own and knows nothing about which model consumes
one. It defines the format, decodes it, and verifies the payload against the
SHA-256 the artifact carries. Choosing a configuration, distributing an artifact
and pinning its provenance belong to whoever owns the model.

## Single-pass processing

The whole input is transformed in one pass. The PCM input is the largest buffer,
so the longest supported input is `maxStorageBufferBindingSize / 4` samples;
there is no chunked mode. Over the limit `createCqt` throws a `RangeError`
naming the required and available sizes, and splitting the input is the caller's
decision.

## Tests

`cqt.test.ts` generates every signal it needs in `fixture.ts`; there are no
binary fixtures to regenerate or keep in sync.

| case                | assertion                                                                          |
| ------------------- | ---------------------------------------------------------------------------------- |
| silence             | every bin sits at `log(1e-6)`                                                      |
| tone bin mapping    | a tone at bin `k`'s centre peaks at bin `k`, for a bin at each end of every octave |
| tone peak magnitude | that peak equals librosa's, to two decimals                                        |
| tone between bins   | peaks on one of the two neighbours                                                 |
| superposition       | two distant tones each keep their own peak                                         |
| linearity           | doubling the input doubles the magnitude                                           |

The tone cases carry most of the weight. A tone can only land on its own bin if
the early downsample, the per-octave resampling cascade, framing, the FFT, the
projection and the octave-to-global bin mapping are all right — but bin mapping,
superposition and linearity are all invariant to gain, so on their own a
resampler with a 2 % gain error still passes. Comparing the peak against
librosa's own magnitude is what pins the absolute scale, and it fails on that
same 2 % error.

`reference.ts` holds those magnitudes — one number per bin, generated with
librosa 0.11.0. It is the whole reference: a steady tone's interior frames agree
to ~1e-5, so a scalar says everything an array would. `__test__/plan.ts` carries
a librosa plan for the same configuration, because a transform driven by a plan
cannot be tested without one.

Parity on broadband input and at the signal edges is deliberately left to the
consumer, which can compare its own end-to-end output against the reference
implementation — a stronger check than any synthetic fixture, and the reason
none are committed here.
