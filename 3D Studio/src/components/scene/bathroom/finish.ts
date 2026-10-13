/**
 * A stated fixture finish → the util material that draws it.
 *
 * The room's `fixtures` / `hardware` slots carry the finish for everything by
 * default. These are the per-PIECE overrides the contract already described —
 * a matte-black shower door in a chrome bathroom, an oil-rubbed-bronze tub
 * filler beside a brushed-nickel tap — mapped onto materials the kit already
 * builds, so honouring them costs no new material.
 */
import type { FixtureFinish } from '@/lib/spec/types';
import type { utilMaterial } from '@/components/scene/materials';

type Util = Parameters<typeof utilMaterial>[0];

export const FINISH_UTIL: Record<FixtureFinish, Util> = {
  chrome: 'chrome',
  'brushed-nickel': 'brushed-nickel',
  // a polished nickel is a warmer chrome; the kit's chrome is the closest real
  // material and inventing a near-duplicate would cost a draw call for nothing
  'polished-nickel': 'chrome',
  'matte-black': 'matte-black',
  'brushed-gold': 'brushed-brass',
  'polished-brass': 'brushed-brass',
  'oil-rubbed-bronze': 'oil-rubbed-bronze',
  stainless: 'stainless',
  white: 'white-plastic',
  black: 'black-metal',
};
