/**
 * Pinhole camera for the photo fitter.
 *
 * The fitter needs to answer one question thousands of times: "seen from
 * HERE, where does this box land in the photo?" three.js could do it, but a
 * PerspectiveCamera drags in matrices, a renderer and a DOM, and this runs
 * on the server inside a tight loop. A pinhole camera is forty lines.
 *
 * CONVENTION (the same one `SolvedCamera` in types.ts documents — keep the
 * two in step):
 *   - position (x, y, z) is in the room frame, metres, floor y = 0;
 *   - yawDeg 0 looks toward -z (the back wall) and increases turning toward
 *     +x (the right wall), so 90 faces the right wall, -90 the left wall,
 *     ±180 the front wall;
 *   - pitchDeg is positive looking DOWN;
 *   - fovDeg is the VERTICAL field of view; the horizontal one follows from
 *     `aspect` (photo width ÷ height);
 *   - image coordinates are normalised: (0, 0) top-left, (1, 1) bottom-right,
 *     matching `PhotoElement.box`.
 *
 * `detected.camera` (the analyzer's estimate) speaks a different language —
 * a position WORD, a height, and a HORIZONTAL fov — so `fromEstimate` turns
 * that into a SolvedCamera with the same standpoints `photoMatch.ts` uses,
 * and `toRig` goes the other way so the studio can stand exactly where the
 * fitter ended up.
 */
import type { CameraRig } from '@/components/scene/SceneCanvas';
import type { RoomSpec, SolvedCamera, Wall } from '@/lib/spec/types';
import { clamp, ft, mToFt } from '@/lib/units';
import { isSingleRoom } from '@/lib/spec/floorplan';

export type Vec3 = [number, number, number];
/** World-space axis-aligned box, metres. */
export interface AABB { min: Vec3; max: Vec3 }
/** Normalised image box [x0, y0, x1, y1], origin top-left. */
export type Box4 = [number, number, number, number];

const DEG = Math.PI / 180;
/**
 * A POINT closer than this to the lens is treated as behind it. A lone point
 * carries no size of its own, so this one guard has to be a length.
 */
const NEAR_POINT = 0.05;
/**
 * How close to the lens a BOX's corner may come before it counts as behind
 * it — as a fraction of that box's own distance from the lens, never a fixed
 * number of metres.
 *
 * It has to be a fraction. A pinhole projection has no length scale: scale
 * the room and the standoff together and the picture is identical, which is
 * exactly what the fitter does thirteen times on every fit (`scaleRoom` +
 * `scaleCamera`, fit.ts) and what the perspective term's variance relies on
 * being an EXACT gauge. A guard in metres puts a length into a projection
 * that has none, and it lands on the only boxes it ever touches: the shells
 * that wrap around the photographer — a floor and one or two walls on nearly
 * every photo, and `rawKindsOf` asks for their unclamped boxes whenever the
 * frame cut them, which for a wall is almost always. Measured before this was
 * relative: scaling a room and its camera by 1.37 moved a floor's unclamped
 * image box by 18 frame widths, so the room-scale search was choosing between
 * physically identical scenes on a numerical artefact. As a fraction the
 * crossing point scales with the scene and the projection is a similarity to
 * the last bit. One per cent of the box's own reach is the same ~5 cm the
 * absolute guard gave a room-sized box, which is where it came from.
 */
const NEAR_FRACTION = 0.01;

/** Assumed photo frame when the pixel size is unknown: most phone photos are 4:3. */
export const DEFAULT_ASPECT = 4 / 3;

export interface Pinhole {
  cam: SolvedCamera;
  /** normalised image position of a world point, or null when it is behind the lens */
  project(p: Vec3): [number, number] | null;
  /** image box covering a world box, clamped to the frame; null when nothing of it is in front of the lens or in frame */
  projectBox(b: AABB): Box4 | null;
  /**
   * The same box UNCLAMPED: edges may sit outside [0, 1], so a caller can tell
   * "the twin runs off the picture here" from "the twin ends exactly at the
   * frame edge". `projectBox` cannot — it clamps, so an island a centimetre
   * past the edge and one three metres past it both come back with x0 = 0,
   * and the loss goes blind along exactly the axis a cropped photo box leaves
   * unmeasured. Same eight-corner + near-plane maths, same null cases.
   */
  projectBoxRaw(b: AABB): Box4 | null;
}

