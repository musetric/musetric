import { type CqtPlan } from '../plan.es.js';
import { decodeCqtPlanArtifact } from '../planDecode.es.js';
import { referencePlanBase64 } from './planPayload.js';

const getReferencePlanArtifact = (): Uint8Array => {
  const binary = atob(referencePlanBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const getReferencePlan = (): CqtPlan =>
  decodeCqtPlanArtifact(getReferencePlanArtifact());

export const referenceCqtConfig = getReferencePlan().config;
