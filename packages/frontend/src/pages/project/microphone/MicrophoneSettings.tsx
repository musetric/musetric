import CloseIcon from '@mui/icons-material/Close';
import {
  Alert,
  Box,
  Button,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import {
  createMicrophoneAudioConstraints,
  getInitialMicrophoneLatencyFrameCount,
  maximumRecordingLatencyMs,
  minimumRecordingLatencyMs,
} from '@musetric/audio/recording';
import { type FC, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { engine } from '../../../engine/engine.js';
import { runMicrophoneLatencyCalibration } from '../../../engine/microphoneLatencyCalibration.js';
import { useEngineStore } from '../../../engine/useEngineStore.js';
import { useProjectStore } from '../store.js';

const meterScale = 8;

const stopStream = (stream: MediaStream) => {
  for (const track of stream.getTracks()) {
    track.stop();
  }
};

const getAudioDevices = async () => {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === 'audioinput' || device.kind === 'audiooutput',
  );
};

const getAudioInputDevices = (devices: MediaDeviceInfo[]) =>
  devices.filter((device) => device.kind === 'audioinput');

export const MicrophoneSettings: FC = () => {
  const { t } = useTranslation();
  const open = useProjectStore((state) => state.microphoneSettingsOpen);
  const setOpen = useProjectStore((state) => state.setMicrophoneSettingsOpen);
  const microphoneDeviceId = useEngineStore(
    (state) => state.microphoneDeviceId,
  );
  const microphoneLatencyFrameCount = useEngineStore(
    (state) => state.microphoneLatencyFrameCount,
  );
  const recording = useEngineStore((state) => state.recording);
  const recordingGain = useEngineStore((state) => state.recordingGain);
  const previewStreamRef = useRef<MediaStream | undefined>(undefined);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [calibrating, setCalibrating] = useState(false);
  const [error, setError] = useState<string>();
  const latencyMs = Math.round(
    (microphoneLatencyFrameCount / engine.context.sampleRate) * 1000,
  );
  const gainedLevel = Math.min(1, level * recordingGain);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let active = true;
    let stream: MediaStream | undefined = undefined;
    let source: MediaStreamAudioSourceNode | undefined = undefined;
    let analyser: AnalyserNode | undefined = undefined;
    let animationFrame: number | undefined = undefined;

    const refreshDevices = async () => {
      const audioDevices = await getAudioDevices();
      if (active) {
        setDevices(getAudioInputDevices(audioDevices));
      }
      return audioDevices;
    };

    const updateLevel = () => {
      if (!active || !analyser) {
        return;
      }

      const samples = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) {
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / samples.length);
      setLevel(Math.min(1, rms * meterScale));
      animationFrame = requestAnimationFrame(updateLevel);
    };

    const startPreview = async () => {
      try {
        setError(undefined);
        if (engine.context.state === 'suspended') {
          await engine.context.resume();
        }
        stream = await navigator.mediaDevices.getUserMedia({
          audio: createMicrophoneAudioConstraints({
            deviceId: microphoneDeviceId,
            sampleRate: engine.context.sampleRate,
          }),
        });
        if (!active) {
          stopStream(stream);
          return;
        }

        previewStreamRef.current = stream;
        const audioDevices = await refreshDevices();
        const latencyFrameCount = getInitialMicrophoneLatencyFrameCount(
          engine.context,
          stream,
          audioDevices,
        );
        engine.store.update((state) => {
          if (!state.microphoneLatencyUserSet) {
            state.microphoneLatencyFrameCount = latencyFrameCount;
          }
        });
        analyser = engine.context.createAnalyser();
        analyser.fftSize = 1024;
        source = engine.context.createMediaStreamSource(stream);
        source.connect(analyser);
        updateLevel();
      } catch (previewError) {
        console.error('Failed to open microphone preview', previewError);
        if (active) {
          setError(t('pages.project.microphoneSettings.error'));
          await refreshDevices();
        }
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    void startPreview();

    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        refreshDevices,
      );
      if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
      }
      source?.disconnect();
      analyser?.disconnect();
      if (stream) {
        if (previewStreamRef.current === stream) {
          previewStreamRef.current = undefined;
        }
        stopStream(stream);
      }
      setLevel(0);
    };
  }, [microphoneDeviceId, open, t]);

  const calibrate = async () => {
    try {
      setCalibrating(true);
      setError(undefined);
      if (engine.context.state === 'suspended') {
        await engine.context.resume();
      }
      const calibrationResult = await runMicrophoneLatencyCalibration({
        context: engine.context,
        deviceId: microphoneDeviceId,
        stream: previewStreamRef.current,
      });
      if (!calibrationResult) {
        setError(t('pages.project.microphoneSettings.calibrationFailed'));
        return;
      }

      console.info(
        'Microphone latency calibration samples',
        calibrationResult.measuredLatencyFrameCounts.map((frameCount) =>
          Math.round((frameCount / engine.context.sampleRate) * 1000),
        ),
      );
      engine.store.update((state) => {
        state.microphoneLatencyFrameCount = calibrationResult.latencyFrameCount;
        state.microphoneLatencyUserSet = true;
      });
    } catch (calibrationError) {
      console.error('Failed to calibrate microphone latency', calibrationError);
      setError(t('pages.project.microphoneSettings.calibrationFailed'));
    } finally {
      setCalibrating(false);
    }
  };

  return (
    <Drawer anchor='right' open={open} onClose={() => setOpen(false)}>
      <Box width={320} p={2} role='presentation'>
        <Stack gap={4}>
          <Stack direction='row' alignItems='center'>
            <Typography variant='h6' sx={{ flexGrow: 1 }}>
              {t('pages.project.microphoneSettings.title')}
            </Typography>
            <IconButton size='small' onClick={() => setOpen(false)}>
              <CloseIcon />
            </IconButton>
          </Stack>
          {error && <Alert severity='error'>{error}</Alert>}
          <FormControl fullWidth>
            <InputLabel>
              {t('pages.project.microphoneSettings.device')}
            </InputLabel>
            <Select
              label={t('pages.project.microphoneSettings.device')}
              disabled={recording}
              value={microphoneDeviceId ?? ''}
              onChange={(event) => {
                const nextDeviceId = event.target.value || undefined;
                engine.store.update((state) => {
                  state.microphoneDeviceId = nextDeviceId;
                  state.microphoneLatencyUserSet = false;
                });
              }}
            >
              <MenuItem value=''>
                {t('pages.project.microphoneSettings.defaultDevice')}
              </MenuItem>
              {devices.map((device, index) => (
                <MenuItem key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    t('pages.project.microphoneSettings.deviceFallback', {
                      value: index + 1,
                    })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Stack gap={0.5}>
            <Typography variant='body2'>
              {t('pages.project.microphoneSettings.latency', {
                value: latencyMs,
              })}
            </Typography>
            {recording && (
              <Typography variant='caption' color='text.secondary'>
                {t('pages.project.microphoneSettings.deviceLocked')}
              </Typography>
            )}
          </Stack>
          <Stack gap={1}>
            <Slider
              min={minimumRecordingLatencyMs}
              max={maximumRecordingLatencyMs}
              step={10}
              value={latencyMs}
              onChange={(_, value) => {
                if (Array.isArray(value)) {
                  return;
                }
                engine.store.update((state) => {
                  state.microphoneLatencyFrameCount = Math.round(
                    (value / 1000) * engine.context.sampleRate,
                  );
                  state.microphoneLatencyUserSet = true;
                });
              }}
            />
            <Button
              variant='outlined'
              disabled={recording || calibrating}
              onClick={() => {
                void calibrate();
              }}
            >
              {calibrating
                ? t('pages.project.microphoneSettings.calibrating')
                : t('pages.project.microphoneSettings.calibrate')}
            </Button>
          </Stack>
          <Stack gap={1}>
            <Typography variant='body2'>
              {t('pages.project.microphoneSettings.level')}
            </Typography>
            <LinearProgress variant='determinate' value={gainedLevel * 100} />
          </Stack>
          <Stack gap={1}>
            <Typography variant='body2'>
              {t('pages.project.microphoneSettings.gain', {
                value: Math.round(recordingGain * 100),
              })}
            </Typography>
            <Slider
              min={0}
              max={200}
              step={5}
              value={Math.round(recordingGain * 100)}
              onChange={(_, value) => {
                if (Array.isArray(value)) {
                  return;
                }
                engine.store.update((state) => {
                  state.recordingGain = value / 100;
                });
              }}
            />
          </Stack>
        </Stack>
      </Box>
    </Drawer>
  );
};
