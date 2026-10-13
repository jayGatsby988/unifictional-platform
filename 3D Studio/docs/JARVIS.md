# Jarvis

Jarvis interprets a contractor's request with `gpt-6-astra`. Deterministic
application tools perform the edits and calculate prices. Model prose cannot
directly patch the project or supply an accepted estimate.

## Use

Open a project, select Jarvis (shortcut 6), and describe the desired result.
For example: “Keep the full estimate under $85,000, use white oak cabinets and
premium quartz, retain the existing appliances, and make three options.” Add
“Apply the best feasible option” when the design should change immediately.
Island dimensions must fit the existing room and circulation; Jarvis will
report a conflict instead of silently shrinking the island or enlarging the room.

Ask “Why did the price change?” for line-item comparisons, or “Find $12,000 in
savings without changing the overall look” for catalog alternatives. An
unachievable savings target is reported with its remaining shortfall.

Options show a midpoint and full estimate range. The budget ceiling applies to
the **high end**. Apply to 3D switches the real project; Undo restores the last
Jarvis change unless subsequent manual edits would be overwritten. Saved options,
chat and undo survive reload. Removing an option does not delete a published
proposal or render.

Render option captures that option's actual 3D geometry and materials before
calling the configured image provider. A client proposal contains recalculated
quantities, materials, labor, allowances, estimate assumptions, matching completed
renders and a separate interactive 3D link for each option. Proposals support
browser printing/PDF and do not publish studio chat.

## Boundaries

- Kitchen tools edit finishes, island dimensions/placement, seating, waterfall
  ends, cabinet door style and backsplash height. Arbitrary wall, plumbing and
  structural redesign is not supported by the current tool set.
- Material and estimate tools also support bathroom, exterior and floor-plan
  projects; kitchen layout operations explicitly reject those room types.
- Retained appliances exclude new purchase and replacement-installation costs.
  Their geometry and finish remain locked. An island supporting an appliance is
  also locked against geometry changes until relocation labor is modeled.
- Geometry checks use the same layout solvers as the viewport. They do not
  certify building-code compliance or establish dimensions hidden in a photo.
- Estimates use the application's regional price book, not live supplier quotes.
  Confirm measurements, site conditions and contractor rates before a firm bid.
- Scanned fixture bounds and partial LiDAR tops lack complete construction
  quantities. Their changed finishes are listed as unpriced, not free. Such work
  cannot pass a hard budget or produce a completed proposal until its measured
  takeoff and pricing are supplied; unbudgeted visual editing remains available.
- Generated images can differ from the model. The interactive model and priced
  snapshot remain the source of truth for each option.

## Implementation

The Responses API runs server-side with strict function schemas, encrypted
reasoning continuity, request cancellation, bounded tool rounds and a shared
270-second deadline. All edits occur in a private workspace. A successful turn
commits atomically only if the original project fingerprint still matches.
Failed or interrupted turns do not partially edit the project.

Tools include project inspection, material search/change, constraints, island
and layout edits, estimate settings, estimates, single/batched option creation,
option selection/comparison, design validation, savings search, render requests
and proposal requests. Render and proposal tools queue work for the client after
a successful design commit. Artifact failures are reported separately from saved
design changes.

Source observations and the as-found baseline remain unchanged by finish edits.
Changed measurements invalidate old options. Render fingerprints bind images to
their exact option snapshot; policy changes create a new option revision instead
of silently reusing a mismatched image.

## Verify

```bash
npx tsx scripts/check-jarvis-tools.ts
npx tsx scripts/check-jarvis-project.ts
npx tsx scripts/check-jarvis-proposal-ui.ts
npx tsx scripts/check-jarvis-transport.ts
npx tsx scripts/check-jarvis-ui.ts
npm run lint
npm run typecheck:scripts
npm run build
```

The checks exercise real layout, pricing and persistence logic without paid
model/image calls. Browser verification should additionally cover an Astra
request, option application and undo across reload, option capture/render, and
the published proposal's prices, image and interactive model links.
