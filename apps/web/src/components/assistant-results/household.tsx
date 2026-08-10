import { assistantToolResultSchemas, captureOutcomeAudiences } from "@tendnote/domain";
import { Caption, ResultCard } from "@/components/assistant-result-card";
import { EveCheckinRow, EveGiftPlanRow } from "@/components/eve-household-cards";
import { GiftIcon, HomeIcon, LockIcon } from "@/components/icons";
import { defineModule } from "./module";
import { ToolActivityLine } from "./shells";

/**
 * The three household-aware Eve results, and the Capture confirmation.
 *
 * These carry the highest privacy stakes of any card on the surface: what a
 * Household check-in shows depends on a proof, what a Gift Plan row omits depends
 * on an exclusion, and which audience a Capture wrote with depends on a fork the
 * caller chose. A generic dot for all of them made success, empty, and failure
 * visually identical — so a member could not tell "the household is quiet" from
 * "the read failed", and could not check "saved to your household" against what
 * was actually written.
 *
 * Every fact these cards render is one the persisted record already carries. None
 * of them re-derives an audience, and none renders anything about another member
 * beyond the attribution the record itself states.
 */

/**
 * The Household check-in in chat.
 *
 * Three honest states, visually distinct on purpose. A member who has not opted in
 * gets a quiet line rather than an offer — the offer lives on Household, where the
 * decision belongs, and a chat card nagging for it would be the manufactured task
 * the decision doc rules out. A member with no household gets the same neutral
 * absence. A failed family says so in its own words, because "nothing is timely"
 * and "we could not look" are different facts and a member reading the wrong one
 * would believe a shared chore had been dealt with.
 */
export const householdCheckinModule = defineModule<"household_check_in">({
  kind: "household_check_in",
  parsers: {
    household_check_in: (output) => {
      const parsed = assistantToolResultSchemas.household_check_in.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "household_check_in",
        householdName: parsed.data.household?.name ?? null,
        optedIn: parsed.data.optedIn,
        records: parsed.data.records.map((record) => ({
          recordId: record.recordId,
          family: record.family,
          href: record.href,
          title: record.title,
          context: record.context,
          timing: record.timing,
          scopeLabel: record.scopeLabel,
          responsibility: record.responsibility,
        })),
        limitations: parsed.data.limitations,
      };
    },
  },
  // A card only when there is something to read. An empty or unavailable check-in
  // recedes to a line: it is news about nothing, and a card would give it weight
  // the household never earned.
  tier: (view) => (view.records.length > 0 ? "card" : "line"),
  key: (view) => `household-check-in:${view.records.map((record) => record.recordId).join("|")}`,
  render: (view, isNew) => {
    if (view.records.length === 0) {
      return (
        <ToolActivityLine icon={<HomeIcon aria-hidden className="size-3.5" />} isNew={isNew}>
          {checkinAbsenceCopy(view)}
        </ToolActivityLine>
      );
    }

    return (
      <ResultCard
        footer={
          <Caption>
            {/* The boundary, in words, on every card: this is one member's view of
                shared records, not a report about the household. */}
            {view.householdName
              ? `What ${view.householdName} is coordinating, as you can see it`
              : "What your household is coordinating, as you can see it"}
          </Caption>
        }
        icon={<HomeIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label="Household check-in"
        tone="neutral"
      >
        <div className="flex flex-col divide-y divide-border/70">
          {view.records.map((record) => (
            <EveCheckinRow key={record.recordId} record={record} />
          ))}
        </div>
        {view.limitations.map((limitation) => (
          <p
            className="pt-2 text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]"
            key={limitation}
          >
            {limitation}
          </p>
        ))}
      </ResultCard>
    );
  },
});

/**
 * What a check-in with no rows honestly says.
 *
 * Three different absences, three different sentences, and never the word
 * "hidden": a member who has not opted in has made a choice, a member with no
 * household has no surface at all, and a member whose household is quiet is
 * looking at good news.
 */
function checkinAbsenceCopy(view: {
  optedIn: boolean;
  householdName: string | null;
  limitations: string[];
}): string {
  if (view.limitations.length > 0) return view.limitations[0] ?? "The check-in is unavailable";
  if (!view.optedIn) return "No household check-in on your brief";
  if (!view.householdName) return "No household";
  return `Nothing timely in ${view.householdName} right now`;
}

