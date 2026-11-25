import {
  type LiveTakeChunk,
  type LiveTakeStart,
  type playerDataChannel,
  type PlayerStemLayouts,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import { type spectrogramDataChannel } from '../spectrogram/protocol.cross.js';
import { createPageReads, type PageReads } from './pageReads.worker.js';
import {
  createStemPageReaders,
  type StemPageReaders,
} from './stemPageReaders.worker.js';
import { type HeldTake } from './takePages.worker.js';
import {
  createStoredWholes,
  heldSources,
  loadStored,
  type RecordingPlace,
  type StoredRecording,
  storedSources,
} from './takeSources.worker.js';
import { type TakeSource } from './takeTracks.worker.js';

type PlayerPort = ReturnType<typeof playerDataChannel.outbound<MessagePort>>;

export type CreateAudioDecodeOptions = {
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export type AudioDecode = {
  connectPlayer: (port: PlayerPort) => boolean;
  mount: (message: RecordingPlace) => Promise<{
    frameCount: number;
  }>;
  setActiveRecording: (recordingId: number | undefined) => void;
  beginLiveTake: (take: LiveTakeStart) => void;
  patchLiveTake: (chunk: LiveTakeChunk) => void;
  holdTake: (take: HeldTake) => void;
  showTry: (take: HeldTake, samples: Float32Array<ArrayBuffer>) => void;
  hideTake: (takeId: string) => void;
  reloadRecording: (finishedTakeId?: string) => Promise<void>;
  requestTarget: (window: PlayerWindow) => void;
  unmount: () => void;
};

type MountedAudio = RecordingPlace &
  StoredRecording & {
    frameCount: number;
    layouts: PlayerStemLayouts;
  };

type Reload = {
  finishedTakeId?: string;
  switched?: boolean;
};

export const createAudioDecode = (
  options: CreateAudioDecodeOptions,
): AudioDecode => {
  const { spectrogramPort } = options;
  const wholes = createStoredWholes();
  let playerPort: PlayerPort | undefined = undefined;
  let readers: StemPageReaders | undefined = undefined;
  let pageReads: PageReads | undefined = undefined;
  let mounted: MountedAudio | undefined = undefined;
  let held: HeldTake | undefined = undefined;
  let activeRecordingId: number | undefined = undefined;
  let reloading: Promise<void> = Promise.resolve();
  let reloadOnMount: Reload | undefined = undefined;

  const sources = (audio: MountedAudio): TakeSource[] => [
    ...storedSources(audio),
    ...(held ? heldSources(held, audio.sampleRate) : []),
  ];

  const showTakes = () => {
    if (mounted) {
      pageReads?.setTakes(sources(mounted));
    }
  };

  const reloadPieces = async (reload: Reload): Promise<void> => {
    const current = mounted;
    if (!current) {
      reloadOnMount = { finishedTakeId: reload.finishedTakeId };
      return;
    }
    const recordingId = activeRecordingId;
    if (reload.switched && current.recordingId === recordingId) {
      return;
    }
    const stored = await loadStored(current, recordingId);
    if (mounted !== current || activeRecordingId !== recordingId) {
      return;
    }
    const switched =
      Boolean(reload.switched) || current.recordingId !== recordingId;
    current.recordingId = stored.recordingId;
    current.pieces = stored.pieces;
    if (switched || (held && held.takeId === reload.finishedTakeId)) {
      held = undefined;
    }
    showTakes();
    const pieces = await wholes.load(current);
    if (mounted !== current) {
      return;
    }
    spectrogramPort.methods.setRecordingPieces({
      pieces,
      finishedTakeId: reload.finishedTakeId,
      switched,
    });
  };

  const mountPlayer = (audio: MountedAudio, reads: PageReads) => {
    playerPort?.methods.mount({
      frameCount: audio.frameCount,
      layouts: audio.layouts,
      ...reads.takes(),
    });
  };

  const queueReload = async (reload: Reload): Promise<void> => {
    const next = reloading
      .catch(() => undefined)
      .then(async () => reloadPieces(reload));
    reloading = next;
    await next;
  };

  const createReads = (audio: MountedAudio, current: StemPageReaders) =>
    createPageReads({
      readers: current,
      layouts: audio.layouts,
      takes: sources(audio),
      sampleRate: audio.sampleRate,
      putPage: (page) => {
        playerPort?.methods.putPage(page);
      },
      dropPages: (pages) => {
        playerPort?.methods.dropPages({ pages });
      },
      setTakes: (takes) => {
        playerPort?.methods.setTakes(takes);
      },
      putLeadPage: (page) => {
        spectrogramPort.methods.putLeadPage(page);
      },
      failed: (error) => {
        console.error('Failed to read a page of a track', error);
      },
    });

  spectrogramPort.bindHandlers({
    requestLeadPages: (message) => {
      pageReads?.requestLeadPages(message.indices);
    },
  });

  return {
    connectPlayer: (port) => {
      playerPort = port;
      port.bindHandlers({
        requestWindow: (message) => {
          pageReads?.requestWindow(message);
        },
      });
      if (!mounted || !pageReads) {
        return false;
      }
      pageReads.forgetPlayer();
      mountPlayer(mounted, pageReads);
      return true;
    },
    mount: async (message) => {
      const { projectId, sampleRate } = message;
      const recordingId = activeRecordingId;
      readers ??= createStemPageReaders();
      const current = readers;
      pageReads?.close();
      pageReads = undefined;
      const [[lead, backing, instrumental], stored] = await Promise.all([
        Promise.all([
          current.lead.open(projectId, sampleRate),
          current.backing.open(projectId, sampleRate),
          current.instrumental.open(projectId, sampleRate),
        ]),
        loadStored(message, recordingId),
      ]);
      const audio: MountedAudio = {
        projectId,
        sampleRate,
        frameCount: Math.max(
          lead.frameCount,
          backing.frameCount,
          instrumental.frameCount,
        ),
        layouts: {
          lead: { frameCount: lead.frameCount, pageStarts: lead.pageStarts },
          backing: {
            frameCount: backing.frameCount,
            pageStarts: backing.pageStarts,
          },
          instrumental: {
            frameCount: instrumental.frameCount,
            pageStarts: instrumental.pageStarts,
          },
        },
        ...stored,
      };
      held = undefined;
      const pieces = await wholes.load(audio);
      mounted = audio;
      pageReads = createReads(audio, current);
      spectrogramPort.methods.mount({
        lead: audio.layouts.lead,
        recording: pieces,
      });
      mountPlayer(audio, pageReads);
      const pending = reloadOnMount;
      reloadOnMount = undefined;
      if (pending || activeRecordingId !== recordingId) {
        queueReload(pending ?? {}).catch((error: unknown) => {
          console.error('Failed to reload the recording', error);
        });
      }
      return { frameCount: audio.frameCount };
    },
    setActiveRecording: (recordingId) => {
      if (activeRecordingId === recordingId) {
        return;
      }
      activeRecordingId = recordingId;
      if (!mounted) {
        return;
      }
      queueReload({ switched: true }).catch((error: unknown) => {
        console.error('Failed to switch the recording', error);
      });
    },
    beginLiveTake: (take) => {
      spectrogramPort.methods.beginLiveTake(take);
    },
    patchLiveTake: (chunk) => {
      spectrogramPort.methods.appendLiveTake({
        ...chunk,
        samples: chunk.samples.slice(),
      });
    },
    holdTake: (take) => {
      held = take;
      showTakes();
    },
    showTry: (take, samples) => {
      held = take;
      showTakes();
      spectrogramPort.methods.beginLiveTake({
        takeId: take.takeId,
        tempo: take.tempo,
        transpose: take.transpose,
        octave: take.octave,
      });
      spectrogramPort.methods.appendLiveTake({
        startFrame: take.runs[0].startFrame,
        offset: 0,
        samples,
      });
    },
    hideTake: (takeId) => {
      if (held?.takeId === takeId) {
        held = undefined;
        showTakes();
      }
      if (mounted) {
        spectrogramPort.methods.setRecordingPieces({
          pieces: wholes.copy(mounted.pieces),
          finishedTakeId: takeId,
        });
      }
    },
    reloadRecording: async (finishedTakeId) => queueReload({ finishedTakeId }),
    requestTarget: (window) => {
      pageReads?.requestTarget(window);
    },
    unmount: () => {
      mounted = undefined;
      held = undefined;
      pageReads?.close();
      pageReads = undefined;
      reloadOnMount = undefined;
      activeRecordingId = undefined;
      playerPort?.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
