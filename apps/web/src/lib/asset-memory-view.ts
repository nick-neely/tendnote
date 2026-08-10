import type { AssetMemory, AssetOwnership } from "@tendnote/domain";
import { formatAssetMemoryValue } from "@/lib/asset-memory-value";
import type { OwnerActionResult } from "@/lib/owner-action";

export type AssetMemoryMutationResult = OwnerActionResult<AssetMemoryView>;

/**
 * One kept detail as the Asset Profile renders it.
 *
 * `canWrite` is the projection of the Phase Eight authority table one level down
 * from the Asset: a member-owned detail stays its owner's to correct however
 * wide its audience, and a household-native one is every active member's
 * (ADR 0214). It is a rendering hint — the server proves it again on the write.
 */
export type AssetMemoryView = {
  id: string;
  /** What the fact is called ("Filter size"). */
  label: string;
  /** The typed exact value, already formatted, or null when there is only prose. */
  valueLabel: string | null;
  /** The raw text of a text-valued detail, so a correction form can start from it. */
  valueText: string | null;
  notes: string | null;
  ownership: AssetOwnership;
  /** The optimistic-concurrency fence a correction is written against. */
  revision: number;
  canWrite: boolean;
};

export function toAssetMemoryView(
  memory: AssetMemory,
  options: { callerUserId: string },
): AssetMemoryView {
  return {
    id: memory.id,
    label: memory.label,
    valueLabel: formatAssetMemoryValue(memory.value),
    // Only a text value round-trips into the correction form. A date, interval,
    // or amount is a typed fact with its own editor, and offering a free-text box
    // over one would let a correction quietly destroy the type.
    valueText: memory.value?.type === "text" ? memory.value.text : null,
    notes: memory.notes,
    ownership: memory.ownership,
    revision: memory.revision,
    canWrite:
      memory.ownership === "household_native" || memory.ownerUserId === options.callerUserId,
  };
}
