# @musetric/engine

The audio engine of the interface. Its [readme](readme.md) maps the parts, the
position and the transport; the rules of the repository are in its
[AGENTS.md](../../AGENTS.md) and are not repeated here.

## Before changing

- The cursor, playback, a seek, a hold or the loop: headquarters'
  [player.md](https://github.com/musetric/headquarters/blob/main/player.md)
  states what the user must see and hear.
- Recording: a take is never lost, and what reached the host stays there
  ([#1201](https://github.com/musetric/musetric/issues/1201)).

## Rules

- A new command sends its message to a worker or the worklet itself, as those
  of `player/settings.ts` do, and never writes a field of the store for a
  subscription to forward: the order of messages would then be the order of
  subscriptions ([#1370](https://github.com/musetric/musetric/issues/1370)).

## Before finishing

- `pnpm --filter @musetric/dsp build:project`, once per checkout, since the
  tests run on its WebAssembly.
- `pnpm --filter @musetric/engine test`, `check:ts` and `check:lint`, then
  the repository's checks.
- A change of the position, the transport or the audio thread is measured by
  `measure:cursor` of [`@musetric/measure`](../measure/readme.md) on a device.
