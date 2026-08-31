# WebGPU on iOS, measured

The device measurements were run on hardware: an **iPad Air 11-inch (M3)**
(`iPad15,3`) on **iPadOS 26.4**, inside the shipping app's `WKWebView` on the
`tauri.localhost` origin, from a debug build, on **2026-08-27**. The epsilon
threshold sweep, the parity table and the quiet-audio finding were measured the
next day on a **desktop NVIDIA adapter** through the same onnxruntime-web WebGPU
EP, and say so where they appear. Where a claim is still inferred it says so.

This file replaces an earlier version that was derived from the Android numbers
plus static analysis. Its central premise — that the scarce resource on Apple is
the storage-buffer count, capped at 10 — is **wrong on this device**, and every
conclusion that followed from it is void. The real cap is 44, and the thing that
broke separation is not a limit at all.

## The headline

**Separation returned silence because 96 `RMSNormalization` nodes carry
`epsilon = 1e-12` while their tensors are `float16`.** The node normalizes by
`1/sqrt(mean(x²) + epsilon)`, and the WebGPU kernel casts that reciprocal to the
tensor dtype — so for any row where `mean(x²) + epsilon` falls below
`1/65504² = 2.33e-10`, the reciprocal is past the largest finite fp16 value,
becomes `+inf`, and `0 * inf = NaN`. The attention softmax then spreads that NaN
across the whole time axis: the output tensor comes back NaN, the iFFT collapses
NaN to zero, the vocal stem is digital silence, and `separateLeadBacking` rejects
it with `Input audio appears to be silent.`

Rows that small are not hypothetical: measured on the torch graph over a real
5 s chunk, **0.089% of all RMSNorm input rows sit under `2.33e-10`** — the
padded STFT edges, silent frames, and dead band-split features. Any one of them
is enough.

It is a defect of the exported graph, not of the app, not of Apple's WebGPU, and
not of onnxruntime-web — **and it is not Apple-specific**: a one-node fp16
`RMSNormalization` graph reproduces it on Windows/NVIDIA through the same
onnxruntime-web WebGPU EP (see the threshold table below). Why Adreno survives
the same artifact is not measured; the most likely reading is that its f32→f16
conversion saturates to 65504 where Apple's and NVIDIA's produce `inf`, which
WGSL leaves implementation-defined. The fix does not depend on which it is.

