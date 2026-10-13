# Measured-plane camera appearance, version 1

This optional local asset projects depth-checked camera observations onto the original measured wall/floor planes. It contains appearance only. It does not change captured geometry, project selections, quantities, or the Source scan. Pixels are ephemeral in the web client and never enter project JSON or cloud uploads.

## Geometry binding

`MNHPGEO1` is the canonical binary input to SHA-256. All integer fields are little endian. It contains the eight ASCII magic bytes, a UInt16 surface count, then every raw measured wall, floor, door, window and opening sorted lexicographically by its UTF-8 ID bytes. Maximum count is 256. Objects are excluded.

Each surface contains:

1. UInt16 ID byte count and UTF-8 ID, 1–160 bytes, unique and without NUL.
2. UInt8 kind: wall 1, floor 2, door 3, window 4, opening 5.
3. Three Float32 dimensions (XYZ), then all 16 Float32 transform entries in their original column-major order.
4. UInt16 polygon point count: zero for absent/null, otherwise 3–256. Each point has three Float32 absolute world coordinates; original ring order is retained.

Negative zero canonicalizes to positive zero. Values must be finite; dimensions are 0–100 m, other coordinates/transform entries have absolute value at most 1000. Float32 matches original ARKit precision and avoids Foundation/JavaScript Float64 JSON ULP differences. This conversion is used only for hashing and never rewrites geometry. Confidence and redundant position metadata are excluded; translation comes from the full transform.

## Appearance packet

`MNHPLAN1` has a 107-byte header:

| Field | Size |
| --- | --- |
| ASCII magic | 8 bytes |
| SHA-256 of canonical raw room geometry | 32 bytes |
| SHA-256 of original mesh XYZ bytes, in triangle order | 32 bytes |
| SHA-256 of native camera archive | 32 bytes |
| Plane count | UInt16 LE |
| Resource-limited flag, 0 or 1 | UInt8 |

Each plane record contains UInt16 ID length + UTF-8 ID, UInt8 kind (wall 1/floor 2), UInt16 width and height, Float64 origin XYZ, Float64 unit U XYZ, Float64 unit V XYZ, Float64 meters-per-texel, UInt32 RGBA byte length, and exact RGBA bytes. Float64 values are little endian. Plane IDs are unique and must match the raw room's wall/floor IDs and kind.

Limits are 64 planes, each edge 1–1024, at most 2,000,000 texels across the packet, and at most 8 MiB for the entire packet. Meters-per-texel is 0.005–0.25 m, normally 0.025 m. Spans are at most 100 m per axis. RGBA length is exactly width × height × 4. RGB is sRGB; alpha is only 0 or 255. Unsupported cells have RGBA `[0,0,0,0]`. Each included image must have at least one observed cell. Unknown versions, malformed UTF-8, duplicate/unknown IDs, malformed counts/flags, nonfinite vectors, invalid bases/domains, incorrect masks, mismatched hashes, truncation and trailing bytes are rejected.

## Grid and rendering

For a wall, U and V are normalized transform columns 0 and 1. Project the original polygon onto that plane, or use the measured rectangle if the wall has no polygon. Origin is transform translation plus U × minimum projected U plus V × minimum projected V. For a floor, an original polygon is required; U is world X, V is world Z, and origin is `[minimumX, meanPolygonY, minimumZ]`. Floor height deviation and wall polygon distance from plane must be at most 1 cm. Width/height are the ceiling of each span divided by meters-per-texel. The final row or column can extend by less than one cell beyond the polygon bounds.

Cell `(x,y)` has world center `origin + U*(x+0.5)*step + V*(y+0.5)*step`. Row zero is minimum V. The decoder verifies this frame against the raw surface, then applies the room's existing import mapping once: translate/rotate origin and rotate U/V. Output is in Studio coordinates. It does not renormalize the captured mesh or saved project.

The renderer must clip to original measured geometry/openings and use nearest filtering with no mipmaps or interpolation through invalid masks. Unsupported cells remain transparent over the explicitly inferred room underlay. These images never replace the exact Source scan.

## Bridge ownership and lifecycle

New hosts may call `manhattanNativeAssetState({projectId,token,stage,requestId,state,message?})` immediately after mesh acknowledgment, before preparing either appearance asset. Stage is `texture` or `planeTexture`; state is `pending`, `failed`, or `unavailable`. Request IDs are 1–100 ASCII letters/digits/underscores/hyphens. An optional error message is at most 1000 characters. Preparation is bound to the current mesh object, project and opaque asset token. A 90-second timer settles missing native work. Status for an obsolete request cannot settle a newer one.

Plane bytes arrive via optional `manhattanNativePlaneTexture({projectId,token,cameraSHA256,data,preparationId?})`. `data` is canonical bounded base64. The camera hash is trusted native-cache provenance compared against the packet header; JavaScript does not receive the camera archive and does not independently verify its pixels. Room and mesh hashes are computed from their original source geometry in the web client.

When supplied, preparationId must match the active stage request and current mesh. Legacy texture/plane packets without preparationId remain supported. Preparation stays pending through the worker decoder. Closing/changing the room, replacing the mesh, or native background cancellation aborts owned work and prevents late acceptance. Failed preparation preserves already accepted appearance. New hosts reannounce fresh request IDs after resuming; old hosts without these optional handlers degrade gracefully.
