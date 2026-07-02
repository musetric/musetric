import { createFourierCell } from '@musetric/fft/gpu';
import { createSpectrogramDecibelifyCell } from '../decibelify/index.js';
import { createSpectrogramMagnitudifyCell } from '../magnitudify/index.js';
import { createSpectrogramSliceSamplesCell } from '../sliceSamples/index.js';
import { createSignalBufferCell } from '../state/signal.js';

export type BandPipelineCells = {
  signalCell: ReturnType<typeof createSignalBufferCell>;
  sliceSamplesCell: ReturnType<typeof createSpectrogramSliceSamplesCell>;
  fourierCell: ReturnType<typeof createFourierCell>;
  magnitudifyCell: ReturnType<typeof createSpectrogramMagnitudifyCell>;
  decibelifyCell: ReturnType<typeof createSpectrogramDecibelifyCell>;
};

export const createBandPipelineCells = (
  device: GPUDevice,
): BandPipelineCells => ({
  signalCell: createSignalBufferCell(device),
  sliceSamplesCell: createSpectrogramSliceSamplesCell(device),
  fourierCell: createFourierCell(device),
  magnitudifyCell: createSpectrogramMagnitudifyCell(device),
  decibelifyCell: createSpectrogramDecibelifyCell(device),
});

export const disposeBandPipelineCells = (cells: BandPipelineCells): void => {
  cells.decibelifyCell.dispose();
  cells.magnitudifyCell.dispose();
  cells.fourierCell.dispose();
  cells.sliceSamplesCell.dispose();
  cells.signalCell.dispose();
};
