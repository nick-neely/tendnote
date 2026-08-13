"use client";

import {
  HOUSEHOLD_CALENDAR_CONNECTION_LIMIT,
  HOUSEHOLD_CALENDAR_LABEL_LIMIT,
} from "@tendnote/domain/household-calendar";
import Link from "next/link";
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from "react";
import {
  connectHouseholdCalendarAction as defaultConnectAction,
  disconnectHouseholdCalendarAction as defaultDisconnectAction,
  type HouseholdCalendarResult,
} from "@/app/actions/household-calendar";
import { appDestination } from "@/components/app-destinations";
import { CalendarDotsIcon, HistoryIcon, UsersRoundIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  HouseholdCalendarEventView,
  HouseholdCalendarFamilyView,
} from "@/lib/household/household-calendar-view";
import type { HouseholdCalendarSurface } from "@/lib/household/household-shared-data";
import { HOUSEHOLD_GENERIC_ERROR } from "@/lib/household/invitation-copy";

export type HouseholdCalendarActions = {
  connect?: (input: { label: string }) => Promise<HouseholdCalendarResult>;
  disconnect?: (input: { connectionId: string }) => Promise<HouseholdCalendarResult>;
};

type PanelProps = {
  families: readonly HouseholdCalendarFamilyView[];
  /** True for an active Household Owner, the only role that may change what is shared. */
  canGovern: boolean;
  /** Whether the reader's own Google Calendar is connected. Only gates the Owner's form. */
  viewerHasCalendarAccess: boolean;
  /** True when even the list of designated calendars could not be read this time. */
  unavailable: boolean;
  actions?: HouseholdCalendarActions;
  onPlanEvent: (event: HouseholdCalendarEventView) => void;
  onSurfaceChange: (surface: HouseholdCalendarSurface) => void;
  onAnnounce: (message: string) => void;
};

function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
      {children}
    </p>
  );
}

function ErrorText({ message }: { message: string }) {
  return (
    <p
      className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-destructive"
      role="alert"
    >
      {message}
    </p>
  );
}

/**
 * The household's designated calendars, as any active member reads them
 * (issue #387, ADR 0217).
 *
 * Everything below the heading is provider-derived, read-through context, and
 * the treatment says so before the copy does: the same neutral rows, mono time
 * column, and attendee line the owner-scoped Account preview uses, with no
 * accept, dismiss, edit, or RSVP anywhere. Google owns these events; Tendnote is
 * reading them out loud. The single affordance a row carries is "Plan this
 * event", and it writes a household-native record beside the event rather than
 * anything to the calendar.
 *
 * Every active member sees this. Only an Owner sees the controls that change it,
 * because connecting and disconnecting change what the whole household - present
 * and future - can read. A member therefore has no "Share a calendar" affordance
 * at all: not a disabled one, and not one that refuses on press. An empty
 * section tells them an owner can share one, which is the true next step, and
 * offering them a control they cannot complete would be a worse answer than the
 * sentence.
 *
 * Each card names who shared it. The connector is provenance and never
 * authority (ADR 0217), but a member reading an unattributed "Family" cannot
 * tell whose calendar is in front of them, and when it goes unreadable there is
 * nobody obvious to ask. Naming the sharer costs nothing and answers both.
 *
 * Each designated calendar is its own card and its own outcome. One that cannot
 * be read says so in its own words and takes nothing else with it: the other
 * calendars still render, and so do the Event Plans below.
 */
