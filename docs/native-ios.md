# Native iOS integration

The companion SwiftUI project lives in the sibling `manhattan-app` folder. It captures rooms with Apple RoomPlan and preserves original geometry, USDZ files, detail photographs and reviewed measurements on the device.

The app opens `/mobile` in a WKWebView. The page exposes `manhattanNativeReady`, `manhattanNativeImport(payload)` and `manhattanNativeFlush()`. Version 1 payloads carry a project UUID, room category, metric transforms, surfaces, observed object bounds, reviewed dimensions and an optional saved studio snapshot. Native messages use the `manhattan` handler and are restricted to the trusted main-frame `/mobile` document.

## Captured geometry

The importer accepts split walls, concave rooms, non-right-angle corners, varying wall heights, and partial captures. It does not require exactly four walls or corners closing within 5 mm. Every source surface and object uses a single rigid coordinate normalization; individual wall lengths, angles, positions and opening sizes remain captured values. Malformed transforms, nonfinite data, duplicate identifiers and excessive documents still fail validation before the store changes.

Kitchen and bathroom specs carry optional `scanGeometry`, used instead of the procedural rectangular shell. The renderer preserves observed floor polygons, clips openings across split wall segments, handles overlapping opening cuts once, and displays captured objects as differentiated bounds. An overview camera frames the measured geometry on mobile. Automatic decorative objects, bathroom accessories, fans, and rectangular shadow floors are disabled for captures.

A floor fill is derived only when no floor surface exists and the wall endpoints form one unambiguous closed loop. Endpoint associations may span up to 12 cm; the walls themselves never move. The resulting floor is explicitly provisional. Self-crossing floor outlines and incomplete/ambiguous boundaries are not filled using a bounding rectangle or convex hull. Missing or overlapping floor coverage is excluded from floor/ceiling quantities. Valid concave floors price their polygon area, and wall quantities share the renderer's clipped surface calculation. Estimates remain preliminary; ceiling area uses a projected floor footprint allowance, not a captured ceiling mesh.

Low confidence and loose ends produce review guidance rather than making the entire scan inaccessible. An accepted scan is not proof of measurement accuracy. A single captured wall can be saved and opened with unknown, zero unverified room depth; camera framing is padded without inventing room depth or stretching the wall.

### Detailed countertop surfaces

New native captures can include optional `countertopSurfaces` on observed objects. Each surface carries a world-coordinate outer ring, optional holes, `source: "lidar-mesh"`, and a processing `resolutionMeters`. The importer validates simple, horizontal rings with contained, nonoverlapping holes and normalizes every point once with the rest of the room. RoomPlan dimensions and transforms remain intact. Saved baselines also retain these rings.

The studio renders observed top coverage directly, retaining bends, rounded edges, gaps and separate levels. Source scan mode draws the same contours. Incomplete patch boundaries do not become extruded cabinet bodies, slab thickness or cutout walls; faint RoomPlan bounds supply context. A gap can be an occlusion, and adjacent pieces can share a processing seam, so patch edges do not establish a complete physical perimeter. Processing resolution is not sensor accuracy. Material controls follow the actually rendered top slots, including measured table tops.

Island straightening is off by default. An explicit saved alignment preference can adjust eligible low-confidence, bounds-only islands; measured contours always retain their original orientation. Approximate island profiles apply to bounds-only objects, or to the explicitly selected solid design preview; they never alter captured geometry.

The native app's **LiDAR detail** view opens the retained raw surface locally, including bends, clutter and gaps, with full-screen orbit, zoom and reset. The native bridge can also transfer the retained mesh into the current Studio session. The temporary mesh is excluded from saved project snapshots and render uploads.

### Scan appearance and design finishes

RoomPlan object bounds have no measured finish channel. The separate retained mesh can carry camera-sampled vertex colors. A fresh scan previously inherited the demo's white cabinets, oak floor and quartz; these were placeholder material IDs, not measured finishes. The saved baseline is retained for compatibility, but unreviewed scan slots now render with plain neutral materials and display **Finish not captured**. Selecting a finish explicitly records that choice, including selecting the former default. Existing changed selections and photo-supported finishes remain visible in the design preview. Resetting finishes returns unknown slots to neutral.

Studio opens in **3D model** with the saved design choices. **Source scan** shows retained LiDAR triangles and available camera-sampled vertex colors; uncolored regions remain gray. Without an available mesh it falls back to neutral captured bounds and contours. Partial countertop patches remain partial by default. The explicit **Solid design preview** choice uses the existing cabinet and countertop builder within captured object bounds, providing complete representative solids. Its rectangular countertop shapes are labeled approximate; the choice never changes source geometry, measured quantities or the baseline. Native detail photos and raw meshes are not silently uploaded to recover missing appearance information.

The September 11 Studio appearance investigation reproduced the issue with an actual saved capture containing 22 patches and no photographs. Its selections exactly matched the initial baseline. All 476 contour points survived import and saved-state round trips unchanged, isolating the wrong finishes from the separate incomplete-coverage limitation. Private room files and screenshots remain outside source control.

