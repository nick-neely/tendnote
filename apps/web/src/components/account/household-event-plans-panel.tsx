"use client";

import {
  HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT,
  HOUSEHOLD_EVENT_PLAN_LINK_LIMIT,
  HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT,
  type HouseholdEventPlan,
  type HouseholdEventPlanCalendarReference,
  type HouseholdEventPlanLinkKind,
} from "@tendnote/domain/household-event-plans";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import {
  archiveHouseholdEventPlanAction as defaultArchiveAction,
  createHouseholdEventPlanAction as defaultCreateAction,
  linkHouseholdEventPlanRecordAction as defaultLinkAction,
  restoreHouseholdEventPlanAction as defaultRestoreAction,
  unlinkHouseholdEventPlanRecordAction as defaultUnlinkAction,
  updateHouseholdEventPlanAction as defaultUpdateAction,
  type HouseholdEventPlanResult,
} from "@/app/actions/household-event-plans";
import { CalendarDotsIcon, HistoryIcon, LinkIcon, NotebookPenIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  buildHouseholdEventPlanConflictView,
  buildHouseholdEventPlanLinkChoices,
  type HouseholdEventPlanConflictView,
  type HouseholdEventPlanGroups,
  type HouseholdEventPlanLinkCandidate,
  type HouseholdEventPlanRecord,
  type HouseholdEventPlanView,
} from "@/lib/household/household-event-plan-view";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";
import { formatEventWhen } from "@/lib/integrations/calendar-preview";

export type HouseholdCalendarEventAddress = {
  connectionId: string;
  calendarId: string;
  providerEventId: string;
};

export type HouseholdEventPlanDraftInput = {
  title: string;
  details: string | null;
  plannedFor: string | null;
  calendarEvent: HouseholdCalendarEventAddress | null;
};

export type HouseholdEventPlanActions = {
  create?: (input: { draft: HouseholdEventPlanDraftInput }) => Promise<HouseholdEventPlanResult>;
  update?: (input: {
    planId: string;
    expectedVersion: number;
    draft: HouseholdEventPlanDraftInput;
  }) => Promise<HouseholdEventPlanResult>;
  archive?: (input: {
    planId: string;
    expectedVersion: number;
  }) => Promise<HouseholdEventPlanResult>;
  restore?: (input: {
    planId: string;
    expectedVersion: number;
  }) => Promise<HouseholdEventPlanResult>;
  link?: (input: {
    planId: string;
    linkKind: HouseholdEventPlanLinkKind;
    recordId: string;
  }) => Promise<HouseholdEventPlanResult>;
  unlink?: (input: { planId: string; linkId: string }) => Promise<HouseholdEventPlanResult>;
};

/**
 * One member's press of "Plan this event", handed across from the calendars.
 *
 * It carries the event's address and enough of its wording to show what the new
 * Plan is about. It deliberately does not seed the title: a Plan that opened
 * pre-filled with the provider's words would be a copy of the event on the day
 * it was made, which is the one thing a Plan must never be.
 */
export type PendingHouseholdCalendarEvent = {
  /** Bumped on every press, so pressing the same event again reopens the form. */
  nonce: number;
  calendarLabel: string;
  eventTitle: string;
  whenLabel: string;
  address: HouseholdCalendarEventAddress;
};

type OpenForm = { key: string; attachment: PendingHouseholdCalendarEvent | null };

type PanelProps = {
  groups: HouseholdEventPlanGroups;
  /** True when this household's Plans could not be read at all this time. */
  unavailable: boolean;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  /** The reader's own records, for the link picker on an active Plan. */
  linkCandidates: readonly HouseholdEventPlanLinkCandidate[];
  pendingCalendarEvent: PendingHouseholdCalendarEvent | null;
  actions?: HouseholdEventPlanActions;
  /** A whole refreshed list, after a write that landed. */
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  /** One Plan's current value, after a write that lost its fence. */
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
};

function ErrorText({ id, message }: { id?: string; message: string }) {
  return (
    <p
      className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
      id={id}
      role="alert"
    >
      {message}
    </p>
  );
}

