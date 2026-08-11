import type {
  Asset,
  AssetAuthorityOperation,
  AssetChildAuthorityOperation,
  AssetOwnership,
  PrivacyScope,
} from "@tendnote/domain";
import {
  assertAssetOperationForm,
  householdOperationForAsset,
  householdOperationForAssetChild,
} from "@tendnote/domain";
import { createHouseholdAuthorizationProver } from "../households/authorization";
import type { AssetAuthorityStore } from "./types";

/**
 * The shape any Asset child record presents to the proof: an Asset Memory, a
 * piece of Asset Evidence, or anything later slices hang under an Asset. Only
 * the five facts policy is allowed to see — never the content.
 */
export type AssetChildFacts = {
  kind: "asset_memory" | "asset_evidence";
  id: string;
  ownerUserId: string;
  scope: PrivacyScope;
  ownership: AssetOwnership;
  householdId: string | null;
};

/**
 * A record whose ownership form decides whether its owner key is an access path.
 * Assets, Asset Memories, and Asset Evidence all satisfy it.
 */
type OwnershipBearing = { ownership: AssetOwnership };

/**
 * The storage-key rule, as a predicate: an owner-keyed row is only *the caller's*
 * when it is member-owned.
 *
 * On a household-native row `ownerUserId` is whoever typed it, kept because the
 * column is `NOT NULL` and because creator provenance is worth having. Treating
 * it as an access path is how a departed creator keeps the household's records
 * (ADR 0214), so every owner-keyed read in the family passes through here.
 */
export function memberOwned<TRecord extends OwnershipBearing>(
  record: TRecord | null | undefined,
): TRecord | null {
  return record?.ownership === "member_owned" ? record : null;
}

/**
 * The family's one load shape: try the owner-keyed read, accept it only for a
 * member-owned row, and otherwise fall through to the scope-visible read.
 *
 * Factored because it was hand-copied at five sites and the copy that got it
 * wrong was invisible — the evidence-bytes route kept serving a departed
 * capturer's file for exactly as long as nobody re-read that one line. The
 * owner-keyed read runs first because it is the common private case and the only
 * path that reaches a review-gated proposal; `visible` is what requires current
 * active membership.
 *
 * Reads are thunks rather than promises so the scope-visible query is not issued
 * for the private case that never needs it.
 */
export async function resolveOwnedOrVisible<TRecord extends OwnershipBearing>(reads: {
  owned: () => Promise<TRecord | null>;
  visible: () => Promise<TRecord | null>;
}): Promise<TRecord | null> {
  const owned = memberOwned(await reads.owned());
  return owned ?? (await reads.visible());
}

/**
 * The one place an Asset's authority — and every Asset child record's — is
 * decided.
 *
 * Every lifecycle and composition path funnels through here rather than
 * comparing `asset.ownerUserId` to the actor, because the two ownership forms
 * answer the same operation differently and a comparison written beside a
 * mutation cannot tell them apart: a member-owned Asset at `household` scope and
 * a household-native one are the same row shape to the audience rule. The proof
 * reads the actor's memberships and the record's audience fresh on every call
 * (ADR 0219), so a member who left between a page render and a button press is
 * refused here.
 *
 * The child arm is what ADR 0219 deferred. Until this issue the Asset family
 * clamped a child's scope at write time and let a SQL predicate carry every
 * composed read, which is a pre-filter and not a proof: it cannot see a
 * membership that ended after the page was cached, and it cannot see the
 * lifecycle or ownership facts the proof gates on. Every list a surface renders
 * now passes through {@link keepProvenChildren}, so the ceiling holds on the
 * read path and not only on the write path.
 */
