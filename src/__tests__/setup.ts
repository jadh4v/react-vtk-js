import '@testing-library/jest-dom';

// jsdom does not implement ResizeObserver. Provide a no-op stub so that any
// component using useResizeObserver (e.g. RenderWindow) can mount without
// throwing a ReferenceError.
global.ResizeObserver = class ResizeObserver {
  observe() {
    return;
  }

  unobserve() {
    return;
  }

  disconnect() {
    return;
  }
};
