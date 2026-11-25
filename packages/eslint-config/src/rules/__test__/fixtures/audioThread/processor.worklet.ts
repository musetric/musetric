import { createRuntime, type Runtime } from './runtime.worklet.js';

const AudioWorkletProcessor = class {};

export class Processor extends AudioWorkletProcessor {
  readonly runtime: Runtime = createRuntime({ read: () => [0] });

  process(): boolean {
    this.runtime.process();
    return true;
  }
}
