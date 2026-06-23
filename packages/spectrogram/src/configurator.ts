import { type ExtSpectrogramConfig } from './common/extConfig.js';
import { applySpectrogramPatchConfig } from './common/patchConfig.js';
import { type SpectrogramMarkers } from './common/processorTimer.js';
import {
  allTrackKeys,
  buildSpectrogramConfig,
  type SpectrogramConfig,
  type TrackKey,
} from './config.cross.js';
import {
  createSpectrogramDrawCell,
  type SpectrogramDraw,
} from './draw/index.js';
import {
  createSpectrogramLaneCell,
  type SpectrogramLane,
  type SpectrogramLaneMarkers,
} from './lane/index.js';
import {
  createSpectrogramRemapCell,
  type SpectrogramRemap,
} from './remap/index.js';
import {
  createSpectrogramStateCell,
  type SpectrogramState,
} from './state/index.js';

export type SpectrogramTrack = {
  lane: SpectrogramLane;
  remap: SpectrogramRemap;
};

export type SpectrogramRuntime = {
  state: SpectrogramState;
  tracks: Record<TrackKey, SpectrogramTrack>;
  draw: SpectrogramDraw;
};

export type SpectrogramConfigurator = {
  configure: () => SpectrogramRuntime | undefined;
  updateConfig: (config?: Partial<SpectrogramConfig>) => void;
  dispose: () => void;
};

const pickLaneMarkers = (
  markers: SpectrogramMarkers,
  key: TrackKey,
): SpectrogramLaneMarkers => ({
  sliceSamples: markers[`${key}.sliceSamples`],
  windowing: markers[`${key}.windowing`],
  fourierReverse: markers[`${key}.fourierReverse`],
  fourierTransform: markers[`${key}.fourierTransform`],
  magnitudify: markers[`${key}.magnitudify`],
  decibelify: markers[`${key}.decibelify`],
  fundamentalFrequency: markers[`${key}.fundamentalFrequency`],
});

type TrackCells = {
  lane: ReturnType<typeof createSpectrogramLaneCell>;
  remap: ReturnType<typeof createSpectrogramRemapCell>;
};

export const createSpectrogramConfigurator = (
  device: GPUDevice,
  markers: SpectrogramMarkers,
): SpectrogramConfigurator => {
  let draftConfig: Partial<SpectrogramConfig> | undefined = undefined;
  let config: ExtSpectrogramConfig | undefined = undefined;
  let runtime: SpectrogramRuntime | undefined = undefined;

  const stateCell = createSpectrogramStateCell(device);
  const drawCell = createSpectrogramDrawCell(device, markers.draw);

  const trackCells = allTrackKeys.reduce(
    (acc, key) => {
      acc[key] = {
        lane: createSpectrogramLaneCell(device, {
          label: key,
          markers: pickLaneMarkers(markers, key),
        }),
        remap: createSpectrogramRemapCell(device, markers[`${key}.remap`]),
      };
      return acc;
    },
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {} as Record<TrackKey, TrackCells>,
  );

  const buildConfig = (): ExtSpectrogramConfig | undefined => {
    const baseConfig = buildSpectrogramConfig(config, draftConfig);
    if (!baseConfig) {
      return undefined;
    }
    draftConfig = undefined;
    return {
      ...baseConfig,
      windowCount: baseConfig.viewSize.width,
    };
  };

  return {
    configure: markers.configure(() => {
      if (!draftConfig) {
        return runtime;
      }

      const nextConfig = buildConfig();
      if (!nextConfig) {
        return undefined;
      }
      config = nextConfig;
      draftConfig = undefined;
      const state = stateCell.get(nextConfig);
      const { texture } = state;

      const tracks = allTrackKeys.reduce(
        (acc, key, index) => {
          const lane = trackCells[key].lane.get(nextConfig);
          const remap = trackCells[key].remap.get({
            rawMagnitude: lane.rawMagnitudeBuffer,
            columnEnergy: lane.columnEnergyBuffer,
            texture: texture.layerViews[index],
            config: nextConfig,
            gainDb: nextConfig.lanes[key].gainDb,
          });
          acc[key] = { lane, remap };
          return acc;
        },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as Record<TrackKey, SpectrogramTrack>,
      );

      const fundamentalFrequencies = allTrackKeys.reduce(
        (acc, key) => {
          acc[key] = tracks[key].lane.fundamentalFrequencyBuffer;
          return acc;
        },
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        {} as Record<TrackKey, GPUBuffer>,
      );

      const draw = drawCell.get({
        arrayView: texture.arrayView,
        fundamentalFrequencies,
        config: nextConfig,
      });

      runtime = {
        state,
        tracks,
        draw,
      };
      return runtime;
    }),
    updateConfig: (patchConfig) => {
      draftConfig = applySpectrogramPatchConfig({
        base: config,
        draft: draftConfig,
        patch: patchConfig,
      });
    },
    dispose: () => {
      stateCell.dispose();
      drawCell.dispose();
      for (const key of allTrackKeys) {
        trackCells[key].lane.dispose();
        trackCells[key].remap.dispose();
      }
    },
  };
};
