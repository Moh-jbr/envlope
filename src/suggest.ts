/**
 * The name `query` most plausibly meant, ignoring case. Preferred, in order:
 *   1. the same name in different case (database_url → DATABASE_URL)
 *   2. a name the query abbreviates: same first letter, query letters in order
 *      (DB_URL → DATABASE_URL), which raw edit distance ranks poorly
 *   3. a name within an edit distance of half the longer name (DATABSE_URL)
 * Ties go to the smaller edit distance, then to the earlier name.
 */
export function closestName(query: string, names: string[]): string | undefined {
  const q = query.toUpperCase();
  let best: { name: string; rank: number; distance: number } | undefined;
  for (const name of names) {
    const n = name.toUpperCase();
    const distance = editDistance(q, n);
    let rank: number;
    if (distance === 0) rank = 0;
    else if (q.length >= 2 && q[0] === n[0] && isSubsequence(q, n)) rank = 1;
    else if (distance <= Math.floor(Math.max(q.length, n.length) / 2)) rank = 2;
    else continue;
    if (!best || rank < best.rank || (rank === best.rank && distance < best.distance)) {
      best = { name, rank, distance };
    }
  }
  return best?.name;
}

/** Whether every character of `short` appears in `long`, in order. */
function isSubsequence(short: string, long: string): boolean {
  let i = 0;
  for (const c of long) {
    if (c === short[i]) i++;
    if (i === short.length) return true;
  }
  return false;
}

/** Levenshtein distance: each insertion, deletion or substitution costs 1. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length]!;
}
