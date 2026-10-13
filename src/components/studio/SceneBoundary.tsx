'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useProjectStore } from '@/lib/store/project-store';

/** A failed renderer or asset must not take project controls and saved work
 * down with it. Remount the canvas at a lighter quality on explicit retry. */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean; attempt: number }> {
  state = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[studio] 3D view failed', error.message, info.componentStack); }
  render() {
    if (!this.state.failed) return <div key={this.state.attempt} className="absolute inset-0">{this.props.children}</div>;
    return <div className="absolute inset-0 z-30 flex items-center justify-center bg-bg p-6">
      <div className="max-w-sm rounded-2xl border border-border bg-bg-elev p-6 text-center shadow-xl">
        <TriangleAlert size={24} className="mx-auto mb-3 text-brass" />
        <h2 className="font-display text-xl text-ink">The 3D view couldn&apos;t load</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">Your project is still here. Try a lighter graphics setting to restart the view.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => {
          useProjectStore.getState().setUI({ quality: 'performance' });
          this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }));
        }}><RefreshCw size={14} /> Retry 3D view</button>
      </div>
    </div>;
  }
}
