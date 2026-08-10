import type {
  ActiveHouseholdAccess,
  HouseholdAuthorizationGrant,
  HouseholdAuthorizationProof,
  HouseholdAuthorizationSubject,
  HouseholdOperation,
  HouseholdRecordLifecycle,
  HouseholdRecordOwnership,
  HouseholdRequestPurpose,
  PrivacyScope,
  Sensitivity,
} from "@tendnote/domain";
import {
  evaluateHouseholdAuthorization,
  HouseholdRecordUnavailableError,
  proveHouseholdComposition,
} from "@tendnote/domain";
import { createDrizzleHouseholdStore } from "./drizzle-store";
import type { HouseholdRecordShare, HouseholdStore, VisibilityRecordKind } from "./types";

/**
 * The two reads a proof is built from. Both are keyed by facts the caller cannot
 * assert: their own memberships and the record's stored audience.
 */
type HouseholdAuthorizationStore = Pick<
  HouseholdStore,
  "listActiveHouseholdMembershipsForUser" | "listHouseholdRecordSharesForRecords"
>;

/**
 * A scoped record described only by what policy is allowed to see.
 *
 * There is deliberately no audience field: the selected members are read from
 * the share registry, so nothing a route, tool, or job passes in can widen the
 * audience of a record it is asking about. `lifecycle`, `sensitivity`, and
 * `excludedUserIds` are the domain's own facts about its record, supplied by the
 * domain that stores them — a family with no such concept simply omits them and
 * gets the conservative default.
 */
export type HouseholdRecordFacts = {
  kind: VisibilityRecordKind;
  id: string;
  /** Null when the workspace owns the record rather than a member (ADR 0214). */
  ownerUserId: string | null;
  scope: PrivacyScope;
  householdId: string | null;
  ownership?: HouseholdRecordOwnership;
  lifecycle?: HouseholdRecordLifecycle;
  sensitivity?: Sensitivity;
  excludedUserIds?: readonly string[];
};

type ProofRequest = {
  callerUserId: string;
  operation: HouseholdOperation;
  purpose?: HouseholdRequestPurpose;
};

/**
 * Composite map key for one household's records of one kind. `:` is safe as the
 * separator because both halves are a UUID and a fixed enum member, neither of
 * which can contain one — so no two distinct pairs can collide into one key.
 */
function shareKey(householdId: string, recordKind: VisibilityRecordKind) {
  return `${householdId}:${recordKind}`;
}

/**
 * Groups the shared-scope records by household and kind so one composition costs
 * one share read per family rather than one per record. Only `shared` records
 * need it: private has no audience and `household` needs no per-record row.
 */
async function readAudiences(
  store: HouseholdAuthorizationStore,
  records: readonly HouseholdRecordFacts[],
): Promise<Map<string, string[]>> {
  const groups = new Map<
    string,
    { householdId: string; kind: VisibilityRecordKind; ids: string[] }
  >();
  for (const record of records) {
    if (record.scope !== "shared" || !record.householdId) continue;
    const key = shareKey(record.householdId, record.kind);
    const group = groups.get(key) ?? {
      householdId: record.householdId,
      kind: record.kind,
      ids: [],
    };
    group.ids.push(record.id);
    groups.set(key, group);
  }

  const audiences = new Map<string, string[]>();
  for (const group of groups.values()) {
    const shares: HouseholdRecordShare[] = await store.listHouseholdRecordSharesForRecords({
      householdIds: [group.householdId],
      recordKind: group.kind,
      recordIds: group.ids,
    });
    for (const share of shares) {
      const key = `${shareKey(share.householdId, share.recordKind)}:${share.recordId}`;
      audiences.set(key, [...(audiences.get(key) ?? []), share.sharedWithUserId]);
    }
  }
  return audiences;
}

function subjectFor(record: HouseholdRecordFacts, audiences: Map<string, string[]>) {
  const audienceUserIds = record.householdId
    ? audiences.get(`${shareKey(record.householdId, record.kind)}:${record.id}`)
    : undefined;
  return { ...record, audienceUserIds };
}

/**
 * What one record family has to supply to get a proof seam.
 *
 * Two functions, because those are the only two things that genuinely differ
 * between families: where the caller's standing is read from, and how a stored
 * record is described to policy. Everything the ADR actually mandates — reading
 * memberships at the moment of the call, one opaque refusal, dropping rather
 * than marking an unproven record — is the skeleton's, so it cannot fork.
 *
 * `TContext` is whatever per-batch read a family's subjects need beyond the
 * record itself. Scoped records read the share registry; a family with no
 * audience registry uses `void` and pays nothing for the seam.
 */
export type HouseholdProofFamily<TRecord, TContext> = {
  /**
   * Reads the caller's own active memberships for this batch.
   *
   * Supplied rather than fixed so a family can skip the read when its own
   * stored facts prove it cannot matter — the scoped-record skip below is that,
   * and it belongs with the family that can justify it, not in the skeleton.
   */
  readCallerMemberships: (
    callerUserId: string,
    records: readonly TRecord[],
  ) => Promise<readonly ActiveHouseholdAccess[]>;
  /** Per-batch facts the subjects need. One read per batch, never one per record. */
  readSubjectContext: (records: readonly TRecord[]) => Promise<TContext>;
  toSubject: (record: TRecord, context: TContext) => HouseholdAuthorizationSubject;
};

