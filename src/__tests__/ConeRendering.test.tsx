/**
 * Integration test: cone rendering pipeline.
 *
 * Verifies the full vtk.js data-flow path from source algorithm through to
 * the renderer without requiring a real GPU or browser:
 *
 *   vtkConeSource ──outputPort──▶ vtkMapper ──▶ vtkActor ──▶ vtkRenderer
 *                                                                 │
 *                                                        vtkRenderWindow
 *                                                                 │
 *                                                    (mock) vtkOpenGLRenderWindow
 *                                                          render() → no-op
 *
 * Only the two WebGL-touching modules are mocked:
 *   • @kitware/vtk.js/Rendering/OpenGL/RenderWindow   – prevents GPU init
 *   • @kitware/vtk.js/Rendering/Core/RenderWindowInteractor – prevents DOM events
 *
 * Everything else (vtkRenderWindow, vtkRenderer, vtkMapper, vtkActor,
 * vtkConeSource) uses the real vtk.js implementation so the assertions reflect
 * genuine pipeline behaviour.
 *
 * NOTE on vtkRenderer introspection after unmount:
 *   vtk.js freezes the publicAPI object — methods are non-configurable AND
 *   non-writable, so neither vi.spyOn() nor direct assignment can replace
 *   them, and a Proxy violates the invariant for non-configurable properties.
 *   Test 5 therefore observes cleanup indirectly via DeletionRegistry, whose
 *   markForDeletion() lives on a plain class instance and is fully spy-able.
 *   React's effect ordering guarantees removeActor() runs (useEffect cleanup)
 *   strictly before markForDeletion() is called (useUnmount), so catching the
 *   latter proves the former already happened.
 */

import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — must be created before any vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { mockOGLRWNewInstance, mockRWINewInstance } = vi.hoisted(() => {
  /**
   * Minimal stub for the vtkOpenGLRenderWindow vtk object.
   *
   * The critical method is render(): vtkRenderWindow.render() calls
   * view.render() on every registered view. Making it a no-op prevents the
   * entire vtkRenderer → vtkMapper → WebGL upload chain from being entered.
   */
  const mockView = {
    // Called by OpenGLRenderWindow.tsx to attach the vtk object to a DOM node.
    setContainer: vi.fn(),
    // Called by RenderWindow.tsx resize logic.
    setSize: vi.fn(),
    // Called by vtkRenderWindow.render() — the WebGL firewall.
    render: vi.fn(),
    // Called by RenderWindow.tsx:92 — useResizeObserver(openGLRenderWindow.get().getContainer(), ...)
    // The vtk OpenGL render window exposes getContainer() separately from the
    // React IOpenGLRenderWindow.getContainer() wrapper.
    getContainer: vi.fn(() => null),
    // Called in the DeletionRegistry callback to release the GPU context.
    getCanvas: vi.fn(() => ({
      getContext: vi.fn(() => ({
        getExtension: vi.fn(() => ({ loseContext: vi.fn() })),
      })),
    })),
    // vtk object lifecycle.
    delete: vi.fn(),
    // vtk.js internal: may be queried by vtkRenderWindow.addView().
    getVtkClassName: vi.fn(() => 'vtkOpenGLRenderWindow'),
    // Called by vtkRenderWindow.addView() to back-link the view to the window.
    setRenderable: vi.fn(),
  };

  /**
   * Minimal stub for vtkRenderWindowInteractor.
   *
   * The real interactor attaches DOM keyboard/pointer event listeners and
   * calls WebGL methods on the view. The stub no-ops all of that while still
   * satisfying the checks in useInteractorStyle (getInteractorStyle()).
   */
  const mockInteractor = {
    setView: vi.fn(),
    initialize: vi.fn(),
    bindEvents: vi.fn(),
    disable: vi.fn(),
    unbindEvents: vi.fn(),
    // setInteractorStyle / getInteractorStyle are called by SingleView on mount
    // and by useInteractorStyle's cleanup to decide whether to unset the style.
    setInteractorStyle: vi.fn(),
    getInteractorStyle: vi.fn(() => null),
    // Called by vtkRenderWindow.render() before iterating views.
    render: vi.fn(),
    delete: vi.fn(),
  };

  return {
    mockOGLRWNewInstance: vi.fn(() => mockView),
    mockRWINewInstance: vi.fn(() => mockInteractor),
  };
});

// ---------------------------------------------------------------------------
// Module mocks — hoisted by Vitest above all imports at transform time.
// ---------------------------------------------------------------------------

vi.mock('@kitware/vtk.js/Rendering/OpenGL/RenderWindow', () => ({
  default: { newInstance: mockOGLRWNewInstance },
}));

