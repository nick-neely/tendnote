import type { HouseholdHomeRecord } from "@tendnote/domain";
import {
  composeHouseholdCheckin,
  composeHouseholdHome,
  HOUSEHOLD_CHECKIN_UNAVAILABLE,
} from "@tendnote/domain";
import type {
  HouseholdCheckinView,
  HouseholdHomeCandidate,
  HouseholdHomeCandidateLoader,
  HouseholdHomeProver,
  HouseholdHomeView,
} from "./types";

/**
 * What a member is told when one domain family could not be read.
 *
 * It says what changed for them — part of the home is missing, and nothing of
 * the household's moved — and nothing about which internal source failed. That
 * is a log line, not copy (DESIGN.md §9).
 */
const FAMILY_UNAVAILABLE =
  "Part of Household is temporarily unavailable. Your household's records are unchanged.";

/**
 * What the Check-in adds to the home's dependencies: whether this member asked
 * for it.
 *
 * Read on every composition rather than passed in, because an opt-in is a
 * standing preference and standing is exactly what a caller-scoped surface may
 * not assume. It is also the one thing about a Check-in nobody else can decide —
 * no member enables it for another (ADR 0220).
 */
export type HouseholdCheckinOptIn = (input: { callerUserId: string }) => Promise<boolean>;

export type HouseholdHomeServiceDeps = {
  /**
   * The caller's currently admitted household, read fresh on every composition.
   *
   * Fail-closed by construction: a member who has left resolves to `null`, the
   * loaders never run, and there is nothing to compose. Departure therefore
   * takes the home away on the next read rather than when a cache expires.
   */
  readAdmittedHousehold: (input: {
    callerUserId: string;
  }) => Promise<{ id: string; name: string } | null>;
  /** The other active members, for provenance. Never used for authorization. */
  listMemberNames: (input: {
    callerUserId: string;
    householdId: string;
  }) => Promise<Array<{ userId: string; name: string | null }>>;
  loadCandidateFamilies: HouseholdHomeCandidateLoader[];
  proveRecords: HouseholdHomeProver;
  /** Absent means nobody has opted in — the conservative default (ADR 0220). */
  readCheckinOptIn?: HouseholdCheckinOptIn;
};

