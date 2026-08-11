import {
  assertHouseholdEventPlanEditable,
  HOUSEHOLD_EVENT_PLAN_LINK_LIMIT,
  type HouseholdEventPlan,
  HouseholdEventPlanConflictError,
  type HouseholdEventPlanDraft,
  type HouseholdEventPlanLink,
  type HouseholdEventPlanLinkKind,
  type HouseholdEventPlanStatus,
  HouseholdRecordUnavailableError,
  HouseholdValidationError,
  householdEventPlanCalendarRef,
  normalizeHouseholdEventPlanDraft,
} from "@tendnote/domain";
import type { createHouseholdAuthorizationProver, HouseholdRecordFacts } from "./authorization";
import type {
  HouseholdEventPlanLinkTargetStore,
  HouseholdEventPlanProvedLink,
  HouseholdEventPlanStore,
  HouseholdEventPlanWrite,
} from "./event-plan-types";
import type { HouseholdStore } from "./types";

/** The record kind an Event Plan is proved as. */
export const HOUSEHOLD_EVENT_PLAN_KIND = "household_event_plan" as const;

type HouseholdEventPlanProver = ReturnType<typeof createHouseholdAuthorizationProver>;

export type HouseholdEventPlanLifecycleDeps = {
  households: Pick<HouseholdStore, "listActiveHouseholdMembershipsForUser">;
  plans: HouseholdEventPlanStore;
  linkTargets: HouseholdEventPlanLinkTargetStore;
  prover: HouseholdEventPlanProver;
  now?: () => Date;
};

/**
 * A Plan's own facts, as the Authorization Proof sees them.
 *
 * `household_native` is what makes every active member's authority symmetric:
 * the proof's record-authority gate only demands ownership for `member_owned`
 * records, so a member who did not create the Plan may still edit and archive
 * it, and the creator gets no more than they do (ADR 0217).
 *
 * `scope: "household"` is a literal rather than a column because a Plan is
 * always whole-household-visible. A stored scope would be a value someone could
 * write to narrow a record whose entire purpose is that it is shared.
 *
 * `lifecycle` says `active` even for an archived Plan. `ended` means "there is
 * nothing here", and an archived Plan is still there - whether it can be edited
 * is the domain's own rule, enforced separately by
 * {@link assertHouseholdEventPlanEditable}.
 */
function planFacts(plan: HouseholdEventPlan): HouseholdRecordFacts {
  return {
    kind: HOUSEHOLD_EVENT_PLAN_KIND,
    id: plan.id,
    ownerUserId: plan.createdByUserId,
    scope: "household",
    householdId: plan.householdId,
    ownership: "household_native",
    lifecycle: "active",
  };
}

export type HouseholdEventPlanWithLinks = {
  plan: HouseholdEventPlan;
  links: HouseholdEventPlanProvedLink[];
};

/**
 * The one household-native Event Plan query/mutation layer.
 *
 * Every entry point resolves the household from the caller's own active
 * membership and then obtains a fresh Household Authorization Proof for the
 * exact operation about to happen. Neither a prior read, the caller's role, nor
 * the fact that they created the Plan is treated as standing (ADR 0219).
 */
