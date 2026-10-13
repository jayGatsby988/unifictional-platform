'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { nanoid } from 'nanoid';
import type {
  BaselineSource, DecorSpec, EstimateSettings, IntakeState, MaterialSlotId, Photo, Project, RenderJob, RoomSpec, RoomType, ScanJob,
} from '@/lib/spec/types';
import { DEFAULT_SELECTIONS } from '@/lib/materials/catalog';
import { ensureSpecMaterials, healSelections, type SlotMaterialRemap } from '@/lib/materials/match';
import { emptyDecor } from '@/lib/spec/defaults';
import { healFloorPlan } from '@/lib/spec/floorplan';
import { healIntake } from '@/lib/spec/intake';
import { resolveOpen } from '@/lib/spec/photo-box';
import { measureProject, releaseInconsistentMeasurements, type MeasurementPatch } from '@/lib/spec/measurements';
import { calibratePlanProject } from '@/lib/spec/plan-edit';
import { applyJarvisOption, commitJarvisResult, removeJarvisOption, restoredJarvisState, undoJarvisChange } from '@/lib/jarvis/project';
import type { DesignSnapshot, JarvisProposalLink, JarvisTurnResult } from '@/lib/jarvis/types';
import { recordScanEstimateChoices, clearScanEstimateChoices } from '@/lib/estimate/scan-finish-intent';
import { clearScanFinishChoices, recordScanFinishChoices } from '@/lib/native/scan-finishes';

export type CameraMode = 'orbit' | 'walk' | 'photo';
export type RenderQuality = 'auto' | 'high' | 'balanced' | 'performance';
export type AnalysisPhase = 'idle' | 'uploading' | 'analyzing' | 'building' | 'ready' | 'error';

export interface UIState {
  selectedSlot: MaterialSlotId | null;
  hoveredSlot: MaterialSlotId | null;
  cameraMode: CameraMode;
  /** null shows the whole building; an index opens a floor for inspection. */
  floorPlanLevel: number | null;
  quality: RenderQuality;
  showEstimate: boolean;
  showRenders: boolean;
  panel: 'materials' | 'layout' | 'estimate' | 'renders' | 'scan' | 'jarvis';
  jarvisPreview?: { id: string; name: string; snapshot: DesignSnapshot; finishChoices?: Record<string, string> } | null;
  jarvisPreviewReady?: string | null;
  jarvisBusy?: boolean;
  analysisPhase: AnalysisPhase;
  analysisMessage: string;
  analysisProgress: number; // 0..1
  analysisStartedAt: number | null;
  compareMode: boolean;
  showOriginalPhoto: boolean;
  activeRenderId: string | null;
  /** background accuracy pass: comparing the twin with the client's photo */
  accuracyPass: 'idle' | 'running' | 'applied' | 'clean';
  accuracyApplied: number;
  accuracyMatch: number;
  /** photo-fit: projecting the twin's elements onto the photo's inventory boxes */
  fitState: 'idle' | 'running' | 'done' | 'error';
  /** mean IoU of the last fit, 0..1, or null when never fitted */
  fitScore: number | null;
  /** how close the fitted twin's sizes and positions are, 0..1, or null when never fitted */
  fitProportions: number | null;
  /** opacity of the client's photo laid over the twin in photo mode, 0..1 */
  overlayOpacity: number;
  overlayVisible: boolean;
}

export interface ProjectStore {
  project: Project;
  ui: UIState;

  // project lifecycle
  newProject: (roomType: RoomType) => void;
  loadProject: (p: Project) => void;
  setRoomType: (t: RoomType) => void;
  setPhotos: (photos: Photo[]) => void;
  addPhotos: (photos: Photo[]) => void;
  removePhoto: (url: string) => void;
  setDescription: (d: string) => void;
  setName: (n: string) => void;
  /** what was uploaded and what the client answered about it; null clears it */
  setIntake: (intake: IntakeState | null) => void;
  setSpec: (spec: RoomSpec) => void;
  patchSpec: (patch: (spec: RoomSpec) => RoomSpec) => void;
  confirmMeasurements: (patch: MeasurementPatch) => void;
  confirmPlanScale: (levelIndex: number, wallId: string, measuredFt: number) => void;
  setSelection: (slot: string, materialId: string) => void;
  setSelections: (sel: Record<string, string>) => void;
  resetSelectionsToDetected: () => void;
  setOverride: (key: string, value: unknown) => void;
  setEstimateSettings: (s: Partial<EstimateSettings>) => void;

