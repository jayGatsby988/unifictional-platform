/**
 * Schema-driven repair for model output. Walks the JSON Schema emitted by
 * zod (public `z.toJSONSchema` API — no zod internals) alongside the raw
 * value and a known-good fallback, clamping numbers, snapping enums to the
 * closest allowed value, filling missing keys, and dropping junk. The result
 * always has the schema's SHAPE; domain consistency is handled in
 * `reconcile.ts` and the final `safeParse` in `analyze.ts` is the arbiter.
 */
import { z } from 'zod';
import { schemaFor, ScannedRoomGeometryZ } from '@/lib/spec/schema';
import type { RoomType } from '@/lib/spec/types';
import { DEFAULT_MATERIAL, isItemKind, isItemMaterial } from '@/lib/spec/decor-items';

export interface JsonSchemaNode {
  type?: string | string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode | false;
  /** zod tuples: one schema per position */
  prefixItems?: JsonSchemaNode[];
  anyOf?: JsonSchemaNode[];
  oneOf?: JsonSchemaNode[];
  enum?: unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  /** kept for the same reason as minimum/maximum: `stripForStrict` deletes it, so
   *  the model is never told the cap and this walk is the only thing that applies it */
  maxLength?: number;
}

const schemaCache = new Map<RoomType, JsonSchemaNode>();