**This is fixed.** The graph has been re-exported with `epsilon = 1e-9`, the
exporter now picks the epsilon from the dtype and refuses to emit one that cannot
survive it, and there is an audit script for artifacts built elsewhere — see
[The fix](#the-fix). Quiet audio is normalized before it enters the fp16 core,
which preserves its masks without changing the rendered level.

## Measured limits

`navigator.gpu` is present, the adapter reports `vendor=apple arch=apple
device=apple`, and `shader-f16` is in its feature list.

| limit                               | adapter (hardware) | device with no `requiredLimits` |
| ----------------------------------- | ------------------ | ------------------------------- |
| `maxStorageBuffersPerShaderStage`   | **44**             | 8                               |
| `maxBufferSize`                     | 1024 MiB           | 256 MiB                         |
| `maxStorageBufferBindingSize`       | 1024 MiB           | 128 MiB                         |
| `maxUniformBufferBindingSize`       | 1024 MiB           | 64 KiB                          |
| `maxComputeInvocationsPerWorkgroup` | 1024               | 256                             |
| `maxComputeWorkgroupStorageSize`    | 32768              | 16384                           |
| `maxComputeWorkgroupsPerDimension`  | 65535              | 65535                           |
| `maxBindGroups`                     | 11                 | 4                               |
| `maxBindingsPerBindGroup`           | 65535              | 1000                            |
| `maxTextureDimension2D`             | 16384              | 8192                            |

Two things follow.

**Apple is more generous than either Adreno, on every axis that mattered there.**
[androidWebgpu.md](./androidWebgpu.md) records a real storage-binding ceiling of
256 MiB on both test phones and 16 buffers per stage. Here a single 1024 MiB
`STORAGE` allocation succeeds, and compute pipelines binding 6, 7, 8, 9, 10, 11,
12, 13 and 14 storage buffers all compile once the device is asked for the raised
limit. The 8-wide `Concat` re-treeing the Android work required is not needed on
Apple — it is also harmless, so leave it.

**The default device is the trap, not the hardware.** `requestDevice()` with no
`requiredLimits` yields the WebGPU spec defaults, which is where the 8 comes
from. Every device the app creates asks for more than that — see the next
section.

### A measurement trap worth knowing

An adapter is consumed by `requestDevice`. Asking the _same_ adapter for a second
device returns a device that is already lost: it reports whatever limits the
descriptor asked for, silently accepts `createBuffer`, and fails every pipeline
creation. A limits probe that requests several devices in a row from one adapter
will read plausible numbers and draw the opposite conclusion. Request a fresh
adapter per device.

## The storage-buffer limit is not what binds here

`maxStorageBuffersPerShaderStage` is the one limit separation depends on, and
this hardware is nowhere near it. Instrumenting `requestDevice` shows
onnxruntime-web asking for the adapter maximum of 44 on its own, before any
shared code sees the descriptor: it builds its device inside the WASM module
through `webgpuInit`, and `ort.webgpu.mjs` contains no mention of
`requiredLimits` at all — the list is assembled on the C++ side.

[webgpuDevice.ts](../../ai/src/runtime/webgpuDevice.ts) in `@musetric/ai` is what
the shared runtimes use: it configures one high-performance adapter before the
first session, raises only that limit and caps it at ten, hands the adapter to
ONNX Runtime and reuses the device ONNX Runtime creates, then asserts the buffer
count each runtime needs after the session exists. Separation needs nine of that
ten, so the assertion passes here.

The app bundles two ONNX Runtime builds: the JSEP one (`ort.bundle.min-*.js`,
which calls `adapter.requestDevice` from JavaScript and which transformers.js
pulls in) and the native WebGPU EP inlined into the app chunk. Only the second
one goes through the shared adapter.

## What is verified healthy

Every one of these was compared against the same graph on the WASM execution
provider in the same page, on the same inputs.

**24 single-operator graphs agree exactly**, fp16 and fp32: `Identity`, `Tanh`,
`Sigmoid`, `Gelu`, `Sqrt`, `Softmax`, `Cast`, `Transpose`, `Reshape`, `MatMul`,
`Concat` with 2/4/7/8/9/12 inputs, `Split` into 4 and 8, `LayerNormalization`,
`RMSNormalization`, and a `MatMul → Mul → Softmax → MatMul` attention block. No
zeros, no NaN, no divergence.

**KARA2 runs correctly and fast.** `UVR_MDXNET_KARA_2.onnx` (52.8 MB, no
external data) on a `[1, 4, 2048, 256]` input: WebGPU `sum=1263236.77`, WASM
`sum=1263236.73`, all 2 097 152 outputs non-zero, no NaN. **2.0 s on WebGPU
against 10.4 s on WASM** — WebGPU is roughly five times faster here.

**T501 loads and runs.** The loopback storage server serves the graph
(6 268 093 B) and all of the external data (741 190 540 B); session creation
takes 1.7–6.7 s. Fed a smooth synthetic tensor it returns finite masks in
`[-0.667, +0.227]`, matching the range the shipped Apple Silicon verification
recorded.

**The GPU-buffer input binding is exact.** The same session, same content, fed
once as a CPU tensor and once through `ort.Tensor.fromGpuBuffer`, returns
`sum=1751.30` both times.

**The app's own WGSL front end is clean.** Reading every buffer back across a
real `processChunk`, with an input whose peak is 0.7:

```
1.raw            sum=128743.1 max=0.70   nan=0 inf=0 n=441000
2.afterFrame     sum=299530.2 max=0.70   nan=0 inf=0 n=2054100
3.afterFft       sum=944029.7 max=212.07 nan=0 inf=0 n=2054100
4.modelInput     sum=944029.7 max=212.07 nan=0 inf=0 n=2054100
5.modelOutput    sum=0.0                 nan=2054100          <-- every value
6.afterSynthesis sum=0.0                 nan=2054100
7.afterIfft      sum=0.0                 nan=0
8.outputAudio    sum=0.0                 nan=0
```

Frame, FFT and pack are finite to the last element. The break is inside the
model.

## The zero-row failure, isolated

One session, CPU tensors on both sides, only the input content changing:

| input                      | NaN in output | sum    |
| -------------------------- | ------------- | ------ |
| smooth sine                | 0 / 2 054 100 | 1751.3 |
| all zeros                  | **2 054 100** | 0.0    |
| 100 of 501 frames zeroed   | **2 054 100** | 0.0    |
| imaginary part zeroed      | 0 / 2 054 100 | 1654.3 |
| wide dynamic range (10^±4) | 0 / 2 054 100 | 1334.2 |
| 100 frames zeroed, `+1e-6` | **2 054 100** | 0.0    |
| 100 frames zeroed, `+1e-4` | 0 / 2 054 100 | 2133.7 |
| all zeros, `+1e-6`         | **2 054 100** | 0.0    |

Zeroing a fifth of the frames destroys **all** of the output, not just those
frames — softmax along the time axis carries the NaN everywhere. The last three
rows add a constant to the input: `+1e-6` still fails, `+1e-4` is clean.

Amplitude is not a factor. Scaling the input by 0.5, 2, 8, 32, 128 and 512 gives
byte-identical output — the graph is scale-invariant because it normalizes at the
front. That is also why the epsilon is the only thing standing between a zero row
and a division by zero.

## The threshold, measured

The device runs above narrow the failure to a zero-ish row but do not say what
the epsilon has to be. A one-node graph does: `RMSNormalization` alone, fp16 in
and out, `[1, 6, 1536]`, one constant per row, run on the onnxruntime-web WebGPU
EP (**Windows, NVIDIA — the failure is not Apple-specific**). Each cell is the
first output value of that row, or the NaN count:

| epsilon | zero row     | 2⁻²⁴ (min subnormal) | 2⁻²⁰     | 2⁻¹⁴ (min normal) | 1     | 256   |
| ------- | ------------ | -------------------- | -------- | ----------------- | ----- | ----- |
| 1e-12   | **NaN×1536** | **NaN×1536**         | NaN×1536 | 1.000             | 1.000 | 1.000 |
| 1e-11   | **NaN×1536** | **NaN×1536**         | NaN×1536 | 0.9985            | 1.000 | 1.000 |
| 1e-10   | **NaN×1536** | **NaN×1536**         | NaN×1536 | 0.9868            | 1.000 | 1.000 |
| 2e-10   | **NaN×1536** | **NaN×1536**         | NaN×1536 | 0.9741            | 1.000 | 1.000 |
| 2.4e-10 | 0.000        | 0.003847             | 0.06143  | 0.9692            | 1.000 | 1.000 |
| 3e-10   | 0.000        | 0.003441             | 0.05496  | 0.9619            | 1.000 | 1.000 |
| 1e-9    | 0.000        | 0.001884             | 0.03015  | 0.8877            | 1.000 | 1.000 |
| 1e-8    | 0.000        | 0.0005960            | 0.009537 | 0.5210            | 1.000 | 1.000 |

The break sits between `2.0e-10` and `2.4e-10`, which is exactly
`1/65504² = 2.331e-10`. So the epsilon is **not** flushed to zero in fp16 —
if it were, `2.4e-10` would fail with `1e-12`. It reaches the kernel intact as
f32, and what overflows is the reciprocal `1/sqrt(mean(x²) + epsilon)` when it is
cast back to fp16. Everything follows from that:

- **the constraint is `epsilon >= 2.33e-10`**, unconditionally, for any fp16
  normalization, whatever the input;
- rows that are merely small, not zero, fail too — 2⁻²⁰ per element is
  `mean(x²) = 9e-13`, below the floor, which is why real audio and not just
  digital silence triggers it;
- `1e-4` is 400 000× more than the floor requires, and that costs quality: the
  rightmost columns show how far an epsilon that large drags a small-but-real row
  toward zero.

### What the epsilon costs

The floor says what is _safe_; parity says what is _free_. The full T501 core was
run on the WebGPU EP against the torch fp32 masks for the same input, once per
candidate epsilon, on three real chunks: a loud one, the same one with 100 of its
501 frames zeroed, and a near-silent intro (peak 0.0033, −50 dBFS).

| epsilon           | loud         | loud, 100 frames zeroed | quiet intro |
| ----------------- | ------------ | ----------------------- | ----------- |
| 1e-12 (published) | 45.70 dB     | **all NaN**             | **all NaN** |
| 3e-10             | 45.70 dB     | 45.04 dB                | 0.14 dB     |
| **1e-9 (chosen)** | **45.68 dB** | **45.07 dB**            | 0.15 dB     |
| 1e-8              | 43.88 dB     | 44.96 dB                | 0.17 dB     |
| 1e-7              | 38.86 dB     | 41.95 dB                | 0.25 dB     |

`1e-9` is indistinguishable from the unusable `1e-12` on healthy audio (0.02 dB)
and keeps the reciprocal a 2x margin inside fp16. `1e-7` already fails the 40 dB
export gate, and the `1e-4` the device patch reached for is three more orders past
that. The 0.03% figure that patch reported is a whole-tensor average over one
smooth sine, which contains no small rows at all.

The same ordering shows in the per-row arithmetic, measured against the
`mean(x²)` the torch graph actually produces at all 96 RMSNorm inputs over a real
chunk — everything from the floor up to `1e-8` only touches the 0.09% of rows
that are below the floor and unrepresentable in fp16 either way:

| epsilon | 1/sqrt(eps) | rows >1% off | rows >10% off |
| ------- | ----------- | ------------ | ------------- |
| 1e-12   | 1 000 000   | 0.0890%      | 0.0890%       |
| 2.4e-10 | 64 550      | 0.0895%      | 0.0894%       |
| 1e-8    | 10 000      | 0.0901%      | 0.0899%       |
| 1e-6    | 1 000       | 2.2547%      | 0.1126%       |
| 1e-4    | 100         | 2.7027%      | 2.7027%       |

**The published artifact fails on a desktop NVIDIA adapter too**, on the same
inputs: clean on the loud chunk, all-NaN the moment a zero-ish row appears. Only
the loud case ever worked. Whatever Adreno does with an out-of-range f32→f16
conversion, it is not what Dawn does on either Metal or D3D12.

## The fix

The epsilon now comes from the exporter, chosen by the dtype the node ends up in.
In `musetric-toolkit`, `scripts/onnx/roformer/build_full_onnx.py` carries both
values — `RMSNORM_EPS = 1e-12` while `RMSNormalization` stays fp32 (the default
build pins it there), and `RMSNORM_EPS_FP16 = 1e-9` for `--all-fp16`, which is
the mobile build and the only one that leaves the node in fp16. The same export
refuses to write a graph that breaks the rule, and
`scripts/onnx/fp16_epsilon_audit.py` re-checks any artifact, including ones built
elsewhere:

```bash
uv run --group export python scripts/onnx/fp16_epsilon_audit.py   tmp/models/syhft_core_blocked_fp16_webgpu_t501.onnx
```

The artifacts were rebuilt from source rather than patched in place, and each
rebuild is byte-identical to what it replaces apart from the epsilon: same 2262
nodes (2580 at T=1101), same 981 initializers (991), **the 741 MB `.data` file hashes to the same
`73a4074734363ff2243ee1354064bc8fd0c70ae6e22021f8e3ea51b8e0d35469`**, and a
node-by-node comparison finds exactly 96 differences, all of them the `epsilon`
attribute. Only the 6 MB graph has to be republished.

Both blocked cores were rebuilt and published to the `test` revision of
[musetric/vocal-separation-roformer-onnx](https://huggingface.co/musetric/vocal-separation-roformer-onnx):

| file                                             | sha256                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `syhft_core_blocked_fp16_webgpu_t501.onnx`       | `33435ad4bc9896879c3b7060165d7b21cf05091d4d5b8f92cf38ff5bf6c1b91c`             |
| `syhft_core_blocked_fp16_webgpu_t1101.onnx`      | `bb8f371d8982b7dc87b3dae24405588da5c90a1af4eb4af58ca2ab31d7257252`             |
| `syhft_core_blocked_fp16_webgpu_t501.onnx.data`  | `73a4074734363ff2243ee1354064bc8fd0c70ae6e22021f8e3ea51b8e0d35469` (unchanged) |
| `syhft_core_blocked_fp16_webgpu_t1101.onnx.data` | `b08cfc80905e3560a4dd5d30f641299a47dd96d309ebbe9524d9d6c9d2a0356f` (unchanged) |

That was the state when the app still carried a mobile-only descriptor. It no
longer does: the published repository now ships a single query-blocked core at a
1100-frame window, which a mobile storage buffer can bind, so mobile and desktop
both read [vocalsModel.ts](../../ai/src/models/vocalsModel.ts). The download
cache re-fetches on a hash mismatch, so a device holding an older graph picks the
new one up on its own.

**The other fp16 graphs were audited.** `beat_this` (fp32 `BatchNormalization`,
`epsilon=1e-5`) and the q4 whisper encoder/decoder (fp32 epsilons) are clean. The
fp16 whisper graphs are not affected by _this_ failure — their normalization is
decomposed into `ReduceMean → Add(eps) → Sqrt → Div`, which divides rather than
multiplying by a reciprocal, so nothing overflows — but their epsilon is an fp16
initializer holding `1.00136e-05`, which is **denormal in fp16** (the smallest
normal is `6.10e-5`). On a GPU that flushes fp16 denormals it reads as exactly
zero, and a zero-variance row then divides 0 by 0. That is a warning, not a
failure: it needs a constant row to fire. The audit reports it.

## Quiet audio: fp16 underflow at the input

Found while verifying the fix, **separate from the epsilon, and fixed alongside
it**. On the near-silent intro above (peak 0.0033, −50 dBFS, STFT peak 0.14) the
graph returned finite masks that were simply wrong — **0.15 dB against the torch
reference**, where the loud chunk gets 45.68 dB. Nothing reported an error.

The cause is the input, not the normalization: an STFT that small puts most of
its values under the smallest normal fp16 value, so the graph's first `Cast`
flattens them. The core is scale-invariant by construction — its first operation
is an `RMSNorm`, and the masks it returns are dimensionless — so the input can be
lifted back into range for free.

[stftInference.ts](../../ai/src/runtime/stftInference.ts) now normalizes each
chunk to `normalizedPeak` before the STFT and divides the result back out
afterwards, and `vocalsRuntime` asks for `0.5`. The STFT is linear, so scaling
the audio scales every bin by the same factor; both loops are O(chunk) on the
CPU, against a two-second inference. Measured on the shipped graph:

| chunk                   | as-is    | normalized to peak 0.5 |
| ----------------------- | -------- | ---------------------- |
| loud                    | 45.68 dB | 45.71 dB               |
| loud, 100 frames zeroed | 45.07 dB | 44.92 dB               |
| quiet intro (−50 dBFS)  | 0.15 dB  | **42.98 dB**           |

Only `vocalsRuntime` opts in. `leadBackingRuntime` runs KARA2, which does not
start with a normalization, so nothing there may assume scale invariance.

Note this also refines the scale-invariance the earlier device runs reported: the
graph is scale-invariant in exact arithmetic and stays so upward in fp16 — the
0.5x–512x sweep started from a loud chunk — but downward it runs out of exponent.

## Why a CPU fallback cannot return

This is historical evidence from before the CPU fallback was removed. It
explains why the shipping app fails a GPU step instead of retrying the full
model in the WebView on CPU.

Falling through to the WASM path put the T501 fp16 graph and its 741 MB of
external data in the web content process, which did not survive it. From
`JetsamEvent-2026-08-27-171813.ips`:

```
com.apple.WebKit.WebContent  pid=2759  5120 MB  reason=per-process-limit
com.apple.WebKit.WebContent  pid=2792  5133 MB  reason=per-process-limit
Musetric                     pid=2757    16 MB  (alive)
```

The app itself holds 16 MB and survives; the kernel kills the web content
process, WebKit reloads the page, the queue restarts from 0.0%, and the cycle
repeats — 14 deaths in two minutes were recorded. It reads exactly like an app
crash loop and is not one.

`com.apple.developer.kernel.increased-memory-limit` is granted to the **app**.
The process that exceeds its limit is the WebContent extension, which has its
own, and the app's entitlement does not raise it. So no entitlement makes a CPU
path for T501 viable on iOS, and there is now no second path at all — a GPU
failure ends the step.

## Open questions

- Whether Metal silently stops addressing a storage buffer past some size the
  way both Adreno chips do past 256 MiB. Allocation up to 1024 MiB succeeds here,
  but **nothing was written past the boundary and read back**, so this is
  untested.
- Whether the denormal fp16 epsilon in the whisper graphs ever fires on Apple.
  It needs a row of exactly constant hidden state, which nothing has produced so
  far.
- End-to-end separation with the re-exported graph through the real queue. It is
  verified at the model boundary on a desktop adapter, not on the device and not
  through a full project run.