  // the room as found — what the changes-only estimate diffs against
  captureBaseline: (source: BaselineSource) => void;
  clearBaseline: () => void;
  patchBaselineSelections: (patch: Record<string, string>) => void;
  revertToBaseline: () => void;
  setBranding: (b: Project['branding']) => void;
  setClient: (c: Project['client']) => void;
  commitJarvis: (projectId: string, result: JarvisTurnResult, message: string) => void;
  applyJarvisOption: (id: string) => void;
  removeJarvisOption: (id: string) => void;
  undoJarvis: () => void;
  addJarvisProposal: (link: JarvisProposalLink) => void;

  // jobs
  upsertRender: (job: RenderJob) => void;
  upsertScan: (job: ScanJob) => void;
  removeRender: (id: string) => void;

  // ui
  setUI: (patch: Partial<UIState>) => void;
  selectSlot: (slot: MaterialSlotId | null) => void;
  setAnalysis: (phase: AnalysisPhase, message?: string, progress?: number) => void;
}

export const DEFAULT_ESTIMATE_SETTINGS: EstimateSettings = {
  region: 'seattle',
  tier: 'standard',
  contingencyPct: 0.1,
  markupPct: 0.2,
  scope: 'pull-and-replace',
  includePermits: true,
  // a freshly analysed kitchen must open at "nothing changed yet", not at a
  // whole remodel of the room the client already owns
  mode: 'changes',
  includeKnockOns: true,
};

export function emptyProject(roomType: RoomType = 'kitchen'): Project {
  const now = new Date().toISOString();
  return {
    id: nanoid(10),
    name: 'Untitled project',
    roomType,
    createdAt: now,
    updatedAt: now,
    photos: [],
    description: '',
    spec: null,
    selections: { ...DEFAULT_SELECTIONS[roomType] },
    overrides: {},
    baseline: null,
    // never asked: a plain room photo answers its own questions, and the
    // guided intake only exists for the uploads that cannot
    intake: null,
    estimateSettings: { ...DEFAULT_ESTIMATE_SETTINGS },
    renders: [],
    scans: [],
  };
}

const initialUI: UIState = {
  selectedSlot: null,
  hoveredSlot: null,
  cameraMode: 'orbit',
  floorPlanLevel: null,
  quality: 'auto',
  showEstimate: true,
  showRenders: false,
  panel: 'materials',
  analysisPhase: 'idle',
  analysisMessage: '',
  analysisProgress: 0,
  analysisStartedAt: null,
  compareMode: false,
  showOriginalPhoto: false,
  activeRenderId: null,
  accuracyPass: 'idle',
  accuracyApplied: 0,
  accuracyMatch: 0,
  fitState: 'idle',
  fitScore: null,
  fitProportions: null,
  overlayOpacity: 0.45,
  overlayVisible: true,
};

const touch = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() });

/**
 * `ensureSpecMaterials` repairs a spec IN PLACE — `materials[slot] = …`, an
 * `Object.assign` over the same map, and a kitchen's `cabinets.twoTone`.
 * `captureBaseline` deliberately stores the SAME spec object as `project.spec`
 * (that reference equality is how the analysis loop knows the user has not
 * diverged), and a patch's shallow spreads keep sharing those two children with
 * it. Without this a stale-custom-id remap or a `unifyRelatedSlots` fix landing
 * after capture would rewrite the AS-FOUND map too, and the changes-only
 * estimate would report "no change" on a row the user did change. So: give a
 * patched spec its own copies of exactly the objects that pass mutates.
 */
/** Native walls/openings are source evidence. Fixture or photo edits must not
 * erase them or change the framing dimensions behind their layout controls. */
function preserveCapturedRoom(previous: RoomSpec | null, next: RoomSpec): RoomSpec {
  if (previous && (previous.roomType === 'kitchen' || previous.roomType === 'bathroom') && previous.scanGeometry && next.roomType === previous.roomType) {
    return { ...next, scanGeometry: previous.scanGeometry, ...(next.scanDesign === undefined && previous.scanDesign !== undefined ? { scanDesign: previous.scanDesign } : {}), dims: previous.dims, openings: previous.openings };
  }
  return next;
}

function detachMutated(spec: RoomSpec): RoomSpec {
  const out = { ...spec, materials: { ...spec.materials } } as unknown as RoomSpec;
  if (out.roomType === 'kitchen') out.cabinets = { ...out.cabinets };
  return out;
}

