import {
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

const longPressMs = 500;
const slopPixels = 10;
const releaseClickMs = 400;

const swallowClick = (event: Event) => {
  event.stopPropagation();
  event.preventDefault();
};

const stopSwallowing = () => {
  window.removeEventListener('click', swallowClick, true);
};

export type LongPress = {
  holding: boolean;
  handlers: {
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onPointerMove: (event: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onPointerLeave: () => void;
    onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  };
};

type Press = {
  timer: number;
  x: number;
  y: number;
};

export const useLongPress = (
  onLongPress: (anchor: HTMLElement) => void,
): LongPress => {
  const [holding, setHolding] = useState(false);
  const pressRef = useRef<Press>(undefined);
  const firedRef = useRef(false);

  const release = () => {
    if (pressRef.current) {
      window.clearTimeout(pressRef.current.timer);
      pressRef.current = undefined;
    }
    if (firedRef.current) {
      firedRef.current = false;
      window.setTimeout(stopSwallowing, releaseClickMs);
    }
    setHolding(false);
  };

  useEffect(() => release, []);

  return {
    holding,
    handlers: {
      onPointerDown: (event) => {
        if (event.button !== 0) {
          return;
        }
        release();
        const anchor = event.currentTarget;
        const timer = window.setTimeout(() => {
          pressRef.current = undefined;
          firedRef.current = true;
          window.addEventListener('click', swallowClick, {
            capture: true,
            once: true,
          });
          setHolding(false);
          if ('vibrate' in navigator) {
            navigator.vibrate(10);
          }
          onLongPress(anchor);
        }, longPressMs);
        pressRef.current = { timer, x: event.clientX, y: event.clientY };
        setHolding(true);
      },
      onPointerMove: (event) => {
        const press = pressRef.current;
        if (
          press &&
          Math.hypot(event.clientX - press.x, event.clientY - press.y) >
            slopPixels
        ) {
          release();
        }
      },
      onPointerUp: release,
      onPointerCancel: release,
      onPointerLeave: release,
      onContextMenu: (event) => {
        event.preventDefault();
        if (pressRef.current || firedRef.current) {
          return;
        }
        onLongPress(event.currentTarget);
      },
    },
  };
};
