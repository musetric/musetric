import { describe, expect, it } from 'vitest';
import { verifyCqtPlanArtifact } from '../planDecode.es.js';
import {
  getReferencePlan,
  getReferencePlanArtifact,
  verifyReferencePlan,
} from './plan.js';

describe('CQT plan artifact', () => {
  it('decodes the frozen librosa plan', () => {
    const plan = getReferencePlan();
    expect(plan.earlyDownsampleCount).toBe(1);
    expect(plan.octaves).toHaveLength(6);
    expect(plan.fftBins).toHaveLength(1818);
    expect(plan.coefficients).toHaveLength(3636);
    expect(plan.downsample.halfCoefficients).toHaveLength(128);
  });

  it('accepts an artifact whose payload matches its own SHA-256', async () => {
    await expect(verifyReferencePlan()).resolves.toMatchObject({
      formatVersion: 1,
    });
  });

  it('rejects a corrupted payload', async () => {
    const artifact = getReferencePlanArtifact();
    artifact[artifact.length - 1] ^= 1;
    await expect(verifyCqtPlanArtifact(artifact)).rejects.toThrow(RangeError);
  });
});
