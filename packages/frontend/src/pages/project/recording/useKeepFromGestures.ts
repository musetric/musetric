import { useEffect, useState } from 'react';

export const useKeepFromGestures = () => {
  const [element, setElement] = useState<HTMLElement>();

  useEffect(() => {
    if (!element) return;
    const keep = (event: PointerEvent) => {
      event.stopPropagation();
    };
    element.addEventListener('pointerdown', keep);
    return () => {
      element.removeEventListener('pointerdown', keep);
    };
  }, [element]);

  return setElement;
};