/** Right / up / forward basis for a yaw + pitch under the convention above. */
export function cameraBasis(yawDeg: number, pitchDeg: number): { right: Vec3; up: Vec3; forward: Vec3 } {
  const y = yawDeg * DEG, p = pitchDeg * DEG;
  const sy = Math.sin(y), cy = Math.cos(y), sp = Math.sin(p), cp = Math.cos(p);
  return {
    forward: [sy * cp, -sp, -cy * cp],
    right: [cy, 0, sy],
    up: [sy * sp, cp, -cy * sp],
  };
}

export function makeCamera(cam: SolvedCamera): Pinhole {
  const { right, up, forward } = cameraBasis(cam.yawDeg, cam.pitchDeg);
  const aspect = clamp(finite(cam.aspect, DEFAULT_ASPECT), 0.2, 5);
  const tanV = Math.tan(clamp(finite(cam.fovDeg, 50), 10, 150) * DEG / 2);
  const tanH = tanV * aspect;
  const cx = finite(cam.x, 0), cy = finite(cam.y, 1.5), cz = finite(cam.z, 0);

  /** camera-space coordinates: xc right, yc up, zc forward (positive in front) */
  const toCam = (p: Vec3): Vec3 => {
    const dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz;
    return [
      dx * right[0] + dy * right[1] + dz * right[2],
      dx * up[0] + dy * up[1] + dz * up[2],
      dx * forward[0] + dy * forward[1] + dz * forward[2],
    ];
  };
  const toImage = (c: Vec3): [number, number] => [
    0.5 + (c[0] / c[2]) / (2 * tanH),
    0.5 - (c[1] / c[2]) / (2 * tanV),
  ];

  const project = (p: Vec3): [number, number] | null => {
    const c = toCam(p);
    if (c[2] <= NEAR_POINT) return null;
    return toImage(c);
  };

  /**
   * The box's unclamped image extents, or null when nothing of it is in front
   * of the lens or none of it lands in frame. Both `projectBox` and
   * `projectBoxRaw` are this plus their own last step, so the two can never
   * drift apart.
   */
  const extents = (b: AABB): Box4 | null => {
    // the eight corners in camera space
    const cs: Vec3[] = [];
    for (let i = 0; i < 8; i++) {
      cs.push(toCam([i & 1 ? b.max[0] : b.min[0], i & 2 ? b.max[1] : b.min[1], i & 4 ? b.max[2] : b.min[2]]));
    }
    // This box's own near plane: a fraction of how far it reaches from the
    // lens, so it scales with the scene (see NEAR_FRACTION). A box collapsed
    // onto the lens has reach 0 and no corner passes the test below, which is
    // the right answer for it.
    let reach = 0;
    for (const c of cs) reach = Math.max(reach, Math.hypot(c[0], c[1], c[2]));
    const near = reach * NEAR_FRACTION;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (c: Vec3) => {
      const [u, v] = toImage(c);
      if (u < x0) x0 = u; if (u > x1) x1 = u; if (v < y0) y0 = v; if (v > y1) y1 = v;
    };
    let any = false;
    for (const c of cs) if (c[2] > near) { add(c); any = true; }
    if (!any) return null;
    // A box that straddles the near plane (the camera stands over the rug,
    // beside a run) would project its behind-lens corners to nonsense, so
    // each edge crossing the plane contributes the crossing point instead.
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        const j = i | bit;
        if (j === i) continue;
        const a = cs[i], c = cs[j];
        const aIn = a[2] > near, cIn = c[2] > near;
        if (aIn === cIn) continue;
        const t = (near - a[2]) / (c[2] - a[2]);
        add([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, near]);
      }
    }
    if (!Number.isFinite(x0 + y0 + x1 + y1)) return null;
    if (x1 <= 0 || y1 <= 0 || x0 >= 1 || y0 >= 1) return null;
    return [x0, y0, x1, y1];
  };

  const projectBox = (b: AABB): Box4 | null => {
    const e = extents(b);
    if (!e) return null;
    const out: Box4 = [clamp(e[0], 0, 1), clamp(e[1], 0, 1), clamp(e[2], 0, 1), clamp(e[3], 0, 1)];
    if (out[2] - out[0] < 1e-4 || out[3] - out[1] < 1e-4) return null;
    return out;
  };

  // The degeneracy test is on the CLAMPED box in both, so the pair agree about
  // which boxes exist: a raw box whose visible sliver is under a ten-thousandth
  // of the frame is no box at all, however far it runs off the picture.
  const projectBoxRaw = (b: AABB): Box4 | null => {
    const e = extents(b);
    if (!e) return null;
    if (Math.min(e[2], 1) - Math.max(e[0], 0) < 1e-4 || Math.min(e[3], 1) - Math.max(e[1], 0) < 1e-4) return null;
    return e;
  };

  return { cam, project, projectBox, projectBoxRaw };
}

