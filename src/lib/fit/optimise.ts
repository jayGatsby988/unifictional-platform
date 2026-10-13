/**
 * The joint continuous optimiser: a (1+λ) evolution strategy with Gaussian
 * sampling and a shrinking step — the simplest thing that finds DIAGONAL
 * moves. Coordinate descent (the scans and pattern sweeps that run before
 * it) stalls wherever two numbers have to move together: the camera back
 * AND the lens longer, a run's length AND the island's end, a window's sill
 * AND the ceiling. Sampling every coordinate at once, in proportion to its
 * own step, takes those moves in one go.
 *
 * Half the samples of each generation perturb a small random subset of the
 * coordinates (one to three), because most spec numbers only move their own
 * element and a full-vector step mostly adds noise to the others; the other
 * half perturb everything, which is where the joint moves come from. The
 * scale grows a little on a successful generation and shrinks on a failed
 * one, and the search stops when every coordinate's step is under its floor
 * or the budget is gone.
 *
 * Deterministic: the only randomness is a seeded PRNG the caller hands in.
 */
import { moveDim, type Dim } from './params';

/** mulberry32 — small, fast, good enough, and identical on every run for the same seed */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal sample (Box–Muller) from a uniform source. */
export function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng()), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface EvolveOptions {
  rng: () => number;
  /** most objective evaluations */
  maxEvals: number;
  /** wall-clock stop (Date.now() based) */
  deadline: number;
  /** samples per generation */
  lambda?: number;
  /** starting step, as a multiple of each dimension's `step` */
  scale0?: number;
  /** the objective at `p0`, when already known */
  f0?: number;
  /** stop after this many failed generations in a row (a plateau) */
  patience?: number;
  /** an outside budget (the layout evaluations) that ends the search when it says so */
  stop?: () => boolean;
}

export interface EvolveResult {
  p: number[];
  loss: number;
  evals: number;
  generations: number;
}

/**
 * Minimise `f` from `p0` inside `dims`. `f` receives the candidate and the
 * indices that differ from the incumbent, so a caller whose objective has
 * an expensive part (the layout) can skip it when only cheap coordinates
 * (the camera) moved. Improvements are taken greedily; an equal or worse
 * sample is discarded.
 */
export function evolve(p0: number[], dims: Dim[], f: (p: number[], changed: number[]) => number, opts: EvolveOptions): EvolveResult {
  const n = dims.length;
  let best = p0.slice();
  let fbest = opts.f0 ?? f(best, []);
  let evals = opts.f0 === undefined ? 1 : 0;
  let scale = opts.scale0 ?? 0.5;
  const lambda = Math.max(2, opts.lambda ?? 8);
  const patience = opts.patience ?? 12;
  const rng = opts.rng;
  let generations = 0;
  let failed = 0;
  const alive = () => dims.some((d) => d.step * scale >= d.minStep);
  const halted = () => evals >= opts.maxEvals || Date.now() > opts.deadline || (opts.stop ? opts.stop() : false);
  while (n > 0 && alive() && !halted()) {
    let improved = false;
    for (let k = 0; k < lambda && !halted(); k++) {
      const q = best.slice();
      const changed: number[] = [];
      // odd samples move a handful of coordinates, even ones move them all
      const subset = k % 2 === 1;
      if (subset) {
        const m = 1 + Math.floor(rng() * 3);
        for (let j = 0; j < m; j++) {
          const i = Math.floor(rng() * n);
          if (!changed.includes(i)) changed.push(i);
        }
      } else {
        for (let i = 0; i < n; i++) changed.push(i);
      }
      const moved: number[] = [];
      for (const i of changed) {
        const d = dims[i];
        if (d.step * scale < d.minStep * 0.5) continue;
        const v = moveDim(best[i], gaussian(rng) * d.step * scale, d);
        if (Math.abs(v - best[i]) < 1e-9) continue;
        q[i] = v;
        moved.push(i);
      }
      if (!moved.length) continue;
      const fq = f(q, moved);
      evals++;
      if (fq < fbest - 1e-9) { best = q; fbest = fq; improved = true; }
    }
    generations++;
    if (improved) { scale = Math.min(scale * 1.15, 2); failed = 0; }
    else { scale *= 0.7; failed++; if (failed >= patience) break; }
  }
  return { p: best, loss: fbest, evals, generations };
}
