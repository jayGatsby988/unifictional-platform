'use client';
/**
 * Photo-matched camera.
 *
 * The twin is only convincing if it is framed the way the client's photo was
 * framed. The analyzer already reports where it thinks the photographer stood
 * (`spec.detected.camera`), but nothing was using it, so the twin opened on a
 * generic three-quarter view that looked nothing like the picture it came from.
 *
 * This turns that estimate into a real CameraRig. It also gives the accuracy
 * pass something meaningful to compare: a screenshot from this camera and the
 * original photo show the same room from the same place, so a vision model can
 * name the differences instead of describing two unrelated views.
 *
 * The estimate's `fovDeg` is the HORIZONTAL field of view — that is how people
 * (and vision models) describe a lens: "a phone's wide camera is about 70°"
 * means side to side. three.js wants the vertical angle, and the two are only
 * related through the aspect ratio of the frame, which is why the rig needs
 * to know the photo's aspect. Get this wrong and a 4:3 photo compared with a
 * 16:9 canvas shows a different amount of room top to bottom, and the model
 * "corrects" a ceiling height that was never wrong.
 */
import type { CameraRig } from '@/components/scene/SceneCanvas';
import type { RoomSpec, SolvedCamera, Wall } from '@/lib/spec/types';
import { cameraBasis, toRig } from '@/lib/fit/camera';
import { ft } from '@/lib/units';
import { isSingleRoom } from '@/lib/spec/floorplan';

type Corner = NonNullable<RoomSpec['detected']['camera']['position']>;

/**
 * The wall each standpoint has its back to. A photographer standing here
 * cannot be facing this wall — aiming at it puts the target behind the lens.
 */
const STAND_WALL: Record<Corner, Wall | null> = {
  front: 'front',
  'corner-left': 'front',
  'corner-right': 'front',
  'side-left': 'left',
  'side-right': 'right',
  top: null,
};

const OPPOSITE: Record<Wall, Wall> = { back: 'front', front: 'back', left: 'right', right: 'left' };

/** The target must sit at least this far ahead of the lens, or the rig is a spin on the spot. */
const MIN_AHEAD_M = 1.5;

/** Where the photographer stood, in room-normalised coordinates (-1..1 on x/z). */
const STANDPOINT: Record<Corner, { x: number; z: number }> = {
  front: { x: 0, z: 0.92 },
  'corner-left': { x: -0.78, z: 0.82 },
  'corner-right': { x: 0.78, z: 0.82 },
  'side-left': { x: -0.9, z: 0.15 },
  'side-right': { x: 0.9, z: 0.15 },
  top: { x: 0, z: 0.35 },
};

/** The point the photographer aimed at, by the wall they were facing. */
const AIM: Record<'back' | 'front' | 'left' | 'right', { x: number; z: number }> = {
  back: { x: 0, z: -0.85 },
  front: { x: 0, z: 0.85 },
  left: { x: -0.85, z: 0 },
  right: { x: 0.85, z: 0 },
};

/**
 * "Snap back to the photo camera" is requested from outside the canvas (the
 * reset button, and the accuracy pass before every screenshot); the canvas
 * listens for this event and re-applies the current rig.
 */
export const RESET_VIEW_EVENT = 'manhattan:reset-view';
export function requestResetView() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(RESET_VIEW_EVENT));
}

/** Assumed frame when the photo's pixel size is not known yet: most phone photos are 4:3. */
export const DEFAULT_PHOTO_ASPECT = 4 / 3;

const probed = new Map<string, Promise<{ width: number; height: number } | null>>();

/**
 * The photo's natural pixel size, decoded in the browser. Uploads record
 * their size, but the demo photo and older projects do not — and the
 * inventory's boxes are normalised to the photo's frame, so a fit or a
 * screenshot made at a guessed aspect measures against the wrong frame. The
 * Viewport used this probe for its letterbox; it is shared here so the fit
 * and the accuracy pass ask the same question before they run. Cached per
 * URL; null when the image cannot be decoded (or off the browser).
 */
export function probePhotoSize(url: string): Promise<{ width: number; height: number } | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || !url) return Promise.resolve(null);
  let p = probed.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    probed.set(url, p);
    // a failed decode is not cached — the blob may simply not be reachable yet
    void p.then((r) => { if (!r) probed.delete(url); });
  }
  return p;
}

