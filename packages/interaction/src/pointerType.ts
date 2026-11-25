export type PointerInputType = 'mouse' | 'pen' | 'touch';

export const isPointerInputType = (
  pointerType: string,
): pointerType is PointerInputType =>
  pointerType === 'mouse' || pointerType === 'pen' || pointerType === 'touch';

export const isPrimaryPointerButton = (event: PointerEvent): boolean =>
  event.pointerType !== 'mouse' || event.button === 0;

const controlSelector = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="switch"]',
  '[role="tab"]',
].join(', ');

export const isControlPress = (
  element: HTMLElement,
  event: PointerEvent,
): boolean => {
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest(controlSelector);
  if (!control) return false;
  return control !== element && element.contains(control);
};
