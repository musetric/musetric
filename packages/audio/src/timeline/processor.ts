import { type TimelineConfig } from './config.js';
import { createTimelineConfigurator } from './configurator.js';

export type TimelineProcessor = {
  render: () => boolean;
  updateConfig: (config?: Partial<TimelineConfig>) => void;
  dispose: () => void;
};

export type CreateTimelineProcessorOptions = {
  config?: Partial<TimelineConfig>;
};

export const createTimelineProcessor = (
  options: CreateTimelineProcessorOptions = {},
): TimelineProcessor => {
  const configurator = createTimelineConfigurator();
  configurator.updateConfig(options.config);

  return {
    render: () => {
      const runtime = configurator.configure();
      if (!runtime) {
        return false;
      }

      runtime.draw.run(runtime.config);
      return true;
    },
    updateConfig: configurator.updateConfig,
    dispose: configurator.dispose,
  };
};
