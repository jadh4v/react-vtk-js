import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import type { vtkObject } from '@kitware/vtk.js/interfaces';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkProp3D from '@kitware/vtk.js/Rendering/Core/Prop3D';
import { useEffect } from 'react';

interface PropertyWithColorAndOpacity extends vtkObject {
  setRGBTransferFunction(
    index: number,
    fn: vtkColorTransferFunction | null
  ): boolean;
  getRGBTransferFunction(index?: number): vtkColorTransferFunction | null;
  setScalarOpacity(index: number, fn: vtkPiecewiseFunction | null): boolean;
  getScalarOpacity(index?: number): vtkPiecewiseFunction | null;
}

interface ActorWithColorAndOpacity<E extends vtkObject> extends vtkProp3D {
  getProperty(): E;
}

export default function useColorAndOpacity<
  E extends PropertyWithColorAndOpacity,
  T extends ActorWithColorAndOpacity<E>
>(
  getActor: () => T,
  colorTransferFunctions:
    | Array<vtkColorTransferFunction | null | undefined>
    | null
    | undefined,
  scalarOpacityFunctions:
    | Array<vtkPiecewiseFunction | null | undefined>
    | null
    | undefined,
  trackModified: (b: boolean) => void
) {
  useEffect(() => {
    if (!colorTransferFunctions?.length) return;
    const property = getActor().getProperty();

    colorTransferFunctions.forEach((fn, component) => {
      property.setRGBTransferFunction(component, fn ?? null);
    });

    return () => {
      for (let i = 0; i < 4; i++) {
        property.setRGBTransferFunction(i, null);
      }
    };
  }, [colorTransferFunctions, getActor]);

  useEffect(() => {
    if (!scalarOpacityFunctions?.length) return;
    const property = getActor().getProperty();

    scalarOpacityFunctions.forEach((fn, component) => {
      property.setScalarOpacity(component, fn ?? null);
    });

    return () => {
      for (let i = 0; i < 4; i++) {
        property.setScalarOpacity(i, null);
      }
    };
  }, [scalarOpacityFunctions, getActor]);

  // watch for vtk.js object changes

  useEffect(() => {
    if (!colorTransferFunctions?.length) return;
    const subs = colorTransferFunctions
      .filter((fn): fn is vtkColorTransferFunction => !!fn)
      .map((fn) => {
        return fn.onModified(() => {
          trackModified(true);
        });
      });
    return () => subs.forEach((sub) => sub.unsubscribe());
  });

  useEffect(() => {
    if (!scalarOpacityFunctions?.length) return;
    const subs = scalarOpacityFunctions
      .filter((fn): fn is vtkPiecewiseFunction => !!fn)
      .map((fn) => {
        return fn.onModified(() => {
          trackModified(true);
        });
      });
    return () => subs.forEach((sub) => sub.unsubscribe());
  });
}
