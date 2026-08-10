import Link from "next/link";
import { Body, Caption } from "@/components/assistant-result-card";
import { GiftIcon, type Icon, ListTodoIcon, RepeatIcon } from "@/components/icons";
import type { GiftPlanRowView, HouseholdCheckinRowView } from "@/lib/eve/tool-result-view";

const FAMILY_ICON: Record<HouseholdCheckinRowView["family"], Icon> = {
  action: ListTodoIcon,
  routine: RepeatIcon,
  gift_plan: GiftIcon,
};

/**
 * One record on a Household check-in, in chat.
 *
 * Deliberately the same facts, in the same order, as the static check-in surface:
 * what kind of thing it is, its title as a canonical link, when it matters, whose
 * it is, and who said they are looking after it. Two renderings of one list that
 * described a record differently would be two answers to the same question, and
 * this is the surface where a member is least able to check.
 *
 * Attribution and responsibility stay text on one quiet line rather than pills.
 * A badge reads as a status the row is reporting, and neither of these is one:
 * "Household" says whose the record is, and a Responsibility Holder is a member's
 * own statement, never an assignment or a turn.
 */
export function EveCheckinRow({ record }: { record: HouseholdCheckinRowView }) {
  const FamilyIcon = FAMILY_ICON[record.family];
  return (
    <div className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
        <FamilyIcon aria-hidden className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Caption>{record.context}</Caption>
        <Link
          className="w-fit font-medium text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={record.href}
        >
          {record.title}
        </Link>
        <Caption>
          {record.timing}
          {" · "}
          {record.scopeLabel}
          {record.responsibility ? ` · ${record.responsibility}` : null}
        </Caption>
      </div>
    </div>
  );
}

/**
 * One Gift Plan the caller may see.
 *
 * Two facts carry the trust boundary here, and both are about the reader rather
 * than about anybody else. The occasion and its date say what the plan is for. The
 * authority line says whether the reader owns it — because a co-planner who cannot
 * change a plan's subject or audience should understand why, rather than
 * discovering it at the moment they try.
 *
 * What is absent is load-bearing: no co-planner list, no contributor names, no
 * Surprise Subject. The view carries none of them, so this component could not
 * render one if it tried (ADR 0216).
 */
export function EveGiftPlanRow({ plan }: { plan: GiftPlanRowView }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <Link
          className="font-medium text-sm hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          href={`/gift-plans/${plan.giftPlanId}`}
        >
          {plan.subjectName}
        </Link>
        <span className="text-muted-foreground text-xs">{plan.occasion}</span>
      </div>
      {plan.occasionOn ? <Body>{formatOccasion(plan.occasionOn)}</Body> : null}
      <Caption>
        {ideaSummary(plan)}
        {" · "}
        {/* The reader's own standing, said plainly. "Yours" and "Shared with you"
            are the two forms a Gift Plan takes for the person reading it, and the
            second explains an absent control rather than leaving it unexplained. */}
        {plan.isOwner ? "Yours" : "Shared with you"}
      </Caption>
    </div>
  );
}

/**
 * How much thinking is on a plan, without turning it into progress.
 *
 * Claims are reported only when there are any: "3 ideas · 1 claimed" helps
 * co-planners avoid buying the same blanket, while "3 ideas · 0 claimed" reads as
 * a score against a target nobody set.
 */
function ideaSummary(plan: GiftPlanRowView): string {
  const ideas = plan.ideaCount === 1 ? "1 idea" : `${plan.ideaCount} ideas`;
  if (plan.ideaCount === 0) return "No ideas yet";
  return plan.claimedIdeaCount > 0 ? `${ideas} · ${plan.claimedIdeaCount} claimed` : ideas;
}

/** The occasion's day, or the raw value when it is unparseable. */
function formatOccasion(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
