import type { HouseholdHomeRecord } from "@tendnote/domain";
import { composeHouseholdHome } from "@tendnote/domain";
import type {
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
};

export function createHouseholdHomeService(deps: HouseholdHomeServiceDeps) {
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

      const members = await deps.listMemberNames({
        callerUserId: input.callerUserId,
        householdId: household.id,
      });
      const loaderInput = {
        callerUserId: input.callerUserId,
        householdId: household.id,
        localDate: input.localDate,
        timeZone: input.timeZone ?? "UTC",
        now: input.now ?? new Date(),
        memberNames: new Map(
          members.flatMap((member) => (member.name ? [[member.userId, member.name] as const] : [])),
        ),
      };

      const settled = await Promise.allSettled(
        deps.loadCandidateFamilies.map((load) => load(loaderInput)),
      );
      const candidates: HouseholdHomeCandidate[] = [];
      const limitations: string[] = [];
      for (const result of settled) {
        if (result.status === "fulfilled") candidates.push(...result.value);
        else limitations.push(FAMILY_UNAVAILABLE);
      }

      return {
        household,
        ...composeHouseholdHome({
          records: await provenRecords(deps.proveRecords, input.callerUserId, candidates),
          limitations,
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
