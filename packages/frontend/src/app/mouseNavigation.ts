const backButton = 3;
const forwardButton = 4;

export const blockMouseNavigation = (): void => {
  window.addEventListener('mouseup', (event) => {
    if (event.button === backButton || event.button === forwardButton) {
      event.preventDefault();
    }
  });
};
