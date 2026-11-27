# @musetric/transport

The pure core of the player's position and transport, which
[`@musetric/engine`](../engine/readme.md) runs on the main thread and in its
audio worklet. Its TypeScript `lib` holds neither the DOM nor the AudioWorklet,
so it knows no port, node, timer or clock of its own: the engine passes in
every frame and every callback.

- **The timeline map** (`heardPosition.ts`, with `renderHistory.ts` and
  `rangeFrames.ts`) maps the context frames the worklet renders to the song
  frames heard, and is the only writer of the position
  ([#1369](https://github.com/musetric/musetric/issues/1369)). `playhead.ts`
  holds the value it publishes.
- **The session machine** (`session.ts`) holds what the user asked for, and
  writes the four readings of the transport into the engine's state with each
  transition ([#1371](https://github.com/musetric/musetric/issues/1371)).
- **The motion machine** (`motion.ts`) holds what the worklet really plays.

The timeline map and the motion machine run on the audio thread, and the
engine's lint follows their calls there with `musetric/no-audio-thread-allocations`.
A directive of that rule in this package is read when the engine is linted,
so this package's own lint, which sees no audio thread, does not report it
as unused (`eslint.config.ts`).
