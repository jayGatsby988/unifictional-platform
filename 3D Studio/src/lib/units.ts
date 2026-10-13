/** Unit helpers. The 3D scene is metric (1 unit = 1 m); specs are imperial. */
export const FT = 0.3048;
export const IN = 0.0254;

export const ft = (feet: number) => feet * FT;
export const inch = (inches: number) => inches * IN;
export const mToFt = (m: number) => m / FT;
export const sqftFromM2 = (m2: number) => m2 / (FT * FT);

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, step = 1) => Math.round(v / step) * step;

export const fmtUSD = (n: number, opts: { compact?: boolean } = {}) => {
  if (opts.compact && Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`;
  }
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
};

export const fmtRange = (lo: number, hi: number) => `${fmtUSD(lo, { compact: true })} – ${fmtUSD(hi, { compact: true })}`;

export const fmtFt = (feet: number) => {
  const whole = Math.floor(feet);
  const inches = Math.round((feet - whole) * 12);
  if (inches === 12) return `${whole + 1}'`;
  return inches ? `${whole}' ${inches}"` : `${whole}'`;
};
