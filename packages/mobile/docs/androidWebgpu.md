# WebGPU limits on Android, measured

Separation and transcription are the two inferences in the app large enough to
hit device limits, and every limit either one hits is about **one tensor being
too big to bind**, never about the phone running out of memory. This document
records what the two test devices actually allow, how that was measured, which
changes to the exported separation graph made the reference 11-second window run
on a phone at all, and the single change the whisper encoder needed for the same
reason.

**Measured:** 2026-08-26 for separation, with `tak_10s.flac` through the
production `@musetric/ai` path (WGSL STFT/iSTFT plus `createVocalsGpuRuntime`);
2026-08-27 for the whisper encoder.

**Read this first:** the exploration below ran in **Chrome for Android**
(151.0.7922.173 on both phones). Every accepted result was then repeated in the
**Android System WebView** the app actually ships against — see
[Repeated in the WebView](#repeated-in-the-webview), which is the section that
counts, and which disagrees with Chrome on one device.

## The devices

|                                              | OnePlus 9RT (`MT2111`) | Samsung Galaxy S24 Ultra (`SM-S928B`) |
| -------------------------------------------- | ---------------------- | ------------------------------------- |
| SoC / GPU                                    | SM8350, Adreno 660     | SM8650, Adreno 750                    |
| Android / WebView                            | 14 / 151.0.7922.199    | 16 / 151.0.7922.170                   |
| Vulkan / driver                              | 1.1.128, `4bbe300fc3`  | 1.3.128, `f6b5df5188`                 |
| `maxStorageBufferBindingSize` (WebGPU)       | 512 MiB                | **128 MiB**                           |
| `maxStorageBufferRange` (native Vulkan)      | 512 MiB                | 128 MiB                               |
| **real ceiling, measured**                   | **256 MiB**            | **256 MiB**                           |
| `maxStorageBuffersPerShaderStage` (WebGPU)   | 16                     | 16                                    |
| storage buffers per stage (native)           | 524 288                | 16 777 216                            |
| device-local heaps                           | 11 250 MiB             | 11 085 + 4 096 MiB                    |
| `maxMemoryAllocationSize`                    | 1 024 MiB              | 1 024 MiB                             |
| `shaderInt64` / usable `bufferDeviceAddress` | 0 / no                 | 1 / yes                               |

## Three facts worth keeping

**WebGPU does not clamp the buffer limit.** Native Vulkan reports byte for byte
what WebGPU reports. Going native buys nothing on this axis. The 128 MiB the
S24 declares is `2^27`, exactly the minimum the Vulkan specification requires —
its driver reports the floor, the older one reports four times the floor.

**Both declared numbers are wrong, and one of them is dangerous.** A compute
shader writing through a plain storage-buffer descriptor stops working past
**256 MiB = `2^28`** on both GPUs, whatever they declare. Past that, writes are
discarded and reads return zero: no fault, no error, no device loss. On the
Adreno 750 that is merely conservative. On the Adreno 660 it means a binding
between 256 and 512 MiB is accepted as legal, and silently produces garbage —
and onnxruntime sizes its tensors by the declared limit. Treat 256 MiB as the
ceiling on any Adreno regardless of what the adapter says.

**Only the newer GPU has an escape hatch.** `bufferDeviceAddress` addresses the
full buffer correctly on the Adreno 750 (verified to 500 MiB). The Adreno 660
reports `shaderInt64 = 0`, so it cannot do the 64-bit address arithmetic that
path needs. No runtime we use emits it anyway; it is a fact about the hardware,
not an available option.

## What the separation graph asks for

The RoFormer core alternates attention along time and along mel bands. Only the
first is large:

| Layers             | Score tensor          | T = 501   | T = 1101    |
| ------------------ | --------------------- | --------- | ----------- |
| 6 × time attention | `[60, 8, T, T]` fp16  | 229.8 MiB | 1 109.8 MiB |
| 6 × band attention | `[T, 8, 60, 60]` fp16 | 28.8 MB   | 63.4 MB     |

At T = 1101 the time-attention tensor is four times any ceiling on either
phone. At T = 501 it is 229.8 MiB — inside the 256 MiB hardware ceiling with
26 MiB to spare, and already over what the S24 will bind.

## What had to change, in the order it mattered

**1. Wide `Concat`/`Split`.** Both phones cap a shader at 16 storage buffers, so
a 60-input `Concat` fails with `Too many storage buffers in shader. Current: 17`.
`split_concat_webgpu.py` re-trees those to 8-wide. Purely a WebGPU limit —
native Vulkan allows hundreds of thousands — but without it nothing runs.

**2. Attention blocked along the query axis.** Softmax normalizes each query row
over the full key axis independently, so splitting the _queries_ into 64-row
chunks is exact — not an approximation, and not the online-softmax bookkeeping
flash attention needs. Peak score tensor drops to `[60, 8, 64, T]`: 29.4 MiB at
T = 501, 64.5 MiB at T = 1101. Same FLOPs. Verified exact: at T = 101 the
blocked and unblocked graphs agree with torch to the same 65.20 dB and the same
`max|diff| = 6.776e-04`.

**3. The fp32 RMSNorm islands — the actual T = 1101 blocker.** Pinning RMSNorm
to fp32 costs nothing at T = 501 and is fatal at T = 1101: it turns the
`[T, 60, 1536]` activations into **387 MiB fp32 tensors**, each with a
full-size cast copy beside it, across 96 islands. Once attention was blocked,
those were the largest tensors in the graph by a wide margin.

Converting them to fp16 by hand produces **NaN** — `mean(x²)` overflows fp16 on
the residual stream, exactly as the exporter's own comment warns. The fix is the
fused `ai.onnx::RMSNormalization`: its WebGPU kernel casts to `f32` inside the
shader and accumulates the sum of squares there, so it takes fp16 in and out and
needs no island and no cast copies. Largest tensor becomes 193.5 MiB fp16, and
the graph loses a thousand nodes.

## Results in Chrome

The search for a working graph ran here; the section after it is the same work
repeated in the shipping runtime, and the last row differs.

| Graph                                         | OnePlus 9RT             | S24 Ultra                           |
| --------------------------------------------- | ----------------------- | ----------------------------------- |
| published fused, T = 501                      | 37.9 s · ×0.26          | device lost in `MultiHeadAttention` |
| published fused, T = 1101                     | device lost in `Concat` | not run                             |
| blocked, T = 501                              | 38.2 s · ×0.26          | **13.6 s · ×0.74**                  |
| blocked, T = 1101, fp32 RMSNorm               | renderer killed         | not run                             |
| blocked, T = 1101, hand-lowered fp16 RMSNorm  | 95.1 s, **NaN**         | 37.4 s, **NaN**                     |
| **blocked, T = 1101, fused RMSNormalization** | device lost in `Tanh`   | **32.1 s · ×0.31**                  |

Times are for the 10-second fixture, two chunks, session creation excluded
(3.4–6.0 s everywhere). Every successful run produced the same output within
rounding: peak 0.672, rms 0.113. On the CPU provider the blocked graphs measure
64.0–65.3 dB against the published artifacts with no NaN.

**The S24 Ultra runs the full 11-second reference context.** The device
previously written off for WebGPU separation is the faster of the two, by a
factor of three.

**The 9RT does not — in Chrome, and it turns out that qualifier matters.** It
has the memory — the hand-lowered variant ran T = 1101 to completion in 95 s —
but the fused-RMSNorm variant loses the GPU device at ~24 s into the first chunk,
reproducibly, with fence timeouts on `kgsl-timeline` in logcat that reach other
processes. That is the driver watchdog killing an over-long submission, the same
`PREEMPTFAULT` class of failure recorded when this work started. The Adreno 750
survives because it is three times faster per chunk, not because it is
configured differently.

## Repeated in the WebView

The Chrome numbers above were re-run in the Android System WebView, by attaching
to a Tauri shell's WebView over its `webview_devtools_remote` socket and
navigating it to the same page. Same graphs, same fixture, same server.

| Graph                                     | OnePlus 9RT        | S24 Ultra          |
| ----------------------------------------- | ------------------ | ------------------ |
| blocked, T = 501                          | 38.7 s · ×0.26     | 17.3 s · ×0.58     |
| blocked, T = 1101, fused RMSNormalization | **96.7 s · ×0.10** | **35.6 s · ×0.28** |

All four finite, all four matching the Chrome output to three decimals.

**The WebView succeeds where Chrome failed.** On the 9RT, T = 1101 lost the GPU
device in Chrome twice at the same node; in the WebView it completes. The
Chromium milestone is the same (151), so the difference is the browser's own GPU
process configuration, not the driver — and the failure was never a hard limit,
it was a watchdog the WebView apparently gives more room. It also means a Chrome
failure on this workload is not evidence about the app, in either direction.

**Both phones run the full 11-second reference context in the shipping runtime.**
The 9RT does it at ×0.10, which is roughly half an hour for a three-minute track
and not a product; the S24 at ×0.28, roughly eleven minutes. T = 501 stays the
practical setting on the 9RT.

Session creation in the WebView is slower on the S24 (10.5 s against 3.4 s in
Chrome) and unchanged on the 9RT. Not investigated.

Also worth recording: navigating an installed WebView through CDP is enough to
test a page inside the app's own engine, without building or installing
anything. The app must be in the foreground and left alone — bringing it forward
with `monkey` recreates the activity and silently restarts the run.

## The whisper encoder hits the same wall

Transcription failed on the S24 for the same reason separation did, and the same
change fixes it. The whisper encoder always sees a 30-second window — 1500
frames, 20 heads, 64 per head — and the exported graph computes each layer's
attention in one shot, so its score tensor is `[20, 1500, 1500]` fp32:
**171.7 MiB**, in 32 layers. Over the S24's 128 MiB, under the 9RT's declared
512 MiB. onnxruntime fails the dispatch that binds it:

```
WebGPU validation failed. In entries[1], binding index 1 not present in the
bind group layout. — While validating [BindGroupDescriptor "Softmax"]
```

`block_attention.py` in the toolkit's `scripts/onnx/whisper` rewrites each
`MatMul → Softmax → MatMul` chain into one chain per 250-row query block plus a
`Concat`, which is the same exact rewrite the separation core got and for the
same reason. Peak score tensor becomes **28.6 MiB**; the graph goes from 1751 to
2423 nodes and no weight is touched — the q4 `MatMulNBits` nodes are copied
through, so nothing is requantized. On the CPU provider the blocked and
unblocked encoders produce **bit-identical** output.

| Encoder graph, one 30-second window | OnePlus 9RT     | S24 Ultra             |
| ----------------------------------- | --------------- | --------------------- |
| as published                        | 22.1 s / 21.6 s | fails to bind (above) |
| query-blocked                       | 22.3 s / 21.7 s | **10.3 s / 10.0 s**   |

Cold run / warm run, in Chrome, session creation excluded (2.5–4.0 s). Blocking
costs about 1 % on the phone that never needed it. The S24's output matches the
CPU provider's RMS to six decimals; the 9RT's differs by 0.3 % **on both
graphs**, so that is the older GPU's arithmetic and not the rewrite.

This is why the encoder alone was the problem: the decoder's cross-attention is
`[20, tokens, 1500]`, at most 51 MiB for a full 448-token window, and its
self-attention is smaller still. Neither needs blocking, and neither could be
blocked the same way — their query extent is dynamic.

The blocked encoder is published on the **`test`** branch of
`musetric/whisper-large-v3-turbo-onnx`, which is the revision `whisperModel.ts`
points at; `main` still holds the graph it was cut from. The app transcribes the
fixture on the S24 through the real
`@huggingface/transformers` pipeline: model load 7.2 s, one 30-second batch in
14.1 s, no WebGPU error and no CPU fallback. The 9RT, which never had the
problem, loads in 8.4 s and returns the same text it returned on the unblocked
graph, its own transcription errors included. On a desktop discrete GPU the two
graphs are indistinguishable — 1.57 s against 1.60 s cold, 0.94 s against 0.96 s
warm, each measured in a freshly started browser. Measure this in a clean
browser or not at all: with several 425 MB sessions alive in other tabs the same
runs stretch to 7–20 s and the comparison stops meaning anything.

## Open

- T = 1101 works everywhere in the WebView but is too slow to ship on the 9RT.
  The interesting window is between 501 and 1101, and it is one run per value.
- The S24's earlier `SIGSEGV` in the driver's shader compiler no longer
  reproduces. It was recorded on WebView `151.0.7922.83`; the device now runs
  `.170` and separates without incident. Whether the WebView update fixed it or
  the graph changes avoid the shape that triggered it is untested — the
  published fused graph still loses the device on that phone in Chrome, so the
  graph is at least part of it.
- Both phones ran with a charger attached and no thermal soak. A long track is
  a different experiment.
- The fused-`RMSNormalization` variant is WebGPU-only: the Core ML execution
  provider has no builder for that operator. iOS needs its own build, where the
  fp32 islands may well be affordable — the limits there are not these.
- Output was checked for finiteness, peak and RMS, and against the published
  graphs on CPU. Nobody has listened to it.
- **Rhythm now fails where transcription used to.** On the S24 Beat This! loses
  its very first `Split` with `Failed to create a WebGPU compute pipeline:
CreateComputePipelines failed with VK_ERROR_UNKNOWN`, and the step fails.
  That is a shader-compilation failure, not a binding-size one, so query
  blocking has nothing to say about it; it needs its own diagnosis.
