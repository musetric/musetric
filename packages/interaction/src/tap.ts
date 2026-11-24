const tapSlop = 6;
const tapMs = 350;

type Press = {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
};

export type TapTracker = {
  press: (event: PointerEvent) => void;
  move: (event: PointerEvent) => void;
  cancel: () => void;
  release: (event: PointerEvent) => boolean;
};

export const createTapTracker = (): TapTracker => {
  let press: Press | undefined = undefined;
  return {
    press: (event) => {
      press = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        timeStamp: event.timeStamp,
      };
    },
    move: (event) => {
      if (
        press?.pointerId === event.pointerId &&
        Math.hypot(
          event.clientX - press.clientX,
          event.clientY - press.clientY,
        ) > tapSlop
      ) {
        press = undefined;
      }
    },
    cancel: () => {
      press = undefined;
    },
    release: (event) => {
      const tapped =
        press?.pointerId === event.pointerId &&
        event.timeStamp - press.timeStamp <= tapMs;
      press = undefined;
      return tapped;
    },
  };
};
