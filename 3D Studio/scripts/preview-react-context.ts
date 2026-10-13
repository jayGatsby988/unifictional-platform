/** Context semantics for the one-shot component walkers. Only the real R3F
 * context receives a renderer stub; application contexts keep their defaults
 * and the nearest provider's value, without mutating React's global context. */
export function previewContexts(fiberContext: unknown, fiberStore: unknown) {
  const values = new Map<unknown, unknown>();
  const read = (context: unknown): unknown => {
    if (values.has(context)) return values.get(context);
    if (context === fiberContext) return fiberStore;
    return (context as { _currentValue?: unknown } | null)?._currentValue;
  };
  const provider = (type: unknown, value: unknown, children: () => void): boolean => {
    const node = type as { $$typeof?: symbol; _context?: unknown } | null;
    const context = node?.$$typeof === Symbol.for('react.context') ? node
      : node?.$$typeof === Symbol.for('react.provider') ? node._context : undefined;
    if (!context) return false;
    const hadValue = values.has(context), previous = values.get(context);
    values.set(context, value);
    try { children(); }
    finally { if (hadValue) values.set(context, previous); else values.delete(context); }
    return true;
  };
  return { read, provider };
}
