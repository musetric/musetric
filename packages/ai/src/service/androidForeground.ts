export type ForegroundBridge = {
  setActive: (active: boolean) => void;
};

declare const MusetricForeground: ForegroundBridge | undefined;

export const readAndroidForeground = (): ForegroundBridge | undefined =>
  typeof MusetricForeground === 'undefined' ? undefined : MusetricForeground;
