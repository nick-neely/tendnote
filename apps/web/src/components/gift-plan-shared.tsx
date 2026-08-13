import { CalendarIcon, CircleCheckIcon, EyeSlashIcon } from "@/components/icons";
import { VisibilityStatus } from "@/components/visibility-affordance";
import type { GiftPlanView } from "@/lib/gift-plan-view";

/** Fallback when a Gift Plan mutation fails for an unknown reason. */
export const GIFT_PLAN_GENERIC_ERROR = "That didn't go through. Try again.";

const CHIP =
  "inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground";

/**
 * Who can see the plan, said in a word and a glyph.
 *
 * Unlike the Action chip, a private Gift Plan *does* carry an indicator. Sharing
 * is the whole point of the feature, so "who else is in on this" is the fact a
 * reader scans for, and leaving the private case blank would make its absence
 * ambiguous rather than quiet.
 */
export function GiftPlanAudienceChip({ plan }: { plan: GiftPlanView }) {
  return (
    <VisibilityStatus privatePolicy="show" scope={plan.scope} selectedCount={plan.coPlannerCount} />
  );
}

/**
 * The plan's one important moment.
 *
 * Clay, once per row, and never color alone — the glyph and the word carry it on
 * their own. It says the state plainly rather than celebrating it; a surprise is
 * a responsibility the reader is holding, not a party the interface is throwing.
 */
export function GiftPlanSurpriseChip() {
  // No `title`. The word and the glyph already say it, and a tooltip is the one
  // place the detail would have been mouse-only — unreachable by keyboard and by
  // touch. The detail page states the promise in visible text instead.
  return (
    <span className={`${CHIP} border-transparent bg-accent-soft text-accent-soft-foreground`}>
      <EyeSlashIcon aria-hidden className="size-3 shrink-0" />
      Surprise
    </span>
  );
}

/**
 * Where the plan is in its life, for every viewer rather than only its owner.
 *
 * Before this, a co-planner could not see that a plan was celebrated — so they
 * had no way to understand why the claim control had gone, and, worse, no way to
 * notice they were claiming a gift for a party that had already happened. A word
 * and a glyph, never colour alone.
 *
 * Nothing renders while the plan is under way: that is the ordinary case, and a
 * chip on every row would be noise rather than information.
 */
export function GiftPlanStatusChip({ label }: { label: string | null }) {
  if (!label) return null;
  return (
    <span className={CHIP}>
      <CircleCheckIcon aria-hidden className="size-3 shrink-0" />
      {label}
    </span>
  );
}

/**
 * The calm line that stands where a control used to be.
 *
 * A disabled button explains nothing and reads as a small alarm; this says what
 * happened and the one move that undoes it. Deliberately not `role="alert"` —
 * nothing has gone wrong here.
 */
export function GiftPlanClosedNote({ reason }: { reason: string }) {
  return (
    <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
      {reason}
    </p>
  );
}

export function GiftPlanTimingChip({ label }: { label: string }) {
  return (
    <span className={CHIP}>
      <CalendarIcon aria-hidden className="size-3 shrink-0" />
      {label}
    </span>
  );
}

/**
 * What surprise protection actually promises, in one sentence, where the owner
 * decides.
 *
 * The product's most load-bearing claim is that the subject cannot reach the
 * plan anywhere, so it is stated concretely — the surfaces, by name — rather
 * than as reassurance. Warm through restraint: no exclamation, no "don't worry",
 * no gift-wrap language.
 */
export function GiftPlanSurpriseNote({ name }: { name: string | null }) {
  return (
    <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
      {name ? `${name} won't` : "They won't"} see this plan, its ideas, or any mention of it — not
      in lists, search, reminders, or a link someone sends them.
    </p>
  );
}
