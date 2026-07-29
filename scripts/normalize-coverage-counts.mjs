function normalizeCount(value, onNormalize) {
  if (Array.isArray(value)) {
    return value.map((count) => normalizeCount(count, onNormalize));
  }

  if (typeof value === "number" && value < 0) {
    onNormalize();
    return 0;
  }

  return value;
}

export function normalizeCoverageCounts(coverage) {
  let normalizedCount = 0;

  for (const fileCoverage of Object.values(coverage)) {
    for (const counterKind of ["s", "f", "b"]) {
      const counters = fileCoverage[counterKind] ?? {};

      for (const [counterId, value] of Object.entries(counters)) {
        counters[counterId] = normalizeCount(value, () => {
          normalizedCount += 1;
        });
      }
    }
  }

  return { coverage, normalizedCount };
}
