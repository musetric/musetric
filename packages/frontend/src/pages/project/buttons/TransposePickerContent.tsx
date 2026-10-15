import { Divider, Stack } from '@mui/material';
import { maxTransposeSemitones, minTransposeSemitones } from '@musetric/audio';
import { useQuery } from '@tanstack/react-query';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/index.js';
import { routes } from '../../../app/router/routes.js';
import { engine } from '../../../engine/engine.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { formatKeyCompact, transposeKeyRoot } from '../key/keyFormat.js';
import { formatTransposeSemitones } from './formatTransposeSemitones.js';
import { ScaleSlider } from './ScaleSlider.js';
import { SingerVoiceToggle } from './SingerVoiceToggle.js';
import { VoiceOctaveToggle } from './VoiceOctaveToggle.js';

export const TransposePickerContent: FC = () => {
  const { t } = useTranslation();
  const { projectId } = routes.project.useAssertMatch();
  const recording = useEngineStore((state) => state.recording);
  const transposeSemitones = useEngineStore(
    (state) => state.transposeSemitones,
  );
  const voiceOctave = useEngineStore((state) => state.voiceOctave);
  const original = transposeSemitones === 0 && voiceOctave === 0;
  const keyQuery = useQuery(endpoints.key.get(projectId));
  const sourceKey = keyQuery.status === 'success' ? keyQuery.data : undefined;

  return (
    <Stack sx={{ gap: 3.5 }}>
      <ScaleSlider
        title={t('pages.project.player.controls.transposeTitle')}
        caption={t('pages.project.player.controls.transposeCaption')}
        value={transposeSemitones}
        min={minTransposeSemitones}
        max={maxTransposeSemitones}
        original={0}
        largeTickEvery={maxTransposeSemitones}
        mediumTickEvery={1}
        valueText={formatTransposeSemitones(transposeSemitones)}
        unit={t('pages.project.player.controls.semitoneUnit')}
        info={
          sourceKey === undefined
            ? undefined
            : formatKeyCompact(
                transposeKeyRoot(sourceKey.root, transposeSemitones),
                sourceKey.mode,
              )
        }
        originalInfo={
          sourceKey === undefined
            ? undefined
            : formatKeyCompact(
                transposeKeyRoot(sourceKey.root, 0),
                sourceKey.mode,
              )
        }
        labels={[minTransposeSemitones, maxTransposeSemitones].map(
          (semitones) => ({
            value: semitones,
            label: formatTransposeSemitones(semitones),
          }),
        )}
        disabled={recording}
        onReset={
          original
            ? undefined
            : () => {
                engine.store.update((state) => {
                  state.transposeSemitones = 0;
                  state.voiceOctave = 0;
                });
              }
        }
        onChange={(semitones) => {
          engine.store.update((state) => {
            state.transposeSemitones = semitones;
          });
        }}
      />
      <Divider />
      <VoiceOctaveToggle />
      <Divider />
      <SingerVoiceToggle />
    </Stack>
  );
};
