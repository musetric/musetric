import {
  type LiveTakeChunk,
  type playerDataChannel,
  type PlayerStemLayouts,
  type PlayerWindow,
} from '../player/protocol.cross.js';
import {
  type spectrogramDataChannel,
  spectrogramLeadKey,
  type SpectrogramTakes,
} from '../spectrogram/protocol.cross.js';
import { createPageReads, type PageReads } from './pageReads.worker.js';
import {
  createStemPageReaders,
  type StemPageReaders,
} from './stemPageReaders.worker.js';
import { type HeldTake } from './takePages.worker.js';
import {
  heldSources,
  liveSources,
  loadStored,
  type RecordingPlace,
  type StoredRecording,
  storedSources,
} from './takeSources.worker.js';
import { type TakeSource } from './takeTracks.worker.js';

type PlayerPort = ReturnType<typeof playerDataChannel.outbound<MessagePort>>;

export type CreateProjectAudioOptions = {
  spectrogramPort: ReturnType<
    typeof spectrogramDataChannel.outbound<MessagePort>
  >;
};

export type ProjectAudio = {
  connectPlayer: (port: PlayerPort) => boolean;
  mount: (message: RecordingPlace) => Promise<{
    frameCount: number;
  }>;
  setActiveRecording: (recordingId: number | undefined) => void;
  patchLiveTake: (chunk: LiveTakeChunk, take: HeldTake) => void;
  holdTake: (take: HeldTake) => void;
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

export const createProjectAudio = (
  options: CreateProjectAudioOptions,
): ProjectAudio => {
  const { spectrogramPort } = options;
  let playerPort: PlayerPort | undefined = undefined;
  let readers: StemPageReaders | undefined = undefined;
  let pageReads: PageReads | undefined = undefined;
  let mounted: MountedAudio | undefined = undefined;
  let held: HeldTake | undefined = undefined;
  let live: HeldTake | undefined = undefined;
  let spectrogramSources: TakeSource[] = [];
  let spectrogramReads = new AbortController();
  let activeRecordingId: number | undefined = undefined;
  let reloading: Promise<void> = Promise.resolve();
  let reloadOnMount: Reload | undefined = undefined;

  const sources = (audio: MountedAudio): TakeSource[] => [
    ...storedSources(audio),
    ...(held ? heldSources(held, audio.sampleRate) : []),
  ];

  const spectrogramTakes = (audio: MountedAudio): SpectrogramTakes => {
    const liveRuns = live ? liveSources(live, audio) : [];
    spectrogramSources = [...sources(audio), ...liveRuns];
    return {
      takes: spectrogramSources.map((source) => ({
        key: source.key,
        songStartFrame: source.songStartFrame,
        tempo: source.tempo,
        transpose: source.transpose,
        octave: source.octave,
        frameCount: source.frameCount,
        pageStarts: source.pageStarts,
      })),
      live: liveRuns.at(-1)?.key,
    };
  };

  const showSpectrogramTakes = () => {
    if (mounted) {
      spectrogramPort.methods.setTakes(spectrogramTakes(mounted));
    }
  };

  const showTakes = () => {
    if (mounted) {
      pageReads?.setTakes(sources(mounted));
    }
    showSpectrogramTakes();
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
    if (switched || (live && live.takeId === reload.finishedTakeId)) {
      live = undefined;
    }
    showTakes();
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
        spectrogramPort.methods.putPage({ key: spectrogramLeadKey, ...page });
      },
      failed: (error) => {
        console.error('Failed to read a page of a track', error);
      },
    });

  spectrogramPort.bindHandlers({
    requestPages: (message) => {
      const { key, indices } = message;
      if (key === spectrogramLeadKey) {
        pageReads?.requestLeadPages(indices);
        return;
      }
      const source = spectrogramSources.find((item) => item.key === key);
      if (!source) {
        return;
      }
      const { signal } = spectrogramReads;
      for (const index of indices) {
        source
          .read(index, signal)
          .then((page) => {
            if (!page.samples) {
              throw new Error(`The page ${String(index)} of ${key} is empty`);
            }
            spectrogramPort.methods.putPage({
              key,
              index,
              samples: page.samples,
            });
          })
          .catch((error: unknown) => {
            if (!signal.aborted) {
              console.error('Failed to read a page of a take', error);
            }
          });
      }
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
      live = undefined;
      mounted = audio;
      pageReads = createReads(audio, current);
      spectrogramPort.methods.mount({
        lead: audio.layouts.lead,
        ...spectrogramTakes(audio),
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
    patchLiveTake: (chunk, take) => {
      if (
        live?.takeId !== take.takeId ||
        live.runs.length !== take.runs.length
      ) {
        live = take;
        showSpectrogramTakes();
      }
      spectrogramPort.methods.writeLiveTake({
        offset: chunk.offset,
        samples: chunk.samples.slice(),
      });
    },
    holdTake: (take) => {
      held = take;
      if (live?.takeId === take.takeId) {
        live = undefined;
      }
      showTakes();
    },
    hideTake: (takeId) => {
      if (held?.takeId === takeId) {
        held = undefined;
        showTakes();
      }
      if (live?.takeId === takeId) {
        live = undefined;
        showSpectrogramTakes();
      }
    },
    reloadRecording: async (finishedTakeId) => queueReload({ finishedTakeId }),
    requestTarget: (window) => {
      pageReads?.requestTarget(window);
    },
    unmount: () => {
      mounted = undefined;
      held = undefined;
      live = undefined;
      spectrogramSources = [];
      spectrogramReads.abort();
      spectrogramReads = new AbortController();
      pageReads?.close();
      pageReads = undefined;
      reloadOnMount = undefined;
      activeRecordingId = undefined;
      playerPort?.methods.unmount();
      spectrogramPort.methods.unmount();
    },
  };
};
