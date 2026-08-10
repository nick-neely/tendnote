import type { AssetOwnership } from "./assets";
import { AssetValidationError } from "./assets";
import type { HouseholdOperation } from "./household-authorization";

/**
 * The operations the shared-Asset collaboration contract distinguishes.
 *
 * These are the rows of the authority table in
 * `docs/phase-8/household-assets-and-asset-memories.md`, not the lifecycle
 * transitions: `archive` covers restore as well as archive, because setting an
 * Asset aside and bringing it back are one authority question. `attach` is here
 * because adding your own detail to an Asset is the one write that asks nothing
 * of the Asset itself — it asks only whether you can see it.
 */
export type AssetAuthorityOperation =
  | "view"
  | "edit"
  | "archive"
  | "delete"
  | "audience"
  | "attach";

/**
 * How each operation asks the Household Authorization Proof (ADR 0219).
 *
 * The mapping is the whole point of this module: authority is decided once, by
 * the proof, from the record's ownership form — never by an `ownerUserId ===
 * actorUserId` comparison written beside a mutation. Assets have no `progress`
 * arm; nothing about an Asset is "done", and the reporting act the proof grants
 * to a whole audience belongs to the linked Action instead (ADR 0179's
 * maintenance boundary, restated by #386's third acceptance criterion).
 */
const PROOF_OPERATION: Record<AssetAuthorityOperation, HouseholdOperation> = {
  view: "view",
  edit: "update",
  archive: "archive",
  // Permanent deletion is the correction/privacy path and needs the strongest
  // authority the proof expresses. The form rule below then removes it entirely
  // from a workspace-owned Asset, so this arm only ever runs for an owner.
  delete: "archive",
  audience: "change_audience",
  // Attaching your own memory or receipt to an Asset someone else owns is not an
  // act on their Asset — the detail is yours, clamped to the Asset's scope, and
  // theirs to neither read nor rewrite unless you widened it. So the Asset only
  // has to be one you may see; the child's own proof governs the child.
  attach: "view",
};

export function householdOperationForAsset(operation: AssetAuthorityOperation): HouseholdOperation {
  return PROOF_OPERATION[operation];
}

/**
 * The operations an Asset child record — an Asset Memory or a piece of Asset
 * Evidence — distinguishes.
 *
 * Deliberately its own small union rather than the Asset's: a child has no
 * audience of its own to change beyond the clamp, and evidence has no edit at
 * all. `remove` covers dismissing a memory and deleting evidence, which is one
 * authority question wearing two lifecycle names.
 */
export type AssetChildAuthorityOperation = "view" | "edit" | "remove";

const CHILD_PROOF_OPERATION: Record<AssetChildAuthorityOperation, HouseholdOperation> = {
  view: "view",
  edit: "update",
  remove: "archive",
};

export function householdOperationForAssetChild(
  operation: AssetChildAuthorityOperation,
): HouseholdOperation {
  return CHILD_PROOF_OPERATION[operation];
}

/**
 * The rules the proof cannot express, because they are about the record family
 * rather than about the caller.
 *
 * The proof answers "may *this member* do this to this Asset". These answer "is
 * this operation a thing this *kind of* Asset has at all", and each fails for
 * every caller including the member who created it — so they run before the
 * proof rather than after: there is nothing to prove.
 *
 * Their messages are curated and safe to show. They name no member and disclose
 * nothing the caller cannot already see, so they do not fall under ADR 0219's
 * single-refusal rule, which governs *whether the caller may know the record
 * exists*.
 */
export function assertAssetOperationForm(input: {
  operation: AssetAuthorityOperation;
  ownership: AssetOwnership;
}): void {
  if (input.operation === "delete" && input.ownership === "household_native") {
    // Archive is the removal path for a workspace-owned record, and no single
    // member may end one for everybody (ADR 0214). Said as the alternative
    // rather than as a denial, because there is a thing to do instead.
    throw new AssetValidationError("A household asset is archived, not deleted.");
  }
  if (input.operation === "audience" && input.ownership === "household_native") {
    throw new AssetValidationError(
      "A household asset is already there for everyone in the household.",
    );
  }
}

/**
 * Why a workspace-owned detail cannot hang off a member's own Asset.
 *
 * A household-native child is the workspace's and survives its creator's
 * departure — but a member-owned Asset returns to that member's private space
 * when they leave, and it would take the workspace's detail with it. The
 * household would lose a record it owns because of something that happened to a
 * record it does not, which is the one thing workspace ownership exists to
 * prevent.
 *
 * The cost is real: a shared note on a partner's car has to be a member-owned
 * one, widened to the household. That is the honest form for it anyway — the car
 * is theirs.
 *
 * The reverse direction is unrestricted and deliberately so: a household-native
 * Asset holding one member's private receipt is the case ADR 0179 exists for.
 */
export function assertAssetChildOwnershipForm(input: {
  childOwnership: AssetOwnership;
  assetOwnership: AssetOwnership;
}): void {
  if (input.childOwnership === "household_native" && input.assetOwnership !== "household_native") {
    throw new AssetValidationError("A household detail belongs on a household asset.");
  }
}

/**
 * The scope a child record must hold, given its ownership form.
 *
 * A household-native child is whole-household-visible by definition — the same
 * rule that makes a household-native Asset `household` scope — so its audience
 * is not a choice a caller gets to make, and passing one is not an error to
 * report but a value to ignore. A member-owned child keeps whatever the caller
 * chose, subject to the ceiling.
 */
export function assetChildScopeForOwnership(
  ownership: AssetOwnership,
  requested: "private" | "shared" | "household" | undefined,
): "private" | "shared" | "household" | undefined {
  return ownership === "household_native" ? "household" : requested;
}

/**
 * What the surface says when two members write the same field at once.
 *
 * One sentence, factual, and never a reproach: the second writer did nothing
 * wrong, their draft is safe, and the only thing they have to decide is whether
 * they still want it. The actor's name is filled in by the surface, which
 * already holds the household roster — resolving it here would mean a name
 * lookup inside a failure path.
 */
export const ASSET_STALE_WRITE_MESSAGE = "Someone else changed this while you were editing.";

/**
 * How a surface says whose Asset — or whose detail — this is, in one quiet line.
 *
 * Two sentences that are never both true: a household-native record is the
 * household's, and a record someone else owns is theirs and shared with you.
 * Your own member-owned record says nothing at all, because "Shared by you" is
 * a fact you already have.
 *
 * A household-native record's `ownerUserId` is a storage key, so this takes the
 * ownership form first and only reaches for a name in the member-owned arm —
 * crediting the household's refrigerator to whoever happened to type it is
 * exactly the mistake the storage-key rule exists to prevent (ADR 0214).
 */
export function assetAttributionLabel(input: {
  ownership: AssetOwnership;
  owned: boolean;
  ownerName: string | null;
}): { kind: "household" } | { kind: "shared_by"; label: string } | null {
  if (input.ownership === "household_native") return { kind: "household" };
  if (input.owned) return null;
  return { kind: "shared_by", label: `Shared by ${input.ownerName ?? "a household member"}` };
}
