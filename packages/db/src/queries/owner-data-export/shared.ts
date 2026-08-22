export type OwnerDataExportSensitivityLabel = "normal" | "sensitive" | "restricted";

export function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

export function sortByCreatedAt<T extends { id: string; createdAt: Date }>(records: readonly T[]) {
  return [...records].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
  );
}

export function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

export function jsonBytes(value: unknown) {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
}

export function envelope<T>(records: readonly T[]) {
  return { schemaVersion: "1.0", records };
}

export function sensitivityRank(value: OwnerDataExportSensitivityLabel) {
  return value === "restricted" ? 2 : value === "sensitive" ? 1 : 0;
}
