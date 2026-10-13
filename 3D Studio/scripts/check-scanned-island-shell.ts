import assert from "node:assert/strict";
import { Matrix4, ShapeUtils, Vector2, Vector3 } from "three";
import {
  deriveScannedIslandShell,
  type ScannedIslandShell,
} from "../src/components/scene/scanned-island-shell";
import type { ScannedObjectPresentation } from "../src/components/scene/scanned-object-layout";
import type { ObservedMesh } from "../src/lib/native/mesh-archive";

type V = [number, number, number];
type P = [number, number];
let checks = 0;
const check = (name: string, run: () => void) => {
  run();
  console.log(`PASS ${++checks}: ${name}`);
};
const outline: P[] = [
  [-1, -0.6],
  [1, -0.6],
  [1, 0.1],
  [0.3, 0.1],
  [0.3, 0.6],
  [-1, 0.6],
];
function object(frame = new Matrix4()): ScannedObjectPresentation {
  return {
    id: "synthetic-island",
    kind: "storage",
    role: "island",
    confidence: "medium",
    dimensions: { x: 2.2, y: 1.2, z: 1.5 },
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    transform: frame.toArray(),
    sourceTransform: frame.toArray(),
    nearestWallId: null,
    alignment: {
      applied: false,
      deltaRadians: 0,
      reason: "Original measured frame",
    },
    representation: "inferred-from-captured-bounds",
  };
}
function mesh(triangles: V[][], frame = new Matrix4()): ObservedMesh {
  const positions = new Float32Array(
    triangles.flatMap((t) =>
      t.flatMap((p) => new Vector3(...p).applyMatrix4(frame).toArray()),
    ),
  );
  return {
    version: 2,
    triangleCount: triangles.length,
    coloredVertexCount: 0,
    positions,
    colors: new Float32Array(positions.length),
    captured: new Float32Array(triangles.length * 3),
    wasLimited: false,
    bounds: { min: [-4, -4, -4], max: [4, 4, 4] },
  };
}
function quad(out: V[][], a: V, b: V, c: V, d: V) {
  out.push([a, b, c], [a, c, d]);
}
function top(out: V[][], ring: P[], y: number) {
  const triangles = ShapeUtils.triangulateShape(
    ring.map((p) => new Vector2(...p)),
    [],
  );
  for (const t of triangles)
    out.push(t.map((i) => [ring[i][0], y, ring[i][1]] as V));
}
function fixture(
  options: {
    gap?: boolean;
    secondLevel?: number;
    fullTop?: boolean;
    winding?: boolean;
  } = {},
) {
  const triangles: V[][] = [];
  for (let side = 0; side < outline.length; side++) {
    const a = outline[side],
      b = outline[(side + 1) % outline.length];
    for (let col = 0; col < 20; col++) {
      if (options.gap && side === 0 && col >= 8 && col < 12) continue;
      const x0 = a[0] + ((b[0] - a[0]) * col) / 20,
        z0 = a[1] + ((b[1] - a[1]) * col) / 20;
      const x1 = a[0] + ((b[0] - a[0]) * (col + 1)) / 20,
        z1 = a[1] + ((b[1] - a[1]) * (col + 1)) / 20;
      for (let row = 0; row < 10; row++) {
        const y0 = -0.56 + (0.88 * row) / 10,
          y1 = -0.56 + (0.88 * (row + 1)) / 10;
        quad(triangles, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0]);
      }
    }
  }
  // The working plane is observed in one broad patch. Its missing interior is
  // completed only when the independently observed body actually closes.
  top(
    triangles,
    options.fullTop
      ? outline
      : [
          [-0.94, -0.5],
          [-0.2, -0.5],
          [-0.2, 0.5],
          [-0.94, 0.5],
        ],
    0.34,
  );
  if (options.secondLevel !== undefined)
    top(
      triangles,
      [
        [-0.8, -0.59],
        [0.8, -0.59],
        [0.8, -0.3],
        [-0.8, -0.3],
      ],
      options.secondLevel,
    );
  if (options.winding)
    for (let i = 0; i < triangles.length; i += 2) triangles[i].reverse();
  return triangles;
}
function contains(
  shell: ScannedIslandShell,
  x: number,
  z: number,
  height: number,
) {
  const cross = (a: P, b: P, p: P) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  for (const panel of shell.panels.filter((p) => p.kind === "countertop"))
    for (let i = 0; i < panel.positions.length; i += 9) {
      if (Math.abs(panel.positions[i + 1] - height) > 0.005) continue;
      const p = panel.positions,
        corners: P[] = [
          [p[i], p[i + 2]],
          [p[i + 3], p[i + 5]],
          [p[i + 6], p[i + 8]],
        ];
      const signs = corners.map((a, j) =>
        cross(a, corners[(j + 1) % 3], [x, z]),
      );
      if (signs.every((n) => n >= -1e-8) || signs.every((n) => n <= 1e-8))
        return true;
    }
  return false;
}
const basic = fixture();
check(
  "closed observed concave body produces continuous working cap without covering the aisle notch",
  () => {
    const source = mesh(basic),
      input = object(),
      before = JSON.stringify(input),
      xyz = source.positions.slice();
    const result = deriveScannedIslandShell(source, input)!;
    assert.ok(
      result?.inferredWorkingCap,
      "continuous cap needs a supported closed body",
    );
    assert.equal(
      result.panels.filter((p) => p.kind === "body").length,
      outline.length,
    );
    assert.ok(
      contains(result, 0.8, -0.3, 0.34),
      "missing interior inside supported body can be explicitly completed",
    );
    assert.ok(
      !contains(result, 0.7, 0.4, 0.34),
      "concavity and aisle clearance must remain",
    );
    assert.ok(result.inferredFillArea > 0.5);
    for (const panel of result.panels) {
      assert.ok(panel.positions.every(Number.isFinite));
      assert.ok(
        panel.sourceTriangleIndices.every((i) => i < source.triangleCount),
      );
      assert.ok(panel.observedArea > 0);
    }
    assert.deepEqual(source.positions, xyz);
    assert.equal(JSON.stringify(input), before);
  },
);
check(
  "persistent missing front does not authorize an inferred countertop across its opening",
  () => {
    const result = deriveScannedIslandShell(
      mesh(fixture({ gap: true })),
      object(),
    )!;
    assert.ok(result, "other supported clean faces should remain");
    assert.ok(!result.inferredWorkingCap);
    assert.ok(!contains(result, 0.8, -0.3, 0.34));
  },
);
check("independent raised plane retains its own height and coverage", () => {
  const result = deriveScannedIslandShell(
    mesh(fixture({ secondLevel: 0.52 })),
    object(),
  )!;
  assert.ok(result?.inferredWorkingCap);
  assert.ok(contains(result, 0, -0.4, 0.52));
  assert.ok(
    !contains(result, 0, 0.3, 0.52),
    "closed working body cannot invent a raised slab perimeter",
  );
  assert.ok(contains(result, 0, 0.3, 0.34));
});
check(
  "rotated translated original poses and alternating triangle winding preserve local shape",
  () => {
    const frame = new Matrix4().makeRotationY(0.73).setPosition(4, 1.4, -3),
      input = object(frame);
    const source = mesh(fixture({ winding: true }), frame),
      original = source.positions.slice(),
      transform = [...input.transform];
    const result = deriveScannedIslandShell(source, input)!;
    assert.ok(result?.inferredWorkingCap);
    assert.ok(contains(result, 0.8, -0.3, 0.34));
    assert.ok(!contains(result, 0.7, 0.4, 0.34));
    for (const panel of result.panels) {
      const localOrigin = new Vector3(...panel.origin).applyMatrix4(
        frame.clone().invert(),
      );
      assert.ok(
        localOrigin.length() < 2,
        "appearance origin must transform exactly once",
      );
      assert.ok(Math.abs(new Vector3(...panel.unitU).length() - 1) < 1e-6);
      assert.ok(
        Math.abs(new Vector3(...panel.unitU).dot(new Vector3(...panel.unitV))) <
          1e-6,
      );
    }
    assert.deepEqual(source.positions, original);
    assert.deepEqual(input.transform, transform);
  },
);
check(
  "a neighbor-owned fixture cannot supply the missing body evidence",
  () => {
    const input = object(),
      neighbor = object(new Matrix4().setPosition(0, 0, -0.6));
    neighbor.id = "independent-cabinet";
    neighbor.role = "base-cabinet";
    neighbor.dimensions = { x: 0.45, y: 1.2, z: 0.2 };
    const result = deriveScannedIslandShell(mesh(basic), input, [
      input,
      neighbor,
    ]);
    assert.ok(
      !result?.inferredWorkingCap,
      "another fixture cannot bridge a cabinet opening",
    );
  },
);
check("malformed frames and oversized source archives fail closed", () => {
  const input = object();
  input.transform[0] = 2;
  assert.equal(deriveScannedIslandShell(mesh(basic), input), null);
  const source = mesh(basic);
  source.triangleCount = 320_001;
  assert.equal(deriveScannedIslandShell(source, object()), null);
});
check("paired slab underside cannot lower the inferred working surface", () => {
  const triangles = fixture();
  const ring: P[] = [
    [-0.94, -0.5],
    [-0.2, -0.5],
    [-0.2, 0.5],
    [-0.94, 0.5],
  ];
  const underside: V[][] = [];
  top(underside, ring, 0.29);
  for (const triangle of underside) triangle.reverse();
  triangles.push(...underside);
  const result = deriveScannedIslandShell(mesh(triangles), object())!;
  assert.ok(result?.inferredWorkingCap);
  assert.ok(contains(result, 0.8, -0.3, 0.34));
  assert.ok(
    !contains(result, 0.8, -0.3, 0.29),
    "underside remains observed-only",
  );
});
check(
  "separate supported levels three centimetres apart do not get averaged",
  () => {
    const result = deriveScannedIslandShell(
      mesh(fixture({ secondLevel: 0.37 })),
      object(),
    )!;
    assert.ok(result?.inferredWorkingCap);
    assert.ok(contains(result, -0.5, 0.2, 0.34));
    assert.ok(contains(result, 0.5, -0.4, 0.37));
    assert.ok(!contains(result, 0.5, -0.4, 0.355));
  },
);
check(
  "known neighbor boundary triangles cannot become another island face",
  () => {
    const triangles = fixture(),
      boundaryStart = triangles.length;
    quad(
      triangles,
      [1.125, -0.56, -0.6],
      [1.125, -0.56, 0.6],
      [1.125, 0.32, 0.6],
      [1.125, 0.32, -0.6],
    );
    const neighbor = object(new Matrix4().setPosition(1.375, 0, 0));
    neighbor.id = "neighbor";
    neighbor.role = "base-cabinet";
    neighbor.dimensions = { x: 0.5, y: 1.2, z: 1.2 };
    const result = deriveScannedIslandShell(mesh(triangles), object(), [
      neighbor,
    ])!;
    assert.ok(result?.inferredWorkingCap);
    assert.ok(
      result.panels.every((panel) =>
        panel.sourceTriangleIndices.every((id) => id < boundaryStart),
      ),
    );
  },
);
check(
  "oversized crossing triangles do not extend the clean object beyond its height envelope",
  () => {
    const triangles: V[][] = [];
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      quad(
        triangles,
        [a[0], -1, a[1]],
        [b[0], -1, b[1]],
        [b[0], 1, b[1]],
        [a[0], 1, a[1]],
      );
    }
    top(triangles, outline, 0.34);
    assert.equal(deriveScannedIslandShell(mesh(triangles), object()), null);
  },
);
check("eight millimetre unobserved raised-slab slit stays open", () => {
  const triangles = fixture();
  top(
    triangles,
    [
      [-0.9, -0.6],
      [-0.004, -0.6],
      [-0.004, -0.3],
      [-0.9, -0.3],
    ],
    0.52,
  );
  top(
    triangles,
    [
      [0.004, -0.6],
      [0.9, -0.6],
      [0.9, -0.3],
      [0.004, -0.3],
    ],
    0.52,
  );
  const result = deriveScannedIslandShell(mesh(triangles), object())!;
  assert.ok(result?.inferredWorkingCap);
  assert.ok(
    !contains(result, 0, -0.45, 0.52),
    "sub-grid gaps must not be filled as observed",
  );
  assert.ok(contains(result, -0.5, -0.45, 0.52));
  assert.ok(contains(result, 0.5, -0.45, 0.52));
});
check(
  "pathological candidate density is bounded and cannot manufacture a supported shell",
  () => {
    const sparse: V[][] = [];
    for (let i = 0; i < 60_002; i++)
      sparse.push([
        [-0.1, 0, -0.1],
        [0.1, 0, -0.1],
        [0, 0, 0.1],
      ]);
    const start = performance.now();
    assert.equal(deriveScannedIslandShell(mesh(sparse), object()), null);
    assert.ok(
      performance.now() - start < 2500,
      "candidate cap must stop before expensive fitting",
    );
  },
);
check(
  "short floor gaps continue the fitted faces only onto a compatible measured floor",
  () => {
    const source = mesh(fixture()),
      input = object();
    const floor = {
      id: "captured-floor",
      kind: "floor",
      confidence: "high" as const,
      dimensions: { x: 4, y: 0.01, z: 4 },
      transform: new Matrix4().toArray(),
      polygonCorners: [
        { x: -2, y: -0.6, z: -2 },
        { x: 2, y: -0.6, z: -2 },
        { x: 2, y: -0.6, z: 2 },
        { x: -2, y: -0.6, z: 2 },
      ],
    };
    const without = deriveScannedIslandShell(source, input)!,
      withFloor = deriveScannedIslandShell(source, input, [], [floor])!;
    assert.ok(withFloor.inferredFloorSupportArea! > 0.05);
    assert.ok(
      withFloor.panels
        .filter((p) => p.kind === "body")
        .every((p) => Math.abs(p.positions[1] + 0.6) < 1e-6),
    );
    assert.ok(withFloor.inferredFillArea > without.inferredFillArea);
    assert.deepEqual(
      withFloor.panels
        .filter((p) => p.kind === "countertop")
        .map((p) => p.positions),
      without.panels
        .filter((p) => p.kind === "countertop")
        .map((p) => p.positions),
    );
    const unsupported = {
      ...floor,
      polygonCorners: floor.polygonCorners.map((p) => ({ ...p, x: p.x + 10 })),
    };
    assert.ok(
      !deriveScannedIslandShell(source, input, [], [unsupported])!
        .inferredFloorSupportArea,
    );
    const lowered = {
      ...floor,
      polygonCorners: floor.polygonCorners.map((p) => ({ ...p, y: -0.8 })),
    };
    assert.ok(
      !deriveScannedIslandShell(source, input, [], [lowered])!
        .inferredFloorSupportArea,
    );
  },
);
check(
  "explicit captured countertop holes stay open inside a completed body loop",
  () => {
    const input = object(),
      world = (x: number, z: number) => ({ x, y: 0.34, z });
    input.countertopSurfaces = [
      {
        source: "lidar-mesh",
        resolutionMeters: 0.02,
        polygonCorners: outline.map((p) => world(...p)),
        holes: [
          [
            world(-0.1, -0.2),
            world(0.15, -0.2),
            world(0.15, 0),
            world(-0.1, 0),
          ],
        ],
      },
    ];
    const before = JSON.stringify(input);
    const result = deriveScannedIslandShell(mesh(fixture()), input)!;
    assert.ok(result?.inferredWorkingCap);
    assert.ok(
      !contains(result, 0, -0.1, 0.34),
      "a known hole must never be covered by inferred cap",
    );
    assert.ok(contains(result, 0.5, -0.4, 0.34));
    assert.equal(JSON.stringify(input), before);
  },
);
check(
  "a separately captured sink cannot be sealed by a completed working cap",
  () => {
    const source = mesh(fixture()),
      input = object(),
      sink = object(new Matrix4().setPosition(0, 0.24, 0));
    sink.id = "captured-sink";
    sink.role = "sink";
    sink.dimensions = { x: 0.5, y: 0.2, z: 0.4 };
    const result = deriveScannedIslandShell(source, input, [sink]);
    assert.ok(result && !result.inferredWorkingCap);
    assert.ok(!contains(result, 0, 0, 0.34));
  },
);
console.log(`${checks} scanned island shell checks passed.`);
