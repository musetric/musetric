import { Stack } from '@mui/material';
import { type api } from '@musetric/api';
import { type FC, useEffect } from 'react';
import { engine } from '../../engine/engine.js';
import { useEngineStore } from '../../engine/useEngineStore.js';
import { AudioSettings } from './audioSettings/AudioSettings.js';
import { MicrophoneAccessDialog } from './audioSettings/MicrophoneAccessDialog.js';
import { TempoPicker } from './buttons/TempoPicker.js';
import { TransposePicker } from './buttons/TransposePicker.js';
import { CalibrationDialog } from './calibration/CalibrationDialog.js';
import { subscribeLoopBack } from './loop/subscribeLoopBack.js';
import { MediaSessionSync } from './mediaSession/MediaSessionSync.js';
import { MixPopover } from './mix/MixPopover.js';
import { MixdownDialog } from './mixdown/MixdownDialog.js';
import { PlaybackPanel } from './player/PlaybackPanel.js';
import { PlayerFailedNotice } from './player/PlayerFailedNotice.js';
import { ProjectContent } from './ProjectContent/index.js';
import { ProjectLayout } from './ProjectPageLayout.js';
import { RealtimeNotice } from './RealtimeNotice.js';
import { RecordingDeleteDialog } from './recording/RecordingDeleteDialog.js';
import { RecordingListPicker } from './recording/RecordingListPicker.js';
import { subscribeTakeInterruptions } from './recording/subscribeTakeInterruptions.js';
import { TakeRefusedNotice } from './recording/TakeRefusedNotice.js';
import { RhythmMetronomeSync } from './rhythm/RhythmMetronomeSync.js';
import { ProjectSettings } from './settings/field/ProjectSettings.js';
import { subscribeSettingsStore } from './settings/store.js';
import { ProjectShortcuts } from './shortcuts/ProjectShortcuts.js';
import { VoiceRangeSync } from './spectrogram/VoiceRangeSync.js';

export type ProjectAppProps = {
  project: api.project.Item;
};
export const ProjectApp: FC<ProjectAppProps> = (props) => {
  const { project } = props;
  const playerFailed = useEngineStore(
    (state) => state.statuses.player === 'error',
  );
  const takeRefused = useEngineStore(
    (state) => state.takeRefusal !== undefined,
  );

  useEffect(() => subscribeSettingsStore(), []);
  useEffect(() => subscribeTakeInterruptions(), []);
  useEffect(() => subscribeLoopBack(), []);

  useEffect(() => {
    engine.player.setSourceGainDb(project.audioAnalysis?.sourceGainDb ?? 0);
    engine.view.setLeadSpectrogramGainDb(
      project.audioAnalysis?.leadSpectrogramGainDb ?? 0,
    );
  }, [project.audioAnalysis]);

  useEffect(() => engine.decoder.mount(project.id), [project.id]);

  return (
    <ProjectLayout framed>
      <Stack sx={{ width: '100%', flexGrow: 1, minHeight: 0, gap: 2 }}>
        <RealtimeNotice />
        <ProjectContent />
        <PlaybackPanel />
      </Stack>
      {playerFailed && <PlayerFailedNotice />}
      {takeRefused && <TakeRefusedNotice />}
      <RhythmMetronomeSync projectId={project.id} />
      <MediaSessionSync title={project.name} coverUrl={project.previewUrl} />
      <ProjectShortcuts projectId={project.id} />
      <VoiceRangeSync
        projectId={project.id}
        leadSpectrogramGainDb={
          project.audioAnalysis?.leadSpectrogramGainDb ?? 0
        }
      />
      <AudioSettings />
      <ProjectSettings />
      <TransposePicker />
      <TempoPicker />
      <MixPopover />
      <MixdownDialog />
      <RecordingListPicker />
      <RecordingDeleteDialog />
      <CalibrationDialog />
      <MicrophoneAccessDialog />
    </ProjectLayout>
  );
};
