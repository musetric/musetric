export type DesktopSystem = 'windows' | 'macos';

export const readDesktopSystem = (): DesktopSystem | undefined => {
  const { userAgent, maxTouchPoints } = navigator;
  if (userAgent.includes('Windows')) {
    return 'windows';
  }
  if (userAgent.includes('Macintosh') && maxTouchPoints <= 1) {
    return 'macos';
  }
  return undefined;
};