export function HouseholdCalendarsPanel({
  families,
  canGovern,
  viewerHasCalendarAccess,
  unavailable,
  actions = {},
  onPlanEvent,
  onSurfaceChange,
  onAnnounce,
}: PanelProps) {
  return (
    <section aria-labelledby="household-calendars-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
          id="household-calendars-heading"
        >
          <CalendarDotsIcon aria-hidden className="size-4 shrink-0" />
          Shared calendars
          <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] font-normal">
            <span className="font-mono">Google&nbsp;Calendar</span> · read-only
          </span>
        </h2>
        <SectionNote>
          Everyone here can read these. Tendnote reads them and nothing more: it never adds,
          changes, cancels, or replies to anything on a calendar.
        </SectionNote>
      </div>

      {unavailable ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Shared calendars can&rsquo;t be read right now. Your plans below are unaffected.
        </p>
      ) : families.length === 0 ? (
        <p className="rounded-xl border border-dashed bg-surface px-4 py-3 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          No calendar is shared with this household yet.
          {canGovern ? "" : " An owner can share one."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {families.map((family) => (
            <CalendarFamilyCard
              actions={actions}
              canGovern={canGovern}
              family={family}
              key={family.connectionId}
              onAnnounce={onAnnounce}
              onPlanEvent={onPlanEvent}
              onSurfaceChange={onSurfaceChange}
            />
          ))}
        </ul>
      )}

      {canGovern ? (
        <ConnectCalendar
          actions={actions}
          connectedCount={families.length}
          onAnnounce={onAnnounce}
          onSurfaceChange={onSurfaceChange}
          viewerHasCalendarAccess={viewerHasCalendarAccess}
        />
      ) : null}
    </section>
  );
}

/**
 * One designated calendar.
 *
 * Its freshness and its failure are stated on the card rather than at the
 * section, because both are facts about this calendar alone. A stale card says
 * it is showing what was last read; an unreadable one says only that it cannot
 * be read, never why - the why is a fact about another member's Google account.
 */