/**
 * The Household Authorization Proof, bound to storage.
 *
 * Every entry point re-reads the caller's active memberships and whatever the
 * family's subjects are built from before deciding. That is the whole reason
 * this seam exists rather than each adapter calling the domain evaluator with
 * facts it happened to have: a membership read a request ago, a share list from
 * a cached page, or an audience carried on a queued job are all stale by the
 * time they are used, and a proof built from them is not a proof (ADR 0219).
 *
 * It is generic over the record family so that a change to the ADR's contract —
 * a new gate, a different refusal, a different listing semantic — lands in one
 * file rather than in each family's hand-rolled copy.
 */
export function createHouseholdProofSeam<TRecord, TContext>(
  family: HouseholdProofFamily<TRecord, TContext>,
) {
  async function proveRecord(
    input: ProofRequest & { record: TRecord },
  ): Promise<HouseholdAuthorizationProof> {
    const [memberships, context] = await Promise.all([
      family.readCallerMemberships(input.callerUserId, [input.record]),
      family.readSubjectContext([input.record]),
    ]);

    return evaluateHouseholdAuthorization({
      callerUserId: input.callerUserId,
      operation: input.operation,
      purpose: input.purpose,
      subject: family.toSubject(input.record, context),
      callerActiveMemberships: memberships,
    });
  }

  return {
    proveRecord,

    /** The proof-or-nothing form: one opaque refusal for every way this can fail. */
    async requireRecord(
      input: ProofRequest & { record: TRecord },
    ): Promise<HouseholdAuthorizationGrant> {
      const proof = await proveRecord(input);
      if (!proof.authorized) {
        throw new HouseholdRecordUnavailableError();
      }
      return proof;
    },

    /**
     * Proves a bounded composition and returns only the records that hold, in
     * the order they were given. An unproven record leaves nothing behind — no
     * entry, no count, no gap the caller could measure.
     */
    async proveRecords(
      input: ProofRequest & { records: readonly TRecord[] },
    ): Promise<HouseholdAuthorizationGrant[]> {
      const [memberships, context] = await Promise.all([
        family.readCallerMemberships(input.callerUserId, input.records),
        family.readSubjectContext(input.records),
      ]);

      return proveHouseholdComposition({
        callerUserId: input.callerUserId,
        operation: input.operation,
        purpose: input.purpose,
        subjects: input.records.map((record) => family.toSubject(record, context)),
        callerActiveMemberships: memberships,
      });
    },
  };
}

/**
 * The scoped-record family: everything that lives in the share registry.
 *
 * The names stay `*RecordAccess` / `proveVisibleRecords` because a dozen call
 * sites and ADR 0219's own language use them; only the machinery underneath is
 * now shared.
 */
export function createHouseholdAuthorizationProver(store: HouseholdAuthorizationStore) {
  const seam = createHouseholdProofSeam<HouseholdRecordFacts, Map<string, string[]>>({
    /**
     * Skips the membership read entirely when no record in the request is
     * scoped beyond its owner.
     *
     * The skip is driven by the records' stored scope, never by the caller, and
     * a private record's decision provably does not consult memberships — so
     * proving one costs nothing over the read it accompanies. That matters
     * because this runs on the single-record read path, where the common case
     * is a caller opening their own private record.
     */
    readCallerMemberships: async (callerUserId, records) => {
      if (!callerUserId || !records.some((record) => record.scope !== "private")) return [];
      return store.listActiveHouseholdMembershipsForUser({ userId: callerUserId });
    },
    readSubjectContext: (records) => readAudiences(store, records),
    toSubject: subjectFor,
  });

  return {
    proveRecordAccess: seam.proveRecord,
    requireRecordAccess: seam.requireRecord,
    proveVisibleRecords: seam.proveRecords,
  };
}

let drizzleProver: ReturnType<typeof createHouseholdAuthorizationProver> | null = null;

/**
 * The database-backed prover the record adapters share.
 *
 * Built lazily and once: it is imported by the scoped-record stores, which the
 * households module in turn imports, and a module-scope instance would make that
 * cycle load-order sensitive.
 */
function householdRecordProver() {
  drizzleProver ??= createHouseholdAuthorizationProver(createDrizzleHouseholdStore());
  return drizzleProver;
}

/**
 * The runtime gate on a scoped-record read: the row has been selected, and this
 * decides whether the caller may actually be shown it.
 *
 * The SQL predicate that selected the row is a pre-filter over ownership, scope,
 * membership, and shares. This re-decides the same question against facts read
 * now, and against the facts SQL cannot see — the record's lifecycle,
 * sensitivity, and domain exclusions. A row that the predicate admitted and the
 * proof refuses is dropped, so the proof is the ceiling on every single-record
 * read rather than a second opinion nobody asks for (ADR 0219).
 *
 * `null` in, `null` out: an adapter can pass its query result straight through,
 * and a refusal is indistinguishable from a row that was not there.
 */
export async function provenVisibleRecord<TRow>(input: {
  callerUserId: string;
  row: TRow | null | undefined;
  facts: (row: TRow) => HouseholdRecordFacts;
  operation?: HouseholdOperation;
  purpose?: HouseholdRequestPurpose;
}): Promise<TRow | null> {
  if (!input.row) return null;

  const proof = await householdRecordProver().proveRecordAccess({
    callerUserId: input.callerUserId,
    operation: input.operation ?? "view",
    purpose: input.purpose,
    record: input.facts(input.row),
  });

  return proof.authorized ? input.row : null;
}
