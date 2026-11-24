import { type StemType, stemTypes } from '@musetric/audio/es';
import { type SeekRun } from '../runs.js';

export type SeekResult = {
  count: number;
  unheld: number;
  silent: number;
  toSoundMs: number[];
  heldMs: number[];
  waitedRequests: number[];
  abortedRequests: number[];
  leadRequests: number[];
  requestsPerSecond: Record<StemType, number>;
};

export const analyzeSeek = (run: SeekRun): SeekResult => {
  const result: SeekResult = {
    count: run.seeks.length,
    unheld: 0,
    silent: 0,
    toSoundMs: [],
    heldMs: [],
    waitedRequests: [],
    abortedRequests: [],
    leadRequests: [],
    requestsPerSecond: { lead: 0, backing: 0, instrumental: 0 },
  };
  for (const [index, [seekAt]] of run.seeks.entries()) {
    const until = run.seeks.at(index + 1)?.[0] ?? run.endedAt;
    const within = (time: number) => time >= seekAt && time < until;
    result.leadRequests.push(
      run.requests.filter(
        (request) => request.stem === 'lead' && within(request.sentAt),
      ).length,
    );
    result.abortedRequests.push(
      run.requests.filter(
        (request) =>
          request.failed &&
          request.endedAt !== undefined &&
          within(request.endedAt),
      ).length,
    );
    const buffering = run.buffering.filter((event) => within(event[0]));
    const waiting =
      run.buffering.findLast((event) => event[0] < seekAt)?.[1] === 1;
    const heldAt = waiting
      ? seekAt
      : buffering.find((event) => event[1] === 1)?.[0];
    if (heldAt === undefined) {
      result.unheld += 1;
      continue;
    }
    const sound = buffering.find(
      (event) => event[0] >= heldAt && event[1] === 0,
    );
    if (!sound) {
      result.silent += 1;
      continue;
    }
    const [soundAt] = sound;
    result.toSoundMs.push(soundAt - seekAt);
    result.heldMs.push(soundAt - heldAt);
    result.waitedRequests.push(
      run.requests.filter(
        (request) =>
          !request.failed &&
          request.endedAt !== undefined &&
          request.endedAt >= seekAt &&
          request.endedAt <= soundAt,
      ).length,
    );
  }
  const firstSeekAt = run.seeks.at(0)?.[0];
  if (firstSeekAt !== undefined && run.endedAt > firstSeekAt) {
    const seconds = (run.endedAt - firstSeekAt) / 1000;
    for (const stem of stemTypes) {
      result.requestsPerSecond[stem] =
        run.requests.filter(
          (request) =>
            request.stem === stem &&
            request.sentAt >= firstSeekAt &&
            request.sentAt < run.endedAt,
        ).length / seconds;
    }
  }
  return result;
};
