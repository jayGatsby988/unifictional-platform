/**
 * An in-memory `localStorage` for the headless suites.
 *
 * The project store is persisted, and zustand's `createJSONStorage` resolves
 * the backing store ONCE when the module is first imported. So a check that
 * drives the real store from node either installs a storage before that
 * import or spends its run printing "the given storage is currently
 * unavailable" over its own results.
 *
 * Import this FIRST — before anything that reaches the store — for that
 * reason. It is a side-effect module on purpose: an exported `install()`
 * would run too late, after the imports it is supposed to precede.
 */
const store = new Map<string, string>();

if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const memory: Storage = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: memory, configurable: true, writable: true });
}

export {};
