export type PointerInputType = 'mouse' | 'pen' | 'touch';

export const isPointerInputType = (
  pointerType: string,
): pointerType is PointerInputType =>
  pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch';

export const isPrimaryPointerButton = (event: PointerEvent): boolean =>
  event.pointerType !== 'mouse' || event.button === 0;