// ---------------------------------------------------------------------------
// The analyzer's estimate ↔ a solved camera
// ---------------------------------------------------------------------------

type Standpoint = RoomSpec['detected']['camera']['position'];

/** Where the photographer stood, room-normalised (-1..1 on x / z). Same table as photoMatch.ts. */
export const STANDPOINT: Record<Standpoint, { x: number; z: number }> = {
  front: { x: 0, z: 0.92 },
  'corner-left': { x: -0.78, z: 0.82 },
  'corner-right': { x: 0.78, z: 0.82 },
  'side-left': { x: -0.9, z: 0.15 },
  'side-right': { x: 0.9, z: 0.15 },
  top: { x: 0, z: 0.35 },
};

/** The point they aimed at, by the wall they faced. Same table as photoMatch.ts. */
export const AIM: Record<Wall, { x: number; z: number }> = {
  back: { x: 0, z: -0.85 },
  front: { x: 0, z: 0.85 },
  left: { x: -0.85, z: 0 },
  right: { x: 0.85, z: 0 },
};

function finite(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Horizontal fov → vertical, for a frame of `aspect` = width ÷ height. */
export function verticalFov(horizontalDeg: number, aspect: number): number {
  const h = clamp(finite(horizontalDeg, 62), 20, 120);
  const a = clamp(finite(aspect, DEFAULT_ASPECT), 0.2, 5);
  return clamp((2 * Math.atan(Math.tan((h * DEG) / 2) / a)) / DEG, 18, 110);
}

export function horizontalFov(verticalDeg: number, aspect: number): number {
  const v = clamp(finite(verticalDeg, 50), 10, 150);
  const a = clamp(finite(aspect, DEFAULT_ASPECT), 0.2, 5);
  return clamp((2 * Math.atan(Math.tan((v * DEG) / 2) * a)) / DEG, 20, 120);
}

/** Yaw / pitch (degrees, our convention) of the direction from `from` to `to`. */
export function lookAngles(from: Vec3, to: Vec3): { yawDeg: number; pitchDeg: number } {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const flat = Math.hypot(dx, dz);
  return {
    yawDeg: flat < 1e-9 ? 0 : Math.atan2(dx, -dz) / DEG,
    pitchDeg: Math.atan2(-dy, flat) / DEG,
  };
}

/** Room size in metres with the same guards the layout solvers use. */
export function roomSize(spec: RoomSpec): { w: number; d: number; h: number } {
  const dims = isSingleRoom(spec) ? spec.dims : null;
  return {
    w: ft(clamp(finite(dims?.widthFt, 14), 4, 80)),
    d: ft(clamp(finite(dims?.depthFt, 12), 4, 80)),
    h: ft(clamp(finite(dims?.ceilingFt, 9), 7, 20)),
  };
}

/**
 * A starting camera from the analyzer's `detected.camera` estimate: the
 * standpoint word becomes a position, the aim wall a yaw, the height a y and
 * the HORIZONTAL fov a vertical one. Never throws — a spec with no camera at
 * all gets a front-of-room view of the back wall.
 */
export interface CameraEstimate { fovDeg: number; heightFt: number; position: Standpoint; lookingAt: Wall }

export function fromEstimate(spec: RoomSpec, aspect: number = DEFAULT_ASPECT, override: Partial<CameraEstimate> = {}): SolvedCamera {
  const { w, d, h } = roomSize(spec);
  const cam: Partial<CameraEstimate> = { ...(spec.detected?.camera ?? {}), ...override };
  const a = clamp(finite(aspect, DEFAULT_ASPECT), 0.2, 5);
  const stand = (cam.position && STANDPOINT[cam.position]) || STANDPOINT.front;
  const aim = (cam.lookingAt && AIM[cam.lookingAt]) || AIM.back;
  const top = cam.position === 'top';
  const eye = clamp(ft(finite(cam.heightFt, 5.2)), 1.1, h - 0.25);

  // stand just inside the room — a photographer backed against a wall still
  // has the lens ~30 cm off it (same inset as photoMatch.ts)
  const inset = 0.32;
  const px = clamp((stand.x * w) / 2, -w / 2 + inset, w / 2 - inset);
  const pz = clamp((stand.z * d) / 2, -d / 2 + inset, d / 2 - inset);
  const py = top ? Math.min(h - 0.2, eye + 1.4) : eye;
  const tx = (aim.x * w) / 2 * 0.7;
  const tz = (aim.z * d) / 2 * 0.7;
  const ty = top ? 0.2 : clamp(eye * 0.78, 0.8, h * 0.62);
  const { yawDeg, pitchDeg } = lookAngles([px, py, pz], [tx, ty, tz]);

  return {
    x: px, y: py, z: pz,
    yawDeg, pitchDeg,
    fovDeg: verticalFov(finite(cam.fovDeg, 62), a),
    aspect: a,
    score: 0,
  };
}

/** Distance along `forward` from `from` to where the ray leaves the room box (0..h tall). */
function rayToRoom(from: Vec3, forward: Vec3, w: number, d: number, h: number): number {
  const lo: Vec3 = [-w / 2, 0, -d / 2], hi: Vec3 = [w / 2, h, d / 2];
  let t = Infinity;
  for (let i = 0; i < 3; i++) {
    const f = forward[i];
    if (Math.abs(f) < 1e-9) continue;
    const bound = f > 0 ? hi[i] : lo[i];
    const ti = (bound - from[i]) / f;
    if (ti > 0 && ti < t) t = ti;
  }
  return Number.isFinite(t) ? t : 3;
}

/**
 * A CameraRig standing exactly at a solved camera, aimed where its forward
 * ray meets the room, so the studio's photo mode shows the frame the fitter
 * scored. `fov` is vertical, which is what three.js wants.
 */
export function toRig(cam: SolvedCamera, spec: RoomSpec): CameraRig {
  const { w, d, h } = roomSize(spec);
  const { forward } = cameraBasis(cam.yawDeg, cam.pitchDeg);
  const position: Vec3 = [finite(cam.x, 0), clamp(finite(cam.y, 1.5), 0.3, h - 0.1), finite(cam.z, 0)];
  // The target sits a little short of where the ray leaves the room, and at
  // least 0.8 m out so OrbitControls has something to orbit. Every clamp is
  // applied ALONG the ray: a low camera pitched steeply at the floor used to
  // have its target's y clamped on its own, which bent the bearing and put
  // the studio's photo view at a different pitch from the one the fitter
  // scored. Now the target stops just above the floor (or below the
  // ceiling) on the ray itself, so yaw and pitch survive exactly.
  let dist = Math.max(0.8, rayToRoom(position, forward, w, d, h) * 0.85);
  const vertical = forward[1] < -1e-9 ? (0.05 - position[1]) / forward[1] : forward[1] > 1e-9 ? (h - 0.05 - position[1]) / forward[1] : Infinity;
  dist = Math.max(0.05, Math.min(dist, vertical));
  const target: Vec3 = [
    position[0] + forward[0] * dist,
    position[1] + forward[1] * dist,
    position[2] + forward[2] * dist,
  ];
  const inset = 0.32;
  return {
    position,
    target,
    fov: clamp(finite(cam.fovDeg, 50), 18, 110),
    minDistance: 0.45,
    maxDistance: Math.max(w, d) * 1.8,
    minPolar: 0.18,
    maxPolar: Math.PI / 2 - 0.02,
    eyeHeight: position[1],
    bounds: { minX: -w / 2 + inset, maxX: w / 2 - inset, minZ: -d / 2 + inset, maxZ: d / 2 - inset },
  };
}

/**
 * The analyzer-style description of a solved camera (the nearest standpoint
 * word, the wall it faces, height in feet, HORIZONTAL fov), so the parts of
 * the app that still read `detected.camera` agree with the solve.
 */
export function toEstimate(cam: SolvedCamera, spec: RoomSpec): { fovDeg: number; heightFt: number; position: Standpoint; lookingAt: Wall } {
  const { w, d } = roomSize(spec);
  const nx = w > 0 ? (2 * finite(cam.x, 0)) / w : 0;
  const nz = d > 0 ? (2 * finite(cam.z, 0)) / d : 0;
  let position: Standpoint = 'front';
  let best = Infinity;
  for (const [name, s] of Object.entries(STANDPOINT) as Array<[Standpoint, { x: number; z: number }]>) {
    if (name === 'top') continue;
    const dist = Math.hypot(s.x - nx, s.z - nz);
    if (dist < best) { best = dist; position = name; }
  }
  const { forward } = cameraBasis(cam.yawDeg, 0);
  const lookingAt: Wall = Math.abs(forward[0]) > Math.abs(forward[2]) ? (forward[0] > 0 ? 'right' : 'left') : forward[2] < 0 ? 'back' : 'front';
  return {
    fovDeg: clamp(horizontalFov(cam.fovDeg, cam.aspect), 20, 120),
    heightFt: clamp(Math.round(mToFt(finite(cam.y, 1.5)) * 10) / 10, 2, 12),
    position,
    lookingAt,
  };
}