export function createHouseholdEventPlanLifecycle(deps: HouseholdEventPlanLifecycleDeps) {
  const now = deps.now ?? (() => new Date());

  async function requireActiveHousehold(callerUserId: string): Promise<string> {
    if (!callerUserId) throw new HouseholdRecordUnavailableError();
    const memberships = await deps.households.listActiveHouseholdMembershipsForUser({
      userId: callerUserId,
    });
    const householdId = memberships[0]?.householdId;
    if (!householdId) throw new HouseholdRecordUnavailableError();
    return householdId;
  }

  /**
   * Reads one Plan and proves the caller may perform `operation` on it.
   *
   * The read and the proof are always paired: there is no way to get a Plan out
   * of this module without one, so an unauthorized caller's every outcome is the
   * same opaque refusal - no content, no count, no existence signal.
   */
  async function provenPlan(input: {
    callerUserId: string;
    planId: string;
    operation: "view" | "update" | "archive";
  }): Promise<HouseholdEventPlan> {
    const plan = await deps.plans.getPlan({ planId: input.planId });
    if (!plan) throw new HouseholdRecordUnavailableError();
    await deps.prover.requireRecordAccess({
      callerUserId: input.callerUserId,
      operation: input.operation,
      record: planFacts(plan),
    });
    return plan;
  }

  /**
   * Keeps only the links whose target the caller may currently see, and dresses
   * each survivor with that target's own name.
   *
   * Proved on every read rather than trusted from when the link was made,
   * because the target's audience can narrow after the fact - a Follow-Up
   * re-scoped to private, a member removed from a selected audience. A refused
   * link leaves nothing behind, so the Plan does not report that a record the
   * caller cannot see exists.
   *
   * The title comes from the same read that produced the authorization facts and
   * is attached only after the proof grants the link, so it travels exactly as
   * far as the link itself does and never one step further.
   */
  async function visibleLinks(
    callerUserId: string,
    links: readonly HouseholdEventPlanLink[],
  ): Promise<HouseholdEventPlanProvedLink[]> {
    if (links.length === 0) return [];

    const facts = await Promise.all(
      links.map(async (link) => {
        const target = await deps.linkTargets.readFacts({
          linkKind: link.linkKind,
          recordId: link.recordId,
        });
        return target ? { link, target } : null;
      }),
    );
    const present = facts.filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    const grants = await deps.prover.proveVisibleRecords({
      callerUserId,
      operation: "view",
      records: present.map(({ link, target }) => ({
        kind: link.linkKind,
        id: link.recordId,
        ownerUserId: target.ownerUserId,
        scope: target.scope,
        householdId: target.householdId,
      })),
    });

    const granted = new Set(grants.map((grant) => `${grant.subjectKind}:${grant.subjectId}`));
    return present
      .filter(({ link }) => granted.has(`${link.linkKind}:${link.recordId}`))
      .map(({ link, target }) => ({ ...link, title: target.title }));
  }

  function writeFrom(draft: HouseholdEventPlanDraft): HouseholdEventPlanWrite {
    const normalized = normalizeHouseholdEventPlanDraft(draft);
    return {
      title: normalized.title,
      details: normalized.details,
      plannedFor: normalized.plannedFor,
      calendarConnectionId: normalized.calendarEvent?.connectionId ?? null,
      calendarId: normalized.calendarEvent?.calendarId ?? null,
      calendarProviderEventId: normalized.calendarEvent?.providerEventId ?? null,
    };
  }

  /** Applies a fenced write, turning a lost fence into the conflict a member sees. */
  async function fencedWrite(input: {
    planId: string;
    expectedVersion: number;
    actorUserId: string;
    patch: Parameters<HouseholdEventPlanStore["applyPlanWrite"]>[0]["patch"];
  }): Promise<HouseholdEventPlan> {
    const updated = await deps.plans.applyPlanWrite({
      planId: input.planId,
      expectedVersion: input.expectedVersion,
      actorUserId: input.actorUserId,
      at: now(),
      patch: input.patch,
    });
    if (updated) return updated;

    // The fence did not hold. Re-read so the member is shown the value that beat
    // them and who wrote it; their own draft is kept by the surface.
    const current = await deps.plans.getPlan({ planId: input.planId });
    if (!current) throw new HouseholdRecordUnavailableError();
    throw new HouseholdEventPlanConflictError(current);
  }

  return {
    /** This household's Plans, newest-relevant first, with each caller's visible links. */
    async listHouseholdEventPlans(input: {
      callerUserId: string;
      status?: HouseholdEventPlanStatus;
    }): Promise<HouseholdEventPlanWithLinks[]> {
      const householdId = await requireActiveHousehold(input.callerUserId);
      const plans = await deps.plans.listPlans({ householdId, status: input.status });
      if (plans.length === 0) return [];

      // Composition proof: an unproven Plan is dropped, never marked.
      const grants = await deps.prover.proveVisibleRecords({
        callerUserId: input.callerUserId,
        operation: "view",
        records: plans.map(planFacts),
      });
      const granted = new Set(grants.map((grant) => grant.subjectId));
      const visible = plans.filter((plan) => granted.has(plan.id));

      const links = await deps.plans.listLinks({ planIds: visible.map((plan) => plan.id) });
      const provenLinks = await visibleLinks(input.callerUserId, links);

      return visible.map((plan) => ({
        plan,
        links: provenLinks.filter((link) => link.planId === plan.id),
      }));
    },

    async getHouseholdEventPlan(input: {
      callerUserId: string;
      planId: string;
    }): Promise<HouseholdEventPlanWithLinks> {
      const plan = await provenPlan({ ...input, operation: "view" });
      const links = await deps.plans.listLinks({ planIds: [plan.id] });
      return { plan, links: await visibleLinks(input.callerUserId, links) };
    },

    /**
     * Creates a Plan, from explicit household intent or from a member choosing
     * "Plan this event" on a Household Calendar Event.
     *
     * Both routes are this one mutation. A calendar event contributes only its
     * address; a Plan created from one is not seeded with the event's title,
     * time, or attendees, because a Plan that started as a copy would be a
     * mirror on its first day.
     *
     * The one entry point here that takes no Authorization Proof, and it is not
     * an omission: a proof decides one caller's operation on one record's stored
     * facts, and there is no record yet to have any. What authorizes a creation
     * is active membership in the household it lands in, which
     * `requireActiveHousehold` reads fresh from the caller's own memberships on
     * every call. Every later operation on the resulting Plan is proved.
     */
    async createHouseholdEventPlan(input: {
      callerUserId: string;
      draft: HouseholdEventPlanDraft;
    }): Promise<HouseholdEventPlan> {
      const householdId = await requireActiveHousehold(input.callerUserId);
      const write = writeFrom(input.draft);
      return deps.plans.createPlan({
        ...write,
        householdId,
        actorUserId: input.callerUserId,
        at: now(),
      });
    },

    async updateHouseholdEventPlan(input: {
      callerUserId: string;
      planId: string;
      expectedVersion: number;
      draft: HouseholdEventPlanDraft;
    }): Promise<HouseholdEventPlan> {
      const plan = await provenPlan({
        callerUserId: input.callerUserId,
        planId: input.planId,
        operation: "update",
      });
      assertHouseholdEventPlanEditable(plan);

      return fencedWrite({
        planId: plan.id,
        expectedVersion: input.expectedVersion,
        actorUserId: input.callerUserId,
        patch: writeFrom(input.draft),
      });
    },

    /** Archive is the removal path; nobody here can permanently delete a Plan. */
    async archiveHouseholdEventPlan(input: {
      callerUserId: string;
      planId: string;
      expectedVersion: number;
    }): Promise<HouseholdEventPlan> {
      const plan = await provenPlan({
        callerUserId: input.callerUserId,
        planId: input.planId,
        operation: "archive",
      });
      if (plan.status === "archived") return plan;

      return fencedWrite({
        planId: plan.id,
        expectedVersion: input.expectedVersion,
        actorUserId: input.callerUserId,
        patch: { status: "archived", archivedAt: now() },
      });
    },

    /**
     * Brings an archived Plan back. Proved as `archive` rather than `update`
     * because it is the same authority moving the same lifecycle switch, in the
     * other direction - a caller who may not archive may not un-archive either.
     */
    async restoreHouseholdEventPlan(input: {
      callerUserId: string;
      planId: string;
      expectedVersion: number;
    }): Promise<HouseholdEventPlan> {
      const plan = await provenPlan({
        callerUserId: input.callerUserId,
        planId: input.planId,
        operation: "archive",
      });
      if (plan.status === "active") return plan;

      return fencedWrite({
        planId: plan.id,
        expectedVersion: input.expectedVersion,
        actorUserId: input.callerUserId,
        patch: { status: "active", archivedAt: null },
      });
    },

    /**
     * Links an existing record the caller can currently see.
     *
     * The caller's own view proof on the target is required, so a member cannot
     * pull a record into the household's shared surface that they were not
     * entitled to read. It is checked again on every read, because being able to
     * see it today does not mean the next reader can.
     */
    async linkHouseholdEventPlanRecord(input: {
      callerUserId: string;
      planId: string;
      linkKind: HouseholdEventPlanLinkKind;
      recordId: string;
    }): Promise<HouseholdEventPlanLink> {
      const plan = await provenPlan({
        callerUserId: input.callerUserId,
        planId: input.planId,
        operation: "update",
      });
      assertHouseholdEventPlanEditable(plan);

      const existing = await deps.plans.listLinks({ planIds: [plan.id] });
      if (existing.length >= HOUSEHOLD_EVENT_PLAN_LINK_LIMIT) {
        throw new HouseholdValidationError(
          `A plan can link up to ${HOUSEHOLD_EVENT_PLAN_LINK_LIMIT} records. Remove one to add another.`,
        );
      }

      const target = await deps.linkTargets.readFacts({
        linkKind: input.linkKind,
        recordId: input.recordId,
      });
      if (!target) throw new HouseholdRecordUnavailableError();
      await deps.prover.requireRecordAccess({
        callerUserId: input.callerUserId,
        operation: "view",
        record: {
          kind: input.linkKind,
          id: input.recordId,
          ownerUserId: target.ownerUserId,
          scope: target.scope,
          householdId: target.householdId,
        },
      });

      return deps.plans.createLink({
        planId: plan.id,
        linkKind: input.linkKind,
        recordId: input.recordId,
        linkedByUserId: input.callerUserId,
        at: now(),
      });
    },

    async unlinkHouseholdEventPlanRecord(input: {
      callerUserId: string;
      planId: string;
      linkId: string;
    }): Promise<{ removed: boolean }> {
      const plan = await provenPlan({
        callerUserId: input.callerUserId,
        planId: input.planId,
        operation: "update",
      });
      assertHouseholdEventPlanEditable(plan);
      return { removed: await deps.plans.deleteLink({ planId: plan.id, linkId: input.linkId }) };
    },

    /** Whether a Plan already references this calendar event, for "Plan this event". */
    async findPlanForCalendarEvent(input: {
      callerUserId: string;
      connectionId: string;
      providerEventId: string;
    }): Promise<HouseholdEventPlan | null> {
      const householdId = await requireActiveHousehold(input.callerUserId);
      const plans = await deps.plans.listPlans({ householdId, status: "active" });
      const match = plans.find((plan) => {
        const ref = householdEventPlanCalendarRef(plan);
        return (
          ref?.connectionId === input.connectionId && ref.providerEventId === input.providerEventId
        );
      });
      if (!match) return null;

      const proof = await deps.prover.proveRecordAccess({
        callerUserId: input.callerUserId,
        operation: "view",
        record: planFacts(match),
      });
      return proof.authorized ? match : null;
    },
  };
}

export type HouseholdEventPlanLifecycle = ReturnType<typeof createHouseholdEventPlanLifecycle>;
