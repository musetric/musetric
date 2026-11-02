import { type FC, useEffect } from 'react';
import { getMediaBridge, subscribeMediaSession } from './mediaSession.js';

export type MediaSessionSyncProps = {
  title: string;
  coverUrl?: string;
};

export const MediaSessionSync: FC<MediaSessionSyncProps> = (props) => {
  const { title, coverUrl } = props;

  useEffect(() => {
    const bridge = getMediaBridge();
    if (!bridge) {
      return undefined;
    }
    return subscribeMediaSession(bridge, title, coverUrl);
  }, [title, coverUrl]);

  return undefined;
};
