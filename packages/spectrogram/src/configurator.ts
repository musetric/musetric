import { applyPatchConfig } from '@musetric/utils';
import { spectrogramConfigFieldEqual } from './common/configFieldEqual.js';
import {
  computeColumnStep,
  type ExtSpectrogramConfig,
} from './common/extConfig.js';
import { type SpectrogramMarkers } from './common/processorTimer.js';
import {
  createSpectrogramComparisonColorCell,
  type SpectrogramComparisonColor,
} from './comparison/index.js';
import {
  allTrackKeys,
  buildSpectrogramConfig,
  mapTrackKeys,
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
  remap?: SpectrogramRemap;
};

export type SpectrogramRuntime = {
  config: ExtSpectrogramConfig;
  state: SpectrogramState;
  tracks: Record<TrackKey, SpectrogramTrack>;
  draw: SpectrogramDraw;
  comparisonColor: SpectrogramComparisonColor;
};

export type SpectrogramConfigurator = {
  configure: () => SpectrogramRuntime | undefined;
  updateConfig: (config?: Partial<SpectrogramConfig>) => void;
  dispose: () => void;
};

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
  const drawCell = createSpectrogramDrawCell(device, () =>
    markers.getGpuMarker('draw'),
  );
  const colorCell = createSpectrogramComparisonColorCell(device);

  const trackCells = mapTrackKeys<TrackCells>((key) => ({
    lane: createSpectrogramLaneCell(device, { label: key }),
    remap: createSpectrogramRemapCell(device),
  }));

  const buildConfig = (): ExtSpectrogramConfig | undefined => {
    const baseConfig = buildSpectrogramConfig(config, draftConfig);
    if (!baseConfig) {
      return undefined;
    }
    draftConfig = undefined;
    const windowCount = baseConfig.viewSize.width;
    return {
      ...baseConfig,
      windowCount,
      columnStep: computeColumnStep({ ...baseConfig, windowCount }),
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

      const tracks = mapTrackKeys<SpectrogramTrack>((key, index) => {
        const lane = trackCells[key].lane.get(nextConfig);
        const remap = nextConfig.lanes[key].showSpectrogram
          ? trackCells[key].remap.get({
              spectra: lane.bandSpectra,
              texture: texture.layerViews[index],
              config: nextConfig,
              gainDb: nextConfig.lanes[key].gainDb,
            })
          : undefined;
        return { lane, remap };
      });

      const fundamentalLines = mapTrackKeys<GPUBuffer>(
        (key) => tracks[key].lane.fundamentalLineBuffer,
      );
      const { reference, target } = nextConfig.comparison;
      const comparisonColor = colorCell.get({
        config: nextConfig,
        referenceLine: fundamentalLines[reference],
        targetLine: fundamentalLines[target],
      });

      const draw = drawCell.get({
        arrayView: texture.arrayView,
        fundamentalLines,
        verdict: comparisonColor.verdictBuffer,
        config: nextConfig,
      });

      runtime = {
        config: nextConfig,
        state,
        tracks,
        draw,
        comparisonColor,
      };
      return runtime;
    }),
    updateConfig: (patchConfig) => {
      draftConfig = applyPatchConfig({
        base: config,
        draft: draftConfig,
        patch: patchConfig,
        isEqual: spectrogramConfigFieldEqual,
      });
    },
    dispose: () => {
      stateCell.dispose();
      drawCell.dispose();
      colorCell.dispose();
      for (const key of allTrackKeys) {
        trackCells[key].lane.dispose();
        trackCells[key].remap.dispose();
      }
    },
  };
};
