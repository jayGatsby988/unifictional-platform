import assert from 'node:assert/strict';
import { createContext } from 'react';
import { context as fiberContext } from '@react-three/fiber';
import { previewContexts } from './preview-react-context';

const store = () => ({}), contexts = previewContexts(fiberContext, store);
const appearance = createContext<null | { slots: string[] }>(null), transform = createContext({ delta: 'identity' });
assert.equal(contexts.read(fiberContext), store);
assert.equal(contexts.read(appearance), null, 'an absent appearance provider cannot look like a renderer store');
assert.deepEqual(contexts.read(transform), { delta: 'identity' });
assert.equal(contexts.provider('group', 'ignored', () => assert.fail('intrinsic is not a context provider')), false);
const parent = { slots: ['flooring'] }, child = { slots: ['countertop'] };
assert.equal(contexts.provider(appearance.Provider, parent, () => {
  assert.equal(contexts.read(appearance), parent);
  contexts.provider(appearance.Provider, child, () => assert.equal(contexts.read(appearance), child));
  assert.equal(contexts.read(appearance), parent);
  contexts.provider(appearance.Provider, undefined, () => assert.equal(contexts.read(appearance), undefined));
  assert.equal(contexts.read(appearance), parent);
  assert.throws(() => contexts.provider(appearance.Provider, child, () => { throw new Error('child failed'); }), /child failed/);
  assert.equal(contexts.read(appearance), parent);
  assert.equal(contexts.read(fiberContext), store);
}), true);
assert.equal(contexts.read(appearance), null, 'a sibling sees the default after provider traversal');
assert.equal(previewContexts(fiberContext, store).read(appearance), null, 'separate harvests cannot share a provider');
// React 18 wraps providers; React 19 uses the context object itself.
contexts.provider({ $$typeof: Symbol.for('react.provider'), _context: appearance }, parent, () => assert.equal(contexts.read(appearance), parent));
assert.equal(contexts.read(appearance), null);
console.log('PASS preview contexts preserve defaults, provider nesting, explicit undefined, throw cleanup and renderer isolation.');