/**
 * The Gift Plans a caller may see.
 *
 * The card is deliberately incapable of saying anything about who else is on a
 * plan: the view carries no co-planner, no member name, and no Surprise Subject
 * flag, so there is no field a renderer could reach for. An empty result is a
 * plain line with no hedge — "no gift plans" reads identically for someone with
 * none and for the person a plan is a surprise for, which is the whole of ADR 0216
 * as this surface experiences it.
 */
export const giftPlanSearchModule = defineModule<"gift_plan_search">({
  kind: "gift_plan_search",
  parsers: {
    search_gift_plans: (output) => {
      const parsed = assistantToolResultSchemas.search_gift_plans.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "gift_plan_search",
        query: parsed.data.query,
        plans: parsed.data.plans.map((plan) => ({ ...plan })),
      };
    },
  },
  tier: (view) => (view.plans.length > 0 ? "card" : "line"),
  key: (view) => `gift-plan-search:${view.plans.map((plan) => plan.giftPlanId).join("|")}`,
  render: (view, isNew) => {
    if (view.plans.length === 0) {
      return (
        <ToolActivityLine icon={<GiftIcon aria-hidden className="size-3.5" />} isNew={isNew}>
          No gift plans
        </ToolActivityLine>
      );
    }

    return (
      <ResultCard
        icon={<GiftIcon className="size-3" />}
        isNew={isNew}
        kind={view.kind}
        label={view.plans.length === 1 ? "1 gift plan" : `${view.plans.length} gift plans`}
        tone="neutral"
      >
        <div className="flex flex-col divide-y divide-border/70">
          {view.plans.map((plan) => (
            <EveGiftPlanRow key={plan.giftPlanId} plan={plan} />
          ))}
        </div>
      </ResultCard>
    );
  },
});

/** One idea added to a plan, on the caller's explicit say-so. */
export const giftIdeaAddedModule = defineModule<"gift_idea_added">({
  kind: "gift_idea_added",
  parsers: {
    add_gift_idea: (output) => {
      const parsed = assistantToolResultSchemas.add_gift_idea.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "gift_idea_added",
        giftIdeaId: parsed.data.giftIdeaId,
        giftPlanId: parsed.data.giftPlanId,
        title: parsed.data.title,
      };
    },
  },
  tier: () => "line",
  key: (view) => `gift-idea-added:${view.giftIdeaId}`,
  render: (view, isNew) => (
    <ToolActivityLine icon={<GiftIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      Added <span className="text-foreground">{view.title}</span> to the plan
    </ToolActivityLine>
  ),
});

/**
 * What an explicit Capture wrote, and who can see it.
 *
 * The audience is the reason this card exists. Capture's household branch is a
 * privacy-consequential fork, and until now it was confirmed only by Eve's prose —
 * so a member had no way to tell a private save described as shared from a shared
 * save described as private. This renders the visibility the record was actually
 * written with, from the persisted outcome, beside the destination it went to.
 *
 * A line rather than a card: the save already happened and the user asked for it.
 * The visibility is the one fact worth reading, and it is on every row.
 */
export const captureOutcomeModule = defineModule<"capture_outcome">({
  kind: "capture_outcome",
  parsers: {
    capture_saved_item: (output) => {
      const parsed = assistantToolResultSchemas.capture_saved_item.safeParse(output);
      if (!parsed.success) return null;
      return {
        kind: "capture_outcome",
        destination: parsed.data.confirmation.destination,
        // The domain flattens a grouped capture and knows which field each
        // destination keeps its audience on. The card only renders it.
        outcomes: captureOutcomeAudiences(parsed.data.confirmation),
      };
    },
  },
  tier: () => "line",
  key: (view) =>
    `capture-outcome:${view.destination}:${view.outcomes.map((outcome) => outcome.visibility).join("|")}`,
  render: (view, isNew) => (
    <ToolActivityLine icon={<LockIcon aria-hidden className="size-3.5" />} isNew={isNew}>
      {view.outcomes.map((outcome, index) => (
        <span key={`${outcome.destination}:${outcome.visibility}`}>
          {index > 0 ? " · " : null}
          Saved to {outcome.destination}
          {" · "}
          {/* Full-strength ink on the audience alone. It is the fact a member is
              here to check, and the one the surrounding prose cannot be trusted
              to have got right. */}
          <span className="text-foreground">{outcome.visibility}</span>
        </span>
      ))}
    </ToolActivityLine>
  ),
});
