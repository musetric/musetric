import { type Store } from '../common/store.js';
import { openKnownMicrophone } from '../player/microphone.js';
import { type EngineState } from '../state.js';
import { type EngineAudioSession } from './engineAudioSession.js';

export const reportMicrophoneFailure = (
  store: Store<EngineState>,
  audioSession: EngineAudioSession,
  error: unknown,
): boolean => {
  const denial = audioSession.readMicrophoneDenial(error);
  if (!denial) {
    return false;
  }
  store.update((state) => {
    state.microphoneDenial = denial;
    state.microphoneDenialOpen = true;
  });
  return true;
};

export const clearMicrophoneDenial = (store: Store<EngineState>) => {
  const state = store.get();
  if (state.microphoneDenial === undefined && !state.microphoneDenialOpen) {
    return;
  }
  store.update((draft) => {
    draft.microphoneDenial = undefined;
    draft.microphoneDenialOpen = false;
  });
};

export type EngineMicrophoneAccess = {
  canOpenSettings: () => boolean;
  openSettings: () => void;
  recheck: () => Promise<void>;
  dismiss: () => void;
};

export type CreateEngineMicrophoneAccessOptions = {
  store: Store<EngineState>;
  audioSession: EngineAudioSession;
};

export const createEngineMicrophoneAccess = (
  options: CreateEngineMicrophoneAccessOptions,
): EngineMicrophoneAccess => {
  const { store, audioSession } = options;
  let checking: Promise<void> | undefined = undefined;

  const check = async () => {
    if (audioSession.checkMicrophoneAccess) {
      if (await audioSession.checkMicrophoneAccess()) {
        clearMicrophoneDenial(store);
      }
      return;
    }
    try {
      const microphone = await openKnownMicrophone(
        audioSession,
        store.get().microphoneDeviceId,
      );
      audioSession.closeMicrophone(microphone);
      clearMicrophoneDenial(store);
    } catch (error) {
      if (!reportMicrophoneFailure(store, audioSession, error)) {
        console.error('Failed to check the microphone', error);
      }
    }
  };

  return {
    canOpenSettings: () => {
      const denial = store.get().microphoneDenial;
      return (
        denial !== undefined && audioSession.canOpenMicrophoneSettings(denial)
      );
    },
    openSettings: () => {
      const denial = store.get().microphoneDenial;
      if (denial !== undefined) {
        audioSession.openMicrophoneSettings(denial);
      }
    },
    recheck: async () => {
      checking ??= check().finally(() => {
        checking = undefined;
      });
      await checking;
    },
    dismiss: () => {
      store.update((state) => {
        state.microphoneDenialOpen = false;
      });
    },
  };
};
