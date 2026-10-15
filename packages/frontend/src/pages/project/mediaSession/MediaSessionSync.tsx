import { type FC, useEffect } from 'react';
import { getMediaBridge, subscribeMediaSession } from './mediaSession.js';

export type MediaSessionSyncProps = {
  title: string;
};

export const MediaSessionSync: FC<MediaSessionSyncProps> = (props) => {
  const { title } = props;

  useEffect(() => {
    const bridge = getMediaBridge();
    if (!bridge) {
      return undefined;
    }
    return subscribeMediaSession(bridge, title);
  }, [title]);

  return undefined;
};
