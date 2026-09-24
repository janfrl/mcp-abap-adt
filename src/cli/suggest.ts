function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The closest candidate within two edits, for "Did you mean ...?". */
export function closest(input: string, candidates: readonly string[]): string | undefined {
  const [best] = candidates
    .map((candidate) => ({ candidate, cost: editDistance(input.toLowerCase(), candidate.toLowerCase()) }))
    .toSorted((x, y) => x.cost - y.cost);
  return best && best.cost <= 2 ? best.candidate : undefined;
}
