import { fundamentalChannel } from '../common/fundamentalChannel.cross.js';
import { createPlayhead } from '../player/playhead.cross.js';
import {
  spectrogramChannel,
  spectrogramDataChannel,
} from './protocol.cross.js';
import { createRenderHook } from './renderHook.worker.js';
import { createSpectrogramRuntime } from './runtime.worker.js';

const profiling = import.meta.env.frontendSpectrogramProfiling === 'true';
const renderHook =
  import.meta.env.frontendMeasure === 'true' ? createRenderHook() : undefined;
if (renderHook) {
  // eslint-disable-next-line musetric/no-global-state -- the measure build gives the external driver one entry point
  Object.assign(globalThis, {
    musetricMeasureHooks: { setRenderListener: renderHook.setListener },
  });
}
const port = spectrogramChannel.inbound(self);

const reportError = () => {
  port.methods.setState({
    status: 'error',
  });
};
self.addEventListener('error', reportError);
self.addEventListener('unhandledrejection', reportError);
self.addEventListener('messageerror', reportError);

port.bindBoot(async (message) => {
  await createSpectrogramRuntime({
    port,
    dataPort: spectrogramDataChannel.inbound(message.dataPort),
    playhead: createPlayhead(message.playheadPort, message.sampleRate),
    fundamentalPort: fundamentalChannel.outbound(message.fundamentalPort),
    profiling,
    onRendered: renderHook?.notify,
  });
  port.methods.booted();
});
