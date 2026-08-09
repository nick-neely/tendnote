import type {
  GiftIdea,
  GiftPlan,
  GiftPlanEventKind,
  GiftPlanStatus,
  PrivacyScope,
} from "@tendnote/domain";
import {
  assertAudienceExcludesSurpriseSubject,
  assertGiftIdeaContributor,
  assertGiftPlanOpen,
  assertGiftRecordFresh,
  assertSurpriseSubjectEligible,
  audienceWithoutSurpriseSubject,
  createGiftIdeaSchema,
  createGiftPlanSchema,
  GiftPlanConflictError,
  GiftPlanValidationError,
  giftIdeaUpdateSchema,
  giftPlanExclusions,
  giftPlanUpdateSchema,
  HouseholdRecordUnavailableError,
  resolveGiftIdeaClaim,
  resolveGiftPlanTransition,
} from "@tendnote/domain";
import type { MutationOutcome } from "../affected-scopes";
import {
  createHouseholdAuthorizationProver,
  type HouseholdRecordFacts,
} from "../households/authorization";
import { resolveRecordVisibility } from "../households/record-visibility";
import { affectedScopesForGiftPlan } from "./affected-scopes";
import type { GiftPlanDetail, GiftPlanLifecycleStore, GiftPlanWithContext } from "./types";

export type GiftPlanLifecycleOptions = { now?: () => Date };

const VISIBILITY_WORDING = {
  recordNoun: "plan",
  recordNounWithArticle: "a plan",
  fail: (message: string) => new GiftPlanValidationError(message),
};

/**
 * The one owner-scoped Gift Plan query and mutation layer.
 *
 * Everything the product does with a Gift Plan happens here, and every entry
 * point — read, write, count, search, provenance — obtains a Household
 * Authorization Proof before it returns or changes anything. Web, Eve, Capture,
 * Review, Search, Household, Today, and reminders are meant to be thin adapters
 * over this seam and are never to reach the tables themselves
 * (docs/phase-8/household-gift-ideas-and-birthday-planning.md, "Implementation
 * boundary").
 *
 * That is not an aesthetic preference. The shared visibility predicate every
 * other record family reads through can see ownership, scope, membership, and
 * shares — and structurally cannot see a domain exclusion. A Gift Plan whose
 * Surprise Subject was enforced by that predicate alone would be safe on the
 * list it was written for and leak on the next surface someone added. So the
 * exclusion is enforced twice, in the two languages it has to hold in: the store
 * refuses to emit a protected row to the person it protects against, and the
 * proof refuses it again, from facts read at that moment, before any caller sees
 * it (ADR 0216, ADR 0219).
 *
 * Refusal is always the same: `null`, an empty list, a zero, or one opaque
 * error. Nothing here reports that a record exists but is withheld — no
 * placeholder, no "1 hidden", no gap in a count. A Surprise Subject reading
 * their household's plans sees exactly what someone with no plans sees.
 */
