import { useEffect, useRef, useState } from 'react';

const minAnchorAge = 15_000;
const minRemaining = 30_000;

const formatRemaining = (remaining: number): string => {
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes - hours * 60}m`;
};

type EtaAnchor = {
  projectId: number;
  time: number;
  progress: number;
};

export const useProcessingEta = (
  projectId: number,
  progress: number,
): string | undefined => {
  const anchorRef = useRef<EtaAnchor | undefined>(undefined);
  const [eta, setEta] = useState<string>();

  useEffect(() => {
    const anchor = anchorRef.current;
    if (
      !anchor ||
      anchor.projectId !== projectId ||
      progress < anchor.progress
    ) {
      anchorRef.current = { projectId, time: Date.now(), progress };
      setEta(undefined);
      return;
    }

    const elapsed = Date.now() - anchor.time;
    const advanced = progress - anchor.progress;
    if (elapsed < minAnchorAge || advanced <= 0) {
      return;
    }

    const remaining = ((1 - progress) / advanced) * elapsed;
    setEta(remaining < minRemaining ? undefined : formatRemaining(remaining));
  }, [projectId, progress]);

  return eta;
};