/** Un-stripped JSON schema (keeps minimum/maximum/minItems for clamping). */
export function rawJsonSchema(roomType: RoomType): JsonSchemaNode {
  let s = schemaCache.get(roomType);
  if (!s) {
    s = z.toJSONSchema(schemaFor(roomType), { target: 'draft-2020-12', unrepresentable: 'any' }) as JsonSchemaNode;
    // Sensor evidence is never AI-generated or filled with schema defaults.
    if (s.properties) delete s.properties.scanGeometry;
    if (s.required) s.required = s.required.filter(key => key !== 'scanGeometry');
    schemaCache.set(roomType, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// String similarity (for enum + material snapping)
// ---------------------------------------------------------------------------

export function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen–Dice bigram similarity on normalised strings, 0..1. */
export function similarity(a: string, b: string): number {
  const x = normalizeToken(a);
  const y = normalizeToken(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x[0] === y[0] ? 0.5 : 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let inter = 0;
  for (const [g, n] of bx) inter += Math.min(n, by.get(g) ?? 0);
  return (2 * inter) / (x.length - 1 + (y.length - 1));
}

/** Closest candidate (exact → contains → dice). Returns null when nothing is remotely close. */
export function closestString(candidates: readonly string[], value: string, minScore = 0.34): string | null {
  const v = normalizeToken(value);
  if (!v) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const n = normalizeToken(c);
    let score: number;
    if (n === v) return c;
    if (n.includes(v) || v.includes(n)) score = 0.9 - Math.abs(n.length - v.length) / Math.max(n.length, v.length) * 0.3;
    else score = similarity(n, v);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= minScore ? best : null;
}

// ---------------------------------------------------------------------------
// Defaults from schema
// ---------------------------------------------------------------------------

const typeOf = (s: JsonSchemaNode): string | undefined => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type);
const isNullable = (s: JsonSchemaNode) => (Array.isArray(s.type) && s.type.includes('null')) || Boolean(s.anyOf?.some((o) => o.type === 'null'));
const nonNullOptions = (s: JsonSchemaNode) => (s.anyOf ?? s.oneOf ?? []).filter((o) => o.type !== 'null');
const isConstUnion = (opts: JsonSchemaNode[]) => opts.length > 0 && opts.every((o) => o.const !== undefined);

export function defaultFor(schema: JsonSchemaNode): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const opts = nonNullOptions(schema);
  if (opts.length) {
    if (isNullable(schema)) return null;
    return defaultFor(opts[0]);
  }
  switch (typeOf(schema)) {
    case 'integer':
    case 'number': {
      const lo = schema.minimum ?? -Infinity;
      const hi = schema.maximum ?? Infinity;
      return Math.min(hi, Math.max(lo, 0));
    }
    case 'string': return '';
    case 'boolean': return false;
    case 'null': return null;
    case 'array': {
      const out: unknown[] = [];
      const tuple = Array.isArray(schema.prefixItems) ? schema.prefixItems : null;
      const n = schema.minItems ?? (tuple ? tuple.length : 0);
      for (let i = 0; i < n; i++) {
        const sch = tuple ? tuple[i] : (typeof schema.items === 'object' ? schema.items : null);
        out.push(sch ? defaultFor(sch) : null);
      }
      return out;
    }
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, prop] of Object.entries(schema.properties ?? {})) out[k] = defaultFor(prop);
      return out;
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

export interface SanitizeReport {
  fixes: string[];
}

const MAX_FIXES = 400;
function note(report: SanitizeReport, path: string, what: string) {
  if (report.fixes.length < MAX_FIXES) report.fixes.push(`${path || '$'}: ${what}`);
}

function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const m = /-?\d+(?:\.\d+)?/.exec(v.replace(/,/g, ''));
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Returns a value that fits `schema`, preferring `value`, then `fallback`,
 * then a schema default. Every change is appended to `report`.
 */
export function coerceToSchema(schema: JsonSchemaNode, value: unknown, fallback: unknown, path: string, report: SanitizeReport): unknown {
  // const
  if (schema.const !== undefined) {
    if (value !== schema.const) note(report, path, `set to constant ${JSON.stringify(schema.const)}`);
    return schema.const;
  }

  // unions (nullable / literal unions)
  const options = nonNullOptions(schema);
  if (schema.anyOf || schema.oneOf) {
    const nullable = isNullable(schema);
    if (value === null && nullable) return null;
    if (value === undefined) {
      if (fallback === null && nullable) return null;
      if (fallback === undefined) return nullable ? null : coerceToSchema(options[0], undefined, undefined, path, report);
      return coerceToSchema(options[0], fallback, undefined, path, report);
    }
    if (isConstUnion(options)) {
      const consts = options.map((o) => o.const);
      if (consts.includes(value)) return value;
      let pick: unknown;
      if (typeof consts[0] === 'number') {
        const n = parseNumber(value);
        pick = n === null ? (consts.includes(fallback) ? fallback : consts[0]) : consts.reduce((best, c) => (Math.abs((c as number) - n) < Math.abs((best as number) - n) ? c : best));
      } else {
        const s = typeof value === 'string' ? closestString(consts.map(String), value) : null;
        pick = s ?? (consts.includes(fallback) ? fallback : consts[0]);
      }
      note(report, path, `${JSON.stringify(value)} → ${JSON.stringify(pick)}`);
      return pick;
    }
    // General union: choose the option whose type matches the value, else the first.
    const kind = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const match = options.find((o) => typeOf(o) === kind || (kind === 'number' && typeOf(o) === 'integer')) ?? options[0];
    if (!match) return nullable ? null : value;
    return coerceToSchema(match, value, fallback, path, report);
  }

  // enum
  if (schema.enum?.length) {
    const allowed = schema.enum;
    if (allowed.includes(value)) return value;
    const asString = typeof value === 'string' ? closestString(allowed.map(String), value) : null;
    const pick = asString ?? (allowed.includes(fallback) ? fallback : allowed[0]);
    note(report, path, `${JSON.stringify(value)} → ${JSON.stringify(pick)}`);
    return pick;
  }

  switch (typeOf(schema)) {
    case 'integer':
    case 'number': {
      let n = parseNumber(value);
      if (n === null) {
        const fb = parseNumber(fallback);
        n = fb ?? (defaultFor(schema) as number);
        note(report, path, `${JSON.stringify(value)} → ${n} (fallback)`);
      }
      const lo = schema.minimum ?? -Infinity;
      const hi = schema.maximum ?? Infinity;
      let out = Math.min(hi, Math.max(lo, n));
      if (typeOf(schema) === 'integer') out = Math.round(out);
      if (out !== n && out !== value) note(report, path, `${n} clamped to ${out}`);
      return out;
    }
    case 'string': {
      let s: string | null = null;
      if (typeof value === 'string') s = value;
      else if (typeof value === 'number' || typeof value === 'boolean') s = String(value);
      if (s === null) {
        const fb = typeof fallback === 'string' ? fallback : '';
        if (value !== undefined) note(report, path, `non-string → ${JSON.stringify(fb)}`);
        s = fb;
      }
      // A too-long string is the one shape error the downstream repairs cannot
      // reach: reconcile only runs on a spec that already PARSED, so a 41-char
      // decor label or a 'rgb(200, 60, 60)' in a colour field would fail
      // RoomSpecZ and drop the client's kitchen to the template. Clamped here
      // for the same reason numbers are clamped against minimum/maximum.
      const cap = schema.maxLength;
      if (typeof cap === 'number' && s.length > cap) {
        note(report, path, `${s.length} chars truncated to ${cap}`);
        s = s.slice(0, cap);
      }
      return s;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (['true', 'yes', 'y', '1', 'present'].includes(s)) return true;
        if (['false', 'no', 'n', '0', 'absent', 'none'].includes(s)) return false;
      }
      if (typeof value === 'number') return value !== 0;
      const fb = typeof fallback === 'boolean' ? fallback : false;
      if (value !== undefined) note(report, path, `non-boolean → ${fb}`);
      return fb;
    }
    case 'null':
      return null;
    case 'array': {
      // a tuple (prefixItems) coerces each position against its own schema,
      // so an out-of-range frame span is clamped instead of failing the parse
      const tuple = Array.isArray(schema.prefixItems) ? schema.prefixItems : null;
      const items = typeof schema.items === 'object' ? schema.items : null;
      const itemSchema = (i: number): JsonSchemaNode | null => tuple ? (tuple[i] ?? tuple[tuple.length - 1] ?? null) : items;
      let arr: unknown[];
      if (Array.isArray(value)) arr = value;
      else if (isObj(value) && items && typeOf(items) === 'object') { arr = [value]; note(report, path, 'object wrapped into array'); }
      else { arr = Array.isArray(fallback) ? fallback : []; if (value !== undefined) note(report, path, 'non-array replaced'); }
      const fbArr = Array.isArray(fallback) ? fallback : [];
      let out = arr.map((el, i) => { const sch = itemSchema(i); return sch ? coerceToSchema(sch, el, fbArr[i] ?? fbArr[0], `${path}[${i}]`, report) : el; });
      const maxItems = schema.maxItems ?? (tuple ? tuple.length : undefined);
      const minItems = schema.minItems ?? (tuple ? tuple.length : undefined);
      if (maxItems !== undefined && out.length > maxItems) { note(report, path, `truncated to ${maxItems} items`); out = out.slice(0, maxItems); }
      if (minItems !== undefined && out.length < minItems) {
        note(report, path, `padded to ${minItems} items`);
        while (out.length < minItems) {
          const src = fbArr[out.length];
          const sch = itemSchema(out.length);
          out.push(sch ? coerceToSchema(sch, src, undefined, `${path}[${out.length}]`, report) : src ?? null);
        }
      }
      return out;
    }
    case 'object': {
      const props = schema.properties ?? {};
      const src = isObj(value) ? value : null;
      const fb = isObj(fallback) ? fallback : null;
      if (!src) {
        if (value !== undefined) note(report, path, 'non-object replaced');
        if (fb) return coerceToSchema(schema, fb, undefined, path, report);
      }
      const out: Record<string, unknown> = {};
      for (const [k, prop] of Object.entries(props)) {
        const childPath = path ? `${path}.${k}` : k;
        const has = src ? Object.prototype.hasOwnProperty.call(src, k) : false;
        if (!has && src) note(report, childPath, 'missing → fallback');
        out[k] = coerceToSchema(prop, has ? src![k] : undefined, fb ? fb[k] : undefined, childPath, report);
      }
      return out;
    }
    default:
      return value !== undefined ? value : fallback;
  }
}

/** Repairs `raw` into the shape of the room's schema using `fallback` (a valid spec) for gaps. */
export function sanitizeShape(raw: unknown, roomType: RoomType, fallback: unknown, report: SanitizeReport): unknown {
  const schema = rawJsonSchema(roomType);
  const value = isObj(raw) ? { ...raw, roomType } : raw;
  // The photo inventory and the solved camera are filled in server-side, so an
  // answer that omits or mangles them (or a fallback spec from before they
  // existed) must repair to "nothing yet". Cleaned BEFORE coercion: a string
  // where `solved` should be would otherwise be padded into a zeroed camera
  // that the fitter could mistake for a real one.
  if (isObj(value) && isObj(value.detected)) {
    const det = { ...value.detected };
    if (!Array.isArray(det.elements)) { if (det.elements !== undefined) note(report, 'detected.elements', 'not a list → []'); det.elements = []; }
    if (isObj(det.camera)) {
      const camera = { ...det.camera };
      if (camera.solved !== null && !isObj(camera.solved)) { if (camera.solved !== undefined) note(report, 'detected.camera.solved', 'not a camera → null'); camera.solved = null; }
      det.camera = camera;
    }
    // The server fills the detector's repeatability, always — so this clean is
    // unconditional. Accepting a well-shaped answer ({samples: 99, agreement: 1})
    // is exactly the manufactured agreement the rule exists to stop; the model
    // has no way to know how many passes the server ran.
    if (det.inventory !== undefined && det.inventory !== null) note(report, 'detected.inventory', 'server-owned → null');
    det.inventory = null;
    value.detected = det;
  }
  // Item words, before coercion. `coerceToSchema` snaps an unknown enum member
  // to its NEAREST valid one, so an espresso machine arrives as a 'pot' and a
  // terracotta salt cellar as stainless — a different object from the one the
  // model saw, and reconcile's own 'other' fallback can never fire because it
  // only ever sees a valid word. Contract §4.2: unknown kind → 'other',
  // unknown material → that kind's default.
  if (isObj(value) && isObj(value.decor) && Array.isArray(value.decor.items)) {
    const items = value.decor.items.map((raw) => {
      if (!isObj(raw)) return raw;
      const it = { ...raw };
      if (it.kind !== undefined && !isItemKind(it.kind)) {
        note(report, 'decor.items[].kind', `unknown kind '${String(it.kind)}' → other`);
        it.kind = 'other';
      }
      const kind = isItemKind(it.kind) ? it.kind : 'other';
      if (it.material !== undefined && !isItemMaterial(it.material)) {
        note(report, 'decor.items[].material', `unknown material '${String(it.material)}' → ${DEFAULT_MATERIAL[kind]}`);
        it.material = DEFAULT_MATERIAL[kind];
      }
      return it;
    });
    value.decor = { ...value.decor, items };
  }
  const out = coerceToSchema(schema, value, fallback, '', report);
  if (isObj(out) && isObj(fallback) && fallback.roomType === roomType && (roomType === 'kitchen' || roomType === 'bathroom')) {
    const captured = ScannedRoomGeometryZ.safeParse(fallback.scanGeometry);
    if (captured.success) { out.scanGeometry = captured.data; out.dims = structuredClone(fallback.dims); out.openings = structuredClone(fallback.openings); }
  }
  if (isObj(out) && isObj(out.detected)) {
    const det = out.detected;
    if (!Array.isArray(det.elements)) det.elements = [];
    if (!isObj(det.camera)) det.camera = { fovDeg: 62, heightFt: 5, position: 'front', lookingAt: 'back', solved: null };
    else if (!isObj(det.camera.solved)) det.camera.solved = null;
  }
  return out;
}

/** Strips ```json fences and trailing prose, then JSON.parse. Throws on failure. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('Model response did not contain a JSON object');
}
