/**
 * Vision analysis: photos (+ description) → RoomSpec.
 *
 * OpenAI Responses API with a strict JSON-schema output format (retrying once
 * without `strict` if the model rejects the schema), then zod validation,
 * schema-driven repair (`sanitize.ts`), domain reconciliation
 * (`reconcile.ts`) and a final validation. A template spec is the last resort
 * so the UI always receives something explorable — flagged via `usedFallback`.
 */
import type OpenAI from 'openai';
import { RoomSpecZ, jsonSchemaFor } from '@/lib/spec/schema';
import { defaultSpec, emptyDecor } from '@/lib/spec/defaults';
import { PLAN_NO_DIMENSIONS } from '@/lib/spec/intake';
import { ensureSpecMaterials } from '@/lib/materials/match';
import type { Photo, PhotoElement, RoomSpec, RoomType } from '@/lib/spec/types';
import { MAX_UPLOAD_BYTES, fetchBytes, toModelImageUrl } from '@/lib/storage/blob';
import { imageDimensions } from '@/lib/storage/image-meta';
import { INVENTORY_TIMEOUT_MS, inventoryPhoto, mergeItemPass, type InventoryResult } from './inventory';
import { errorMessage, serverError, serverLog, serverWarn, startTimer } from './log';
import { PLAN_DIM_NOTE, buildAnalysisPrompt } from './prompt';
import { ProviderError, openaiClient, openaiVisionModel } from './providers';
import { reconcileSpec, type DetectedWithFrame, type PhotoFrame } from './reconcile';
import { parseModelJson, sanitizeShape, type SanitizeReport } from './sanitize';
import { isSingleRoom } from '@/lib/spec/floorplan';

export const MAX_ANALYSIS_PHOTOS = 6;
/** Leave the 300 s hosting window room to serialize and close the stream. */
export const ANALYSIS_DEADLINE_MS = 270_000;

/** Keep the user's primary even when the request contains more than the cap. */
export function selectAnalysisPhotos(input: readonly Photo[]): { photos: Photo[]; primaryIndex: number } {
  const marked = input.findIndex((p) => p.primary);
  const chosen = input.slice(0, MAX_ANALYSIS_PHOTOS);
  if (marked >= MAX_ANALYSIS_PHOTOS) chosen[chosen.length - 1] = input[marked];
  const primaryIndex = Math.max(0, chosen.findIndex((p) => p === input[marked]));
  return { photos: chosen.map((p, i) => ({ ...p, primary: i === primaryIndex })), primaryIndex };
}
/**
 * How long the main vision call waits for the inventory before starting
 * without it. Real room uploads needed35–43seconds for the inventory, so a
 * zero-second default made its correct case/pendant counts unavailable to
 * the main reconstruction. Wait at most the inventory's60-second deadline;
 * failure returns immediately, and the main call still has a shared budget.
 * An explicit INVENTORY_HEAD_START_MS=0 keeps the parallel speed override.
 */
export function inventoryHeadStartMs(): number {
  const raw = process.env.INVENTORY_HEAD_START_MS;
  const n = raw === undefined || raw.trim() === '' ? INVENTORY_TIMEOUT_MS : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, INVENTORY_TIMEOUT_MS) : INVENTORY_TIMEOUT_MS;
}
/** Reserve the main model's observed~210-second upper latency inside270s. */
export function inventoryPromptWaitMs(elapsedMs: number, requestedMs = inventoryHeadStartMs()): number {
  return Math.max(0, Math.min(requestedMs, ANALYSIS_DEADLINE_MS - Math.max(0, elapsedMs) - 210_000));
}
/** After the main call returns, how much longer a still-running inventory may take before it is abandoned. */
export const INVENTORY_GRACE_MS = 8_000;

export interface AnalyzeInput {
  roomType: RoomType;
  photos: Photo[];
  description?: string;
  /** request origin — resolves root-relative photo paths that are not on disk */
  origin?: string;
  signal?: AbortSignal;
}

export type AnalyzePhase = 'analyzing' | 'validating' | 'building';

export interface AnalyzeProgress {
  phase: AnalyzePhase;
  message: string;
  /** 0..1 */
  progress: number;
}

