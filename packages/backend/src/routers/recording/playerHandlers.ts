import { nextNumber } from '@musetric/utils';
import {
  broadcastRealtime,
  claimPlayerMaster,
  type PlayerFrameIndexMessage,
  sendPlayerSyncState,
  sendRealtimeEvent,
  stopProjectPlayer,
} from './realtime.js';
import { type RecordingRealtimeContext } from './recordingHandlers.js';

export const handlePlayerPlay = (ctx: RecordingRealtimeContext): void => {
  claimPlayerMaster(ctx.runtime, ctx.projectId, ctx.socket, false);
};

export const handlePlayerRecord = (ctx: RecordingRealtimeContext): void => {
  claimPlayerMaster(ctx.runtime, ctx.projectId, ctx.socket, true);
};

export const handlePlayerStop = (ctx: RecordingRealtimeContext): void => {
  stopProjectPlayer(ctx.runtime, ctx.projectId);
};

export const handlePlayerFrameIndex = (
  message: PlayerFrameIndexMessage,
  ctx: RecordingRealtimeContext,
): void => {
  const playerState = ctx.runtime.projectPlayerStates.get(ctx.projectId);
  if (!playerState) {
    return;
  }
  const frameIndex =
    typeof message.frameIndex === 'number' ? message.frameIndex : 0;
  const frozen = typeof message.frozen === 'boolean' ? message.frozen : false;
  const revision = typeof message.revision === 'number' ? message.revision : 0;
  const source: 'playback' | 'user' =
    message.source === 'user' ? 'user' : 'playback';

  if (source === 'user') {
    playerState.revision = nextNumber(playerState.revision);
    playerState.frameIndex = frameIndex;
    playerState.frozen = frozen;
    ctx.send({ type: 'player.revision', revision: playerState.revision });
    broadcastRealtime(
      ctx.sockets,
      (socket) => {
        sendRealtimeEvent(socket, {
          type: 'player.frameIndex',
          frameIndex: playerState.frameIndex,
          frozen: playerState.frozen,
          revision: playerState.revision,
          source: 'user',
        });
      },
      ctx.socket,
    );
    return;
  }

  if (!playerState.active || playerState.masterSocket !== ctx.socket) {
    sendPlayerSyncState(ctx.socket, playerState);
    return;
  }
  if (revision !== playerState.revision) {
    return;
  }
  playerState.frameIndex = frameIndex;
  playerState.frozen = frozen;
  broadcastRealtime(
    ctx.sockets,
    (socket) => {
      sendRealtimeEvent(socket, {
        type: 'player.frameIndex',
        frameIndex: playerState.frameIndex,
        frozen: playerState.frozen,
        revision: playerState.revision,
        source: 'playback',
      });
    },
    ctx.socket,
  );
};

export const handlePlayerSyncRequest = (
  ctx: RecordingRealtimeContext,
): void => {
  const playerState = ctx.runtime.projectPlayerStates.get(ctx.projectId);
  if (!playerState) {
    return;
  }
  sendPlayerSyncState(ctx.socket, playerState);
};
