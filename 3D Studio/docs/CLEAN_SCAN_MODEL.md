# Clean native scan models — September 12, 2026

The native Studio previously sent both **3D model** and **Source scan** through the observed LiDAR mesh renderer. The default model now reconstructs clean editable surfaces and fixture bodies from captured room planes and object bounds. Source scan retains the original mesh and camera appearance, without editable reconstruction or postprocessing.

## Behavior

- Walls/openings/floor polygons and object transforms use the imported scan frame. Legacy display-only island alignment and photo-assisted fixture/style overrides are ignored by the clean view; saved source data is preserved.
- Cabinet bodies, fronts and hardware are representative details. Bathroom reconstruction includes hollow vanity carcasses, rotated cutouts associated with captured sinks, and smooth open sink, toilet and tub bowls. The tub body supports material editing; fixed utility parts do not advertise unsupported finish controls.
- Islands can use fitted vertical LiDAR faces rather than a RoomPlan rectangle. Consistent cross-sections retain bends and concavities. A closed supported body loop can support an explicitly inferred working cap; captured holes and neighboring sinks remain open. Independent higher slabs retain their own heights. Fragmentary raised slabs do not establish a complete outer perimeter.
- Camera inference separates individual faces and horizontal tops. Agreeing, depth-visible camera views reduce cabinet glare before bounded color-family clustering estimates a clean finish. Original camera fragments, clutter and stickers are not painted onto the reconstructed doors. Island fronts and opposing painted faces stay separate; ambiguous evidence remains neutral. Colors are estimates under captured illumination, not calibrated reflectance or identified material products.
- Inference stays outside project selections, baseline and quantities. Explicit finish choices and Jarvis previews retain their slot masks. Camera evidence derivation is weakly cached by immutable mesh/scan identity; transient materials and generated geometry are disposed when the view changes.
- Shared/rendered images carry a clean-reconstruction appearance version, preventing old raw-mesh screenshots from being presented as the current clean model.

## Verification

Production build, application and script TypeScript checks, targeted ESLint and whitespace checks pass. Geometry coverage includes 34 object-part checks, 14 measured-contour checks, 13 feature checks, 13 layout checks and 10 camera checks. Appearance checks cover isolated colors, floor/rug separation in either color direction, ambiguous evidence, invalid input and hostile IDs. Additional tests cover native import/persistence, finish intent/pricing, UI/slot eligibility and 19 sharing/render cases.

Private actual bathroom and kitchen replays remain outside the repository under the native app’s ignored build directory. Bathroom replay retained all 151,092 source triangles and 453,276 vertices; normalized coordinates agree with the original archive within Float32 round-off. Both Source and clean view switches retained the exact saved project snapshot. A browser vanity finish trial changed only the intended vanity slot, preserving other inferred colors, geometry and baseline. Clearing choices restored inferred cabinet appearance. These browser tests do not constitute a new physical iPhone sensor test.

## Limits

No tape measurements were supplied, so absolute physical accuracy is not verified. The latest private kitchen replay has a supported bent body and working cap; its raised bar still lacks a closed inner return and end. Object bounds can include substantial empty space, so their clearance is not equivalent to the fitted body's clearance. The bathroom scan contains ambiguous wall endpoints and incomplete camera coverage. Clean reconstruction is an editable approximation, not a claim that every construction detail, color or hidden surface was captured.

## Bathroom detail recovery

The clean view keeps captured windows visible through the orbit camera's near-wall cutaway. Their original transforms and dimensions remain authoritative. A full world-registered floor atlas retains depth-supported camera evidence and excludes incompatible floor coverings. Clean floor materials derive the observed color and independently supported grain direction from that atlas, without copying rugs, shadows or exposure seams. A joint grid is omitted when periodic evidence is insufficient. The inferred pattern uses its own texture transform on a separate UV channel; explicit catalog choices retain their original UVs and take precedence.

Mirrors are recovered from local image segmentation, since RoomPlan does not identify them as objects. A dedicated browser worker downloads a versioned MIT-licensed UPerNet model and processes retained camera frames sequentially. Camera pixels stay on the device. Projection is recovered from verified source XYZ/UV/depth correspondences, with degenerate frames rejected and gravity used to orient images. Mirror masks are intersected with captured wall planes and require agreement across multiple views. These inferred surfaces remain separate from captured geometry, material selections, quantities and saved project JSON. Mirror extent is approximate; inconclusive detections do not create a default mirror.

The worker is bounded, terminated on asset/project replacement and released after processing. Model capture waits for detail processing and rendered frames; failure leaves the clean room usable and is exposed in Scan details. Source scan always retains its original mesh and camera appearance. Only one 256-pixel reflection buffer is used for the largest recovered mirror. Shared capture appearance version v2 invalidates previously captured incomplete clean views.

## Current reconstruction verification

The new geometry checks cover concave loops, unclosed sides, rotated poses, neighbor ownership, slab undersides, height separation, known holes, sink cutouts and bounded processing. Object appearance checks cover independent-camera visibility, white cabinets, glare/shadow ambiguity, mixed finishes, missing data, appliances and cancellation. GPU checks verify color-space handling, instanced face projection, clean shading, explicit catalog lighting, shader reuse and resource disposal. Floor checks separate immutable world observations from inferred finish patterns.

Derived shell geometry and appearance remain transient. Neither the source mesh nor native geometry, selections, quantities or catalog prices are rewritten. The current sharing/render fingerprint is `clean-reconstruction-v3`. Private scan fixtures, images and replay outputs live in ignored `.build` directories and are excluded from deployment.
