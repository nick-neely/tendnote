"use client";

import type { HouseholdMemberSummary } from "@tendnote/domain/household-overview";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  type HouseholdCalendarActions,
  HouseholdCalendarsPanel,
} from "@/components/household/household-calendars-panel";
import {
  type HouseholdEventPlanActions,
  HouseholdEventPlansPanel,
  type PendingHouseholdCalendarEvent,
} from "@/components/household/household-event-plans-panel";
import { buildHouseholdCalendarFamilyViews } from "@/lib/household/household-calendar-view";
import {
  buildHouseholdEventPlanViews,
  type HouseholdEventPlanLinkCandidate,
  type HouseholdEventPlanRecord,
  householdActorName,
  plannedHouseholdCalendarEventKeys,
} from "@/lib/household/household-event-plan-view";
import type { HouseholdCalendarSurface } from "@/lib/household/household-shared-data";

export type HouseholdPlanningSectionsProps = {
  viewerUserId: string;
  viewerRole: "owner" | "member";
  /** The household's roster, used only to put a name on a Plan's provenance. */
  members: readonly Pick<HouseholdMemberSummary, "userId" | "name">[];
  /** Fixed by the server render so freshness labels do not drift on hydration. */
  now: Date;
  calendars: HouseholdCalendarSurface | null;
  plans: HouseholdEventPlanRecord[] | null;
  /** The reader's own records, offered when they link one to a Plan. */
  linkCandidates: readonly HouseholdEventPlanLinkCandidate[];
  viewerHasCalendarAccess: boolean;
  calendarActions?: HouseholdCalendarActions;
  planActions?: HouseholdEventPlanActions;
};

/**
 * The Household's shared Calendar and Event Plan planning region (issue #387).
 *
 * The two live under one component because one gesture crosses between them:
 * "Plan this event" is pressed on a read-only calendar row and answered by a
 * household-native form further down the screen. Holding that hand-off here
 * keeps the calendars free of any state about planning, which is what lets them
 * stay honestly read-only.
 *
 * It also owns the mutable copy of both reads. Every mutation answers with the
 * whole refreshed surface, so the section a member just changed is right
 * immediately, and `router.refresh()` lets the server tree catch up underneath
 * rather than being what the reader waits for.
 *
 * Failure isolation is structural here, not conditional: the calendars and the
 * Plans are separate reads, separate props, and separate sections, so one being
 * unreadable is invisible to the other.
 */
export function HouseholdPlanningSections({
  viewerUserId,
  viewerRole,
  members,
  now,
  calendars: initialCalendars,
  plans: initialPlans,
  linkCandidates,
  viewerHasCalendarAccess,
  calendarActions,
  planActions,
}: HouseholdPlanningSectionsProps) {
  const router = useRouter();
  const [calendars, setCalendars] = useState(initialCalendars);
  const [plans, setPlans] = useState(initialPlans);
  const [pendingCalendarEvent, setPendingCalendarEvent] =
    useState<PendingHouseholdCalendarEvent | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.userId, member.name])),
    [members],
  );

  // Who shared each calendar, named through the same resolver a Plan's
  // provenance uses, so "you" and a departed sharer read identically in both
  // sections rather than one of them inventing its own wording.
  const sharedByNames = useMemo(
    () =>
      new Map(
        (calendars?.connections ?? []).map((connection) => [
          connection.id,
          householdActorName({
            userId: connection.connectorUserId,
            viewerUserId,
            memberNames,
          }),
        ]),
      ),
    [calendars, viewerUserId, memberNames],
  );

  const families = useMemo(
    () =>
      calendars
        ? buildHouseholdCalendarFamilyViews({
            read: calendars.read,
            now,
            plannedEventKeys: plannedHouseholdCalendarEventKeys(
              (plans ?? []).map((entry) => entry.plan),
            ),
            sharedByNames,
          })
        : [],
    [calendars, now, plans, sharedByNames],
  );

  const groups = useMemo(
    () =>
      buildHouseholdEventPlanViews({
        plans: plans ?? [],
        read: calendars?.read ?? null,
        viewerUserId,
        memberNames,
      }),
    [plans, calendars, viewerUserId, memberNames],
  );

  return (
    <>
      {/*
        Mounted empty so a later confirmation is a content change into an
        existing region rather than a region appearing with its text already in
        it, which is announced unreliably.
      */}
      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>

      <HouseholdCalendarsPanel
        actions={calendarActions}
        canGovern={viewerRole === "owner"}
        families={families}
        onAnnounce={setAnnouncement}
        onPlanEvent={(event) => {
          const family = families.find(
            (candidate) => candidate.connectionId === event.connectionId,
          );
          setPendingCalendarEvent({
            nonce: Date.now(),
            calendarLabel: family?.label ?? "",
            eventTitle: event.title,
            whenLabel: event.whenLabel,
            address: {
              connectionId: event.connectionId,
              calendarId: event.calendarId,
              providerEventId: event.providerEventId,
            },
          });
        }}
        onSurfaceChange={(surface) => {
          setCalendars(surface);
          router.refresh();
        }}
        unavailable={calendars === null}
        viewerHasCalendarAccess={viewerHasCalendarAccess}
      />

      <HouseholdEventPlansPanel
        actions={planActions}
        groups={groups}
        linkCandidates={linkCandidates}
        memberNames={memberNames}
        onAnnounce={setAnnouncement}
        onPlanRefreshed={(current) => {
          // A write that lost its fence still learned the Plan's current value.
          // Showing it costs nothing and stops the row behind the form from
          // being the one stale thing on a screen that just explained staleness.
          // Its links are left as they were: a refused write read nothing about
          // them, so replacing them with an assumption would be inventing one.
          setPlans((existing) =>
            (existing ?? []).map((entry) =>
              entry.plan.id === current.id ? { ...entry, plan: current } : entry,
            ),
          );
        }}
        onPlansChange={(next) => {
          setPlans(next);
          router.refresh();
        }}
        pendingCalendarEvent={pendingCalendarEvent}
        unavailable={plans === null}
        viewerUserId={viewerUserId}
      />
    </>
  );
}
