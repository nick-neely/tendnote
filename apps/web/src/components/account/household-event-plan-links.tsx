import { HOUSEHOLD_EVENT_PLAN_LINK_LIMIT } from "@tendnote/domain/household-event-plans";
import type { RefObject } from "react";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  linkHouseholdEventPlanRecordAction as defaultLinkAction,
  unlinkHouseholdEventPlanRecordAction as defaultUnlinkAction,
  type HouseholdEventPlanResult,
} from "@/app/actions/household-event-plans";
import { LinkIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  buildHouseholdEventPlanLinkChoices,
  type HouseholdEventPlanLinkCandidate,
  type HouseholdEventPlanLinkChoiceGroup,
  type HouseholdEventPlanRecord,
  type HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import { HouseholdEventPlanErrorText } from "./household-event-plan-fields";
import type { HouseholdEventPlanActions } from "./household-event-plan-types";

type LinkWork = {
  work: () => Promise<HouseholdEventPlanResult>;
  announce: string;
};

function usePlanLinkController({
  plan,
  candidates,
  actions,
  onPlansChange,
  onAnnounce,
}: {
  plan: HouseholdEventPlanView;
  candidates: readonly HouseholdEventPlanLinkCandidate[];
  actions: HouseholdEventPlanActions;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const pickerRef = useRef<HTMLParagraphElement>(null);
  /** Whichever of the add control and the limit notice is on the screen. */
  const anchorRef = useRef<HTMLElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [settled, setSettled] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const full = plan.links.length >= HOUSEHOLD_EVENT_PLAN_LINK_LIMIT;
  const open = picking && !full;
  const choices = useMemo(
    () => buildHouseholdEventPlanLinkChoices({ candidates, links: plan.links }),
    [candidates, plan.links],
  );

  useEffect(() => {
    if (open) pickerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (settled === 0) return;
    // Both presses here remove themselves from the screen: the candidate leaves
    // the picker, the row leaves the list. Focus goes to whatever survived, and
    // this runs after that render so there is something left to land on.
    (pickerRef.current ?? anchorRef.current)?.focus();
  }, [settled]);

  function run(input: LinkWork) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await input.work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Links are not version-fenced, so only a saved view can arrive here.
        if (result.view.outcome === "saved") {
          onPlansChange(result.view.plans);
          onAnnounce(input.announce);
          setSettled((count) => count + 1);
        }
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return {
    anchorRef,
    choices,
    error,
    full,
    link: actions.link ?? defaultLinkAction,
    open,
    pending,
    pickerRef,
    run,
    setPicking,
    unlink: actions.unlink ?? defaultUnlinkAction,
  };
}

function PlanLinkRow({
  entry,
  archived,
  pending,
  onRemove,
}: {
  entry: HouseholdEventPlanView["links"][number];
  archived: boolean;
  pending: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t pt-1.5 first:border-t-0 first:pt-0">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        <LinkIcon aria-hidden className="size-3.5 shrink-0 self-center" />
        <span className="min-w-0 text-pretty">{entry.title}</span>
        <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
          {entry.kindLabel}
        </span>
      </span>
      {archived ? null : (
        <Button
          aria-label={`Remove ${entry.title}`}
          className="min-h-11 shrink-0 sm:min-h-8"
          disabled={pending}
          onClick={onRemove}
          size="sm"
          type="button"
          variant="ghost"
        >
          Remove
        </Button>
      )}
    </li>
  );
}

function LinkedPlanRecords({
  plan,
  pending,
  onRemove,
}: {
  plan: HouseholdEventPlanView;
  pending: boolean;
  onRemove: (entry: HouseholdEventPlanView["links"][number]) => void;
}) {
  if (plan.links.length === 0) return null;
  const archived = plan.status === "archived";
  return (
    <ul aria-label={`What ${plan.title} is about`} className="flex flex-col gap-1">
      {plan.links.map((entry) => (
        <PlanLinkRow
          archived={archived}
          entry={entry}
          key={entry.id}
          onRemove={() => onRemove(entry)}
          pending={pending}
        />
      ))}
    </ul>
  );
}

function LinkPickerAnchor({
  pickerId,
  archived,
  full,
  open,
  pending,
  anchorRef,
  onToggle,
}: {
  pickerId: string;
  archived: boolean;
  full: boolean;
  open: boolean;
  pending: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onToggle: () => void;
}) {
  if (archived) return null;
  if (full) {
    return (
      <p
        className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        ref={(node) => {
          anchorRef.current = node;
        }}
        tabIndex={-1}
      >
        This plan is holding all the records it can. Remove one to link something else.
      </p>
    );
  }
  return (
    <Button
      aria-controls={open ? pickerId : undefined}
      aria-expanded={open}
      className="min-h-11 w-fit sm:min-h-8"
      disabled={pending}
      onClick={onToggle}
      ref={(node) => {
        anchorRef.current = node;
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      Link a record
    </Button>
  );
}

function LinkCandidateGroup({
  group,
  pending,
  onLink,
}: {
  group: HouseholdEventPlanLinkChoiceGroup;
  pending: boolean;
  onLink: (candidate: HouseholdEventPlanLinkCandidate) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] font-medium text-muted-foreground">
        {group.label}
      </p>
      <ul className="flex flex-col gap-0.5">
        {group.candidates.map((candidate) => (
          <li key={`${candidate.kind}:${candidate.id}`}>
            <Button
              aria-label={`Link ${candidate.title}`}
              className="h-auto min-h-11 w-full justify-start py-1.5 text-left whitespace-normal sm:min-h-8"
              disabled={pending}
              onClick={() => onLink(candidate)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {candidate.title}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LinkPicker({
  id,
  choices,
  pending,
  pickerRef,
  onLink,
}: {
  id: string;
  choices: readonly HouseholdEventPlanLinkChoiceGroup[];
  pending: boolean;
  pickerRef: RefObject<HTMLParagraphElement | null>;
  onLink: (candidate: HouseholdEventPlanLinkCandidate) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border px-3.5 py-3" id={id}>
      <p
        className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-pretty outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
        ref={pickerRef}
        tabIndex={-1}
      >
        Point this plan at something you&rsquo;re already keeping.
      </p>
      <p className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
        These stay yours and carry on as they are. Finishing one doesn&rsquo;t change this plan or
        the event it refers to.
      </p>
      {choices.length === 0 ? (
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          Nothing to link yet. Actions, follow-ups, and saved items you keep will show up here.
        </p>
      ) : (
        choices.map((group) => (
          <LinkCandidateGroup group={group} key={group.kind} onLink={onLink} pending={pending} />
        ))
      )}
    </div>
  );
}

/** The contextual records a Plan points at, and the inline picker for adding one. */
export function HouseholdEventPlanLinks({
  plan,
  candidates,
  actions,
  onPlansChange,
  onAnnounce,
}: {
  plan: HouseholdEventPlanView;
  candidates: readonly HouseholdEventPlanLinkCandidate[];
  actions: HouseholdEventPlanActions;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const pickerId = useId();
  const controller = usePlanLinkController({
    plan,
    candidates,
    actions,
    onPlansChange,
    onAnnounce,
  });
  const archived = plan.status === "archived";
  if (archived && plan.links.length === 0) return null;

  function remove(entry: HouseholdEventPlanView["links"][number]) {
    controller.run({
      work: () => controller.unlink({ planId: plan.id, linkId: entry.id }),
      announce: `${entry.title} is no longer linked to ${plan.title}.`,
    });
  }

  function link(candidate: HouseholdEventPlanLinkCandidate) {
    controller.run({
      work: () =>
        controller.link({
          planId: plan.id,
          linkKind: candidate.kind,
          recordId: candidate.id,
        }),
      announce: `${candidate.title} is linked to ${plan.title}.`,
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <LinkedPlanRecords onRemove={remove} pending={controller.pending} plan={plan} />
      <LinkPickerAnchor
        anchorRef={controller.anchorRef}
        archived={archived}
        full={controller.full}
        onToggle={() => controller.setPicking((current) => !current)}
        open={controller.open}
        pending={controller.pending}
        pickerId={pickerId}
      />
      {controller.open ? (
        <LinkPicker
          choices={controller.choices}
          id={pickerId}
          onLink={link}
          pending={controller.pending}
          pickerRef={controller.pickerRef}
        />
      ) : null}
      {controller.error ? <HouseholdEventPlanErrorText message={controller.error} /> : null}
    </div>
  );
}