/**
 * Follow a material remap onto the as-found map. A custom id the matcher had
 * to rewrite would otherwise leave the baseline pointing at the old id and
 * every row it drives would read "Changed" without the user touching a thing.
 */
function remapBaseline(baseline: Project['baseline'], remap: Record<string, string>, slotRemap: SlotMaterialRemap): Project['baseline'] {
  if (!baseline) return baseline ?? null;
  const healed = healSelections(baseline.selections, baseline.spec, remap, slotRemap);
  return healed === baseline.selections ? baseline : { ...baseline, selections: healed };
}

/**
 * A reloaded project keeps the OLD material in the view. `ensureSpecMaterials`
 * repairs `spec.materials`, but `selections` is what `useSlotMaterial` renders
 * and what `calculateEstimate` prices, and healing only follows a REMAP — an
 * id the matcher rewrote. When the matcher itself gets better (the accent
 * score that moved client-tan's counter off gold-veined calacatta), the spec's
 * material changes without any remap and the persisted selection stays on the
 * old product for ever: a fresh analysis is right, a reopened project is not.
 *
 * So a slot the client NEVER TOUCHED — its selection still equals the as-found
 * baseline's — follows the spec. A slot they picked by hand is theirs and is
 * left alone, which is why this cannot go through `healSelections`/`remap`
 * (that path deliberately rewrites hand-picked finishes too). The baseline
 * moves with it, so the changes-only estimate still reads "no change" on a row
 * the client did not change.
 */
function followSpecMaterials(project: Project): Project {
  const { spec, baseline } = project;
  if (!spec || !baseline) return project;
  const want = spec.materials as unknown as Record<string, string>;
  const base = baseline.selections;
  let sel = project.selections;
  let bsel = base;
  for (const [slot, id] of Object.entries(sel)) {
    const next = want[slot];
    if (!next || next === id || base[slot] !== id) continue;
    if (sel === project.selections) sel = { ...sel };
    if (bsel === base) bsel = { ...base };
    sel[slot] = next;
    bsel[slot] = next;
  }
  if (sel === project.selections) return project;
  return { ...project, selections: sel, baseline: { ...baseline, selections: bsel } };
}

/** Re-register the baseline spec's custom materials and follow the remap. `undefined` (legacy shared JSON) → null. */
function healBaseline(baseline: Project['baseline'] | undefined): Project['baseline'] {
  if (!baseline) return null;
  const { remap, slotRemap } = ensureSpecMaterials(baseline.spec);
  return remapBaseline(baseline, remap, slotRemap);
}

export const PERSIST_VERSION = 8;

/**
 * The persisted-project migration, pure and testable (scripts/check-store.ts
 * feeds it a real v3 payload). It must never touch `window` or `localStorage`.
 *
 * v1 specs predate décor, finish observations and per-run backsplash; a
 * persisted project from then must open as a bare-walled twin rather than
 * crash the room builder on `decor.shelves`. v2 specs predate the photo
 * inventory, the solved camera, stools and the hood/appliance body words; the
 * strict RoomSpecZ on /api/refine, /api/fit and /api/render rejects a spec
 * missing them, so they are backfilled to "nothing yet".
 */
