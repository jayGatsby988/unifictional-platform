'use client';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Matrix4 } from 'three';
import type { SingleRoomSpec } from '@/lib/spec/types';
import { effectiveScanObjectDesignMatrix, scanObjectIsHidden } from '@/lib/native/scan-design';

const identity = { delta: new Matrix4(), inverse: new Matrix4() };
const Context = createContext(identity);
export const useScanObjectTransform = () => useContext(Context);

/** The design delta surrounds reconstructed WORLD geometry. Appearance queries
 * continue to refer to the immutable captured surface, even after moving it. */
export function ScanObjectDesign({ spec, objectId, children }: { spec: SingleRoomSpec | null; objectId: string; children: ReactNode }) {
  const transform = useMemo(() => {
    const delta = spec ? new Matrix4().fromArray(effectiveScanObjectDesignMatrix(spec, objectId)) : new Matrix4();
    return { delta, inverse: delta.clone().invert() };
  }, [spec, objectId]);
  if (spec && scanObjectIsHidden(spec, objectId)) return null;
  return <Context.Provider value={transform}><group name={`scan-design-${objectId}`} matrix={transform.delta} matrixAutoUpdate={false} userData={{ scanObjectId: objectId, proposedDesign: !transform.delta.equals(identity.delta) }}>{children}</group></Context.Provider>;
}
