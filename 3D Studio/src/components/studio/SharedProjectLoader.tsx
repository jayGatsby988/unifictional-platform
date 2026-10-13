'use client';
import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { Project, RoomSpec } from '@/lib/spec/types';
import { ensureSpecMaterials, healSelections } from '@/lib/materials/match';
import { healContract } from '@/lib/fit/contract';
import { isScannedProject } from '@/lib/sharing/project';

function SharedSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8" aria-busy="true">
      <div className="shimmer h-5 w-40 rounded" />
      <div className="shimmer mt-4 h-10 w-2/3 rounded" />
      <div className="shimmer mt-6 aspect-[16/9] w-full rounded-[var(--radius)]" />
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-32 rounded-[var(--radius)]" />)}
      </div>
    </div>
  );
}

const SharedProjectView = dynamic(() => import('./SharedProjectView'), { ssr: false, loading: () => <SharedSkeleton /> });

export default function SharedProjectLoader({ project }: { project: Project }) {
  // A shared project arrives from the server as plain JSON. Any material the
  // analyzer minted from the client's photo exists only as an id in that
  // JSON, so it is rebuilt here — before the view's children render, not in an
  // effect after them — from the finish observations the spec carries. The
  // pass may rewrite stale ids, so it works on a copy (the prop is plain JSON,
  // a round-trip is a faithful clone) and the selections follow its remap.
  // The as-found baseline gets the same treatment for the same reason: its
  // selections point at ids `ensureSpecMaterials` may have just rewritten, and
  // an unhealed one shows every re-minted slot as a change the client made.
  // A share saved before the field existed has no baseline at all and falls
  // back to full-remodel pricing, which is how it has always read.
  const healed = useMemo(() => {
    // Native shares display their saved image. Healing a procedural stand-in
    // would invalidate the image binding and cannot restore local sensor assets.
    if (isScannedProject(project)) return structuredClone(project);
    const es = project.estimateSettings;
    const baseline = project.baseline ?? null;
    const settings = { ...es, mode: es.mode ?? (baseline ? 'changes' as const : 'full' as const), includeKnockOns: es.includeKnockOns ?? true };
    let healedBaseline: Project['baseline'] = null;
    if (baseline?.spec) {
      const bSpec = healContract(JSON.parse(JSON.stringify(baseline.spec)) as RoomSpec);
      const { remap, slotRemap } = ensureSpecMaterials(bSpec);
      healedBaseline = { ...baseline, spec: bSpec, selections: healSelections(baseline.selections, bSpec, remap, slotRemap) };
    }
    if (!project.spec) return { ...project, baseline: healedBaseline, estimateSettings: settings };
    // A share saved before a contract field existed arrives raw: the studio
    // heals on rehydrate (migrateProject v6) but nothing on this path did, so
    // the share page skipped the mis-read-item prune and the open / plankRun
    // fills the studio has. Same helper, on the clone we already made.
    const spec = healContract(JSON.parse(JSON.stringify(project.spec)) as RoomSpec);
    const { remap, slotRemap } = ensureSpecMaterials(spec);
    return { ...project, spec, selections: healSelections(project.selections, spec, remap, slotRemap), baseline: healedBaseline, estimateSettings: settings };
  }, [project]);
  return <SharedProjectView project={healed} />;
}