export function migrateProject(persisted: unknown, version: number): { project: Project } {
  const s = persisted as { project?: Project };
  const spec = s.project?.spec as (RoomSpec & { decor?: DecorSpec }) | null | undefined;
  if (version < 2 && spec) {
    if (spec.roomType !== 'exterior' && !spec.decor) spec.decor = emptyDecor();
    if (spec.detected && !Array.isArray(spec.detected.finishes)) spec.detected.finishes = [];
    if (spec.roomType === 'kitchen') for (const run of spec.runs ?? []) if (typeof run.backsplash !== 'boolean') run.backsplash = true;
  }
  if (version < 3 && spec) {
    if (spec.detected) {
      if (!Array.isArray(spec.detected.elements)) spec.detected.elements = [];
      if (spec.detected.camera && spec.detected.camera.solved === undefined) spec.detected.camera.solved = null;
    }
    if (spec.roomType !== 'exterior' && spec.decor && spec.decor.stools === undefined) spec.decor.stools = null;
    if (spec.roomType === 'kitchen') {
      for (const a of spec.appliances ?? []) {
        if (a.hoodShape === undefined) a.hoodShape = null;
        if (a.bodyFinish === undefined) a.bodyFinish = null;
      }
    }
  }
  if (version < 4 && spec) {
    // per-element fitting fields (pendant row, per-run upper height,
    // stool pitch / end seats, appliance heights), the inventory's
    // frame block and element facing, and the tall-cabinet slot
    if (spec.detected) {
      if (spec.detected.frame === undefined) spec.detected.frame = null;
      for (const e of spec.detected.elements ?? []) if (e.facing === undefined) e.facing = null;
    }
    if (spec.roomType === 'kitchen') {
      const p = spec.lighting?.pendants;
      if (p) { p.spreadFt ??= 0; p.offsetFt ??= 0; p.aboveCounterIn ??= 0; }
      for (const run of spec.runs ?? []) if (run.upperHeightIn === undefined) run.upperHeightIn = null;
      if (spec.island) { spec.island.stoolPitchIn ??= 0; spec.island.endSeats ??= 0; }
      for (const a of spec.appliances ?? []) { if (a.heightIn === undefined) a.heightIn = null; if (a.aboveCounterIn === undefined) a.aboveCounterIn = null; }
      const m = spec.materials as unknown as Record<string, string>;
      if (m && !m.cabinets_tall) m.cabinets_tall = m.cabinets_base;
      if (spec.backsplash && !spec.backsplash.behindRange) spec.backsplash.behindRange = 'same';
    } else if (spec.roomType === 'bathroom') {
      const p = spec.lighting?.pendants;
      if (p) { p.spreadFt ??= 0; p.offsetFt ??= 0; p.aboveCounterIn ??= 0; }
    }
    if (s.project) {
      const sel = s.project.selections as Record<string, string>;
      if (spec.roomType === 'kitchen' && sel && !sel.cabinets_tall) sel.cabinets_tall = sel.cabinets_base;
    }
  }

  if (version < 5) {
    // v4 specs predate the cabinet above the hood, the detail layer, the
    // proportion degrees of freedom, the detector's own repeatability and the
    // as-found baseline. The strict RoomSpecZ on /api/refine, /api/fit and
    // /api/render rejects a spec missing any of them (nullable ≠ optional),
    // so they are backfilled to "nothing yet".
    if (spec) {
      if (spec.detected && spec.detected.inventory === undefined) spec.detected.inventory = null;
      if (spec.roomType !== 'exterior' && spec.decor) {
        spec.decor.items ??= [];
        spec.decor.cabinetContents ??= [];
      }
      if (spec.roomType === 'kitchen') {
        for (const a of spec.appliances ?? []) if (a.cabinetAbove === undefined) a.cabinetAbove = null;
        if (spec.backsplash && spec.backsplash.heightIn === undefined) spec.backsplash.heightIn = null;
        if (spec.countertop && spec.countertop.overhangIn === undefined) spec.countertop.overhangIn = null;
        if (spec.island) {
          spec.island.endPlacement ??= 'auto';
          if (spec.island.endOverhangIn === undefined) spec.island.endOverhangIn = null;
          spec.island.stoolOffsetIn ??= 0;
        }
        const p = spec.lighting?.pendants;
        if (p && p.positions === undefined) p.positions = null;
        for (const run of spec.runs ?? []) {
          for (const u of run.uppers ?? []) if (u.heightIn === undefined) u.heightIn = null;
          for (const t of run.tall ?? []) if (t.toCeiling === undefined) t.toCeiling = null;
        }
      }
    }
    if (s.project) {
      const es = (s.project.estimateSettings ?? {}) as Partial<EstimateSettings>;
      s.project.estimateSettings = { ...DEFAULT_ESTIMATE_SETTINGS, ...es, mode: es.mode ?? 'changes', includeKnockOns: es.includeKnockOns ?? true };
      // The clone happens AFTER the v2–v4 repairs and the v5 spec fixes above,
      // so the baseline spec is already repaired. spec.materials is the
      // as-found photo finishes and is never rewritten by user edits (only
      // `selections` is), so a backfilled baseline gives a correct materials
      // diff on the very next load; the chip says "backfilled".
      if (s.project.baseline === undefined) {
        s.project.baseline = spec
          ? {
              spec: JSON.parse(JSON.stringify(spec)) as RoomSpec,
              selections: { ...DEFAULT_SELECTIONS[spec.roomType], ...(spec.materials as unknown as Record<string, string>) },
              capturedAt: s.project.updatedAt,
              source: 'migrated',
            }
          : null;
      }
    }
  }

  if (version < 6) {
    // v5 specs predate the second tier of wall cabinets (runs[].uppers2 /
    // uppers2HeightIn), the truncation flags on a photo box
    // (detected.elements[].open / openCause), the plank direction on a finish
    // observation, and the stool seat's shape and colour. RoomSpecZ requires
    // all of them (nullable ≠ optional), so every one is backfilled to the
    // value that means "as before": one tier, no direction recorded, a round
    // pad in the seat material's stock colour — except `open`, which is
    // inferred from the box rather than defaulted (see below).
    if (spec) {
      if (spec.detected) {
        // `open` is INFERRED here, not merely backfilled all-false: the
        // inventory prompt has always told the annotator to stop an element at
        // the frame edge, so a persisted box that touches the border was cut by
        // the picture whether or not anyone recorded it. Backfilling all-false
        // instead left every rehydrated project fully closed — 0 open boxes on
        // client-tan where the same helper finds 18 — and only the fit route
        // heals a spec, so MatchReport, the photo overlay and anything reading
        // `elements[].open` would have seen a lie until the next re-analysis.
        // Same helper the reconciler and healContract use; it cannot disagree.
        for (const e of spec.detected.elements ?? []) {
          if (!e || !e.box || typeof e.box !== 'object') continue;
          const r = resolveOpen(e.box, e.open, e.openCause);
          e.open = r.open;
          e.openCause = r.openCause;
        }
        for (const f of spec.detected.finishes ?? []) if (f.plankRun === undefined) f.plankRun = null;
      }
      if (spec.roomType !== 'exterior' && spec.decor?.stools) {
        if (spec.decor.stools.seatShape === undefined) spec.decor.stools.seatShape = null;
        if (spec.decor.stools.seatColorHex === undefined) spec.decor.stools.seatColorHex = null;
      }
      if (spec.roomType === 'kitchen') {
        for (const run of spec.runs ?? []) {
          if (!Array.isArray(run.uppers2) || run.uppers2.length === 0) run.uppers2 = null;
          if (run.uppers2HeightIn === undefined) run.uppers2HeightIn = null;
        }
      }
    }
  }
  if (version < 7) {
    // v6 predates the guided intake and the bathroom's own contract: what the
    // client uploaded (`project.intake`, `detected.inputKind`), the wall
    // tile's pattern / module / numeric height, the vanity's front, the
    // shower's glass and door, the tub's material and filler, and the
    // accessories list. RoomSpecZ requires every one of them (nullable ≠
    // optional) on /api/refine, /api/fit and /api/render, so each is
    // backfilled to the value that means "as before": null everywhere, an
    // empty accessories list, and 'room-photo' — which is what every project
    // written before the intake existed actually was.
    if (s.project && s.project.intake === undefined) s.project.intake = null;
    if (spec) {
      if (spec.detected && spec.detected.inputKind === undefined) spec.detected.inputKind = 'room-photo';
      if (spec.roomType === 'bathroom') healBathroomContract(spec);
    }
  }
  if (version < 8) {
    // v7 predates the floor plan. No v7 project can BE one — 'floorplan' did
    // not exist as a room type — so nothing is backfilled onto an old spec;
    // the bump exists so a v7 payload is not handed to a v8 rehydrate that
    // assumes the levels array is there, and so a project persisted by a
    // half-written floor plan (a hand-edited payload, a shared link from a
    // newer build) is put through the healer rather than crashing the studio.
    if (spec && spec.roomType === 'floorplan') healFloorPlanContract(spec);
  }
  return s as unknown as { project: Project };
}

