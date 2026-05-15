/**
 * Regression test: OpenGLRenderWindow must call WEBGL_lose_context.loseContext()
 * during cleanup so that GPU slots are freed before Chrome's per-process
 * WebGL context limit (~16) is reached.
 *
 * The test mounts and fully unmounts the component 17 times and asserts that
 * loseContext() was called exactly once per lifecycle, proving that the GPU
 * slot is returned to the browser on every destruction.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Import the component before vi.mock() in source order.
// Vitest hoists vi.mock() calls above all imports at transform time,
// so the mock is always in place when the module is evaluated.
import OpenGLRenderWindow from '../core/OpenGLRenderWindow';

// ---------------------------------------------------------------------------
// Hoisted mock state
// vi.mock() is hoisted above all imports by Vitest, so any values the factory
// closes over must be initialised with vi.hoisted() to avoid a TDZ error.
// ---------------------------------------------------------------------------

const { mockLoseContext, mockGetContext, mockNewInstance } = vi.hoisted(() => {
  const mockLoseContext = vi.fn();

  const mockGetExtension = vi.fn((name: string) =>
    name === 'WEBGL_lose_context' ? { loseContext: mockLoseContext } : null
  );

  const mockGetContext = vi.fn(() => ({
    getExtension: mockGetExtension,
  }));

  let instanceId = 0;
  const mockNewInstance = vi.fn(() => ({
    __id: ++instanceId,
    setContainer: vi.fn(),
    getCanvas: vi.fn(() => ({ getContext: mockGetContext })),
    delete: vi.fn(),
  }));

  return { mockLoseContext, mockGetContext, mockNewInstance };
});

// ---------------------------------------------------------------------------
// Module mock — must be declared at the top level for Vitest hoisting.
// ---------------------------------------------------------------------------

vi.mock('@kitware/vtk.js/Rendering/OpenGL/RenderWindow', () => ({
  default: { newInstance: mockNewInstance },
}));

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Render one <OpenGLRenderWindow>, then immediately unmount it.
 * @testing-library wraps both calls in act(), so all useEffect cleanups
 * (including the DeletionRegistry callback) are flushed synchronously before
 * this function returns.
 */
function mountAndUnmount() {
  const { unmount } = render(<OpenGLRenderWindow />);
  unmount();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OpenGLRenderWindow – WebGL context lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('calls loseContext() once per mount-unmount cycle across 17 cycles', () => {
    // 17 is one past Chrome's hard per-process WebGL context limit of 16.
    // Before the fix, the 17th context was never released, blanking the viewport.
    const CYCLES = 17;

    for (let i = 0; i < CYCLES; i++) {
      mountAndUnmount();
    }

    expect(mockLoseContext).toHaveBeenCalledTimes(CYCLES);
  });

  it('calls loseContext() strictly before view.delete()', () => {
    // Verify ordering: the GPU slot must be relinquished before vtk.js tears
    // down its internal state, otherwise the extension handle is invalid.
    const callOrder: string[] = [];

    mockLoseContext.mockImplementationOnce(() => callOrder.push('loseContext'));

    // Intercept delete() on whichever instance newInstance() creates next.
    const nextInstance = {
      __id: 999,
      setContainer: vi.fn(),
      getCanvas: vi.fn(() => ({ getContext: mockGetContext })),
      delete: vi.fn(() => callOrder.push('delete')),
    };
    mockNewInstance.mockReturnValueOnce(nextInstance);

    mountAndUnmount();

    expect(callOrder).toEqual(['loseContext', 'delete']);
  });

  it('does not throw when getCanvas() is unavailable', () => {
    // Guard against vtk.js builds where getCanvas() does not exist, e.g.
    // server-side rendering stubs.  Cleanup must still succeed.
    const instanceWithoutCanvas = {
      __id: 1000,
      setContainer: vi.fn(),
      getCanvas: undefined, // no canvas accessor
      delete: vi.fn(),
    };
    mockNewInstance.mockReturnValueOnce(instanceWithoutCanvas as never);

    expect(() => mountAndUnmount()).not.toThrow();
    expect(instanceWithoutCanvas.delete).toHaveBeenCalledOnce();
  });
});
