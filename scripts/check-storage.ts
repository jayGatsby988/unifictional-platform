/**
 * Storage pathname checks.
 *
 * These exist because of a live failure: every render in one client project
 * died with "Invalid storage pathname" on BOTH providers, at the moment the
 * finished image was about to be saved. The cause was a disagreement between
 * two regexes that nobody had lined up. nanoid's alphabet is `A-Za-z0-9_-`,
 * so 2 ids in 64 begin with `_` or `-`; `ID_RE` accepts those, the store mints
 * project ids with `nanoid(10)` and the renderer job ids with `nanoid(12)`, and
 * `SAFE_SEGMENT` then demanded an alphanumeric first character. A project that
 * drew the short straw could never render at all, for its whole life, and the
 * id was already persisted in the client's browser so it could not be minted
 * away.
 *
 * The rule under test: a leading `_` or `-` is fine (harmless in a blob key
 * and in a URL), traversal and whitespace and quotes are not.
 *
 *   npx tsx scripts/check-storage.ts
 */
import { ID_RE } from '../src/app/api/_lib/http';
import { normalizePathname, uploadPathname } from '../src/lib/storage/blob';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) { failed++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
  else console.log(`  ok    ${name}`);
};

const accepts = (p: string) => { try { normalizePathname(p); return true; } catch { return false; } };

console.log('\nPathnames that must be ACCEPTED');
for (const p of [
  'renders/_CTn0KVitg/abc123.png',      // project id starting with _ — the live failure
  'renders/-K4zwRB9d1/xyz.jpg',         // project id starting with -
  'renders/proj1234/_JobIdLeading.png', // render job id starting with _
  'renders/proj1234/-JobIdLeading.jpg',
  'photos/Ab3xY9zQ/file9.jpg',
  'projects/abc123.json',
]) check(p, accepts(p));

console.log('\nPathnames that must be REJECTED');
for (const p of [
  'renders/../../etc/passwd',
  'renders/./x.png',
  '../secrets.json',
  'a/b/c/d/e/f/g.png',                  // deeper than 6 segments
  '',
  'renders/pro j/x.png',                // whitespace
  'renders/pro"j/x.png',                // quote
  'renders/pro<j>/x.png',
]) check(p, !accepts(p));

console.log('\nEvery id ID_RE accepts must survive a pathname');
{
  // the exact nanoid alphabet, so this covers the real generator's output
  const ALPHABET = 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW';
  let rejected = 0;
  const bad: string[] = [];
  // deterministic sweep: every character as the FIRST character, which is
  // where the two regexes disagreed
  for (const first of ALPHABET) {
    const id = first + 'bcdefghij';
    if (!ID_RE.test(id)) continue;
    if (!accepts(`renders/${id}/job12345678.png`)) { rejected++; if (bad.length < 6) bad.push(id); }
    if (!accepts(`renders/proj12345/${id}.png`)) { rejected++; if (bad.length < 6) bad.push(id); }
  }
  check('no id valid for the API is rejected by storage', rejected === 0, rejected ? `${rejected} rejected, e.g. ${bad.join(', ')}` : '');
}

console.log('\nuploadPathname round-trips a leading-underscore id');
{
  const p = uploadPathname('photos', '_Ct0KVitg9x', '-Kq4zwRB9d1', 'image/jpeg');
  check('uploadPathname builds an accepted pathname', accepts(p), p);
}

console.log(failed === 0 ? '\nAll storage checks passed' : `\n${failed} STORAGE CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
