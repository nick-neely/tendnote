import type { ReversibleMutationApplyPhase } from "@/lib/reversible-mutation";

/** Rejects stale server acknowledgements while leaving local projections and rollbacks usable. */
export function acceptMutationRevision(
  acknowledged: Map<string, string>,
  input: { id: string; revision: string },
  phase: ReversibleMutationApplyPhase,
): boolean {
  if (phase !== "authoritative" && phase !== "inverse") return true;
  const current = acknowledged.get(input.id);
  if (current && input.revision <= current) return false;
  acknowledged.set(input.id, input.revision);
  return true;
}
