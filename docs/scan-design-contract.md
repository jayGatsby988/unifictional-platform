# Captured rooms and proposed designs

A native scan now opens with a derived object inventory and separate proposal state. The original `scanGeometry` remains immutable. Proposed size, position, orientation, visibility, measured quantities and contractor labor allowances live in `spec.scanDesign`; neither photo analysis nor Jarvis may replace sensor geometry with a rectangular room template.

## Object editing

`compileScanDesign` derives stable IDs, semantic roles, source confidence, material slots and visible-model eligibility. RoomPlan attributes take precedence where they rule out a cabinet or island: bookshelf storage remains furniture, and `TableShapeType:circularElliptic` does not become an island because its detection bounds happen to have counter-like dimensions. Contained upper detections suppressed by the clean renderer remain in the original inventory but are not exposed as independently editable objects.

Each `ScanObjectEdit` records room-axis X/Z offsets in meters, Y rotation in degrees, horizontal local-axis scales, and visibility. `effectiveScanObjectDesignMatrix` applies the proposal to already reconstructed world geometry about the original captured center. It keeps curved profiles, holes and horizontal surface elevations together. A scale changes the proposed design; it is not a new sensor observation or proof of fabrication dimensions.

Explicit RoomPlan parent relationships are bounded and followed through the assembly. Each object's world geometry receives its effective ancestor transform once. Attached sinks and appliances inherit the support's proposal; hidden parents hide their children. Retained appliances and their supports cannot be moved, removed or resized by Jarvis. An overlapping sink/appliance without a captured attachment blocks independent movement with an explanation; spatial proximity is never silently converted into source ownership.

The clean model uses these deltas. Source scan always uses the original coordinates and camera evidence. Camera-face lookup uses the inverse design transform so photographed appearance stays attached to the moved surface. Options, render fingerprints, native saved snapshots and undo retain the proposal state.

Layout and Jarvis share bounded proposal-clearance checks. Qualified clean profiles preserve concavity and holes; other detections use explicitly labeled bounds and observed overhangs. Checks compare the original capture with the proposal, excluding unchanged overlaps, linked fixtures and vertically separated cabinets. Increased overlap or a newly reduced gap inside a 0.9 m product review zone produces a warning, not a surveyed aisle measurement. Definite movement beyond supported room outlines, including concave notches, is rejected. Provisional boundaries or incomplete geometry remain review warnings.

## Quantity and pricing evidence

Captured boxes and partial countertop patches are not automatically sold as full construction quantities. The Layout panel supports site-reviewed quantities for each object/material slot and complete measured floor, net paintable-wall and ceiling area. Quantities have a strict unit, source object coverage, confirmation timestamp and measurement note. Fractional item counts, duplicate coverage, missing objects and hidden-object quantities are rejected. Appliance pricing uses one reviewed package covering the captured appliances, not one complete package per detected item.

Accepted takeoffs use the existing catalog material, installation labor, waste and regional pricing model. Unreviewed objects stay in the estimate's explicit unpriced scope. Entering a measurement alone does not create a renovation charge: a virtual estimate baseline reuses the reviewed quantity while the original fixture size is retained. The stored as-found baseline is never rewritten. A move or rotation does not purchase a replacement slab. Resizing clears affected quantities so an old area cannot price a larger new slab.

Fixture changes need a separate contractor-reviewed modification/relocation labor range. Moving again invalidates that allowance. The estimate keeps unresolved work visibly incomplete; Jarvis cannot apply it against a hard budget or publish a complete proposal by treating unknown costs as zero. Jarvis cannot invent site confirmations or contractor allowances.

## Room geometry and reviewed dimensions

Native and web frames both select the longest wall, break ties by ascending identifier, and use captured polygon corners when available. A framing box controls the camera and studio coordinates; it does not turn an irregular room into four walls. Older saved native frames remain supported during source validation.

Reviewed overall width, depth and height remain separately displayed, including discrepancies with the captured bounds. Three overall lengths cannot determine every wall position or the area of a concave room. Measured net surface-area inputs affect the estimate directly without stretching the original scan.

Paint quantities union overlapping coplanar wall polygons before subtracting the union of openings. Split or duplicated wall/window detections are counted once. A bounded polygon sweep excludes an over-complex wall takeoff for review rather than hanging a mobile render. Original wall geometry is unchanged.

## Native evidence transport

Detail photos are requested explicitly from the active native document. Requests and replies bind the project, current import token and request ID; switching rooms, reimporting or disposing the document invalidates old replies. Transferred JPEG derivatives are held only in session memory, capped at six photos, one MiB each and 2048 pixels per side. Their canonical base64 and JPEG frame headers are checked before creating image URLs. Applying a reviewed photo finish stores the interpretation in `overrides.scanPhotoFinishes`, which survives native JSON reopen alongside `scanDesign`; transferred image bytes do not enter the snapshot.

Chunked mesh/camera archives pass through the existing authoritative binary decoders only after a complete owned transfer. A clear invalidates queued and in-flight acknowledgements, and stale failures cannot erase a newer retry with the same transfer ID. Only exact final-packet duplicates can retrieve a completed acknowledgement. At most four last chunks are retained for retry comparison and four decoders may be pending; complete binary archives are not retained in the acknowledgement cache.

## Verification

- `scripts/check-scan-design.ts`: synthetic curved/linked geometry, source immutability, unlinked support guards, semantic attributes, measured quantities, atomic Jarvis operations, hard-budget exclusions, confirmation forgery, native restore and photo-rebuild preservation.
- `scripts/check-scan-clearance.ts`: concave/rotated profiles, holes, attachment transforms, changed versus existing overlap, room notches, observed overhangs, bounded uncertainty and shared Layout/Jarvis review behavior.
- `scripts/check-scan-design-replay.ts <payload.json> [studio.json]`: read-only local replay against saved native files; checks a proposal, estimation and reopen without changing source files or baseline. Private scan data is not copied into the repository.
- `scripts/check-native-asset-transfer.ts` and `scripts/check-native-detail-photos.ts`: synthetic ownership, disposal, project-switch, malformed data, retry and timeout checks. No camera, real photos or cloud provider is required.
- `scripts/check-preview-context.ts`: keeps the headless bathroom/floor-plan walkers' application contexts separate from the R3F renderer stub, including provider nesting and cleanup.
- Existing native import, persistence, scanned estimate coverage and Jarvis suites cover backward compatibility and unchanged material workflows.

These checks establish software consistency. They do not establish physical LiDAR accuracy or recover surfaces obscured in the original capture. Exact dimensions, site clearances, cabinetry construction and material identity still require sufficient capture evidence and measured validation.
