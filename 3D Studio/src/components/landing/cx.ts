/** Tiny class-name joiner (keeps the landing free of extra deps). */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
