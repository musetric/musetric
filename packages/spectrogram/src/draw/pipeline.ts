import { fragmentShader } from './fragment.wgsl.js';
import { vertexShader } from './vertex.wgsl.js';

export const createPipeline = (
  device: GPUDevice,
  context: GPUCanvasContext,
) => {
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });

  const vertexModule = device.createShaderModule({
    label: 'draw-vertex-shader',
    code: vertexShader,
  });
  const fragmentModule = device.createShaderModule({
    label: 'draw-fragment-shader',
    code: fragmentShader,
  });

  return device.createRenderPipeline({
    label: 'draw-pipeline',
    layout: 'auto',
    vertex: { module: vertexModule, entryPoint: 'main' },
    fragment: {
      module: fragmentModule,
      entryPoint: 'main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });
};