function CalendarFamilyCard({
  family,
  canGovern,
  actions,
  onPlanEvent,
  onSurfaceChange,
  onAnnounce,
}: {
  family: HouseholdCalendarFamilyView;
  canGovern: boolean;
  actions: HouseholdCalendarActions;
  onPlanEvent: (event: HouseholdCalendarEventView) => void;
  onSurfaceChange: (surface: HouseholdCalendarSurface) => void;
  onAnnounce: (message: string) => void;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-col">
          <span className="min-w-0 truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
            {family.label}
          </span>
          {family.sharedBy ? (
            <span className="text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              Shared by {family.sharedBy}
            </span>
          ) : null}
        </span>
        {canGovern ? (
          <DisconnectCalendar
            actions={actions}
            connectionId={family.connectionId}
            label={family.label}
            onAnnounce={onAnnounce}
            onSurfaceChange={onSurfaceChange}
          />
        ) : null}
      </div>

      {family.state === "unavailable" ? (
        /*
          Two sentences, and deliberately not a third. The first is the only
          thing we actually know; the second is the isolation guarantee, which
          is true by construction. What is missing is any promise about recovery
          - a transient provider error does clear on its own, but a connector
          who revoked their Google grant has to reconnect it themselves, and
          this state cannot tell those apart. Saying "it will come back" would
          be a guess, and a member who believed it would wait indefinitely for
          something nobody is doing.

          Nor does it say which of the two it is. That distinction is a fact
          about another member's Google account, and the read seam collapses it
          on purpose (see `HouseholdCalendarFamily`).
        */
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          This calendar can&rsquo;t be read right now. Nothing else here is affected.
        </p>
      ) : (
        <>
          {family.stale ? (
            <p className="flex items-center gap-1.5 text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
              <HistoryIcon aria-hidden className="size-3.5 shrink-0" />
              <span>
                Showing what was last read <span className="font-mono">{family.cachedLabel}</span>.
                It may be out of date.
              </span>
            </p>
          ) : null}

          {family.state === "empty" ? (
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              Nothing on this calendar over the next couple of weeks.
            </p>
          ) : (
            <ul className="flex flex-col divide-y">
              {family.events.map((event) => (
                <CalendarEventRow event={event} key={event.key} onPlanEvent={onPlanEvent} />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/**
 * One provider event.
 *
 * Read-only by construction: the row holds no control that could change it, and
 * a cancellation or an attendee list is reported as Google's answer rather than
 * treated as Tendnote's own attendance truth. "Plan this event" is the only
 * press, and it opens a household-native form with the event's address attached
 * and its title deliberately not copied.
 */
function CalendarEventRow({
  event,
  onPlanEvent,
}: {
  event: HouseholdCalendarEventView;
  onPlanEvent: (event: HouseholdCalendarEventView) => void;
}) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 py-2.5 first:pt-1">
      <span className="w-24 shrink-0 truncate font-mono text-[length:var(--text-caption)] leading-[var(--text-body-line)] text-muted-foreground">
        {event.whenLabel}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="min-w-0 truncate text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {event.title}
          </span>
          {/* Google's own cancellation, carried as text rather than as a colour. */}
          {event.cancelled ? <Badge variant="outline">Cancelled on the calendar</Badge> : null}
        </span>
        {event.withWhom ? (
          <span className="flex items-center gap-1 truncate text-[length:var(--text-caption)] leading-[var(--text-caption-line)] text-muted-foreground">
            <UsersRoundIcon aria-hidden className="size-3 shrink-0" />
            {event.withWhom}
          </span>
        ) : null}
      </span>
      {event.planned ? (
        <Badge variant="outline">Has a plan</Badge>
      ) : (
        <Button
          className="min-h-11 shrink-0 sm:min-h-8"
          onClick={() => onPlanEvent(event)}
          size="sm"
          type="button"
          variant="outline"
        >
          Plan this event
        </Button>
      )}
    </li>
  );
}

/**
 * Stopping sharing, confirmed in place.
 *
 * Inline rather than in a dialog: nothing is deleted, and the household's Plans
 * keep everything they wrote. What does change is what everyone can see, so the
 * consequence is stated at the moment of the press rather than assumed.
 */
function DisconnectCalendar({
  connectionId,
  label,
  actions,
  onSurfaceChange,
  onAnnounce,
}: {
  connectionId: string;
  label: string;
  actions: HouseholdCalendarActions;
  onSurfaceChange: (surface: HouseholdCalendarSurface) => void;
  onAnnounce: (message: string) => void;
}) {
  const disconnect = actions.disconnect ?? defaultDisconnectAction;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The confirm step replaces the button that summoned it, so focus has to
    // follow into it or it lands on the body. It goes to the affirmative rather
    // than the escape because that is the control the reader just asked for;
    // "Keep sharing it" is one Tab away and Escape-shaped either way.
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <span className="flex shrink-0 flex-col items-end gap-1">
        <Button
          className="min-h-11 sm:min-h-8"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          Stop sharing
        </Button>
        {error ? <ErrorText message={error} /> : null}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col gap-2">
      <SectionNote>
        Stop sharing {label}? Everyone here stops seeing its events, and any plan that refers to one
        will say the calendar isn&rsquo;t available. You can share it again later.
      </SectionNote>
      <span className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => {
            if (pending) return;
            setError(null);
            startTransition(async () => {
              try {
                const result = await disconnect({ connectionId });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setConfirming(false);
                onSurfaceChange(result.view);
                onAnnounce(`${label} is no longer shared with the household.`);
              } catch {
                setError(HOUSEHOLD_GENERIC_ERROR);
              }
            });
          }}
          ref={confirmRef}
          size="sm"
          type="button"
          variant="outline"
        >
          {pending ? "Stopping…" : "Yes, stop sharing"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => setConfirming(false)}
          size="sm"
          type="button"
          variant="ghost"
        >
          Keep sharing it
        </Button>
      </span>
      {error ? <ErrorText message={error} /> : null}
    </span>
  );
}

/**
 * The Owner's way to designate a calendar.
 *
 * The confirmation is the whole point of this form, so it is the thing that
 * gates the press rather than a sentence beside it: the checkbox says what
 * connecting actually does - every current and future active member can read
 * this calendar's events - and the button cannot be used until an Owner has said
 * so. There is no per-event audience to choose, because there is none: a
 * household that wants a narrower audience designates a different calendar.
 *
 * When the Owner has no Google Calendar connection of their own, this shows the
 * honest next step instead of a control that would refuse. A designation rides
 * the connector's personal grant, so one made without it would be unreadable the
 * moment it existed.
 */
function ConnectCalendar({
  connectedCount,
  viewerHasCalendarAccess,
  actions,
  onSurfaceChange,
  onAnnounce,
}: {
  connectedCount: number;
  viewerHasCalendarAccess: boolean;
  actions: HouseholdCalendarActions;
  onSurfaceChange: (surface: HouseholdCalendarSurface) => void;
  onAnnounce: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!viewerHasCalendarAccess) {
    return (
      <SectionNote>
        Sharing a calendar reads it through your own Google Calendar connection, and yours
        isn&rsquo;t connected yet.{" "}
        <Link
          className="underline underline-offset-2 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/35 focus-visible:outline-none"
          href={appDestination("account").route}
        >
          Connect it in Account
        </Link>
        , then come back here.
      </SectionNote>
    );
  }

  if (connectedCount >= HOUSEHOLD_CALENDAR_CONNECTION_LIMIT) {
    return (
      <SectionNote>
        A household can share up to {HOUSEHOLD_CALENDAR_CONNECTION_LIMIT} calendars. Stop sharing
        one to share another.
      </SectionNote>
    );
  }

  if (!open) {
    return (
      <Button
        className="min-h-11 self-start sm:min-h-8"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        Share a calendar
      </Button>
    );
  }

  return (
    <ConnectCalendarForm
      actions={actions}
      onAnnounce={onAnnounce}
      onClose={() => setOpen(false)}
      onSurfaceChange={onSurfaceChange}
    />
  );
}

function ConnectCalendarForm({
  actions,
  onSurfaceChange,
  onAnnounce,
  onClose,
}: {
  actions: HouseholdCalendarActions;
  onSurfaceChange: (surface: HouseholdCalendarSurface) => void;
  onAnnounce: (message: string) => void;
  onClose: () => void;
}) {
  const connect = actions.connect ?? defaultConnectAction;
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const confirmId = `${id}-confirm`;
  const [label, setLabel] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const labelRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The press that opens this form destroys the button that was focused, so
    // without this the caret lands on the document body at the moment there is
    // something to type. Same treatment as the new-Plan form.
    labelRef.current?.focus();
  }, []);

  const trimmed = label.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed || !confirmed || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await connect({ label: trimmed });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setLabel("");
        setConfirmed(false);
        onClose();
        onSurfaceChange(result.view);
        onAnnounce(`${trimmed} is now shared with everyone in the household.`);
      } catch {
        setError(HOUSEHOLD_GENERIC_ERROR);
      }
    });
  }

  return (
    <form className="flex flex-col gap-3 rounded-xl border bg-surface px-4 py-4" onSubmit={submit}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={labelId}>What the household will call it</Label>
        <Input
          aria-describedby={hintId}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className="h-11 sm:h-8"
          id={labelId}
          maxLength={HOUSEHOLD_CALENDAR_LABEL_LIMIT}
          name="householdCalendarLabel"
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Family calendar"
          ref={labelRef}
          value={label}
        />
      </div>

      <p
        className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground"
        id={hintId}
      >
        This shares your primary Google Calendar, read through your own Google account. Nobody here
        gains access to your account or your other calendars, and Tendnote never writes to it.
      </p>

      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={confirmed}
          className="mt-0.5"
          id={confirmId}
          onCheckedChange={(next) => setConfirmed(next === true)}
        />
        <Label
          className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] font-normal text-pretty"
          htmlFor={confirmId}
        >
          Everyone in this household, now and anyone who joins later, will be able to read this
          calendar&rsquo;s events.
        </Label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending || trimmed.length === 0 || !confirmed}
          size="sm"
          type="submit"
        >
          {pending ? "Sharing…" : "Share this calendar"}
        </Button>
        <Button
          className="min-h-11 sm:min-h-8"
          disabled={pending}
          onClick={() => {
            onClose();
            setConfirmed(false);
            setError(null);
          }}
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
