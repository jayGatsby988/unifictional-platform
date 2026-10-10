/** Octagon block-U mark, as used on the Unifictional Instagram avatar. */
export function Logo({ className = "h-8 w-8", inverted = false }: { className?: string; inverted?: boolean }) {
  const bg = inverted ? "rgb(var(--bone))" : "rgb(var(--ink))";
  const fg = inverted ? "rgb(var(--ink))" : "rgb(var(--bone))";
  return (
    <svg viewBox="0 0 100 100" className={className} aria-label="Unifictional" role="img">
      <polygon points="29,2 71,2 98,29 98,71 71,98 29,98 2,71 2,29" fill={bg} />
      <path d="M30 26h14v34a6 6 0 0 0 12 0V26h14v35c0 11-9 19-20 19S30 72 30 61z" fill={fg} />
    </svg>
  );
}
