import { type ResourceCell } from '@musetric/utils';
import { resolveFourierBatchRange } from '../batchRange.js';
import { type ParamsRing } from '../params.js';
import {
  type CreateFourier,
  type Fourier,
  type FourierArg,
  type FourierBatchRange,
} from '../types.js';

type MultiPassDispatchState = {
  kind: 'multiPass';
  windowCount: number;
  params: ParamsRing;
  variant: { kernels: readonly { workgroupCount: number }[] };
  pipeline: { stages: readonly GPUComputePipeline[] };
  getStageBindGroups: (slot: number) => readonly GPUBindGroup[];
};

type SinglePassDispatchState = {
  kind: 'singlePass' | 'stockham' | 'inPlaceRadix4' | 'inPlaceMixed';
  windowCount: number;
  params: ParamsRing;
  pipeline: { transform: GPUComputePipeline };
  getBindGroup: (slot: number) => GPUBindGroup;
};

export type StockhamDispatchState =
  | MultiPassDispatchState
  | SinglePassDispatchState;

export const createStockhamFourier =
  <S extends StockhamDispatchState>(
    createStateCell: (device: GPUDevice) => ResourceCell<FourierArg, S>,
    transformLabel: string,
  ): CreateFourier =>
  (device, markers) => {
    const stateCell = createStateCell(device);

    return {
      get: (arg): Fourier => {
        const state: StockhamDispatchState = stateCell.get(arg);

        const dispatch = (
          pass: GPUComputePassEncoder,
          range?: FourierBatchRange,
        ): void => {
          const { batchOffset, batchCount } = resolveFourierBatchRange(
            range,
            state.windowCount,
          );
          if (batchCount === 0) {
            return;
          }
          const slot = state.params.reserve(batchOffset);

          if (state.kind === 'multiPass') {
            const stages = state.getStageBindGroups(slot);
            state.pipeline.stages.forEach((stagePipeline, index) => {
              const kernel = state.variant.kernels[index];
              pass.setPipeline(stagePipeline);
              pass.setBindGroup(0, stages[index]);
              pass.dispatchWorkgroups(batchCount, kernel.workgroupCount);
            });
            return;
          }

          pass.setPipeline(state.pipeline.transform);
          pass.setBindGroup(0, state.getBindGroup(slot));
          pass.dispatchWorkgroups(batchCount);
        };

        return {
          run: (encoder) => {
            const pass = encoder.beginComputePass({
              label: transformLabel,
              timestampWrites: markers?.transform,
            });
            dispatch(pass);
            pass.end();
          },
          dispatch,
        };
      },
      dispose: () => {
        stateCell.dispose();
      },
    };
  };
