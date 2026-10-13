# Manhattan overnight engineering — September 12, 2026

Authorized work window: 08:40–14:40 UTC (01:40–07:40 America/Los_Angeles).
Continue work in the same task. Stop expanding features at the deadline; finish safe verification and report limits. The task heartbeat is `manhattan-overnight-engineering` and must be paused at the deadline.

## Acceptance priorities

1. Scan-derived island shape, separate countertop levels and true placement survive import, viewing, editing and save/reopen. Never substitute a rectangular island for a measured bend or silently move a scan object.
2. Automatic appearance uses saved camera evidence. Catalog choices are deliberate design edits, never recovered finish evidence. Incomplete coverage remains explicit.
3. Mobile scanning, viewing and editing work without data loss; unsupported operations cannot report success.
4. Jarvis tools execute deterministic changes, respect budgets, explain estimate deltas and undo safely.
5. Review actual visual results and performance, not only test counts. Do not claim perfect physical accuracy or an app valuation.

## Initial baseline (08:55 UTC)

Web branch `codex/realism-quality`, native branch `codex/native-ios`. Production still runs the prior release; current automatic camera-texture work is local only. Native build 10 is signed and built, not installed yet.

Implemented locally:
- Optional camera texture archive bound to the SHA256 of original source XYZ, strict depth/visibility projection, local native derived cache, token-owned web worker decoding, perspective-correct camera texture atlases.
- Captured geometry and camera appearance default in Studio, including legacy projects with manually chosen palettes. No box or alignment replacement when an original mesh exists.
- Measured room-plane underlay with inferred camera tints and an explicit view crop; Source scan keeps the complete archive. No source or measurement mutations.
- Per-slot design preview mask so one intentional finish edit cannot repaint the whole room from an old palette.
- Conservative countertop seam recovery and camera quality guidance; sharper repeat views can replace blurry evidence without discarding valid novel geometry.

Evidence:
- Actual retained scan: 320,000 triangles, 149,896 with valid camera texture from 48 images; geometry unchanged. Source vertex-color coverage remains partial.
- 22 texture/bridge checks, 12 room-appearance checks, 7 observed-model checks, existing 39 import, 22 mesh, 13 finish, 17 scanned-geometry and 10 camera checks passed before the latest per-slot mask addition.
- Native core, texture, store, capture and geometry checks passed; signed build 10 and isolated simulator test bundle built successfully.
- Actual source still contains visible gaps/noise. A prettier box is not an acceptable replacement; a clean evidence-supported surface prototype is in progress.

## Parallel ownership

- Root: scene rendering/mobile integration, per-slot finish preview, final review/deployment and device install.
- `capture_recovery_ui`: isolated real-asset WebKit first-open texture generation, source/design toggles, save/reopen and cache/source preservation. No live scan without fresh user readiness.
- `scan_alignment`: offline evidence-supported clean surface reconstruction prototype; no production algorithm changes until reviewed.
- `scan_save_audit`: Jarvis tool execution/native editing, budget parsing, delta explanation, geometry freshness and undo. Owns Jarvis code/tests.

## Preservation and continuation

Private evidence and test outputs live only in the ignored native `.build/AutoTextureAudit` and existing ignored verification directories. Never commit scan assets, camera frames, tokens or credentials. Original native projects and scan assets must remain unchanged. Preserve unrelated pre-existing Xcode project formatting/signing edits; stage only the minimal build version changes in that file. Use at most the available four agent slots, continue existing agents rather than spawning duplicates, and avoid overlapping device operations.

Before publishing: inspect the combined diff, run focused regressions/typechecks/lint and production build, inspect actual mobile screenshots, verify native save/reopen and source/cache integrity, then commit/push selected files and deploy verified changes. Report separately what was tested on a simulator, on the connected device, and with a physical scan. Overnight replay is not a substitute for a fresh real kitchen scan.

## Update 09:56 UTC

- Per-slot camera/design finish mask and staged Jarvis option previews are implemented. 16 scan finish checks pass, including unchanged legacy palettes, one-slot edits, full-palette intent, native reopening, and preview cancellation.
- Graphics context loss recovery implemented without page reload. Browser fault injection verified automatic recovery twice, a bounded manual fallback on repeated loss, and identical project snapshot/camera texture availability afterward. Native physical-device recovery remains untested.
- Native real-asset WK automatic texture derivation/transfer is visibly working. The full toggle/save/reopen UI test is still running after correcting XCTest accessibility line-wrap and sticky-bar selectors. Do not report the full UI test as passed yet.
- Geometry prototype recovered more observed island plane coverage through exact union, but two-view saved-depth checks support none of the tested small holes. No complete perimeter claim or prototype production integration yet.

## Update 11:00 UTC