export interface AnalyzeResult {
  spec: RoomSpec;
  /**
   * The photos analysed, with `width` / `height` filled in for the primary
   * photo when the server had to read them off the file — the inventory's
   * boxes are normalised to that frame, so the client must fit and screenshot
   * at the same aspect, and it can only do that if the size travels back.
   */
  photos: Photo[];
  model: string;
  elapsedMs: number;
  /** the raw model output failed validation and was repaired */
  repaired: boolean;
  /** nothing usable came back; a template spec is returned */
  usedFallback: boolean;
  /** human-readable list of repairs/assumptions made server-side */
  fixes: string[];
  photoCount: number;
  /** what the pixel-space inventory of the primary photo produced */
  inventory: {
    /** the call succeeded (an empty list from a bare photo still counts) */
    ok: boolean;
    count: number;
    /** photo width ÷ height the boxes were drawn against, when known */
    aspect: number | null;
    elapsedMs: number;
    /** the list reached the main analysis prompt (it arrived within the head start) */
    inPrompt: boolean;
    /** index into `photos` of the inventoried photo */
    photoIndex: number;
    /** annotation passes that succeeded (2 = boxes averaged) */
    samples: number;
    /** mean IoU between the passes' paired boxes (how repeatable the boxes were), null with one pass */
    agreement: number | null;
    /** the inventory's read of the frame (also on spec.detected.frame) */
    frame: PhotoFrame | null;
    /** consistency-rule violations that lowered confidences */
    violations: string[];
  };
}

type Content = OpenAI.Responses.ResponseInputContent[];

function isSchemaRejection(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  const msg = String((err as Error).message ?? '');
  return status === 400 && /schema|strict|json_schema|additionalProperties|unsupported|invalid.*format/i.test(msg);
}

function mapOpenAIError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = (err as { status?: number }).status;
  const msg = errorMessage(err);
  if (status === 401) return new ProviderError('openai', 'OpenAI rejected the API key', { code: 'unauthorized', status: 502, retryable: false, cause: err });
  // A 429 is two very different things: a per-minute burst (retry) or an
  // exhausted credit balance (only adding credits helps). Say which.
  if (status === 429 && /insufficient_quota|credit_balance|no credits|billing/i.test(msg)) return new ProviderError('openai', 'The OpenAI account has no credits left — add credits at platform.openai.com/settings/organization/billing, then try again.', { code: 'no_credits', status: 402, retryable: false, cause: err });
  if (status === 429) return new ProviderError('openai', 'OpenAI rate limit reached — try again in a moment', { code: 'rate_limited', status: 502, retryable: true, cause: err });
  if (status === 400 && /image|url|download|fetch/i.test(msg)) return new ProviderError('openai', `OpenAI could not read one of the photos: ${msg}`, { code: 'bad_image', status: 400, retryable: false, cause: err });
  if ((err as Error).name === 'AbortError' || (err as Error).name === 'TimeoutError' || /timed? ?out/i.test(msg)) return new ProviderError('openai', 'Photo reconstruction reached its time limit. Please retry the analysis.', { code: 'timeout', status: 504, retryable: true, cause: err });
  return new ProviderError('openai', `Vision analysis failed: ${msg}`, { status: 502, retryable: true, cause: err });
}

async function callVision(content: Content, roomType: RoomType, strict: boolean, signal?: AbortSignal): Promise<string> {
  const client = openaiClient();
  const model = openaiVisionModel();
  const schema = jsonSchemaFor(roomType) as Record<string, unknown>;
  const response = await client.responses.create(
    {
      model,
      input: [{ role: 'user', content }],
      text: { format: { type: 'json_schema', name: 'room_spec', strict, schema } },
      reasoning: { effort: 'medium' },
      max_output_tokens: 24_000,
      store: false,
    },
    { signal, timeout: ANALYSIS_DEADLINE_MS, maxRetries: 0 },
  );
  if (response.status === 'incomplete') {
    throw new ProviderError('openai', `Vision response incomplete (${response.incomplete_details?.reason ?? 'unknown reason'})`, { code: 'incomplete', retryable: true });
  }
  const text = response.output_text;
  if (!text || !text.trim()) throw new ProviderError('openai', 'Vision model returned an empty response', { code: 'empty_response', retryable: true });
  return text;
}

