# iOS review remediation — September 12, 2026

This is a source and verification report for the `manhatten` web app and sibling `manhattan-app` iOS app. Work began at 23:43 UTC September 12. The iPhone was disconnected; this pass uses saved local scans, synthetic fixtures, browser checks and iOS Simulator. It does **not** certify physical measurement accuracy, install an update, deploy the website or establish App Store readiness.

## What changed

### Captured rooms can become proposed designs

- A deterministic scan inventory exposes captured objects to Layout and Jarvis. Proposals save moves, rotations, horizontal sizes and visibility separately from original sensor geometry.
- Bent profiles, observed surface patches, holes and elevations remain attached to their objects. Captured parent relationships keep linked fixtures together. Ambiguous attachments in older scans require review instead of silently leaving a sink behind.
- Layout and Jarvis review proposed changes against the captured floor outline and nearby fixtures. Increased overlap and narrowed gaps produce actionable warnings; qualified geometry escaping a room notch blocks the proposal. These checks preserve concave profiles and holes and do not claim surveyed aisle widths.
- RoomPlan storage/table attributes prevent some furniture from being mislabeled as cabinets or islands. Parent IDs, completed wall edges and curved-wall metadata survive export/import. Metadata preservation alone does not implement full curved-wall reconstruction.
- Reviewed object takeoffs and contractor labor allowances reach the estimator. Existing appliances are priced once as a package. Moving an existing slab does not purchase a new one, and resizing invalidates affected old takeoffs.
- Jarvis cannot invent measured confirmations, conceal unpriced scope or approve an incomplete proposal against a hard budget. Original scans and baselines remain unchanged through editing, option creation and native reopen.

The implementation uses a separate `scanDesign` layer. It does not force irregular captured geometry into the existing rectangular kitchen run template. See [the design contract](scan-design-contract.md).

### Existing finish matching

- The iPhone lets the user select up to six saved detail photos from all available attachments. Only bounded, metadata-stripped JPEG derivatives enter the active Studio session.
- Studio can also use upright retained scan images or local reference photos. It sends up to three explicitly selected images for finish-only analysis, then presents matches for review before applying them.
- Matches describe visible material family, color, pattern and sheen. They cannot change island shape, dimensions, quantities, product specifications or slab fabrication data.
- Per-face evidence protects mixed island finishes; explicit renovation choices take precedence. Photo-derived floor materials follow the supported captured grain direction, including catalog textures whose long axis differs by 90 degrees.
- Provider requests, actual request-body bytes, decoded image dimensions, concurrency and usage are bounded. Hosted production fails closed without durable admission configuration. [Deployment configuration](scan-finish-admission.md) is required to enable the new paid endpoint.
- Transferred images stay out of project JSON and shared links. Reviewed appearance observations persist across reopening. Project/import ownership prevents stale photo replies or analysis results from crossing sessions.

Automatic exact color or product identity is not established. Existing low-resolution scans cannot recover detail that was never retained. Higher-resolution capture by surface coverage remains future work.

### Capture and storage reliability

- Countertop capture includes dishwasher-supported tops and working-height surfaces inside merged tall storage detections. Adaptive raster refinement retains coarser coverage when a finer pass would lose it.
- Mesh retention reserves space for floors and other room surfaces as well as countertops.
- Camera selection now ranks several bounded candidates within a sampling window instead of keeping whichever timer frame arrives first. Finish drains the last owned candidate; retries and cancellation reject stale work.
- Exposure/light diagnostics are stored in the additive camera archive v2. Original pixel values stay unchanged. This is not yet calibrated photometric normalization.
- Unknown future RoomPlan confidence cannot reject the entire import. A full 48-frame reservoir is no longer mislabeled as failed processing.
- Invalid project records are quarantined individually after byte-exact index backup; healthy projects remain usable. Invalid derived assets can be rebuilt without discarding original scans.
- Measurement unit switches use canonical meters. Native/web frame selection agrees on polygon corners and stable wall ordering. Reviewed overall dimensions stay available; net measured area can affect pricing without stretching an irregular room.
- Overlapping wall segments are unioned for quantities. Explicitly incomplete wall edges and retained curved-wall metadata keep the wall takeoff marked incomplete until reviewed.
- Binary asset transfer uses bounded acknowledged chunks with exact-byte retry handling and cancellation ownership. Snapshot limits now agree at 20 MiB.
- Mirror recovery publishes independently supported details progressively and retains them if later processing times out. Superseded workers cannot publish into a reopened room.

Native implementation and evidence: [reliability](../../manhattan-app/docs/NATIVE-RELIABILITY.md), [capture validation](../../manhattan-app/docs/CAPTURE-EVIDENCE-VALIDATION-2026-09-12.md), [build status](../../manhattan-app/docs/BUILD-STATUS.md).

## Verification and limits

