# Saved scan appearance recovery

This change fixes cases where a saved scan retained usable camera evidence but the editable model discarded the floor, colored a whole slab from sparse clutter, or assigned a default wooden finish to unidentified furniture. It affects derived display appearance; it does not change captured geometry, material selections, takeoffs, or prices.

## Changes

- Add MNHPLAN2 decoding and immutable raw-object geometry binding. Measured working-top patches carry their own depth-checked camera grid, including recorded holes. MNHPLAN1 remains readable.
- Use measured countertop grids before triangle-based appearance. Keep owners, separate levels, missing coverage and recorded coordinates distinct. Conservative downsampling cannot erase a narrow unknown gap.
- Reject a sparse, mixed countertop sample as a full-face color estimate. Preserve restrained fine detail only at supported locations on directly measured slab grids. Unobserved finish fill remains an estimate.
- Keep projected appearance attached to translated, rotated or resized fixtures through an explicit shader capability, independent of material names.
- Preserve ambiguous floor/rug imagery at its observed positions when a global floor material cannot be established. Unsupported areas remain a neutral display fill; a rug cannot become repeated flooring.
- Match measured slab facets above dishwashers and merged tall cabinets to their countertop appearance slot. Their bodies retain their own material slots.
- Give unidentified furniture an unpriced, nonselectable appearance channel. It uses its own camera evidence rather than default wood or another object's cabinet finish.

## Verification

The saved gray-kitchen capture was replayed locally through the actual native archive decoder, project import, asset-transfer bridge and production browser renderer. Private photos, archives and diagnostics remain in ignored local `.build/FinishIncident` directories.

- 35 offline scan-product suites pass, including legacy/v2 transfer, geometry binding, corruption rejection, hole masks, narrow downsample gaps, transformed countertop projections, furniture isolation and preservation of user design choices.
- App and script TypeScript checks, scoped ESLint, production Next build and React rendering review pass.
- Swift and TypeScript canonical geometry hashes agree for synthetic hole fixtures and the real saved scan. Its v2 packet contains 14 planes, including nine working-top patches. Local hashing and decode took about 47ms on the development Mac, not an iPhone benchmark.
- The native derivative retains approximately 0.640m² of observed countertop appearance. The web floor replay retains approximately 2.68m² of registered camera appearance that the previous material-family gate discarded. These are appearance coverage figures, not verified construction quantities.
- Browser import and switching between clean model and original source preserve the captured geometry, baseline, finish selections and design.

## Limits

The original capture contains blurred/upward-facing views, a moving person and an RGB-lens obstruction. Independent-view checks reject conflicting samples, but agreement does not prove calibrated color or identify every near-lens occluder. A camera exposure is not physical material reflectance. Sparse floor imagery cannot establish hidden planks, seams or exact material identity. The actual gray cabinets, warm-lit light slabs and local floor imagery provide references; no kitchen-specific colors are hardcoded.

The separate cloud photo-finish service still requires its existing production rate-limit store prerequisite. This local scan recovery does not use or enable that service, and the supplied private reference photos were not uploaded to an AI provider.

No new LiDAR capture is required to regenerate appearance from retained camera evidence.

## Delivery and physical-device check — September 13, 2026

- Web implementation `9495bcc` is pushed to `codex/realism-quality` and deployed at [the production app](https://manhattan-woad.vercel.app). Deployment `dpl_7Boim6cWkR1AzSX9LCkkuUja5q7y` reached READY; the canonical health and mobile routes passed after promotion. A subsequent health check passed when the phone reconnected.
- Native implementation `cee0220` is pushed to `codex/native-ios`. Signed version 1.0, build 12 was installed on the connected iPhone. The full native core checks and the signed build-for-testing passed. Existing owner changes to the Xcode project file were preserved and excluded from the commit.
- `ManhattanPhysicalStudioUITests/testExistingProjectOpensBothScanViewsWithoutDesignEdits` passed on the physical iPhone in 78.39 seconds, with zero test failures. It opened the saved kitchen, opened the reconstructed model, switched to the original source scan and back, then closed Studio normally. It did not start a capture. Xcode reported a separate failure collecting its optional device diagnostics after the passing test; screenshots, accessibility attachments and the test result were retained.
- The phone automatically upgraded the retained scan to MNHPLAN2. Its derived packet is byte-identical to the final local replay. Original camera evidence, LiDAR mesh, RoomPlan JSON, USDZ and source texture are byte-identical before and after the test. All 13 projects remain. Selections, overrides and estimate settings are unchanged. Snapshot serialization changed one polygon coordinate by one floating-point ULP in both the current spec and baseline, with no geometric edit.
- Visual inspection of the actual iPhone screenshots confirms light countertop appearance and distinct model/source views. It also shows incomplete floor imagery, residual occlusion contamination and inconsistent cabinet shading. This is a functional and data-preservation pass, **not acceptance of complete material or dimensional accuracy**. Clearer downward camera evidence is still needed to evaluate those missing regions.

Device screenshots, copy receipts, preservation checks and `ReconnectedStudioCheck.xcresult` remain private in the native repository's ignored `.build/FinishIncident` directory. No supplied kitchen photos or raw scans are included in this commit or the deployment.