export function createAssetAuthority(store: AssetAuthorityStore) {
  const prover = createHouseholdAuthorizationProver(store);

  /** The facts an Asset presents to policy. Never its name, kind, or history. */
  function assetFacts(asset: Asset) {
    return {
      kind: "asset" as const,
      id: asset.id,
      ownerUserId: asset.ownerUserId,
      scope: asset.scope,
      householdId: asset.householdId,
      ownership: asset.ownership,
    };
  }

  return {
    /**
     * Proves one operation on one loaded Asset, or throws.
     *
     * Both failure modes are deliberate and different. A form refusal
     * ({@link assertAssetOperationForm}) is a curated sentence about the kind of
     * record, safe to show because it discloses nothing the caller cannot
     * already see — "a household asset is archived, not deleted" tells them
     * about the product, not about the household. A proof refusal is the single
     * opaque `HouseholdRecordUnavailableError`, which is what "you may not", "it
     * was deleted", and "you were removed from that household" must all look
     * like from outside (ADR 0219).
     */
    async requireAssetAuthority(input: {
      actorUserId: string;
      asset: Asset;
      operation: AssetAuthorityOperation;
    }) {
      assertAssetOperationForm({
        operation: input.operation,
        ownership: input.asset.ownership,
      });

      return prover.requireRecordAccess({
        callerUserId: input.actorUserId,
        operation: householdOperationForAsset(input.operation),
        record: assetFacts(input.asset),
      });
    },

    /**
     * The same decision, answered rather than enforced.
     *
     * For a read that owes an empty list instead of a refusal: review state is
     * never someone else's to see, and an empty list discloses nothing about
     * whether there was anything to hide. Same proof, same facts, same form
     * rules as {@link requireAssetAuthority} — the only difference is what the
     * caller does with a `false`. That difference is the entire reason this
     * exists rather than an ownership comparison written at the call site: a
     * comparison cannot see current membership, and reading `ownerUserId` as
     * authority is exactly what the storage-key rule forbids (ADR 0214).
     */
    async proveAssetAuthority(input: {
      actorUserId: string;
      asset: Asset;
      operation: AssetAuthorityOperation;
    }): Promise<boolean> {
      assertAssetOperationForm({
        operation: input.operation,
        ownership: input.asset.ownership,
      });
      const proof = await prover.proveRecordAccess({
        callerUserId: input.actorUserId,
        operation: householdOperationForAsset(input.operation),
        record: assetFacts(input.asset),
      });
      return proof.authorized;
    },

    /** The same decision on one child record, on the child's own facts. */
    async requireAssetChildAuthority(input: {
      actorUserId: string;
      child: AssetChildFacts;
      operation: AssetChildAuthorityOperation;
    }) {
      return prover.requireRecordAccess({
        callerUserId: input.actorUserId,
        operation: householdOperationForAssetChild(input.operation),
        record: input.child,
      });
    },

    /**
     * Narrows a page of Assets to the ones the caller may actually be shown.
     *
     * The SQL predicate that selected them is a pre-filter; this re-decides each
     * one against memberships read now. An unproven Asset leaves nothing
     * behind — no row, no count, no gap the caller could measure — because a
     * placeholder is itself the disclosure (ADR 0219).
     */
    async keepProvenAssets<TRow extends { asset: Asset }>(input: {
      callerUserId: string;
      rows: readonly TRow[];
    }): Promise<TRow[]> {
      if (input.rows.length === 0) return [];
      const grants = await prover.proveVisibleRecords({
        callerUserId: input.callerUserId,
        operation: "view",
        records: input.rows.map((row) => assetFacts(row.asset)),
      });
      const allowed = new Set(grants.map((grant) => grant.subjectId));
      return input.rows.filter((row) => allowed.has(row.asset.id));
    },

    /**
     * The same narrowing for a composition of child records, each proved on its
     * own facts.
     *
     * A visible parent carries nothing through here. That is the whole of ADR
     * 0179 on the read side: the household's refrigerator being open to everyone
     * says nothing about the private receipt hanging off it, and the receipt has
     * to answer for itself every time it is listed.
     */
    async keepProvenChildren<TRow>(input: {
      callerUserId: string;
      rows: readonly TRow[];
      facts: (row: TRow) => AssetChildFacts;
    }): Promise<TRow[]> {
      if (input.rows.length === 0) return [];
      const grants = await prover.proveVisibleRecords({
        callerUserId: input.callerUserId,
        operation: "view",
        records: input.rows.map(input.facts),
      });
      const allowed = new Set(grants.map((grant) => grant.subjectId));
      return input.rows.filter((row) => allowed.has(input.facts(row).id));
    },
  };
}