/**
 * The household's own planning records (issue #387).
 *
 * A Plan is Tendnote-native and reads that way: prose leads, there is no mono
 * time rail, and nothing on it is presented as provider truth. It is the
 * deliberate opposite of the calendars above, which are read-only and belong to
 * Google.
 *
 * Authority is symmetric and the surface makes no exception to it. Every active
 * member gets exactly the same controls on every Plan, whoever started it and
 * whatever their household role - a creator badge or an Owner-only edit would be
 * a claim this product does not make.
 *
 * What is deliberately absent, because each would turn a Plan into a claim about
 * people: no RSVP, no guest list, no availability, no per-member attendance, no
 * assignee, no turn order, and no reminders. Someone who wants to be reminded
 * makes their own Action or Follow-Up with their own schedule.
 */
export function HouseholdEventPlansPanel({
  groups,
  unavailable,
  viewerUserId,
  memberNames,
  linkCandidates,
  pendingCalendarEvent,
  actions = {},
  onPlansChange,
  onPlanRefreshed,
  onAnnounce,
}: PanelProps) {
  const [openForm, setOpenForm] = useState<OpenForm | null>(null);

  useEffect(() => {
    if (!pendingCalendarEvent) return;
    setOpenForm({
      key: `event-${pendingCalendarEvent.nonce}`,
      attachment: pendingCalendarEvent,
    });
  }, [pendingCalendarEvent]);

  const empty = groups.active.length === 0 && groups.archived.length === 0;

  return (
    <section aria-labelledby="household-event-plans-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2
            className="flex items-center gap-2 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
            id="household-event-plans-heading"
          >
            <NotebookPenIcon aria-hidden className="size-4 shrink-0" />
            Event plans
          </h2>
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
            Your household&rsquo;s own notes for an occasion. Anyone here can start one, change it,
            or archive it.
          </p>
        </div>
        {unavailable ? null : (
          <Button
            className="min-h-11 shrink-0 sm:min-h-8"
            onClick={() => setOpenForm({ key: `new-${Date.now()}`, attachment: null })}
            size="sm"
            type="button"
            variant="outline"
          >
            New plan
          </Button>
        )}
      </div>

      {unavailable ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Plans can&rsquo;t be read right now. Nothing has changed, and this will come back on its
          own.
        </p>
      ) : (
        <>
          {openForm ? (
            <NewPlanForm
              attachment={openForm.attachment}
              create={actions.create ?? defaultCreateAction}
              key={openForm.key}
              onAnnounce={onAnnounce}
              onClose={() => setOpenForm(null)}
              onPlansChange={onPlansChange}
            />
          ) : null}

          {empty && !openForm ? (
            <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Nothing planned here yet. Start one for the next birthday, school night, or visit, and
              everyone here can add to it.
            </p>
          ) : null}

          {groups.active.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {groups.active.map((plan) => (
                <PlanCard
                  actions={actions}
                  key={plan.id}
                  linkCandidates={linkCandidates}
                  memberNames={memberNames}
                  onAnnounce={onAnnounce}
                  onPlanRefreshed={onPlanRefreshed}
                  onPlansChange={onPlansChange}
                  plan={plan}
                  viewerUserId={viewerUserId}
                />
              ))}
            </ul>
          ) : null}

          {groups.archived.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h3
                className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
                id="household-archived-plans-heading"
              >
                Archived
              </h3>
              <ul
                aria-labelledby="household-archived-plans-heading"
                className="flex flex-col gap-3"
              >
                {groups.archived.map((plan) => (
                  <PlanCard
                    actions={actions}
                    key={plan.id}
                    linkCandidates={linkCandidates}
                    memberNames={memberNames}
                    onAnnounce={onAnnounce}
                    onPlanRefreshed={onPlanRefreshed}
                    onPlansChange={onPlansChange}
                    plan={plan}
                    viewerUserId={viewerUserId}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * A Plan's reference to one Household Calendar Event.
 *
 * Live detail when the calendar can be read, saying plainly when it is showing
 * out-of-date provider data, and one calm sentence when it cannot. The Plan's
 * own content is unaffected either way: an unavailable reference is not an error
 * and not a prompt to fix anything.
 */
function PlanCalendarReference({ reference }: { reference: HouseholdEventPlanCalendarReference }) {
  if (reference.state === "none") return null;

  if (reference.state === "unavailable") {
    return (
      <p className="flex items-start gap-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
        <CalendarDotsIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        <span>The calendar this refers to isn&rsquo;t available right now.</span>
      </p>
    );
  }

  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
      <CalendarDotsIcon aria-hidden className="size-3.5 shrink-0 self-center" />
      <span className="font-mono text-[length:var(--text-caption)]">
        {formatEventWhen(reference.start, reference.allDay)}
      </span>
      <span className="min-w-0">{reference.title ?? "Untitled event"}</span>
      <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
        on {reference.label}
      </span>
      {reference.stale ? (
        <span className="flex items-center gap-1 text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
          <HistoryIcon aria-hidden className="size-3 shrink-0" />
          <span>· may be out of date</span>
        </span>
      ) : null}
    </p>
  );
}

/** Who started it, who last changed it, when. Three facts, and nothing more. */
function PlanProvenance({ plan }: { plan: HouseholdEventPlanView }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
      <span>Started by {plan.provenance.startedBy}</span>
      {plan.provenance.changedBy ? <span>· changed by {plan.provenance.changedBy}</span> : null}
      <span className="font-mono">· {plan.provenance.atLabel}</span>
    </p>
  );
}

/**
 * One Plan.
 *
 * Its title, its own date, its notes, and the quiet line that says who started
 * it and who last changed it. Prose leads and there is no mono time rail,
 * because a Plan is the household's own record and must never be mistaken for
 * the provider truth in the section above it.
 *
 * The lifecycle state lives here rather than in the button pair so a refused
 * archive can explain itself across the whole card. An explanation squeezed into
 * the control column would be the narrowest column on the screen carrying the
 * most important sentence on it.
 */
function PlanCard({
  plan,
  viewerUserId,
  memberNames,
  linkCandidates,
  actions,
  onPlansChange,
  onPlanRefreshed,
  onAnnounce,
}: {
  plan: HouseholdEventPlanView;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  linkCandidates: readonly HouseholdEventPlanLinkCandidate[];
  actions: HouseholdEventPlanActions;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
}) {
  const archive = actions.archive ?? defaultArchiveAction;
  const restore = actions.restore ?? defaultRestoreAction;
  const [editing, setEditing] = useState(false);
  const [conflict, setConflict] = useState<HouseholdEventPlanConflictView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const archived = plan.status === "archived";

  /**
   * Archive and restore are fenced writes like any other, so either can lose to
   * someone else's change. A lost fence stops the move and says so; going ahead
   * anyway is a second, separate press.
   */
  function move(expectedVersion: number) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await (archived ? restore : archive)({ planId: plan.id, expectedVersion });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.view.outcome === "conflict") {
          onPlanRefreshed(result.view.current);
          setConflict(
            buildHouseholdEventPlanConflictView({
              current: result.view.current,
              viewerUserId,
              memberNames,
            }),
          );
          onAnnounce("Someone else changed this plan just now. Nothing was archived.");
          return;
        }
        setConflict(null);
        onPlansChange(result.view.plans);
        onAnnounce(archived ? `${plan.title} is back on the list.` : `${plan.title} was archived.`);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium text-pretty">
            {plan.title}
          </span>
        </span>
        {/*
          Every active member gets exactly these two, on every Plan, whoever
          started it and whatever their household role.
        */}
        {editing ? null : (
          <span className="flex shrink-0 flex-wrap justify-end gap-2">
            {archived ? null : (
              <Button
                className="min-h-11 sm:min-h-8"
                disabled={pending}
                onClick={() => setEditing(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Edit
              </Button>
            )}
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => move(plan.version)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {archived ? (pending ? "Restoring…" : "Restore") : pending ? "Archiving…" : "Archive"}
            </Button>
          </span>
        )}
      </div>

      <PlanCalendarReference reference={plan.calendar} />

      {conflict ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/45 px-3.5 py-3">
          <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty">
            {conflict.changedBy === "you" ? "You" : conflict.changedBy} changed this plan a moment
            ago, so nothing was archived. It now reads &ldquo;{conflict.title}&rdquo;.
          </p>
          <p className="font-mono text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
            {conflict.atLabel}
          </p>
          <span className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => move(conflict.version)}
              size="sm"
              type="button"
              variant="outline"
            >
              {archived ? "Restore it anyway" : "Archive it anyway"}
            </Button>
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => setConflict(null)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Leave it as it is
            </Button>
          </span>
        </div>
      ) : null}

      {editing ? (
        <EditPlanForm
          memberNames={memberNames}
          onAnnounce={onAnnounce}
          onClose={() => setEditing(false)}
          onPlanRefreshed={onPlanRefreshed}
          onPlansChange={onPlansChange}
          plan={plan}
          update={actions.update ?? defaultUpdateAction}
          viewerUserId={viewerUserId}
        />
      ) : (
        <>
          {plan.plannedForLabel ? (
            <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              {plan.plannedForLabel}
            </p>
          ) : null}
          {plan.details ? (
            <p className="max-w-[65ch] text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty whitespace-pre-wrap">
              {plan.details}
            </p>
          ) : null}
          <PlanLinks
            actions={actions}
            candidates={linkCandidates}
            onAnnounce={onAnnounce}
            onPlansChange={onPlansChange}
            plan={plan}
          />
          <PlanProvenance plan={plan} />
        </>
      )}

      {error ? <ErrorText message={error} /> : null}
    </li>
  );
}

/**
 * The records a Plan points at, and the way to point it at one more.
 *
 * A link is context and only context. It says what an occasion is about; it
 * hands the linked record no say over the Plan, and it gives the Plan no say
 * over the record. The copy has to keep saying so, because a list of Actions
 * sitting under a Plan looks exactly like a checklist that would close it.
 *
 * Every row reads as the record's own title. The id it is really made of is
 * never shown, and a link the reader is not entitled to see never arrives here
 * at all - it is dropped by the proof before the surface hears about it, with no
 * placeholder left behind (ADR 0219).
 *
 * The picker is inline rather than a modal, and it is a shortlist to recognize
 * rather than a search: it offers records the member can already see, which in
 * practice are their own.
 */
function PlanLinks({
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
  const link = actions.link ?? defaultLinkAction;
  const unlink = actions.unlink ?? defaultUnlinkAction;
  const pickerId = useId();
  const pickerRef = useRef<HTMLParagraphElement>(null);
  /** Whichever of the add control and the limit notice is on the screen. */
  const anchorRef = useRef<HTMLElement | null>(null);
  const [picking, setPicking] = useState(false);
  const [settled, setSettled] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const archived = plan.status === "archived";
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

  function run(input: { work: () => Promise<HouseholdEventPlanResult>; announce: string }) {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await input.work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // Neither a link nor an unlink is fenced against a version, so `conflict`
        // cannot happen here; the union is narrowed rather than handled.
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

  if (archived && plan.links.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {plan.links.length > 0 ? (
        <ul aria-label={`What ${plan.title} is about`} className="flex flex-col gap-1">
          {plan.links.map((entry) => (
            <li
              className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 border-t pt-1.5 first:border-t-0 first:pt-0"
              key={entry.id}
            >
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
                  onClick={() =>
                    run({
                      work: () => unlink({ planId: plan.id, linkId: entry.id }),
                      announce: `${entry.title} is no longer linked to ${plan.title}.`,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {archived ? null : full ? (
        <p
          className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          ref={(node) => {
            anchorRef.current = node;
          }}
          tabIndex={-1}
        >
          This plan is holding all the records it can. Remove one to link something else.
        </p>
      ) : (
        <Button
          aria-controls={open ? pickerId : undefined}
          aria-expanded={open}
          className="min-h-11 w-fit sm:min-h-8"
          disabled={pending}
          onClick={() => setPicking((current) => !current)}
          ref={(node) => {
            anchorRef.current = node;
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Link a record
        </Button>
      )}

      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border px-3.5 py-3" id={pickerId}>
          {/*
            The same focus landing the conflict block uses: the picker is opened
            by a press that may be well above it, so the reader arrives with it.
          */}
          <p
            className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-pretty outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
            ref={pickerRef}
            tabIndex={-1}
          >
            Point this plan at something you&rsquo;re already keeping.
          </p>
          <p className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
            These stay yours and carry on as they are. Finishing one doesn&rsquo;t change this plan
            or the event it refers to.
          </p>

          {choices.length === 0 ? (
            <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Nothing to link yet. Actions, follow-ups, and saved items you keep will show up here.
            </p>
          ) : (
            choices.map((group) => (
              <div className="flex flex-col gap-1" key={group.kind}>
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
                        onClick={() =>
                          run({
                            work: () =>
                              link({
                                planId: plan.id,
                                linkKind: candidate.kind,
                                recordId: candidate.id,
                              }),
                            announce: `${candidate.title} is linked to ${plan.title}.`,
                          })
                        }
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
            ))
          )}
        </div>
      ) : null}

      {error ? <ErrorText message={error} /> : null}
    </div>
  );
}

/** The three fields a Plan has. Shared by the new-plan and edit forms. */
function PlanFields({
  ids,
  title,
  details,
  plannedFor,
  disabled,
  invalid,
  titleRef,
  onTitle,
  onDetails,
  onPlannedFor,
}: {
  ids: { title: string; details: string; plannedFor: string };
  title: string;
  details: string;
  plannedFor: string;
  disabled: boolean;
  invalid: boolean;
  titleRef?: React.RefObject<HTMLInputElement | null>;
  onTitle: (value: string) => void;
  onDetails: (value: string) => void;
  onPlannedFor: (value: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.title}>What is it</Label>
        <Input
          aria-invalid={invalid ? true : undefined}
          autoComplete="off"
          className="h-11 sm:h-8"
          disabled={disabled}
          id={ids.title}
          maxLength={HOUSEHOLD_EVENT_PLAN_TITLE_LIMIT}
          name="householdEventPlanTitle"
          onChange={(event) => onTitle(event.target.value)}
          placeholder="Mara's birthday dinner"
          ref={titleRef}
          value={title}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.plannedFor}>When (optional)</Label>
        <Input
          className="h-11 w-fit sm:h-8"
          disabled={disabled}
          id={ids.plannedFor}
          name="householdEventPlanDate"
          onChange={(event) => onPlannedFor(event.target.value)}
          type="date"
          value={plannedFor}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.details}>Notes (optional)</Label>
        <Textarea
          disabled={disabled}
          id={ids.details}
          maxLength={HOUSEHOLD_EVENT_PLAN_DETAILS_LIMIT}
          name="householdEventPlanDetails"
          onChange={(event) => onDetails(event.target.value)}
          placeholder="What still needs sorting out."
          rows={3}
          value={details}
        />
      </div>
    </>
  );
}

function NewPlanForm({
  attachment,
  create,
  onPlansChange,
  onAnnounce,
  onClose,
}: {
  attachment: PendingHouseholdCalendarEvent | null;
  create: NonNullable<HouseholdEventPlanActions["create"]>;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onAnnounce: (message: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const detailsId = useId();
  const plannedForId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [plannedFor, setPlannedFor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    // The form is summoned by a press elsewhere on the screen, including one on
    // a calendar row well above it, so the caret has to arrive with it.
    titleRef.current?.focus();
  }, []);

  const trimmed = title.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await create({
          draft: {
            title: trimmed,
            details: details.trim() ? details : null,
            plannedFor: plannedFor || null,
            calendarEvent: attachment?.address ?? null,
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        // A brand new Plan has no fence to lose, so `conflict` cannot happen
        // here; the union is narrowed rather than handled.
        if (result.view.outcome === "saved") {
          onPlansChange(result.view.plans);
          onAnnounce(`${trimmed} was added to your plans.`);
          onClose();
        }
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <form className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-4" onSubmit={submit}>
      {attachment ? (
        <div className="flex flex-col gap-0.5">
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            <CalendarDotsIcon aria-hidden className="size-3.5 shrink-0 self-center" />
            <span className="font-mono text-[length:var(--text-caption)]">
              {attachment.whenLabel}
            </span>
            <span className="min-w-0">{attachment.eventTitle}</span>
            <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)]">
              on {attachment.calendarLabel}
            </span>
          </p>
          <p className="max-w-[65ch] text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-pretty text-muted-foreground">
            This plan will point at that event. It stays your household&rsquo;s own note, so give it
            a name in your own words.
          </p>
        </div>
      ) : null}

      <PlanFields
        details={details}
        disabled={pending}
        ids={{ title: titleId, details: detailsId, plannedFor: plannedForId }}
        invalid={Boolean(error)}
        onDetails={setDetails}
        onPlannedFor={setPlannedFor}
        onTitle={setTitle}
        plannedFor={plannedFor}
        title={title}
        titleRef={titleRef}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending || trimmed.length === 0}
          size="sm"
          type="submit"
        >
          {pending ? "Adding…" : "Add plan"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          Not now
        </Button>
      </div>

      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}

/**
 * Editing a Plan, and the concurrency contract that guards it.
 *
 * The whole design of this form is the case where two people write at once. The
 * save is fenced against the version the member's screen was carrying, and a
 * lost fence never resolves itself: their draft stays exactly as they typed it,
 * the value that beat them is shown beside it with who wrote it and when, and
 * the next move is one of three presses they make themselves. Tendnote does not
 * last-write-wins and does not try to merge two people's prose.
 *
 * "Keep editing mine" adopts the version they were just shown, because they have
 * now seen it: that is the acknowledgement the contract asks for, and a save
 * afterwards is a decision rather than an accident. If someone changes it again
 * in the meantime, they are stopped again.
 */
function EditPlanForm({
  plan,
  viewerUserId,
  memberNames,
  update,
  onPlansChange,
  onPlanRefreshed,
  onAnnounce,
  onClose,
}: {
  plan: HouseholdEventPlanView;
  viewerUserId: string;
  memberNames: ReadonlyMap<string, string>;
  update: NonNullable<HouseholdEventPlanActions["update"]>;
  onPlansChange: (plans: HouseholdEventPlanRecord[]) => void;
  onPlanRefreshed: (plan: HouseholdEventPlan) => void;
  onAnnounce: (message: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const detailsId = useId();
  const plannedForId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const conflictRef = useRef<HTMLParagraphElement>(null);
  const [title, setTitle] = useState(plan.title);
  const [details, setDetails] = useState(plan.details ?? "");
  const [plannedFor, setPlannedFor] = useState(plan.plannedForInput);
  const [expectedVersion, setExpectedVersion] = useState(plan.version);
  const [conflict, setConflict] = useState<HouseholdEventPlanConflictView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (conflict) conflictRef.current?.focus();
  }, [conflict]);

  const trimmed = title.trim();

  function save(version: number) {
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await update({
          planId: plan.id,
          expectedVersion: version,
          draft: {
            title: trimmed,
            details: details.trim() ? details : null,
            plannedFor: plannedFor || null,
            // Restated rather than omitted: a write replaces the whole value, so
            // leaving this out would drop the event a Plan refers to as a side
            // effect of fixing a typo.
            calendarEvent: plan.calendarAddress,
          },
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if (result.view.outcome === "conflict") {
          // Their draft is untouched on purpose: every piece of state this form
          // holds about what they typed survives this branch.
          onPlanRefreshed(result.view.current);
          setConflict(
            buildHouseholdEventPlanConflictView({
              current: result.view.current,
              viewerUserId,
              memberNames,
            }),
          );
          onAnnounce(result.view.message);
          return;
        }
        onPlansChange(result.view.plans);
        onAnnounce(`${trimmed} was saved.`);
        onClose();
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        save(expectedVersion);
      }}
    >
      {conflict ? (
        <div className="flex flex-col gap-2 rounded-lg border border-accent/25 bg-accent-soft/45 px-3.5 py-3">
          {/*
            A focus landing rather than a live region: this block carries three
            controls, and a container that announced itself would fight the
            reader as they moved through them. Focus arrives here instead, and
            the same sentence goes to the surface's status region.
          */}
          <p
            className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-pretty outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
            ref={conflictRef}
            tabIndex={-1}
          >
            Someone else changed this plan while you were writing. Your draft is kept below.
          </p>
          <div className="flex flex-col gap-1">
            <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty">
              It now reads &ldquo;{conflict.title}&rdquo;
              {conflict.plannedForLabel ? `, on ${conflict.plannedForLabel}` : ""}.
            </p>
            {conflict.details ? (
              <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty whitespace-pre-wrap text-muted-foreground">
                {conflict.details}
              </p>
            ) : null}
            <p className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              Changed by {conflict.changedBy}{" "}
              <span className="font-mono">· {conflict.atLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => save(conflict.version)}
              size="sm"
              type="button"
            >
              {pending ? "Saving…" : "Save mine over theirs"}
            </Button>
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={() => {
                setExpectedVersion(conflict.version);
                setConflict(null);
                titleRef.current?.focus();
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Keep editing mine
            </Button>
            <Button
              className="min-h-11 sm:min-h-8"
              disabled={pending}
              onClick={onClose}
              size="sm"
              type="button"
              variant="ghost"
            >
              Use their version
            </Button>
          </div>
        </div>
      ) : null}

      <PlanFields
        details={details}
        disabled={pending}
        ids={{ title: titleId, details: detailsId, plannedFor: plannedForId }}
        invalid={Boolean(error)}
        onDetails={setDetails}
        onPlannedFor={setPlannedFor}
        onTitle={setTitle}
        plannedFor={plannedFor}
        title={title}
        titleRef={titleRef}
      />

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending || trimmed.length === 0 || Boolean(conflict)}
          size="sm"
          type="submit"
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={onClose}
          size="sm"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </div>

      {error ? <ErrorText message={error} /> : null}
    </form>
  );
}