/**
 * The demo specs carry showroom décor and no finish observations. As a
 * repair fallback that is wrong twice over: a model answer that omitted
 * `decor` would inherit shelves and plants the photo never showed, and the
 * finishes would claim colours nobody observed. The template is bare.
 */
function templateSpec(roomType: RoomType): RoomSpec {
  const spec = defaultSpec(roomType);
  if (isSingleRoom(spec)) spec.decor = emptyDecor();
  spec.detected.finishes = [];
  return spec;
}

/** Template spec that still carries whatever the model managed to say about the space. */
function fallbackSpec(roomType: RoomType, raw: unknown, fixes: string[]): RoomSpec {
  const spec = templateSpec(roomType);
  const det = (raw as { detected?: { summary?: unknown; notes?: unknown; assumptions?: unknown } } | null)?.detected;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 12) : []);
  if (det && typeof det.summary === 'string' && det.summary.trim()) spec.detected.summary = det.summary.trim();
  spec.detected.notes = strings(det?.notes);
  spec.detected.assumptions = [
    'The analyzer could not produce a valid reconstruction from these photos; this is a template layout — adjust dimensions and materials by hand.',
    ...strings(det?.assumptions),
  ];
  spec.detected.confidence = 0.15;
  fixes.push('fallback: template spec used');
  return spec;
}

/**
 * What a DRAWING is allowed to have told us — enforced here, not just asked
 * for in the prompt.
 *
 * The floor-plan brief tells the model to leave the finishes empty, to write
 * one `plan dim:` note per dimension string it actually read, and to say when
 * the sheet carried none. A prompt is a request, though, and the failure it
 * guards against is the expensive one: a client uploads a line drawing and
 * gets back a colour nobody chose, sitting in the UI with the same weight as
 * a colour read off their own photograph. So the server holds the line:
 *
 *  - every finish observation is dropped (a drawing has no colour in it, and
 *    an observation marked 'inferred' is still a claim the interview would
 *    then have to overrule) — this runs BEFORE `reconcileSpec`, so an
 *    invented colour never mints a custom material either;
 *  - a drawing that produced no dimension note is declared undimensioned,
 *    which is what turns the room-size questions back on in the interview
 *    (`planSizeUnknown`) instead of shipping a size derived from an assumed
 *    door width;
 *  - what a plan structurally cannot carry — ceiling height, storey height,
 *    roof pitch, the sheets we were not given — is written down as an
 *    assumption the client can read;
 *  - and confidence is capped, however crisp the linework was.
 *
 * The declarations go to the FRONT of the assumptions: the list is capped at
 * 24 and these are the ones that explain what the client is looking at.
 */
export function applyPlanLimits(spec: RoomSpec, fixes: string[]): void {
  const kind = spec.detected.inputKind;
  if (kind !== 'floor-plan' && kind !== 'plans-document') return;

  if (spec.detected.finishes.length) {
    fixes.push(`plan: dropped ${spec.detected.finishes.length} finish observation${spec.detected.finishes.length === 1 ? '' : 's'} — a line drawing carries no colour, so the interview asks instead`);
    spec.detected.finishes = [];
  }

  const notes = Array.isArray(spec.detected.notes) ? spec.detected.notes : [];
  const dims = notes.filter((n) => typeof n === 'string' && n.trim().toLowerCase().startsWith(PLAN_DIM_NOTE));
  fixes.push(dims.length
    ? `plan: ${dims.length} dimension string${dims.length === 1 ? '' : 's'} read off the sheet`
    : 'plan: no dimension strings were read — the interview asks for the room size');

  const declared = [
    'A drawing shows no colour, material or sheen: every finish here is a placeholder until you choose one.',
    'Ceiling height, storey height and roof pitch are on the elevation and section sheets, never on a plan, so none of them were read from this upload.',
    ...(dims.length ? [] : [PLAN_NO_DIMENSIONS]),
    ...(kind === 'plans-document' ? ['Only the sheet in this image was read — a set\'s other pages were not opened.'] : []),
  ];
  const existing = (Array.isArray(spec.detected.assumptions) ? spec.detected.assumptions : []).filter((a) => !declared.includes(a));
  spec.detected.assumptions = [...declared, ...existing].slice(0, 24);
  spec.detected.confidence = Math.min(spec.detected.confidence, 0.4);
}

