export const mediaEventName = 'musetric:media';

export type MediaState = {
  title: string;
  coverUrl?: string;
  durationMs: number;
  positionMs: number;
  playing: boolean;
  recording: boolean;
  speed: number;
};

export type MediaBridge = {
  update: (state: MediaState) => void;
  clear: () => void;
};

export type MediaAction = {
  action: 'play' | 'pause' | 'seek';
  positionMs?: number;
};