/**
 * Put a persisted floor plan through the same healer every route uses, in
 * place. A plan that arrives with overlapping walls, an unclosed polygon, a
 * door on a wall that is not there or a stair to a level nobody drew opens as
 * a smaller, coherent house instead of taking the studio down.
 */
function healFloorPlanContract(spec: RoomSpec): void {
  if (spec.roomType !== 'floorplan') return;
  spec.levels = healFloorPlan((spec as { levels?: unknown }).levels);
  if (spec.detected && typeof spec.detected === 'object') {
    if (!Array.isArray(spec.detected.finishes)) spec.detected.finishes = [];
    if (!Array.isArray(spec.detected.elements)) spec.detected.elements = [];
    if (spec.detected.inventory === undefined) spec.detected.inventory = null;
    if (spec.detected.inputKind === undefined) spec.detected.inputKind = 'floor-plan';
  }
}

/**
 * Fill the bathroom contract fields a v6 spec lacks with their "as before"
 * values, in place. Mirrors `healContract`'s bathroom branch exactly — the two
 * run on different paths (this on rehydrate, that on every route) and must
 * never disagree about what a missing field means.
 */
function healBathroomContract(spec: RoomSpec): void {
  if (spec.roomType !== 'bathroom') return;
  const b = spec as unknown as Record<string, Record<string, unknown> | undefined>;
  const nul = (obj: Record<string, unknown> | undefined, keys: string[]) => {
    if (!obj) return;
    for (const k of keys) if (obj[k] === undefined) obj[k] = null;
  };
  nul(b.vanity, ['drawers', 'doors', 'legStyle', 'counterThicknessIn', 'backsplash', 'heightIn', 'depthIn', 'basin', 'faucetMount', 'hardware', 'openShelf']);
  nul(b.shower, ['glassThicknessIn', 'doorType', 'hardwareFinish', 'nicheAt', 'benchStyle', 'curbHeightIn']);
  nul(b.tub, ['material', 'fillerType', 'fillerFinish', 'apron', 'widthIn', 'heightIn']);
  nul(b.toilet, ['trimFinish']);
  nul(b.wallTile, ['heightIn', 'pattern', 'moduleIn', 'groutWidthIn', 'trim', 'accent', 'showerPattern', 'showerModuleIn']);
  const spc = spec as unknown as Record<string, unknown>;
  if (!Array.isArray(spc.accessories)) spc.accessories = [];
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set) => ({
      project: emptyProject('kitchen'),
      ui: initialUI,

      newProject: (roomType) => set({ project: emptyProject(roomType), ui: { ...initialUI } }),
      // A spec can reference materials the analyzer minted from the photo;
      // those must exist in this process's catalog before anything renders,
      // prices or names them — so every entry point re-registers them, and
      // the selections follow any id the pass had to rewrite.
      loadProject: (p) => {
        const { remap, slotRemap } = ensureSpecMaterials(p.spec);
        const selections = healSelections(p.selections, p.spec, remap, slotRemap);
        // the as-found map must be healed by the SAME remap, or a rewritten
        // custom id reads as a change the user never made ("Changed" on a row
        // nobody touched). Legacy shared JSON has no key at all → null.
        const baseline = healBaseline(p.baseline);
        // a share link or an API body can carry any shape at all under
        // `intake`; heal it here for the same reason the baseline is healed
        const intake = healIntake(p.intake);
        const healed0 = selections === p.selections && baseline === p.baseline && intake === p.intake
          ? p
          : { ...p, selections, baseline, intake };
        // …and then the selections follow the SPEC's own material ids, exactly
        // as they do on rehydrate. `ensureSpecMaterials` step 2a rewrites a
        // catalog id on the spec without putting it in `remap` (a catalog id is
        // not a dead custom id), so `healSelections` cannot see that move: the
        // share page would render and PRICE the id the project was saved with
        // while the spec says another. Measured on client-tan: spec.materials
        // backsplash tile-quartz-slab / flooring custom-flooring-c3d04f50
        // against selections tile-marble-slab / floor-white-oak-plank. Only
        // slots the user never changed by hand move (that is what the baseline
        // comparison inside is for), so studio and share now agree.
        set({
          project: followSpecMaterials(p.jarvis ? { ...healed0, jarvis: restoredJarvisState(p.jarvis) } : healed0),
          ui: { ...initialUI, analysisPhase: p.spec ? 'ready' : 'idle' },
        });
      },
      setRoomType: (roomType) => set((s) => ({
        // a baseline from another room type can only mislead the diff
        // …and the intake with it: the answers were about another room, and a
        // 'kitchen.cabinet-colour' answered for a kitchen is not an answer
        // about a bathroom. `applyIntakeAnswers` would skip them anyway; this
        // is so the UI never shows a client stale answers as if they held.
        project: touch({ ...s.project, roomType, spec: null, selections: { ...DEFAULT_SELECTIONS[roomType] }, baseline: null, intake: null }),
        ui: { ...initialUI, analysisPhase: 'idle' },
      })),
      setPhotos: (photos) => set((s) => ({ project: touch({ ...s.project, photos }) })),
      addPhotos: (photos) => set((s) => ({ project: touch({ ...s.project, photos: [...s.project.photos, ...photos] }) })),
      removePhoto: (url) => set((s) => ({ project: touch({ ...s.project, photos: s.project.photos.filter((p) => p.url !== url) }) })),
      setDescription: (description) => set((s) => ({ project: touch({ ...s.project, description }) })),
      setName: (name) => set((s) => ({ project: touch({ ...s.project, name }) })),
      setIntake: (intake) => set((s) => ({ project: touch({ ...s.project, intake: healIntake(intake) }) })),
      setSpec: (spec) => {
        const { remap, slotRemap } = ensureSpecMaterials(spec);
        set((s) => ({
          project: touch({
            ...s.project,
            spec: preserveCapturedRoom(s.project.spec, spec),
            selections: healSelections({ ...DEFAULT_SELECTIONS[spec.roomType], ...(spec.materials as unknown as Record<string, string>) }, spec, remap, slotRemap),
            baseline: remapBaseline(s.project.baseline, remap, slotRemap),
          }),
        }));
      },
      patchSpec: (patch) => set((s) => {
        if (!s.project.spec) return {};
        const spec = preserveCapturedRoom(s.project.spec, releaseInconsistentMeasurements(detachMutated(patch(s.project.spec))));
        const { remap, slotRemap } = ensureSpecMaterials(spec);
        return {
          ui: { ...s.ui, fitScore: null, fitProportions: null, fitState: 'idle' },
          project: touch({
            ...s.project,
            spec,
            selections: healSelections(s.project.selections, spec, remap, slotRemap),
            baseline: remapBaseline(s.project.baseline, remap, slotRemap),
          }),
        };
      }),
      confirmMeasurements: (patch) => set((s) => ({ project: touch(s.project.spec && 'scanGeometry' in s.project.spec && s.project.spec.scanGeometry ? s.project : measureProject(s.project, patch)), ui: { ...s.ui, fitScore: null, fitProportions: null, fitState: 'idle' } })),
      confirmPlanScale: (levelIndex, wallId, measuredFt) => set((s) => ({ project: touch(calibratePlanProject(s.project, levelIndex, wallId, measuredFt)) })),
      setSelection: (slot, materialId) => set((s) => {
        const selections = { ...s.project.selections, [slot]: materialId };
        return { project: touch({ ...s.project, selections, estimateSettings: recordScanEstimateChoices(s.project.spec, s.project.estimateSettings, selections, [slot]), overrides: recordScanFinishChoices(s.project, selections, [slot]) }) };
      }),
      setSelections: (selections) => set((s) => ({ project: touch({ ...s.project, selections, estimateSettings: recordScanEstimateChoices(s.project.spec, s.project.estimateSettings, selections), overrides: recordScanFinishChoices(s.project, selections) }) })),
      resetSelectionsToDetected: () => set((s) => ({
        project: touch({
          ...s.project,
          selections: { ...DEFAULT_SELECTIONS[s.project.roomType], ...((s.project.spec?.materials as unknown as Record<string, string>) ?? {}) },
          overrides: clearScanFinishChoices(s.project),
          estimateSettings: clearScanEstimateChoices(s.project.estimateSettings),
        }),
      })),
      setOverride: (key, value) => set((s) => ({ project: touch({ ...s.project, overrides: { ...s.project.overrides, [key]: value } }) })),
      setEstimateSettings: (patch) => set((s) => ({ project: touch({ ...s.project, estimateSettings: { ...s.project.estimateSettings, ...patch } }) })),

      // The SAME spec reference on purpose: the analysis loop asks "is the user
      // still following the passes?" with `project.spec === baseline.spec`, and
      // a clone would answer no from the first frame. After a persistence
      // round-trip it IS a separate clone and that test simply stops firing,
      // which is correct — a reloaded project has a user's edits in it.
      // The mutator to watch is `ensureSpecMaterials`, which repairs materials
      // and cabinets.twoTone in place: `detachMutated` above is what keeps it
      // off this shared object once a patch lands.
      captureBaseline: (source) => set((s) => (s.project.spec
        ? { project: touch({ ...s.project, baseline: { spec: s.project.spec, selections: { ...s.project.selections }, capturedAt: new Date().toISOString(), source } }) }
        : {})),
      clearBaseline: () => set((s) => (s.project.baseline ? { project: touch({ ...s.project, baseline: null }) } : {})),
      // a later pass re-reading a finish is a better observation of the room as
      // FOUND, not a change the user made — so it lands on both maps
      patchBaselineSelections: (patch) => set((s) => (s.project.baseline
        ? { project: touch({ ...s.project, baseline: { ...s.project.baseline, selections: { ...s.project.baseline.selections, ...patch } } }) }
        : {})),
      revertToBaseline: () => set((s) => {
        const b = s.project.baseline;
        if (!b) return {};
        const { remap, slotRemap } = ensureSpecMaterials(b.spec);
        return {
          project: touch({
            ...s.project,
            spec: b.spec,
            selections: healSelections(b.selections, b.spec, remap, slotRemap),
            overrides: clearScanFinishChoices(s.project),
            estimateSettings: clearScanEstimateChoices(s.project.estimateSettings),
            baseline: remapBaseline(b, remap, slotRemap),
          }),
        };
      }),
      setBranding: (branding) => set((s) => ({ project: touch({ ...s.project, branding }) })),
      setClient: (client) => set((s) => ({ project: touch({ ...s.project, client }) })),
      commitJarvis: (projectId, result, message) => set((s) => {
        if (s.project.id !== projectId) throw new Error('The active project changed. Jarvis did not overwrite it.');
        return { project: commitJarvisResult(s.project, result, message), ui: { ...s.ui, fitScore: null, fitProportions: null, fitState: 'idle' } };
      }),
      applyJarvisOption: (id) => set((s) => ({ project: applyJarvisOption(s.project, id), ui: { ...s.ui, fitScore: null, fitProportions: null, fitState: 'idle', cameraMode: 'orbit', showOriginalPhoto: false } })),
      undoJarvis: () => set((s) => ({ project: undoJarvisChange(s.project), ui: { ...s.ui, fitScore: null, fitProportions: null, fitState: 'idle' } })),
      removeJarvisOption: (id) => set((s) => ({ project: removeJarvisOption(s.project, id) })),
      addJarvisProposal: (link) => set((s) => ({ project: touch({ ...s.project, jarvis: { ...restoredJarvisState(s.project.jarvis), proposals: [link, ...(s.project.jarvis?.proposals ?? []).filter((p) => p.id !== link.id)].slice(0, 20) } }) })),

      upsertRender: (job) => set((s) => {
        const idx = s.project.renders.findIndex((r) => r.id === job.id);
        const renders = idx >= 0 ? s.project.renders.map((r) => (r.id === job.id ? { ...r, ...job } : r)) : [job, ...s.project.renders];
        return { project: touch({ ...s.project, renders }) };
      }),
      upsertScan: (job) => set((s) => {
        const idx = s.project.scans.findIndex((r) => r.id === job.id);
        const scans = idx >= 0 ? s.project.scans.map((r) => (r.id === job.id ? { ...r, ...job } : r)) : [job, ...s.project.scans];
        return { project: touch({ ...s.project, scans }) };
      }),
      removeRender: (id) => set((s) => ({ project: touch({ ...s.project, renders: s.project.renders.filter((r) => r.id !== id) }) })),

      setUI: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
      selectSlot: (slot) => set((s) => ({ ui: { ...s.ui, selectedSlot: slot, panel: slot ? 'materials' : s.ui.panel } })),
      setAnalysis: (phase, message, progress) => set((s) => ({
        ui: {
          ...s.ui,
          analysisPhase: phase,
          analysisMessage: message ?? s.ui.analysisMessage,
          analysisProgress: progress ?? s.ui.analysisProgress,
          analysisStartedAt: phase === 'uploading' ? Date.now() : phase === 'idle' ? null : s.ui.analysisStartedAt,
        },
      })),
    }),
    {
      name: 'manhattan-project-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ project: s.project }),
      version: PERSIST_VERSION,
      migrate: (persisted, version) => migrateProject(persisted, version),
      // localStorage holds ids, not definitions — rebuild the custom ones from
      // the spec's finish observations before the first frame asks for them.
      // Edited in place: with synchronous storage this runs inside create(),
      // before the store variable exists, so setState is not an option; the
      // object handed here IS the store's project, and nothing has read it yet.
      onRehydrateStorage: () => (state) => {
        if (!state?.project) return;
        const { remap, slotRemap } = ensureSpecMaterials(state.project.spec);
        state.project.selections = healSelections(state.project.selections, state.project.spec, remap, slotRemap);
        state.project.baseline = healBaseline(state.project.baseline);
        state.project.intake = healIntake(state.project.intake);
        if (state.project.jarvis) state.project.jarvis = restoredJarvisState(state.project.jarvis);
        Object.assign(state.project, followSpecMaterials(state.project));
      },
    },
  ),
);

export const useProject = () => useProjectStore((s) => s.project);
export const useSelections = () => useProjectStore((s) => s.project.selections);
export const useSpec = () => useProjectStore((s) => s.project.spec);
export const useUI = () => useProjectStore((s) => s.ui);