- Full real-asset simulator WebKit test passed in 82.355 seconds: first-open automatic texture derivation, source/model and finish toggles, two save/reopen cycles, and eight inspected screenshots. Five original source assets remain byte-identical; room geometry, measurements and baseline remain unchanged; reopening reused the derived texture cache.
- Native cancellation/background lifecycle probe passed. Deferred flushes cannot persist after cancellation; rapid background/foreground resumes perform one import and one asset installation while retaining unsaved edits. Signed native build 10 passed before the additional plane appearance work below; final rebuild is still required.
- Countertop extraction now retains independently supported nearby height levels and avoids starving useful countertop facets behind unrelated floor/wall facets. All 31 geometry checks pass; three actual retained fixture results stay byte-identical. Antialiased camera resampling replaces nearest-pixel downsampling for future captures; existing evidence is preserved.
- Raw mesh material editing supports measured slab overhangs without enlarging cabinet bodies or filling holes. Unsupported surface controls are hidden in the raw mesh path. Explicit finish changes, including choosing the original catalog ID, survive Jarvis options and are priced or marked as unpriced scope. Camera/design view toggles do not remove planned work.
- Native shared links use a captured viewport image bound to the actual design and finish intent. A missing scan asset cannot silently become a procedural replacement kitchen. Asynchronous render/capture work now checks ownership and cancellation.
- Jarvis has a 285-second client deadline, cancellation cleanup and bounded recovery from stalled streams. Local Astra Models metadata access succeeded; production health reports OpenAI configured. No live Responses generation or production model-entitlement claim.
- A separate masked camera appearance channel for measured walls/floors is being integrated. Swift/web synthetic packet parity passes. On the actual saved evidence, the floor feasibility sample has 37.65% supported texels; unsupported cells remain an inferred tint or gray. Original geometry and Source scan remain unchanged. Real packet visual validation is pending.
- The offline clean-surface prototype was inspected and is not being shipped: it modestly smooths supported regions but does not resolve missing evidence. No verified complete island perimeter or physical aisle measurement claim.
- Mobile controls now reserve space below the live model; irrelevant Walk/Photo controls are hidden, inputs avoid Safari focus zoom and key controls meet a 44 px target. Production web build passes; stable phone-sized visual testing is in progress.

Current ownership: root owns web scene/mobile UI and release, `capture_recovery_ui` owns native plane asset/cache/transfer and final native validation, `scan_alignment` owns web plane decoding/bridge/hash validation and retention audit, and `scan_save_audit` performs an independent persistence/fidelity review. Source remains local and unpublished at this update.

## Final feature freeze and release checks

Feature work stopped at the six-hour boundary; the heartbeat is paused. Remaining work is saving and publishing the validated release, then checking installation and existing-project preservation.

- Final native core and signed Release build 10 pass. The final actual-data WK test passed in 220.327 seconds with two save/close/reopen cycles and Source/model toggles. Five original assets remained SHA-identical; room geometry, measurements, baseline and selections stayed unchanged. Both generated appearance caches were reused with identical SHA and modification time.
- Actual plane packet parity passes: six planes, 36,475 supported cells of 139,882 grid cells. Camera triangle textures cover 149,896 of 320,000 retained faces. These are retained-sample counts, not whole-room completeness or physical accuracy measurements.
- The independent persistence review fixed two substantive problems: jointly modified saved geometry could evade original-room validation, and the render appearance token was rejected by native saving. Strict generated local image paths are also supported. Nine new persistence checks and the existing import, irregular scan, mesh and sharing checks pass; both real saved payloads reopen unchanged.
- Final web production build, scripts typecheck, scoped lint and diff check pass. Mobile editing reserves a visible preview above the controls; material options scroll together with their filters rather than squeezing the choices into a tiny nested list.

Known unresolved limits: the retained mesh remains noisy and incomplete; the foreground floor still appears flat in places because raw colored facets occlude the lower camera plane. The proposed fallback shader has not been implemented. Retention priority can use early room bounds, and equal-priority facets are retained in traversal order at the 320k cap. Final-room reselection was diagnosed but was not implemented or tested. No fresh physical kitchen scan, independently measured clearance comparison, live Jarvis Responses generation, or public App Store submission was performed in this pass. Do not represent this release as a perfect automatic reconstruction.

## Published result

Web source commit `1de5e10` and native source commit `fab6770` were pushed to their existing GitHub branches. Production deployment `dpl_4tfSewBwTAx6vTUkrRNibgc6K4VX` is READY at https://manhattan-woad.vercel.app. The production health endpoint returns `ok: true`; the immediate deployment error-log query returned no logs.

Signed build 10 was installed on the connected iPhone. The device project index remained byte-identical before and after installation, retaining all ten projects. No physical scan was started. Native simulator tests and asset-preservation evidence remain in ignored local build folders; private evidence was not committed or uploaded. The user’s unrelated Xcode project formatting/signing edits remain unstaged and preserved.