/** Photo pixel size: from the upload record when present, else from the file header. Null when unknowable. */
async function photoSize(photo: Photo, modelUrl: string, origin?: string): Promise<{ width: number; height: number } | null> {
  if (photo.width && photo.height && photo.width > 0 && photo.height > 0) return { width: photo.width, height: photo.height };
  try {
    // `modelUrl` is a data: URL for local files (already in memory) and the public URL otherwise
    const { buffer } = await fetchBytes(modelUrl.startsWith('data:') ? modelUrl : photo.url, { origin, maxBytes: MAX_UPLOAD_BYTES, timeoutMs: 15_000 });
    const dims = imageDimensions(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    return dims && dims.width > 0 && dims.height > 0 ? { width: dims.width, height: dims.height } : null;
  } catch (err) {
    serverWarn('inventory', 'could not read the photo dimensions', { error: errorMessage(err) });
    return null;
  }
}

type InventoryOutcome = { ok: true; result: InventoryResult } | { ok: false; error: string };

/**
 * Full analysis with diagnostics. Progress callbacks are safe to forward to
 * an NDJSON stream as-is.
 */
export async function analyzeRoomDetailed(input: AnalyzeInput, onProgress?: (p: AnalyzeProgress) => void): Promise<AnalyzeResult> {
  // The route has a 300 s execution limit. One deadline covers preparation,
  // main analysis, explicit schema/JSON retries and annotation grace periods.
  // Per-call timeouts alone allow those stages to exceed the host's limit.
  const deadline = AbortSignal.timeout(ANALYSIS_DEADLINE_MS);
  input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, deadline]) : deadline };
  input.signal?.throwIfAborted();
  const elapsed = startTimer();
  const progress = (phase: AnalyzePhase, message: string, value: number) => onProgress?.({ phase, message, progress: value });
  const { roomType } = input;
  const { photos, primaryIndex } = selectAnalysisPhotos(input.photos);
  if (!photos.length) throw new ProviderError('analyze', 'At least one photo is required', { code: 'bad_request', status: 400, retryable: false });
  const model = openaiVisionModel();
  const fixes: string[] = [];

  progress('analyzing', `Preparing ${photos.length} photo${photos.length === 1 ? '' : 's'}`, 0.04);
  const images = await Promise.all(photos.map((p) => toModelImageUrl(p.url, { origin: input.origin, maxBytes: MAX_UPLOAD_BYTES })));
  input.signal?.throwIfAborted();
  serverLog('analyze', 'photos prepared', { roomType, count: images.length, inlineBytes: images.reduce((s, i) => s + i.bytes, 0) });

  // --- photo inventory (primary photo only), started before the main call.
  // Give the semantic inventory a bounded chance to inform reconstruction.
  // A failed/late inventory still permits the ordinary image-only prompt.
  const size = await photoSize(photos[primaryIndex], images[primaryIndex].url, input.origin);
  input.signal?.throwIfAborted();
  const aspect = size ? size.width / size.height : null;
  // the measured size goes back on the photo record, so the client stores it
  // and fits / screenshots at the frame the boxes were drawn against
  const photosOut: Photo[] = photos.map((p, i) => (i === primaryIndex && size ? { ...p, width: size.width, height: size.height } : p));
  const invCtrl = new AbortController();
  // how long the items-only pass may hold the analysis up once the main call
  // has landed. Small on purpose — a missing pot is not worth a second.
  const ITEMS_GRACE_MS = 250;
  const onAbort = () => invCtrl.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const invStarted = startTimer();
    // A DRAWING IS NOT PHOTOGRAPHED. The inventory boxes what a camera saw, so
    // on a floor plan it spends a three-sample annotation call boxing plan
    // symbols, feeds them into the main prompt as if they were things in a
    // room, and leaves them on `detected.elements` for a fitter that is inert
    // on a plan. INVENTORY_KINDS in prompt.ts says this pass is not run on a
    // drawing; this is where that becomes true.
    const isDrawing = roomType === 'floorplan';
    const inventoryPromise: Promise<InventoryOutcome> = isDrawing
      ? Promise.resolve<InventoryOutcome>({ ok: false, error: 'a drawing is not photographed' })
      : inventoryPhoto({ roomType, imageUrl: images[primaryIndex].url, aspect, signal: invCtrl.signal, timeoutMs: INVENTORY_TIMEOUT_MS })
        .then((result): InventoryOutcome => ({ ok: true, result }))
        .catch((err): InventoryOutcome => {
          if (!invCtrl.signal.aborted) serverWarn('inventory', 'inventory failed; continuing without boxes', { error: errorMessage(err), ms: invStarted() });
          return { ok: false, error: errorMessage(err) };
        });
    // The items-only pass, beside the main inventory rather than after it: the
    // full pass spends its 90-box budget on the runs, the appliances and the
    // windows and gets to the pot on the stove last. Two passes of its own,
    // concurrent with the rest, so it adds no wall time — and it can fail
    // without touching anything (`allSettled` on the pair below).
    const itemsPromise: Promise<PhotoElement[] | null> = roomType === 'kitchen'
      ? inventoryPhoto({ roomType, imageUrl: images[primaryIndex].url, aspect, signal: invCtrl.signal, timeoutMs: INVENTORY_TIMEOUT_MS, only: 'items', samples: 2 })
        .then((r) => r.elements)
        .catch((err) => {
          if (!invCtrl.signal.aborted) serverWarn('inventory', 'items pass failed; using the main pass\'s item boxes', { error: errorMessage(err) });
          return null;
        })
      : Promise.resolve(null);
    const waitFor = (ms: number) => {
      input.signal?.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let cancelled: (() => void) | undefined;
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
      const abort = new Promise<never>((_, reject) => {
        cancelled = () => reject(input.signal?.reason ?? new DOMException('Analysis cancelled', 'AbortError'));
        input.signal?.addEventListener('abort', cancelled, { once: true });
      });
      return Promise.race([inventoryPromise, timeout, abort]).finally(() => {
        clearTimeout(timer);
        if (cancelled) input.signal?.removeEventListener('abort', cancelled);
      });
    };
    progress('analyzing', isDrawing ? 'Reading the sheet' : 'Inventorying the photo', 0.08);
    const headStart = inventoryPromptWaitMs(elapsed());
    const early = headStart > 0 ? await waitFor(headStart) : null;
    input.signal?.throwIfAborted();
    const promptElements: PhotoElement[] = early?.ok ? early.result.elements : [];
    serverLog('inventory', early ? 'inventory arrived before the main call' : headStart > 0 ? 'inventory still running; main call starts without it' : 'inventory running in parallel with the main call', { ms: invStarted(), headStart, count: promptElements.length });

    const content: Content = [{ type: 'input_text', text: buildAnalysisPrompt(roomType, input.description ?? '', photos.length, { primaryPhotoIndex: primaryIndex, elements: promptElements, frame: early?.ok ? early.result.frame : null }) }];
    images.forEach((im, i) => {
      content.push({ type: 'input_text', text: `Photo ${i}${photos[i].primary ? ' (user-marked primary)' : ''}:` });
      content.push({ type: 'input_image', image_url: im.url, detail: 'high' });
    });

    progress('analyzing', `Reading the ${roomType === 'exterior' ? 'site' : roomType} with ${model}`, 0.12);
    let text: string;
    let strict = true;
    try {
      text = await callVision(content, roomType, true, input.signal);
    } catch (err) {
      if (isSchemaRejection(err)) {
        serverWarn('analyze', 'strict schema rejected; retrying without strict', { error: errorMessage(err) });
        strict = false;
        try {
          text = await callVision(content, roomType, false, input.signal);
        } catch (err2) {
          throw mapOpenAIError(err2);
        }
      } else {
        throw mapOpenAIError(err);
      }
    }
    serverLog('analyze', 'vision response received', { roomType, model, strict, chars: text.length, ms: elapsed() });

    // The main call is done; give a late inventory a short grace period, then let it go.
    let inventory = early ?? (await waitFor(INVENTORY_GRACE_MS));
    if (!inventory) {
      invCtrl.abort();
      serverWarn('inventory', 'inventory abandoned after the main call', { ms: invStarted() });
      inventory = { ok: false, error: 'timed out' };
    }
    // the items pass has had the whole main call to finish; it never gets its
    // own grace period, because a missing pot is not worth a second of latency.
    // When the timer wins, the request is aborted and said out loud: an
    // un-awaited vision call runs to completion and is billed either way, and a
    // dropped detail pass has to be visible in the log, not a silent charge.
    let itemElements: PhotoElement[] | null = null;
    if (inventory.ok) {
      let itemsTimer: ReturnType<typeof setTimeout> | undefined;
      const late = Symbol('items-late');
      const raced = await Promise.race([
        itemsPromise,
        new Promise<typeof late>((resolve) => { itemsTimer = setTimeout(() => resolve(late), ITEMS_GRACE_MS); }),
      ]).finally(() => clearTimeout(itemsTimer));
      if (raced === late) {
        invCtrl.abort();
        serverWarn('inventory', 'items pass abandoned after the main call; the twin keeps the main pass\'s item boxes', { ms: invStarted() });
      } else itemElements = raced;
    }
    input.signal?.throwIfAborted();
    const invElements = inventory.ok
      ? (itemElements && itemElements.length ? mergeItemPass(inventory.result.elements, itemElements) : inventory.result.elements)
      : [];

    progress('validating', 'Checking the reconstruction against the schema', 0.7);
    let raw: unknown = null;
    try {
      raw = parseModelJson(text);
    } catch (err) {
      serverWarn('analyze', 'model JSON unparsable; retrying once', { error: errorMessage(err) });
      try {
        text = await callVision(content, roomType, false, input.signal);
        raw = parseModelJson(text);
      } catch (err2) {
        input.signal?.throwIfAborted();
        serverError('analyze', 'retry failed', err2);
        raw = null;
      }
    }

    let spec: RoomSpec | null = null;
    let repaired = false;
    let usedFallback = false;
    const first = raw ? RoomSpecZ.safeParse(raw) : null;
    if (first?.success && first.data.roomType === roomType) {
      spec = first.data;
    } else if (raw) {
      repaired = true;
      const issues = first && !first.success ? first.error.issues.length : 0;
      const report: SanitizeReport = { fixes: [] };
      const shaped = sanitizeShape(raw, roomType, templateSpec(roomType), report);
      const second = RoomSpecZ.safeParse(shaped);
      serverWarn('analyze', 'model output repaired', { issues, fixes: report.fixes.length, ok: second.success });
      fixes.push(...report.fixes.slice(0, 60));
      if (second.success && second.data.roomType === roomType) spec = second.data;
      else if (!second.success) serverError('analyze', 'repair still invalid', undefined, { first: second.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
    }
    if (!spec) {
      usedFallback = true;
      spec = fallbackSpec(roomType, raw, fixes);
    }

    // A model-selected primary cannot be mixed with boxes measured in another
    // image. The prompt and every returned photo flag name this same view.
    if (spec.detected.primaryPhotoIndex !== primaryIndex) fixes.push(`analysis: corrected primary photo ${spec.detected.primaryPhotoIndex} to the requested view ${primaryIndex}`);
    spec.detected.primaryPhotoIndex = primaryIndex;
    // Only an explicit client measurement confirmation may create a lock.
    spec.detected.measurements = null;

    // Before reconcile, so a colour a drawing cannot have shown never reaches
    // the finish matcher and mints a custom material out of itself.
    applyPlanLimits(spec, fixes);

    // The inventory is the authority on detected.elements: the main prompt asks
    // for an empty array, and any copy the model made of the list drifts.
    // Without an inventory whatever the model wrote goes through reconcile's
    // validation like any other field.
    if (inventory.ok) {
      spec.detected.elements = invElements;
      // the frame block rides on detected so reconcile's wall pass and the fitter can read it
      (spec.detected as DetectedWithFrame).frame = inventory.result.frame;
      // The inventory's own repeatability, stored beside the boxes and BEFORE
      // reconcile (which copies it by name): the match report shows it next to
      // the score, so "why isn't it 90%" becomes "here is how precisely the
      // photo was measured". The analyzer is told to leave this null.
      spec.detected.inventory = { samples: inventory.result.samples, agreement: inventory.result.agreement };
      if (inventory.result.samples < 3) fixes.push(`inventory: ${inventory.result.samples} of 3 annotation passes succeeded — the boxes are less precise than usual`);
      if (roomType === 'kitchen' && !(itemElements && itemElements.length)) fixes.push('inventory: items pass unavailable — only the main pass\'s item boxes are used');
      for (const v of inventory.result.violations.slice(0, 12)) fixes.push(`inventory: ${v} — confidence lowered`);
    } else if (isDrawing) {
      spec.detected.inventory = null;
      // nothing was boxed, so anything here is a plan symbol the model wrote
      // into a field meant for photographed elements
      if (spec.detected.elements.length) fixes.push(`plan: dropped ${spec.detected.elements.length} element box${spec.detected.elements.length === 1 ? '' : 'es'} — a drawing has no photographed elements`);
      spec.detected.elements = [];
    } else {
      spec.detected.inventory = null;
      fixes.push(`inventory: unavailable (${inventory.error}) — no pixel boxes for the fitter`);
    }

    progress('building', 'Reconciling cabinets, fixtures and materials', 0.85);
    const reconciled = reconcileSpec(spec, { photoCount: photos.length, fixes });
    const final = RoomSpecZ.safeParse(reconciled);
    if (final.success) {
      spec = final.data;
      // zod strips keys the schema does not know; the frame block is one until DetectionMeta carries it
      (spec.detected as DetectedWithFrame).frame = (reconciled.detected as DetectedWithFrame).frame ?? null;
    } else {
      serverError('analyze', 'reconciled spec failed validation; using template', undefined, { issues: final.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`) });
      usedFallback = true;
      spec = reconcileSpec(fallbackSpec(roomType, raw, fixes), { photoCount: photos.length, fixes });
    }
    if (repaired && !usedFallback) {
      spec.detected.assumptions = [...spec.detected.assumptions, 'Some values were normalised server-side to fit the schema.'].slice(0, 24);
    }
    // Reconcile already registered the photo-matched materials it minted; the
    // final safeParse returned a fresh copy of the spec, so make sure every id
    // it carries still resolves in this process before it leaves.
    ensureSpecMaterials(spec);
    spec.detected.primaryPhotoIndex = primaryIndex;

    const elapsedMs = elapsed();
    const inventoryMeta: AnalyzeResult['inventory'] = {
      ok: inventory.ok,
      count: spec.detected.elements.length,
      aspect: inventory.ok ? inventory.result.aspect : aspect,
      elapsedMs: inventory.ok ? inventory.result.elapsedMs : invStarted(),
      inPrompt: promptElements.length > 0,
      photoIndex: primaryIndex,
      samples: inventory.ok ? inventory.result.samples : 0,
      agreement: inventory.ok ? inventory.result.agreement : null,
      frame: inventory.ok ? inventory.result.frame : null,
      violations: inventory.ok ? inventory.result.violations : [],
    };
    serverLog('analyze', 'complete', { roomType, model, elapsedMs, repaired, usedFallback, fixes: fixes.length, confidence: spec.detected.confidence, inventory: inventoryMeta });
    progress('building', 'Reconstruction ready', 0.98);
    return { spec, photos: photosOut, model, elapsedMs, repaired, usedFallback, fixes, photoCount: photos.length, inventory: inventoryMeta };
  } catch (error) {
    // The SDK replaces a timeout signal's reason with APIUserAbortError.
    // Keep our actual deadline reason so the client gets a retryable timeout.
    if (input.signal?.aborted && (input.signal.reason as Error | undefined)?.name === 'TimeoutError') {
      throw mapOpenAIError(input.signal.reason);
    }
    throw error;
  } finally {
    // Provider failures, schema retries and canceled requests must not leave
    // five annotation calls running after their owning request has ended.
    invCtrl.abort();
    input.signal?.removeEventListener('abort', onAbort);
  }
}

/** Convenience wrapper: photos + description → RoomSpec. */
export async function analyzeRoom(input: AnalyzeInput, onProgress?: (p: AnalyzeProgress) => void): Promise<RoomSpec> {
  return (await analyzeRoomDetailed(input, onProgress)).spec;
}
