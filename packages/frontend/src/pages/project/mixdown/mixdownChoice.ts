import { api } from '@musetric/api';
import { z } from 'zod';

const storageKey = 'musetric.mixdown.choice';

export const mixdownFormatNames = [
  'flac',
  'mp3',
  'm4a',
  'wav',
] as const satisfies readonly api.mixdown.Format['format'][];

const mixdownChoiceSchema = z.object({
  format: z.enum(mixdownFormatNames),
  bitrate: api.mixdown.bitrateSchema,
  bitDepth: api.mixdown.bitDepthSchema,
});

export type MixdownChoice = z.infer<typeof mixdownChoiceSchema>;

const firstMixdownChoice: MixdownChoice = {
  format: 'flac',
  bitrate: 256,
  bitDepth: 16,
};

export const loadMixdownChoice = (): MixdownChoice => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return firstMixdownChoice;
    }
    const parsed = mixdownChoiceSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : firstMixdownChoice;
  } catch (error) {
    console.error('Failed to load the choice of the last export', error);
    return firstMixdownChoice;
  }
};

export const saveMixdownChoice = (choice: MixdownChoice): void => {
  try {
    localStorage.setItem(storageKey, JSON.stringify(choice));
  } catch (error) {
    console.error('Failed to keep the choice of the export', error);
  }
};