/** The size on a photo record, else the probed natural size; null when neither is known. */
export async function photoSizeOf(photo: { url: string; width?: number; height?: number } | null | undefined): Promise<{ width: number; height: number } | null> {
  if (!photo?.url) return null;
  if (photo.width && photo.height && photo.width > 0 && photo.height > 0) return { width: photo.width, height: photo.height };
  return probePhotoSize(photo.url);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const DEG = Math.PI / 180;

/** Horizontal field of view → the vertical one three.js's PerspectiveCamera takes, for a frame of `aspect` = width / height. */
export function verticalFov(horizontalDeg: number, aspect: number): number {
  const h = clamp(finite(horizontalDeg, 62), 20, 120);
  const a = clamp(finite(aspect, DEFAULT_PHOTO_ASPECT), 0.3, 4);
  return clamp((2 * Math.atan(Math.tan((h * DEG) / 2) / a)) / DEG, 18, 110);
}

/**
 * Build a rig that stands where the photo was taken. Interior rooms only —
 * exteriors keep their own framing, since a street-side elevation is already
 * close to how houses are photographed.
 *
 * `aspect` is the photo's width ÷ height; the canvas is sized to the same
 * ratio in photo mode so the frame matches edge for edge.
 *
 * Returns null when the spec has no usable camera estimate, so the caller can
 * fall back to the scene's own rig.
 */
export function photoMatchRig(spec: RoomSpec | null | undefined, aspect: number = DEFAULT_PHOTO_ASPECT): CameraRig | null {
  // a plan has no photograph to match, and an exterior's rig is its own
  if (!isSingleRoom(spec)) return null;
  const cam = spec.detected?.camera;
  if (!cam) return null;

  const w = ft(clamp(finite(spec.dims?.widthFt, 14), 4, 80));
  const d = ft(clamp(finite(spec.dims?.depthFt, 12), 4, 80));
  const h = ft(clamp(finite(spec.dims?.ceilingFt, 9), 7, 20));

  const stand = STANDPOINT[cam.position] ?? STANDPOINT.front;
  // A "front" standpoint facing the "front" wall (or a side standpoint facing
  // its own wall) is a contradiction the model does produce; taken literally
  // the target lands behind or beside the lens and OrbitControls collapses the
  // view. Aim across the room instead.
  const standWall = STAND_WALL[cam.position] ?? null;
  const facing: Wall = standWall && cam.lookingAt === standWall ? OPPOSITE[standWall] : (cam.lookingAt in AIM ? cam.lookingAt : 'back');
  const aim = AIM[facing];
  const eye = clamp(ft(finite(cam.heightFt, 5.2)), 1.1, h - 0.25);
  const fov = verticalFov(cam.fovDeg, aspect);

  // Stand just inside the room. A photographer backed against a wall still has
  // the lens ~30 cm off it, and pulling in avoids clipping through the shell.
  const inset = 0.32;
  const px = clamp((stand.x * w) / 2, -w / 2 + inset, w / 2 - inset);
  const pz = clamp((stand.z * d) / 2, -d / 2 + inset, d / 2 - inset);

  // Aim at the wall they were facing, at roughly counter height so the frame
  // holds both the floor and the uppers the way a real interior shot does.
  let tx = (aim.x * w) / 2 * 0.7;
  let tz = (aim.z * d) / 2 * 0.7;
  const targetY = cam.position === 'top' ? 0.2 : clamp(eye * 0.78, 0.8, h * 0.62);
  // Whatever the wall arithmetic says, keep the target well ahead of the lens
  // (a corner standpoint aiming at the near side wall can otherwise land a
  // few centimetres away). Push it out along the same bearing; if there is no
  // bearing at all, look toward the room centre.
  const ahead = Math.hypot(tx - px, tz - pz);
  if (ahead < MIN_AHEAD_M) {
    const bx = ahead > 1e-6 ? (tx - px) / ahead : (px === 0 && pz === 0 ? 0 : -px / Math.hypot(px, pz));
    const bz = ahead > 1e-6 ? (tz - pz) / ahead : (px === 0 && pz === 0 ? -1 : -pz / Math.hypot(px, pz));
    tx = px + bx * MIN_AHEAD_M;
    tz = pz + bz * MIN_AHEAD_M;
  }

  const rig: CameraRig = {
    position: [px, cam.position === 'top' ? Math.min(h - 0.2, eye + 1.4) : eye, pz],
    target: [tx, targetY, tz],
    fov,
    minDistance: 0.45,
    maxDistance: Math.max(w, d) * 1.8,
    minPolar: 0.18,
    maxPolar: Math.PI / 2 - 0.02,
    eyeHeight: eye,
    bounds: { minX: -w / 2 + inset, maxX: w / 2 - inset, minZ: -d / 2 + inset, maxZ: d / 2 - inset },
  };
  return rig;
}

/** True when the spec carries a camera estimate worth matching. */
export function hasPhotoCamera(spec: RoomSpec | null | undefined): boolean {
  return Boolean(isSingleRoom(spec) && spec.detected?.camera?.position);
}

/** The fitter's exact camera for this spec, when it has one. */
export function solvedCameraFor(spec: RoomSpec | null | undefined): SolvedCamera | null {
  if (!spec || spec.roomType === 'exterior') return null;
  const s = spec.detected?.camera?.solved;
  if (!s) return null;
  const nums = [s.x, s.y, s.z, s.yawDeg, s.pitchDeg, s.fovDeg];
  return nums.every((n) => typeof n === 'number' && Number.isFinite(n)) ? s : null;
}

/**
 * Turn the fitter's solved camera into a rig, exactly: same standpoint, same
 * bearing, same VERTICAL field of view. The photo overlay only lines up when
 * nothing about the camera is "improved" on the way in.
 *
 * `toRig` (the fitter's own helper) places the orbit target where the bearing
 * meets the room shell. What it does not do is admit a pitch outside the
 * orbit controls' default polar clamps: a photo that looks slightly UP (the
 * classic wide shot of the uppers) has its target above the lens, and
 * OrbitControls would drag the camera back to level on the first update. The
 * clamps are widened here to include the solved pitch, so the first frame is
 * the fitted one and orbiting from there still cannot dive under the floor.
 */
export function solvedCameraRig(solved: SolvedCamera, spec: RoomSpec): CameraRig | null {
  if (spec.roomType === 'exterior') return null;
  const rig = toRig(solved, spec);
  const [, fy] = cameraBasis(finite(solved.yawDeg, 0), clamp(finite(solved.pitchDeg, 0), -80, 80)).forward;
  // polar angle of the camera as seen from its target (0 = straight above it)
  const polar = Math.acos(clamp(-fy, -1, 1));
  return {
    ...rig,
    minPolar: Math.min(rig.minPolar ?? 0.18, Math.max(0.02, polar - 0.03)),
    maxPolar: Math.max(rig.maxPolar ?? Math.PI / 2 - 0.02, Math.min(Math.PI - 0.02, polar + 0.03)),
  };
}