- Final production web build, source/scripts TypeScript and lint of changed TypeScript/JavaScript files pass. `npm run check:scan` passes all 30 isolated offline suites, including 15 proposal-clearance cases. Nine separately exercised browser GPU cases verify captured material registration through translation, rotation, scaling and instancing.
- The real saved kitchen was imported through the chunk receiver in a mobile-sized production preview. Reviewed appearance and an island proposal survived reopening with source/baseline unchanged. A reviewed labor allowance reached the estimate. A local 60 cm proposal produced nearby-fixture warnings; returning to the earlier pose removed those new warnings and invalidated the old relocation allowance as expected.
- The saved bathroom opens as a clean model, independently from its source mesh, with its captured window and one mirror recovered from agreeing camera views. Missing floor joint evidence stays uncertain rather than becoming an invented tile grid.
- The photo workflow was tested locally with a labeled mock result. A separate live provider check used only a synthetic cabinet image; private kitchen/bathroom photos were not uploaded during this pass.
- A separate live Jarvis check used `gpt-6-astra` and a synthetic scan. It saved the requested exploratory island option with an exact 0.10 m X offset in 11.2 seconds, preserved source/live design and all finishes, and disclosed unpriced relocation work. No render, proposal publication or user project mutation was requested.
- An exact shipped-model replay found the bathroom's final supported mirror already present after the first 4 of 44 processed views; the progressive worker exposes that result while later frames continue. A proposed camera-priority reorder delayed that result and was rejected. This is saved-data/Mac evidence, not a physical-phone timing guarantee.
- Native generic Release/device compilation uses signing disabled. Simulator builds, six offline UI cases and four integration cases across focused loopback runs cover persistence, recovery, units, accessibility text, photo consent, chunk resume, the older hosted bridge and the actual system photo picker. No physical iPhone validation occurred in this pass.
- The broader legacy photo-fidelity suite still has **3 pre-existing proportion failures and 5 pending annotated features**. An isolated starting-commit replay reproduces them (114 pass). All three fits converge even with a 60-second time cap; increasing runtime does not resolve the targets. Original reference photos are missing and several annotations conflict with their object specifications, so those comparisons need original-photo review before changing geometry or annotations. Solver thresholds and fixtures were not weakened to produce a green report.

Private replay files, generated reports and screenshots remain ignored local verification artifacts; they are not repository fixtures.

Run `npm run check:scan` for the isolated offline scan product suites; it does not require an iPhone, private room data or an AI key. Run `npm run typecheck`, `npm run typecheck:scripts` and `npm run build` separately. Native verification commands are in the sibling app's README. Real GPU rendering, actual Redis scripts and provider connectivity were checked separately and are not implied by an offline pass.

## Work still required before a reliable public launch

1. Complete the new finish endpoint's durable admission store setup and verify the hosted analysis path. Signed iPhone build 11 and the core Studio web update were delivered in the follow-up below.
2. Scan a reference kitchen and bathroom on real hardware. Compare wall lengths, island setbacks, curved edges, both countertop levels and visible finishes with tape measurements and reference photos. Synthetic consistency is not a substitute for this test.
3. Validate processing time, memory and thermal behavior on supported older LiDAR iPhones as well as the current test phone.
4. Complete release/account/backend/privacy review. The new admission gate protects this endpoint; it does not retrofit authentication or account-wide controls onto every older AI route.

Room-wide depth fusion/TSDF, classified mesh reconstruction, high-resolution surface-driven finish capture, fully reconstructed curved walls, multi-room StructureBuilder support and calibrated color normalization are **not implemented by this pass**. Complete unseen edges, exact cabinet construction and fabrication-ready contours remain outside what the current evidence can prove.

## Delivery follow-up — September 12, 2026, 19:10 PDT

- Signed native build 11 was installed and launched separately; all 12 saved projects and 58 files stayed byte-identical. No new scan was started. See the sibling app's build status for the installation receipt.
- Web source `147592d` is deployed and promoted to https://manhattan-woad.vercel.app. Production deployment: `dpl_71iwrnHbWLbh1bxocvwt66ZabeaU`; immutable URL: https://manhattan-3vg3p6xyd-jaygatsby988s-projects.vercel.app. The prior production deployment is `dpl_4REtSwVEvCYcyENQ6BmAnsLKDBZj`.
- The deployment input list excludes private replay/scan files and `.env.local`. The hosted production build passed. The canonical alias resolves to the new deployment, `/api/health` succeeds, `/mobile` displays the native room handoff, and the public Studio renders the saved demo floor plan. Browser inspection found no JavaScript errors; Three.js reports an existing Clock deprecation warning. The scoped deployment error-log query returned no records.
- **New cloud photo finish analysis remains unavailable.** Its synthetic production request correctly returned `503 finish_admission_unavailable` because the durable Redis store is not configured. Vercel stopped the Upstash installation at required marketplace terms acceptance; no database was created. The proposed configuration uses the free plan, production only, with automatic paid upgrades and eviction disabled. After the owner accepts the terms, provision the store, securely configure the server-only REST credentials, redeploy with those environment variables, and verify a synthetic request succeeds. Do not remove the admission guard to enable the route.
- Close and reopen Design Studio in the iPhone app to load the deployed web changes. This delivery does not establish fresh sensor accuracy, complete edge coverage, exact color fidelity or App Store readiness.

Deployment inputs, build/promotion receipts, HTTP checks and runtime-log results are kept under ignored `.build/ReviewQA/`.
