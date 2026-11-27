import { type Engine } from '@musetric/engine';

export type OutputMode = 'silent' | 'aloud';

const gains: Record<OutputMode, number> = { silent: 0, aloud: 1 };

export const setOutput = (engine: Engine, mode: OutputMode) => {
  const node = engine.audioOutput.getOutputNode();
  if (!(node instanceof GainNode)) {
    throw new Error(
      'The page has no output gain to mute: build Musetric with frontendMeasure=true from the commit of this measure package',
    );
  }
  node.gain.value = gains[mode];
  if (node.context !== engine.context || node.gain.value !== gains[mode]) {
    throw new Error(
      `The output of the page is not ${mode}: the command stops before it plays`,
    );
  }
};
