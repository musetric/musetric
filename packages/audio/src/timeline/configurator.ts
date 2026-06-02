import { applyPatchConfig } from '@musetric/resource-utils';
import { buildTimelineConfig, type TimelineConfig } from './config.js';
import { createTimelineDraw, type TimelineDraw } from './draw/index.js';

export type TimelineRuntime = {
  config: TimelineConfig;
  draw: TimelineDraw;
};

export type TimelineConfigurator = {
  configure: () => TimelineRuntime | undefined;
  updateConfig: (config?: Partial<TimelineConfig>) => void;
  dispose: () => void;
};

export const createTimelineConfigurator = (): TimelineConfigurator => {
  let draftConfig: Partial<TimelineConfig> | undefined = undefined;
  let config: TimelineConfig | undefined = undefined;
  let runtime: TimelineRuntime | undefined = undefined;
  const draw = createTimelineDraw();

  const buildConfig = () => {
    const nextConfig = buildTimelineConfig(config, draftConfig);
    if (!nextConfig) {
      return undefined;
    }

    draftConfig = undefined;
    return nextConfig;
  };

  return {
    configure: () => {
      if (!draftConfig) {
        return runtime;
      }

      config = buildConfig();
      if (!config) {
        return undefined;
      }

      runtime = {
        config,
        draw,
      };

      return runtime;
    },
    updateConfig: (patchConfig) => {
      draftConfig = applyPatchConfig({
        base: config,
        draft: draftConfig,
        patch: patchConfig,
      });
    },
    dispose: () => {
      draftConfig = undefined;
      config = undefined;
      runtime = undefined;
      draw.dispose();
    },
  };
};