Validation covers 13 finish-policy/texture checks, 39 import/persistence checks, 16 scan-estimate checks, view readiness, application/script TypeScript, scoped ESLint and a production build. Mobile browser replay also checks neutral initial import, choosing the former default explicitly, neutral source geometry after a choice, and restoring the choice from a saved native Studio snapshot. Texture requests start after the render stack completes so loading-progress updates cannot synchronously update another rendering component; cache sharing and failed-load fallback are tested.

Older scans remain readable with their bounds-only representation. Missing raw LiDAR data cannot be reconstructed from a RoomPlan box; capturing a detailed outline requires a new scan with the native mesh-enabled build.

## Edits and persistence

Overall native dimension confirmations remain separate from the original surfaces. Three bounding dimensions cannot accurately relocate all walls of an irregular room. Source geometry is retained through photo refinement, material changes, design options and store persistence; AI schemas cannot invent it. Changes to captured geometry relative to a saved baseline are rejected on restore. Equality ignores object key order and allows only a few Float64 serialization units on coordinate fields (capped at 1e-12); identifiers, evidence metadata, topology and array order remain exact. This handles Foundation/WebKit round trips without rounding or rewriting saved data.

RoomPlan categories do not establish cabinet interiors, finish selections, utilities or construction details. No cabinets, sink or appliance package are fabricated or priced simply because the room is a kitchen. New fixture placement still needs a clearance check against the actual room; the existing cabinet placement controls use a rectangular reference frame.

Estimates explicitly list unpriced scanned fixture work. Changed scanned materials show **Pricing needed**; a full-remodel comparison is a partial subtotal when scanned work lacks construction quantities and labor. Partial countertop coverage is never priced as a complete slab. Incomplete pricing cannot pass a hard budget or generate a completed proposal; unbudgeted visual edits remain available. Saved option coverage is recalculated from its snapshot instead of trusting an old cached budget badge. Procedural fixture pricing is unchanged.

Closing the native studio requests an immediate snapshot; a failed save requires retry or an explicit choice to use the last saved design. Proposal links open separately so navigation cannot unload an active workspace. Native scan files and detail photographs are not automatically uploaded or synchronized between devices. The embedded studio receives a local geometry payload; invoking online AI or sharing features has separate data handling.

## Verification — September 10, 2026

- `scripts/check-native-import.ts`: 39 import, schema, baseline, bridge and persistence checks.
- `scripts/check-native-real-scans.ts`: 26 geometry and estimator cases, including split five-wall rooms, six-wall L-shapes, skewed walls, centimeter gaps and partial captures.
- `scripts/check-scanned-geometry.ts`: mesh clipping/area, concavity, camera fitting and AI/store preservation checks.
- Full estimate regressions, deterministic Jarvis tool regressions, TypeScript, scoped ESLint and production build passed.
- All four actual saved captures retrieved from the connected iPhone 17 Pro passed import, original wall/object count retention, JSON snapshot validation and unchanged-baseline estimates. Three captures contain five wall segments. Mobile viewport inspection used those real captures. Private capture files remain outside source control.

Native quality/model/store/UI checks live in the companion project. Physical measurement comparison, repeated acquisition under difficult conditions, and App Store acceptance remain separate from these software checks.

Contour regression checks added September 11:

- `scripts/check-measured-countertops.ts`: contour import, validation, concavity, holes, raised levels, pose preservation, source rendering and legacy behavior.
- `scripts/check-native-countertop-parity.ts <synthetic-json-path>`: checks actual Swift-emitted contours and a translated/rotated copy through import, estimates, normalization and saved snapshots. The companion project's `scripts/check-core.sh` emits the synthetic fixture at `.build/CoreChecks/synthetic-contours.json` after its geometry tests pass.
- `scripts/check-scanned-estimate-scope.ts`: 14 cases covering missing scan prices, estimate UI and exports, stale option badges, hard-budget rollback, proposal rejection, and unchanged/procedural/bathroom behavior.

The September 11 build 4 physical island trial saved one partial countertop patch and the original raw mesh. Its 122 points across three contour rings passed exact normalization and saved-project round-trip checks. The complete raised-bar bend remains unverified; the retained scan is not a complete perimeter measurement.

Synthetic geometry checks establish the data and rendering contract; they do not establish physical sensor accuracy.

## Studio reopening verification — September 12, 2026

The physical saved payload reproduced a false geometry-change error across Foundation's `callAsyncJavaScript(arguments:)` bridge: eight countertop dictionaries acquired different key orders despite equal values. Structural comparison accepts the unchanged capture. Three native-WebKit open/save cycles, including two reopens, passed with unchanged room data, saved design and all five scan/camera assets. The geometry suite now includes 30 checks for key order, tiny numeric serialization differences, strict metadata/topology rejection and exact snapshot retention. Private replay files and screenshots remain outside source control.