vi.mock('@kitware/vtk.js/Rendering/Core/RenderWindowInteractor', () => ({
  default: { newInstance: mockRWINewInstance },
}));

// ---------------------------------------------------------------------------
// Real vtk.js + react-vtk-js imports (resolved after mocks are in place).
// ---------------------------------------------------------------------------

import vtkConeSource from '@kitware/vtk.js/Filters/Sources/ConeSource';
import Algorithm from '../core/Algorithm';
import GeometryRepresentation from '../core/GeometryRepresentation';
import View from '../core/View';
import { IRepresentation, IView } from '../types';
import deletionRegistry from '../utils/DeletionRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render a scene with a single cone and return live refs to the View and
 * GeometryRepresentation APIs.
 */
function renderConeScene(onDataAvailable?: () => void) {
  const viewRef = createRef<IView>();
  const repRef = createRef<IRepresentation>();

  const result = render(
    <View ref={viewRef}>
      <GeometryRepresentation ref={repRef} onDataAvailable={onDataAvailable}>
        {/*
         * vtkConeSource is a zero-input source algorithm; Algorithm.tsx
         * immediately calls representation.dataAvailable() once connected,
         * triggering the full onDataAvailable → actor visibility → render chain.
         */}
        <Algorithm
          vtkClass={vtkConeSource}
          state={{ resolution: 30, height: 1.0, radius: 0.5 }}
        />
      </GeometryRepresentation>
    </View>
  );

  return { viewRef, repRef, ...result };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cone rendering pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    // Discard any pending 0 ms render-queue setTimeout created by
    // RenderWindow.tsx so it does not bleed into the next test.
    vi.clearAllTimers();
  });

  // ── 1. Data availability ────────────────────────────────────────────────

  it('fires onDataAvailable when the cone source is connected', () => {
    const onDataAvailable = vi.fn();
    renderConeScene(onDataAvailable);

    // Algorithm.tsx calls representation.dataAvailable() synchronously inside
    // a useEffect that is flushed by @testing-library/react's act() wrapper.
    expect(onDataAvailable).toHaveBeenCalledOnce();
  });

  // ── 2. Mapper input data ─────────────────────────────────────────────────

  it('pipes cone geometry into the mapper with the expected point count', () => {
    const { repRef } = renderConeScene();

    const mapper = repRef.current?.getMapper();
    expect(
      mapper,
      'GeometryRepresentation should expose a mapper'
    ).toBeTruthy();

    const polyData = mapper!.getInputData();
    expect(
      polyData,
      'Mapper should have input data after pipeline wiring'
    ).toBeTruthy();

    // vtkConeSource with resolution=30 produces 31 points (30 base + 1 tip).
    const nPoints = polyData.getNumberOfPoints();
    expect(nPoints).toBeGreaterThanOrEqual(31);
  });

  // ── 3. Actor registration ────────────────────────────────────────────────

  it('adds the cone actor to the renderer when data becomes available', () => {
    const { viewRef, repRef } = renderConeScene();

    // Verify the actor that GeometryRepresentation created…
    const actor = repRef.current?.getActor();
    expect(actor, 'GeometryRepresentation should expose an actor').toBeTruthy();

    // …is registered in the real vtkRenderer's actor list.
    const vtkRen = viewRef.current?.getRenderer()?.get();
    expect(vtkRen, 'View should expose a vtkRenderer').toBeTruthy();

    const actors = vtkRen!.getActors();
    expect(actors).toContain(actor);
  });

  // ── 4. Actor visibility ──────────────────────────────────────────────────

  it('makes the actor visible once data is available', () => {
    const { repRef } = renderConeScene();

    // vtkActor starts hidden (visibility: false) and is flipped to true when
    // GeometryRepresentation receives the dataAvailable signal.
    const actor = repRef.current?.getActor();
    expect(actor!.getVisibility()).toBe(true);
  });

  // ── 5. Cleanup ───────────────────────────────────────────────────────────

  it('marks the actor for deletion when the scene is unmounted', () => {
    const { repRef, unmount } = renderConeScene();
    const actor = repRef.current?.getActor()!;

    // DeletionRegistry is a plain class instance — markForDeletion is
    // configurable and spy-able, unlike the frozen vtk.js publicAPI methods.
    const markSpy = vi.spyOn(deletionRegistry, 'markForDeletion');

    unmount();

    // useProp's useUnmount calls deletionRegistry.markForDeletion(actor).
    // React effect ordering ensures the useEffect cleanup (ren.removeActor)
    // fires first, so the actor is already detached from the renderer by the
    // time markForDeletion is invoked.
    expect(markSpy).toHaveBeenCalledWith(actor);
  });
});