export function createHouseholdHomeService(deps: HouseholdHomeServiceDeps) {
  /**
   * The one gather-and-prove pass both surfaces are built from.
   *
   * The Check-in is a narrower read of the same authorized set, not a second
   * pipeline: same membership re-read, same per-family isolation, same proof on
   * each candidate's own facts. Extending rather than forking is the whole point —
   * two pipelines over one household's records is two chances for one of them to
   * be the lenient one, and the lenient one is the leak (ADR 0219).
   */
  async function provenCandidates(input: {
    callerUserId: string;
    householdId: string;
    localDate: string;
    timeZone?: string;
    now?: Date;
    memberNames: ReadonlyMap<string, string>;
  }): Promise<{ records: HouseholdHomeRecord[]; failedFamilies: number }> {
    const settled = await Promise.allSettled(
      deps.loadCandidateFamilies.map((load) =>
        load({
          callerUserId: input.callerUserId,
          householdId: input.householdId,
          localDate: input.localDate,
          timeZone: input.timeZone ?? "UTC",
          now: input.now ?? new Date(),
          memberNames: input.memberNames,
        }),
      ),
    );

    const candidates: HouseholdHomeCandidate[] = [];
    let failedFamilies = 0;
    for (const result of settled) {
      if (result.status === "fulfilled") candidates.push(...result.value);
      else failedFamilies += 1;
    }

    return {
      records: await provenRecords(deps.proveRecords, input.callerUserId, candidates),
      failedFamilies,
    };
  }

  async function memberNamesFor(callerUserId: string, householdId: string) {
    const members = await deps.listMemberNames({ callerUserId, householdId });
    return new Map(
      members.flatMap((member) => (member.name ? [[member.userId, member.name] as const] : [])),
    );
  }

  return {
    /**
     * The deterministic, permission-filtered Household home for one member.
     *
     * Three things happen in a fixed order and none may be skipped: the caller's
     * membership is re-read, every family's candidates are gathered
     * independently, and every candidate is proved on its own facts before any
     * of it is composed. A family that throws costs its own records and nothing
     * else, so one failing domain never produces the misleading global empty
     * state that would read as "your household has nothing going on".
     */
    async getHouseholdHome(input: {
      callerUserId: string;
      localDate: string;
      timeZone?: string;
      now?: Date;
    }): Promise<HouseholdHomeView> {
      const household = await deps.readAdmittedHousehold({ callerUserId: input.callerUserId });
      if (!household) {
        return { household: null, ...composeHouseholdHome({ records: [] }) };
      }

      const { records, failedFamilies } = await provenCandidates({
        ...input,
        householdId: household.id,
        memberNames: await memberNamesFor(input.callerUserId, household.id),
      });

      return {
        household,
        ...composeHouseholdHome({
          records,
          limitations: Array.from({ length: failedFamilies }, () => FAMILY_UNAVAILABLE),
        }),
      };
    },

    /**
     * One member's private Household Check-in: at most three timely records they
     * are currently authorized to see.
     *
     * Caller-scoped end to end. Membership, the opt-in, the candidates, and the
     * proof are all re-read here rather than carried from whatever produced the
     * entry the member tapped — a Check-in composed an hour ago by a scheduled
     * brief and rendered now is exactly the deferred boundary ADR 0219 names, and
     * this is its last safe point.
     *
     * The opt-in is checked before anything is read, not after. A member who has
     * not asked for a Check-in has no household records gathered on their behalf
     * at all, which is a stronger statement than composing one and hiding it.
     */
    async getHouseholdCheckin(input: {
      callerUserId: string;
      localDate: string;
      timeZone?: string;
      now?: Date;
    }): Promise<HouseholdCheckinView> {
      const optedIn =
        (await deps.readCheckinOptIn?.({ callerUserId: input.callerUserId })) ?? false;
      if (!optedIn) {
        return { household: null, optedIn: false, records: [], limitations: [] };
      }

      const household = await deps.readAdmittedHousehold({ callerUserId: input.callerUserId });
      if (!household) {
        // A member who has left has no Check-in, and is told nothing about the
        // household they used to be in — the entry simply stops existing.
        return { household: null, optedIn: true, records: [], limitations: [] };
      }

      const { records, failedFamilies } = await provenCandidates({
        ...input,
        householdId: household.id,
        memberNames: await memberNamesFor(input.callerUserId, household.id),
      });

      return {
        household,
        optedIn: true,
        ...composeHouseholdCheckin({
          records,
          // One message however many families failed: which internal source was
          // unavailable is a log line, not copy.
          limitations: failedFamilies > 0 ? [HOUSEHOLD_CHECKIN_UNAVAILABLE] : [],
        }),
      };
    },
  };
}

/**
 * Keeps only the records the caller can currently prove access to.
 *
 * The store's scope predicate already pre-filtered the rows, and this decides the
 * same question again against facts read now plus the ones SQL cannot see — the
 * record's lifecycle, its sensitivity, and any domain exclusion such as a Gift
 * Plan's Surprise Subject. An unproven record leaves nothing behind: no row, no
 * placeholder, no count, and no gap a member could measure (ADR 0219).
 */
async function provenRecords(
  prove: HouseholdHomeProver,
  callerUserId: string,
  candidates: readonly HouseholdHomeCandidate[],
): Promise<HouseholdHomeRecord[]> {
  if (candidates.length === 0) return [];
  const grants = await prove({
    callerUserId,
    operation: "view",
    records: candidates.map((candidate) => candidate.facts),
  });
  const granted = new Set(grants.map((grant) => `${grant.subjectKind}:${grant.subjectId}`));
  return candidates
    .filter((candidate) => granted.has(`${candidate.facts.kind}:${candidate.facts.id}`))
    .map((candidate) => candidate.record);
}