export function createGiftPlanLifecycle(
  store: GiftPlanLifecycleStore,
  options: GiftPlanLifecycleOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const prover = createHouseholdAuthorizationProver(store.households);

  /**
   * A plan described as policy is allowed to see it.
   *
   * `excludedUserIds` is derived from the stored column through the domain, not
   * accepted from a caller, so there is no argument shape by which a route,
   * tool, cached page, or queued job can hand over a plan whose protection was
   * dropped on the way. `lifecycle` stays `active` because a Gift Plan has no
   * terminal state short of deletion — archived is history the owner can still
   * open, which is the domain's own rule and not a Household privacy question.
   */
  function giftPlanFacts(plan: GiftPlan): HouseholdRecordFacts {
    return {
      kind: "gift_plan",
      id: plan.id,
      ownerUserId: plan.ownerUserId,
      scope: plan.scope,
      householdId: plan.householdId,
      ownership: "member_owned",
      excludedUserIds: giftPlanExclusions(plan),
    };
  }

  async function currentAudience(plan: GiftPlan): Promise<string[]> {
    if (plan.scope !== "shared" || !plan.householdId) return [];
    const shares = await store.households.listHouseholdRecordShares({
      householdId: plan.householdId,
      recordKind: "gift_plan",
      recordId: plan.id,
    });
    return shares.map((share) => share.sharedWithUserId);
  }

  /**
   * Turns proved plans into what a caller may hold.
   *
   * Batched deliberately: counts and audiences are read once for the whole set,
   * so a listing costs a fixed number of queries and every number in it comes
   * from the same moment as the plan it sits on.
   */
  async function hydrate(
    plans: readonly GiftPlan[],
    callerUserId: string,
  ): Promise<GiftPlanWithContext[]> {
    if (plans.length === 0) return [];

    const householdIds = [
      ...new Set(plans.map((plan) => plan.householdId).filter((id): id is string => Boolean(id))),
    ];
    const [counts, shares, households] = await Promise.all([
      store.plans.countGiftIdeasForPlans({ giftPlanIds: plans.map((plan) => plan.id) }),
      householdIds.length
        ? store.households.listHouseholdRecordSharesForRecords({
            householdIds,
            recordKind: "gift_plan",
            recordIds: plans.map((plan) => plan.id),
          })
        : Promise.resolve([]),
      Promise.all(
        householdIds.map((householdId) => store.households.getHouseholdWorkspace({ householdId })),
      ),
    ]);

    const countByPlan = new Map(counts.map((count) => [count.giftPlanId, count]));
    const householdNameById = new Map(
      households.filter((household) => household !== null).map((h) => [h.id, h.name]),
    );
    const audienceByPlan = new Map<string, string[]>();
    for (const share of shares) {
      audienceByPlan.set(share.recordId, [
        ...(audienceByPlan.get(share.recordId) ?? []),
        share.sharedWithUserId,
      ]);
    }

    return plans.map((plan) => ({
      ...plan,
      // The owner's convenience link home, and only ever theirs: it never grants
      // a co-planner access to the Person, their birthday, memories, or Assets,
      // so it does not travel to one.
      subjectPersonId: plan.ownerUserId === callerUserId ? plan.subjectPersonId : null,
      householdName: plan.householdId ? (householdNameById.get(plan.householdId) ?? null) : null,
      sharedWithUserIds: plan.scope === "shared" ? (audienceByPlan.get(plan.id) ?? []) : [],
      ideaCount: countByPlan.get(plan.id)?.ideaCount ?? 0,
      claimedIdeaCount: countByPlan.get(plan.id)?.claimedIdeaCount ?? 0,
    }));
  }

  /**
   * Loads one plan and proves the exact operation about to happen on it.
   *
   * A plan that does not exist and a plan the caller may not touch raise the
   * same error, because the difference between them is the protected fact.
   */
  async function requirePlan(input: {
    callerUserId: string;
    giftPlanId: string;
    operation: "view" | "update" | "change_audience" | "archive";
  }): Promise<GiftPlan> {
    const plan = await store.plans.getGiftPlanById({ giftPlanId: input.giftPlanId });
    if (!plan) throw new HouseholdRecordUnavailableError();
    await prover.requireRecordAccess({
      callerUserId: input.callerUserId,
      operation: input.operation,
      record: giftPlanFacts(plan),
    });
    return plan;
  }

  /**
   * The standing a contribution rests on: the plan's audience, plus the idea's
   * own contributor rule.
   *
   * The proof asked for is `view`, because adding, editing, or claiming inside a
   * plan is not authority *over* the plan — that stays with its owner, whose
   * `update` and `change_audience` a co-planner never holds. Splitting it this
   * way is what lets a co-planner contribute without being able to re-address,
   * re-subject, or end someone else's plan, and it keeps the Surprise Subject
   * refused at exactly the same gate as on a read.
   */
  async function requireContributablePlan(input: {
    actorUserId: string;
    giftPlanId: string;
  }): Promise<GiftPlan> {
    const plan = await requirePlan({
      callerUserId: input.actorUserId,
      giftPlanId: input.giftPlanId,
      operation: "view",
    });
    assertGiftPlanOpen(plan);
    return plan;
  }

  async function record(
    giftPlanId: string,
    kind: GiftPlanEventKind,
    actorUserId: string | null,
    detailJson: Record<string, unknown> = {},
  ) {
    await store.plans.createGiftPlanEvent({ giftPlanId, kind, actorUserId, detailJson });
  }

  async function outcome(
    plan: GiftPlan,
    callerUserId: string,
    previousAudienceUserIds: readonly string[] = [],
    previousSurpriseSubjectUserId: string | null = null,
  ): Promise<MutationOutcome<GiftPlanWithContext>> {
    const [hydrated] = await hydrate([plan], callerUserId);
    if (!hydrated) throw new HouseholdRecordUnavailableError();
    return {
      result: hydrated,
      affectedScopes: affectedScopesForGiftPlan({
        giftPlanId: plan.id,
        ownerUserId: plan.ownerUserId,
        audienceUserIds: hydrated.sharedWithUserIds,
        previousAudienceUserIds,
        surpriseSubjectUserIds: [plan.surpriseSubjectUserId, previousSurpriseSubjectUserId],
      }),
    };
  }

  /** Replaces one plan's selected audience, dropping every share it no longer has. */
  async function writeAudience(input: {
    plan: GiftPlan;
    scope: PrivacyScope;
    householdId: string | null;
    selectedUserIds: readonly string[];
    actorUserId: string;
  }) {
    if (input.plan.householdId) {
      await store.households.deleteHouseholdRecordShares({
        householdId: input.plan.householdId,
        recordKind: "gift_plan",
        recordId: input.plan.id,
      });
    }
    if (input.scope !== "shared" || !input.householdId) return;
    for (const sharedWithUserId of input.selectedUserIds) {
      await store.households.createHouseholdRecordShare({
        householdId: input.householdId,
        recordKind: "gift_plan",
        recordId: input.plan.id,
        sharedWithUserId,
        sharedByUserId: input.plan.ownerUserId,
      });
    }
  }

  /**
   * Narrow in storage, then prove every surviving row, then hydrate.
   *
   * The list, the search, and the count are all this function with different
   * arguments — deliberately, because three copies of "which plans may this
   * caller see" is three chances for one of them to be the lenient one. A count
   * that disagreed with its list by a single number would tell a Surprise
   * Subject exactly the fact the exclusion exists to withhold.
   *
   * An unproved row leaves nothing behind: no entry, no placeholder, no gap in
   * the length.
   */
  async function provedPlans(input: {
    callerUserId: string;
    statuses?: readonly GiftPlanStatus[];
    query?: string;
    limit?: number;
  }): Promise<GiftPlanWithContext[]> {
    const candidates = await store.plans.listGiftPlanCandidates(input);
    const grants = await prover.proveVisibleRecords({
      callerUserId: input.callerUserId,
      operation: "view",
      records: candidates.map(giftPlanFacts),
    });
    const proved = new Set(grants.map((grant) => grant.subjectId));
    return hydrate(
      candidates.filter((plan) => proved.has(plan.id)),
      input.callerUserId,
    );
  }

  async function activeMemberUserIds(householdId: string): Promise<string[]> {
    const memberships = await store.households.listHouseholdMemberships({
      householdId,
      status: "active",
    });
    return memberships.map((membership) => membership.userId);
  }

  return {
    /**
     * Starts a plan. Private unless the owner deliberately widened it, and
     * protected only if they deliberately named a subject — nothing here infers
     * either (ADR 0153: widening is always explicit).
     */
    async createGiftPlan(input: {
      ownerUserId: string;
      subjectName: string;
      occasion: string;
      occasionOn?: Date | null;
      subjectPersonId?: string | null;
      surpriseSubjectUserId?: string | null;
      scope?: PrivacyScope;
      householdId?: string | null;
      selectedUserIds?: string[];
    }): Promise<MutationOutcome<GiftPlanWithContext>> {
      const selectedUserIds = input.selectedUserIds ?? [];
      assertAudienceExcludesSurpriseSubject({
        surpriseSubjectUserId: input.surpriseSubjectUserId ?? null,
        selectedUserIds,
      });

      const visibility = await resolveRecordVisibility(
        store.households,
        {
          ownerUserId: input.ownerUserId,
          scope: input.scope,
          householdId: input.householdId,
          selectedUserIds,
        },
        VISIBILITY_WORDING,
      );

      if (input.surpriseSubjectUserId) {
        if (!visibility.householdId) {
          throw new GiftPlanValidationError(
            "Surprise protection is for someone in your household. Share the plan with your household first.",
          );
        }
        assertSurpriseSubjectEligible({
          ownerUserId: input.ownerUserId,
          surpriseSubjectUserId: input.surpriseSubjectUserId,
          activeMemberUserIds: await activeMemberUserIds(visibility.householdId),
        });
      }

      const plan = await store.plans.createGiftPlan(
        createGiftPlanSchema.parse({
          ownerUserId: input.ownerUserId,
          subjectName: input.subjectName,
          occasion: input.occasion,
          occasionOn: input.occasionOn ?? null,
          subjectPersonId: input.subjectPersonId ?? null,
          surpriseSubjectUserId: input.surpriseSubjectUserId ?? null,
          scope: visibility.scope,
          householdId: visibility.householdId,
        }),
      );

      await writeAudience({
        plan,
        scope: visibility.scope,
        householdId: visibility.householdId,
        selectedUserIds,
        actorUserId: input.ownerUserId,
      });
      await record(plan.id, "created", input.ownerUserId, { occasion: plan.occasion });
      if (plan.surpriseSubjectUserId) {
        await record(plan.id, "surprise_protected", input.ownerUserId);
      }
      return outcome(plan, input.ownerUserId);
    },

    /**
     * One plan, or `null`.
     *
     * `null` covers "no such plan", "not shared with you", "you left that
     * household", and "this is a surprise for you" without distinguishing them,
     * which is what makes a deep link to a protected plan indistinguishable from
     * a deep link to nothing.
     */
    async getGiftPlan(input: {
      callerUserId: string;
      giftPlanId: string;
    }): Promise<GiftPlanWithContext | null> {
      const plan = await store.plans.getGiftPlanById({ giftPlanId: input.giftPlanId });
      if (!plan) return null;
      const proof = await prover.proveRecordAccess({
        callerUserId: input.callerUserId,
        operation: "view",
        record: giftPlanFacts(plan),
      });
      if (!proof.authorized) return null;
      const [hydrated] = await hydrate([plan], input.callerUserId);
      return hydrated ?? null;
    },

    /**
     * The plans a caller may see, proved one by one.
     *
     * The store has already refused to emit a plan this caller is the Surprise
     * Subject of; every surviving row is proved again anyway, from memberships
     * and shares read now, and an unproved row leaves nothing behind — no entry,
     * no placeholder, and no gap in the length of the list.
     */
    listGiftPlans(input: {
      callerUserId: string;
      includeArchived?: boolean;
      limit?: number;
    }): Promise<GiftPlanWithContext[]> {
      return provedPlans({
        callerUserId: input.callerUserId,
        statuses: input.includeArchived ? undefined : ["active", "celebrated"],
        limit: input.limit,
      });
    },

    /**
     * Text search over the plans a caller may see.
     *
     * It is the same narrow-then-prove path as the listing rather than a second
     * one, so Search cannot come to a different answer about who may see a plan
     * than the surface it links to. A Surprise Subject searching their own
     * surprise gets no result and no existence signal.
     */
    async searchGiftPlans(input: {
      callerUserId: string;
      query: string;
      limit?: number;
    }): Promise<GiftPlanWithContext[]> {
      const query = input.query.trim();
      if (!query) return [];
      return provedPlans({ callerUserId: input.callerUserId, query, limit: input.limit ?? 20 });
    },

    /**
     * How many plans the caller has waiting, derived from the proved list rather
     * than counted in SQL.
     *
     * A count computed from a separate query is a second implementation of
     * visibility, and the one that leaks: "you have 3" beside a list of 2 tells
     * the Surprise Subject exactly what they must not learn.
     */
    async countGiftPlans(input: { callerUserId: string }): Promise<number> {
      return (
        await provedPlans({
          callerUserId: input.callerUserId,
          statuses: ["active", "celebrated"],
        })
      ).length;
    },

    /**
     * A plan with its ideas and its quiet provenance, behind one proof.
     *
     * Ideas and events carry no scope of their own — their audience is the
     * plan's — so proving the plan is the whole decision, and there is no second
     * rule that could drift away from it.
     */
    async getGiftPlanDetail(input: {
      callerUserId: string;
      giftPlanId: string;
    }): Promise<GiftPlanDetail | null> {
      const plan = await store.plans.getGiftPlanById({ giftPlanId: input.giftPlanId });
      if (!plan) return null;
      const proof = await prover.proveRecordAccess({
        callerUserId: input.callerUserId,
        operation: "view",
        record: giftPlanFacts(plan),
      });
      if (!proof.authorized) return null;

      const [hydratedPlans, ideas, events] = await Promise.all([
        hydrate([plan], input.callerUserId),
        store.plans.listGiftIdeas({ giftPlanId: plan.id }),
        store.plans.listGiftPlanEvents({ giftPlanId: plan.id, limit: 50 }),
      ]);
      const hydrated = hydratedPlans[0];
      return hydrated ? { plan: hydrated, ideas, events } : null;
    },

    /** The owner's own edits to what the plan is about. */
    async editGiftPlan(input: {
      actorUserId: string;
      giftPlanId: string;
      edit: { subjectName?: string; occasion?: string; occasionOn?: Date | null };
      expectedRevision?: number | null;
    }): Promise<MutationOutcome<GiftPlanWithContext>> {
      const plan = await requirePlan({
        callerUserId: input.actorUserId,
        giftPlanId: input.giftPlanId,
        operation: "update",
      });
      assertGiftPlanOpen(plan);
      assertGiftRecordFresh({
        expectedRevision: input.expectedRevision,
        current: plan,
        currentValue: `${plan.subjectName} · ${plan.occasion}`,
        message: "This plan changed while you were editing.",
      });

      const updated = await store.plans.updateGiftPlan({
        giftPlanId: plan.id,
        patch: giftPlanUpdateSchema.parse({ ...input.edit, lastActorUserId: input.actorUserId }),
      });
      await record(plan.id, "edited", input.actorUserId);
      return outcome(updated, input.actorUserId);
    },

    /**
     * Re-addresses the plan.
     *
     * The Surprise Subject is refused before the audience is resolved, so an
     * owner who tries to add them is told rather than quietly overruled — the
     * proof would deny them regardless, and being denied silently is how an
     * owner comes to believe a plan is shared when it is not (ADR 0216).
     */
    async setGiftPlanAudience(input: {
      actorUserId: string;
      giftPlanId: string;
      scope: PrivacyScope;
      householdId?: string | null;
      selectedUserIds?: string[];
    }): Promise<MutationOutcome<GiftPlanWithContext>> {
      const plan = await requirePlan({
        callerUserId: input.actorUserId,
        giftPlanId: input.giftPlanId,
        operation: "change_audience",
      });
      assertGiftPlanOpen(plan);
      const previousAudience = await currentAudience(plan);
      const selectedUserIds = input.selectedUserIds ?? [];
      assertAudienceExcludesSurpriseSubject({
        surpriseSubjectUserId: plan.surpriseSubjectUserId,
        selectedUserIds,
      });

      const visibility = await resolveRecordVisibility(
        store.households,
        {
          ownerUserId: plan.ownerUserId,
          scope: input.scope,
          householdId: input.householdId ?? plan.householdId,
          selectedUserIds,
        },
        VISIBILITY_WORDING,
      );

      await writeAudience({
        plan,
        scope: visibility.scope,
        householdId: visibility.householdId,
        selectedUserIds,
        actorUserId: input.actorUserId,
      });
      const updated = await store.plans.updateGiftPlan({
        giftPlanId: plan.id,
        patch: giftPlanUpdateSchema.parse({
          scope: visibility.scope,
          householdId: visibility.householdId,
          lastActorUserId: input.actorUserId,
        }),
      });
      await record(plan.id, "audience_changed", input.actorUserId, { scope: visibility.scope });
      return outcome(updated, input.actorUserId, previousAudience);
    },

    /**
     * Applies or lifts surprise protection.
     *
     * Applying it also revokes any share the subject already held, so protection
     * is fail-closed at the moment it is asked for rather than resting on an
     * audience that happens to be correct. Lifting it restores nothing: the
     * owner shares deliberately or not at all.
     */
    async setGiftPlanSurpriseSubject(input: {
      actorUserId: string;
      giftPlanId: string;
      surpriseSubjectUserId: string | null;
    }): Promise<MutationOutcome<GiftPlanWithContext>> {
      const plan = await requirePlan({
        callerUserId: input.actorUserId,
        giftPlanId: input.giftPlanId,
        operation: "change_audience",
      });
      assertGiftPlanOpen(plan);
      const previousAudience = await currentAudience(plan);
      const previousSubject = plan.surpriseSubjectUserId;

      if (input.surpriseSubjectUserId) {
        if (!plan.householdId) {
          throw new GiftPlanValidationError(
            "Surprise protection is for someone in your household. Share the plan with your household first.",
          );
        }
        assertSurpriseSubjectEligible({
          ownerUserId: plan.ownerUserId,
          surpriseSubjectUserId: input.surpriseSubjectUserId,
          activeMemberUserIds: await activeMemberUserIds(plan.householdId),
        });
        await writeAudience({
          plan,
          scope: plan.scope,
          householdId: plan.householdId,
          selectedUserIds: audienceWithoutSurpriseSubject({
            surpriseSubjectUserId: input.surpriseSubjectUserId,
            selectedUserIds: previousAudience,
          }),
          actorUserId: input.actorUserId,
        });
      }

      const updated = await store.plans.updateGiftPlan({
        giftPlanId: plan.id,
        patch: giftPlanUpdateSchema.parse({
          surpriseSubjectUserId: input.surpriseSubjectUserId,
          lastActorUserId: input.actorUserId,
        }),
      });
      await record(
        plan.id,
        input.surpriseSubjectUserId ? "surprise_protected" : "surprise_lifted",
        input.actorUserId,
      );
      return outcome(updated, input.actorUserId, previousAudience, previousSubject);
    },

    async setGiftPlanStatus(input: {
      actorUserId: string;
      giftPlanId: string;
      status: GiftPlanStatus;
    }): Promise<MutationOutcome<GiftPlanWithContext>> {
      const plan = await requirePlan({
        callerUserId: input.actorUserId,
        giftPlanId: input.giftPlanId,
        operation: "archive",
      });
      const kind = resolveGiftPlanTransition({ from: plan.status, to: input.status });
      const updated = await store.plans.updateGiftPlan({
        giftPlanId: plan.id,
        patch: giftPlanUpdateSchema.parse({
          status: input.status,
          lastActorUserId: input.actorUserId,
        }),
      });
      await record(plan.id, kind, input.actorUserId);
      return outcome(updated, input.actorUserId, await currentAudience(plan));
    },

    /**
     * Ends a plan for good.
     *
     * The plan and its idea content go; there is no hidden household archive to
     * keep them in. `archive` is the proof asked for because deletion is the
     * terminal member of that authority — the record's owner, and no one else,
     * decides a member-owned plan is over.
     */
    async deleteGiftPlan(input: {
      actorUserId: string;
      giftPlanId: string;
    }): Promise<MutationOutcome<{ giftPlanId: string }>> {
      const plan = await requirePlan({
        callerUserId: input.actorUserId,
        giftPlanId: input.giftPlanId,
        operation: "archive",
      });
      const audience = await currentAudience(plan);
      if (plan.householdId) {
        await store.households.deleteHouseholdRecordShares({
          householdId: plan.householdId,
          recordKind: "gift_plan",
          recordId: plan.id,
        });
      }
      await store.plans.deleteGiftPlan({ giftPlanId: plan.id });
      return {
        result: { giftPlanId: plan.id },
        affectedScopes: affectedScopesForGiftPlan({
          giftPlanId: plan.id,
          ownerUserId: plan.ownerUserId,
          previousAudienceUserIds: audience,
          surpriseSubjectUserIds: [plan.surpriseSubjectUserId],
        }),
      };
    },

    async addGiftIdea(input: {
      actorUserId: string;
      giftPlanId: string;
      title: string;
      note?: string | null;
      url?: string | null;
    }): Promise<MutationOutcome<GiftIdea>> {
      const plan = await requireContributablePlan(input);
      const idea = await store.plans.createGiftIdea(
        createGiftIdeaSchema.parse({
          giftPlanId: plan.id,
          contributorUserId: input.actorUserId,
          title: input.title,
          note: input.note ?? null,
          url: input.url ?? null,
        }),
      );
      await record(plan.id, "idea_added", input.actorUserId, { giftIdeaId: idea.id });
      return { result: idea, affectedScopes: await ideaScopes(plan) };
    },

    async editGiftIdea(input: {
      actorUserId: string;
      giftIdeaId: string;
      edit: { title?: string; note?: string | null; url?: string | null };
      expectedRevision?: number | null;
    }): Promise<MutationOutcome<GiftIdea>> {
      const { plan, idea } = await requireOwnContribution(input);
      assertGiftRecordFresh({
        expectedRevision: input.expectedRevision,
        current: idea,
        currentValue: idea.title,
        message: "This idea changed while you were editing.",
      });
      const updated = await store.plans.updateGiftIdea({
        giftIdeaId: idea.id,
        patch: giftIdeaUpdateSchema.parse({ ...input.edit, lastActorUserId: input.actorUserId }),
      });
      await record(plan.id, "idea_edited", input.actorUserId, { giftIdeaId: idea.id });
      return { result: updated, affectedScopes: await ideaScopes(plan) };
    },

    async removeGiftIdea(input: {
      actorUserId: string;
      giftIdeaId: string;
    }): Promise<MutationOutcome<{ giftIdeaId: string }>> {
      const { plan, idea } = await requireOwnContribution(input);
      await store.plans.deleteGiftIdea({ giftIdeaId: idea.id });
      await record(plan.id, "idea_removed", input.actorUserId, { giftIdeaId: idea.id });
      return { result: { giftIdeaId: idea.id }, affectedScopes: await ideaScopes(plan) };
    },

    /**
     * "I'll handle this", taken atomically.
     *
     * The domain decides, the store's conditional write enforces, and a caller
     * who lost the race is told who holds it so they can pick something else.
     * Nothing here assigns work, schedules anything, or counts who claimed more.
     */
    async claimGiftIdea(input: {
      actorUserId: string;
      giftIdeaId: string;
    }): Promise<MutationOutcome<GiftIdea>> {
      const { plan, idea } = await requireContributableIdea(input);
      resolveGiftIdeaClaim({ idea, actorUserId: input.actorUserId, intent: "claim" });
      if (idea.claimedByUserId === input.actorUserId) {
        return { result: idea, affectedScopes: await ideaScopes(plan) };
      }

      const claimed = await store.plans.claimGiftIdeaIfUnclaimed({
        giftIdeaId: idea.id,
        claimantUserId: input.actorUserId,
        at: now(),
      });
      if (!claimed) {
        const current = await store.plans.getGiftIdeaById({ giftIdeaId: idea.id });
        throw new GiftPlanConflictError("Someone else already said they'd handle this one.", {
          currentValue: current?.title ?? idea.title,
          actorUserId: current?.claimedByUserId ?? null,
          revision: current?.revision ?? idea.revision,
        });
      }
      await record(plan.id, "idea_claimed", input.actorUserId, { giftIdeaId: idea.id });
      return { result: claimed, affectedScopes: await ideaScopes(plan) };
    },

    async releaseGiftIdea(input: {
      actorUserId: string;
      giftIdeaId: string;
    }): Promise<MutationOutcome<GiftIdea>> {
      const { plan, idea } = await requireContributableIdea(input);
      resolveGiftIdeaClaim({ idea, actorUserId: input.actorUserId, intent: "release" });
      const released = await store.plans.updateGiftIdea({
        giftIdeaId: idea.id,
        patch: giftIdeaUpdateSchema.parse({
          claimedByUserId: null,
          claimedAt: null,
          lastActorUserId: input.actorUserId,
        }),
      });
      await record(plan.id, "idea_released", input.actorUserId, { giftIdeaId: idea.id });
      return { result: released, affectedScopes: await ideaScopes(plan) };
    },
  };

  async function ideaScopes(plan: GiftPlan) {
    return affectedScopesForGiftPlan({
      giftPlanId: plan.id,
      ownerUserId: plan.ownerUserId,
      audienceUserIds: await currentAudience(plan),
      surpriseSubjectUserIds: [plan.surpriseSubjectUserId],
    });
  }

  /** An idea inside a plan the caller may see, with the plan still open. */
  async function requireContributableIdea(input: { actorUserId: string; giftIdeaId: string }) {
    const idea = await store.plans.getGiftIdeaById({ giftIdeaId: input.giftIdeaId });
    if (!idea) throw new HouseholdRecordUnavailableError();
    const plan = await requireContributablePlan({
      actorUserId: input.actorUserId,
      giftPlanId: idea.giftPlanId,
    });
    return { plan, idea };
  }

  /** The same, narrowed to the caller's own contribution. */
  async function requireOwnContribution(input: { actorUserId: string; giftIdeaId: string }) {
    const { plan, idea } = await requireContributableIdea(input);
    assertGiftIdeaContributor({ idea, actorUserId: input.actorUserId });
    return { plan, idea };
  }
}

export type GiftPlanLifecycle = ReturnType<typeof createGiftPlanLifecycle>;
