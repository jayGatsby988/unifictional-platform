'use client';
/**
 * Small standalone GLB viewer for AI 3D scans (its own Canvas).
 */
import { Component, Suspense, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Bounds, Center, ContactShadows, Environment, OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { cx } from './hooks';

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

class GLBErrorBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: Error) { this.props.onError(err.message || 'Could not load the 3D scan.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

function LoadingOverlay() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-bg/40">
      <div className="panel flex items-center gap-2 px-3 py-2 text-[12px] text-muted"><LoaderCircle size={13} className="animate-spin text-brass" /> Loading scan… {Math.round(progress)}%</div>
    </div>
  );
}

export function ScanViewer({ url, className }: { url: string; className?: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={cx('relative overflow-hidden rounded-[var(--radius)] border border-border bg-[#0e0f12]', className)}>
      {error ? (
        <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 p-6 text-center">
          <TriangleAlert size={18} className="text-danger" />
          <div className="text-[13px] text-ink">Couldn&apos;t display this scan</div>
          <div className="max-w-xs text-[11.5px] text-muted">{error}</div>
          <a className="btn btn-sm mt-2" href={url} target="_blank" rel="noopener noreferrer">Download GLB</a>
        </div>
      ) : (
        <GLBErrorBoundary onError={setError}>
          <Canvas dpr={[1, 1.5]} camera={{ fov: 40, position: [2.6, 1.8, 2.6], near: 0.01, far: 100 }} gl={{ antialias: true }} style={{ background: '#0e0f12' }}>
            <Suspense fallback={null}>
              <Environment files="/hdri/studio_small_09_1k.hdr" />
              <Bounds fit clip observe margin={1.25}>
                <Center bottom>
                  <Model url={url} />
                </Center>
              </Bounds>
              <ContactShadows position={[0, -0.002, 0]} opacity={0.55} scale={6} blur={2.4} far={2} />
            </Suspense>
            <OrbitControls makeDefault enableDamping dampingFactor={0.08} autoRotate autoRotateSpeed={0.9} minPolarAngle={0.2} maxPolarAngle={Math.PI / 2 + 0.1} />
          </Canvas>
          <LoadingOverlay />
        </GLBErrorBoundary>
      )}
    </div>
  );
}
